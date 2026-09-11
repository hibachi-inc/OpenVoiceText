import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, LogicalPosition, monitorFromPoint, PhysicalPosition } from "@tauri-apps/api/window";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { Clock3, Download, Info, Keyboard, ListPlus, Settings2, Sparkles, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "./App.css";
import { localizeBridgeMessage, resolveSpeechLocale, type MessageKey } from "./i18n";
import { SpeechBridgeClient, type DeviceSettingsStatus, type SpeechStatus } from "./speech-bridge";
import { appLog } from "./applog";
import { buildRefinementPrompt, normalizeVocabularyEntries, postProcessTranscript, resolveCustomPrompt, shouldDiscardRefinement, vocabularyHints, type VocabularyEntry } from "./text-processing";
import { useI18n, I18nProvider } from "./app/i18n-context";
import { isModifierOnlyShortcut } from "./app/formatters";
import { DEFAULT_SETTINGS, DEFAULT_VOCABULARY, normalizeSettings } from "./app/settings";
import { useStoredState } from "./app/storage";
import type { CaptureMode, CloudResult, CloudTranscript, HistoryEntry, HudState, PendingChoice, Phase, PreparedCapture, Section, Settings, TranscriptionProvider } from "./app/types";
import { installUpdate, runUpdateCheck, type UpdateState } from "./app/update";
import { AboutPage, StarDialog } from "./features/about/AboutView";
import { bumpStarCount, markStarPromptShown, starPromptShown } from "./features/about/star-prompt";
import { HistoryDialog, HistoryPage } from "./features/history/HistoryViews";
import { jpegToWebp, makeHistoryThumbnail, purgeExpiredImages } from "./features/history/history-media";
import { Hud } from "./features/hud/Hud";
import { OnboardingDialog } from "./features/onboarding/OnboardingDialog";
import { PromptDialog } from "./features/prompts/PromptDialog";
import { isScreenCaptureAllowed } from "./features/privacy/screen-capture";
import { AiPage, GeneralPage, ShortcutPage, VocabularyPage } from "./features/settings/SettingsViews";

const nav: { id: Section; label: MessageKey; icon: LucideIcon }[] = [
  { id: "history", label: "nav.history", icon: Clock3 },
  { id: "general", label: "nav.general", icon: Settings2 },
  { id: "ai", label: "nav.ai", icon: Sparkles },
  { id: "vocabulary", label: "nav.vocabulary", icon: ListPlus },
  { id: "shortcuts", label: "nav.shortcuts", icon: Keyboard },
  { id: "about", label: "nav.about", icon: Info },
];

function Root() {
  const isHud = new URLSearchParams(location.search).has("hud");
  document.documentElement.classList.toggle("hud-page", isHud);
  document.body.classList.toggle("hud-body", isHud);
  if (isHud) return <Hud />;
  return <MainApp />;
}

function MainApp() {
  const [settings, setSettings] = useStoredState<Settings>(
    "voicelatte.settings",
    DEFAULT_SETTINGS,
    normalizeSettings,
  );
  return <I18nProvider preference={settings.appLanguage}><MainAppContent settings={settings} setSettings={setSettings} /></I18nProvider>;
}

function MainAppContent({ settings, setSettings }: { settings: Settings; setSettings: React.Dispatch<React.SetStateAction<Settings>> }) {
  const { language, t } = useI18n();
  const bridge = useMemo(() => new SpeechBridgeClient(), []);
  const [section, setSection] = useState<Section>("history");
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [level, setLevel] = useState(0);
  const [message, setMessage] = useState("");
  const speechLocale = useMemo(() => resolveSpeechLocale(settings.locale), [settings.locale]);
  const [history, setHistory] = useStoredState<HistoryEntry[]>("voicelatte.history", []);
  const [vocabulary, setVocabulary] = useStoredState<VocabularyEntry[]>("voicelatte.vocabulary", DEFAULT_VOCABULARY, normalizeVocabularyEntries);
  const [showPrompts, setShowPrompts] = useState(false);
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const [onboardingComplete, setOnboardingComplete] = useStoredState("voicelatte.onboardingComplete", false, (stored) => stored === true);
  const [showOnboarding, setShowOnboarding] = useState(!onboardingComplete);
  const [onboardingShortcutChosen, setOnboardingShortcutChosen] = useState(Boolean(settings.toggleShortcut));
  const [onboardingTestPassed, setOnboardingTestPassed] = useState(false);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);
  const [starOpen, setStarOpen] = useState(false);
  const [shortcutError, setShortcutError] = useState("");
  const [installing, setInstalling] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<DeviceSettingsStatus | null>(null);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [apiKeyHints, setApiKeyHints] = useStoredState<{ groq: string | null; gemini: string | null }>("voicelatte.apiKeyHints", { groq: null, gemini: null });
  // Keychainに項目は残っているが読み出しを拒否された状態。存在確認だけでは判別できないため保持する。
  const [apiKeyDenied, setApiKeyDenied] = useStoredState<{ groq: boolean; gemini: boolean }>("voicelatte.apiKeyDenied", { groq: false, gemini: false });
  const apiKeyDeniedRef = useRef(apiKeyDenied);
  apiKeyDeniedRef.current = apiKeyDenied;
  const transcriptRef = useRef("");
  const rawRef = useRef("");
  const choiceRef = useRef<PendingChoice | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const recordStartedAt = useRef(0);
  const levelRef = useRef(0);
  const engineRef = useRef("");
  const captureModeRef = useRef<CaptureMode>("live");
  const messageRef = useRef("");
  const spaceHintRef = useRef(false);
  const refiningRef = useRef(false);
  const elapsedRef = useRef(0);
  const processingStartRef = useRef(0);
  const hudVisibleRef = useRef(false);
  const onboardingTestRef = useRef(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const holdActive = useRef(false);
  const shortcutCaptureRef = useRef(false);
  const contextRef = useRef<{ appName: string; bundleID?: string; category: string; promptKey?: string; screenContext?: string; displayX?: number; displayY?: number; platform?: "macos" | "windows" }>({ appName: "VoiceLatte", category: "generic" });
  const captureRef = useRef<string | undefined>(undefined);
  const recordingProviderRef = useRef<TranscriptionProvider>("local");
  // stopRecordingの世代。処理中のEscキャンセルで進め、取り残した非同期の続きを無効化する。
  const stopGenRef = useRef(0);
  const actionRef = useRef<(action: "toggle" | "refine-stop" | "cancel" | "hold-start" | "hold-stop" | "shared-start" | "shared-stop") => void>(() => {});
  const setShortcutCapturing = useCallback((capturing: boolean) => { shortcutCaptureRef.current = capturing; }, []);
  const localizedError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return localizeBridgeMessage(message, language, t);
  }, [language, t]);
  const refreshApiKeys = useCallback(async () => {
    const [groq, gemini] = await Promise.all([
      invoke<boolean>("api_key_present", { provider: "groq" }),
      invoke<boolean>("api_key_present", { provider: "gemini" }),
    ]);
    setApiKeyHints((current) => ({
      groq: groq && !apiKeyDeniedRef.current.groq ? current.groq ?? "••••" : null,
      gemini: gemini && !apiKeyDeniedRef.current.gemini ? current.gemini ?? "••••" : null,
    }));
  }, [setApiKeyHints]);

  const markKeyDenied = useCallback((provider: "groq" | "gemini") => {
    setApiKeyHints((current) => ({ ...current, [provider]: null }));
    setApiKeyDenied((current) => ({ ...current, [provider]: true }));
  }, [setApiKeyDenied, setApiKeyHints]);

  const installSpeechModel = useCallback(async () => {
    setInstalling(true);
    try { await bridge.installModel(speechLocale); setStatus(await bridge.status(speechLocale)); }
    catch (error) { setMessage(localizedError(error)); }
    finally { setInstalling(false); }
  }, [bridge, localizedError, speechLocale]);

  const saveApiKey = useCallback(async (provider: "groq" | "gemini", key: string) => {
    const mask = await invoke<string>("set_api_key", { provider, key });
    setApiKeyHints((current) => ({ ...current, [provider]: mask }));
    setApiKeyDenied((current) => ({ ...current, [provider]: false }));
  }, [setApiKeyDenied, setApiKeyHints]);

  const clearApiKey = useCallback(async (provider: "groq" | "gemini") => {
    await invoke("clear_api_key", { provider });
    setApiKeyHints((current) => ({ ...current, [provider]: null }));
    setApiKeyDenied((current) => ({ ...current, [provider]: false }));
  }, [setApiKeyDenied, setApiKeyHints]);

  const updateHud = useCallback(async (next: HudState) => {
    const shouldShow = next.phase !== "idle";
    const visibilityChanged = hudVisibleRef.current !== shouldShow;
    hudVisibleRef.current = shouldShow;
    await emitTo("hud", "recording-state", next);
    if (!visibilityChanged) return;
    const hud = await WebviewWindow.getByLabel("hud");
    if (!hud) return;
    if (!shouldShow) await hud.hide();
    else await hud.show();
  }, []);

  const setRecordingState = useCallback((next: Partial<HudState> & { phase?: Phase }) => {
    const nextPhase = next.phase ?? phaseRef.current;
    phaseRef.current = nextPhase;
    if (next.phase) setPhase(next.phase);
    if (next.transcript !== undefined) {
      transcriptRef.current = next.transcript;
      setTranscript(next.transcript);
    }
    if (next.level !== undefined) { levelRef.current = next.level; setLevel(next.level); }
    if (next.engine !== undefined) engineRef.current = next.engine;
    if (next.captureMode !== undefined) captureModeRef.current = next.captureMode;
    if (next.message !== undefined) { messageRef.current = next.message; setMessage(next.message); }
    if (next.spaceHint !== undefined) spaceHintRef.current = next.spaceHint;
    if (next.raw !== undefined) rawRef.current = next.raw;
    if (next.refining !== undefined) refiningRef.current = next.refining;
    if (next.elapsed !== undefined) elapsedRef.current = next.elapsed;
    if (next.phase === "idle") { spaceHintRef.current = false; refiningRef.current = false; rawRef.current = ""; }
    if (!onboardingTestRef.current) {
      const pending = choiceRef.current;
      void updateHud({
        phase: nextPhase,
        transcript: next.transcript ?? transcriptRef.current,
        raw: next.raw ?? rawRef.current,
        level: next.level ?? levelRef.current,
        engine: next.engine ?? engineRef.current,
        captureMode: next.captureMode ?? captureModeRef.current,
        uiLanguage: language,
        message: next.message ?? messageRef.current,
        spaceHint: spaceHintRef.current,
        refining: refiningRef.current,
        elapsed: elapsedRef.current,
        choice: pending ? { raw: pending.raw, refined: pending.text } : undefined,
      });
    }
  }, [language, updateHud]);

  const startRecording = useCallback(async (onboardingTest = false) => {
    if (phaseRef.current !== "idle") return;
    if (onboardingTest && !onboardingShortcutChosen) return;
    phaseRef.current = "preparing";
    recordStartedAt.current = Date.now();
    onboardingTestRef.current = onboardingTest;
    if (onboardingTest) setOnboardingTestPassed(false);
    const provider = settings.transcriptionProvider;
    const context = await bridge.context().catch(() => ({ appName: "Unknown", category: "generic", platform: undefined, displayX: undefined, displayY: undefined }));
    if (!onboardingTest) contextRef.current = context;
    await positionHud(context.platform, context.displayX, context.displayY).catch(() => undefined);
    setRecordingState({
      phase: "preparing",
      transcript: "",
      level: 0,
      captureMode: provider === "local" ? "live" : "deferred",
      message: t("record.preparing"),
    });
    try {
      if (provider !== "local" && !apiKeyHints[provider]) throw new Error("cloud.key_missing");
      recordingProviderRef.current = provider;
      const cloudProvider = provider === "local" ? undefined : provider;
      const capture = cloudProvider ? await invoke<PreparedCapture>("prepare_capture") : undefined;
      captureRef.current = capture?.captureId;
      await bridge.start(
        speechLocale,
        vocabularyHints(vocabulary),
        settings.microphoneUID,
        settings.muteOtherAudio,
        {
          onTranscript: (text) => setRecordingState({ transcript: text }),
          onAudioLevel: (nextLevel) => setRecordingState({ level: nextLevel }),
          onEngine: (nextEngine) => setRecordingState({ engine: nextEngine }),
          onError: (error) => {
            appLog.error("recording", `bridge onError: ${error}`);
            const captureId = captureRef.current;
            captureRef.current = undefined;
            recordingProviderRef.current = "local";
            void bridge.cancel().catch(() => undefined).finally(() => {
              if (captureId) void invoke("discard_capture", { captureId });
            });
            setRecordingState({ phase: "error", message: localizeBridgeMessage(error, language, t) });
            window.setTimeout(() => {
              setRecordingState({ phase: "idle" });
              onboardingTestRef.current = false;
            }, 2500);
          },
        },
        capture && cloudProvider ? { audioPath: capture.audioPath, provider: cloudProvider } : undefined,
      );
      setRecordingState({ phase: "listening", message: t("record.listening"), spaceHint: settings.refinement && settings.toggleShortcut !== "Space" && settings.holdShortcut !== "Space" });
    } catch (error) {
      appLog.error("recording", `start failed: ${error instanceof Error ? error.message : String(error)}`);
      if (captureRef.current) {
        void invoke("discard_capture", { captureId: captureRef.current });
        captureRef.current = undefined;
      }
      recordingProviderRef.current = "local";
      setRecordingState({ phase: "error", message: localizedError(error) });
      window.setTimeout(() => {
        setRecordingState({ phase: "idle" });
        onboardingTestRef.current = false;
      }, 2500);
    }
  }, [apiKeyHints, bridge, language, localizedError, onboardingShortcutChosen, setRecordingState, settings.microphoneUID, settings.muteOtherAudio, settings.transcriptionProvider, speechLocale, t, vocabulary]);

  const stopRecording = useCallback(async (withAiRefinement = false) => {
    if (phaseRef.current !== "listening" && phaseRef.current !== "preparing") return;
    // AI整形しない停止では「整形中」と出さず「文字起こし中」にする
    const willRefine = withAiRefinement && settings.refinement;
    setRecordingState({ phase: "processing", level: 0, refining: willRefine, elapsed: 0, message: willRefine ? (recordingProviderRef.current === "local" ? t("record.processing") : t("record.cloudProcessing")) : t("state.transcribing") });
    processingStartRef.current = Date.now();
    const gen = stopGenRef.current;
    const stale = () => gen !== stopGenRef.current;
    try {
      // 停止と並行で文脈を取り直す。録音中にAXツリーが温まるため開始時より取れる。
      // 別アプリに移っていたら開始時のものを優先する。遅延を増やさないよう並列実行。
      const startedCtx = contextRef.current;
      // 画面キャプチャも並列で取る。撮れれば画像を添付し（対応モデルのみ）、
      // 撮れない・非対応のときはAXツリー文言で大体する（画像添付時はRust側でAX文言を省く）。
      // 履歴確認用に撮影画像の縮小版は方式問わず残す。
      // Gemini向けはWebPに変換して帯域を節約する（失敗時はJPEGのまま）。
      const wantWebp = settings.refinementProvider === "gemini" && apiKeyHints.gemini !== null;
      const shotPromise: Promise<{ data: string; mime: string } | null> = (async () => {
        if (!withAiRefinement || !settings.refinement) return null;
        if (!isScreenCaptureAllowed(startedCtx)) return null;
        try {
          const jpeg = await bridge.screenshot(startedCtx.displayX, startedCtx.displayY, startedCtx.bundleID);
          if (!jpeg) return null;
          if (!wantWebp) return { data: jpeg, mime: "image/jpeg" };
          return (await jpegToWebp(jpeg)) ?? { data: jpeg, mime: "image/jpeg" };
        } catch {
          return null;
        }
      })();
      const [stopResult, freshCtx, shot] = await Promise.all([
        bridge.stop(),
        withAiRefinement && settings.refinement ? bridge.context().catch(() => null) : Promise.resolve(null),
        shotPromise,
      ]);
      if (stale()) return;
      const freshTree = freshCtx?.screenContext ?? "";
      const startedTree = startedCtx.screenContext ?? "";
      const sameApp = freshCtx !== null
        && (freshCtx.bundleID ? freshCtx.bundleID === startedCtx.bundleID : freshCtx.appName === startedCtx.appName);
      const refreshed = sameApp && freshTree.length > startedTree.length;
      if (refreshed) {
        contextRef.current = { ...startedCtx, screenContext: freshTree };
      }
      const raw = stopResult.text;
      // final応答に載った確定エンジンを優先する。onEngine由来は別セッションの古い値が残ることがある。
      if (stopResult.engine) engineRef.current = stopResult.engine;
      if (onboardingTestRef.current) {
        const provider = recordingProviderRef.current;
        const captureId = captureRef.current;
        const cloud = provider !== "local" && captureId ? await invoke<CloudResult>("cloud_transcribe", {
          captureId,
          provider,
          prompt: "",
          locale: speechLocale,
          vocabulary: vocabularyHints(vocabulary),
          screenContext: "",
        }).catch((error) => {
          if (bridgeMessageCode(error) === "cloud.key_denied") markKeyDenied(provider);
          throw error;
        }) : undefined;
        captureRef.current = undefined;
        const result = cloud?.text ?? raw;
        if (stale()) return;
        setOnboardingTestPassed(Boolean(result.trim()));
        setRecordingState({ phase: "idle", transcript: result, level: 0, engine: cloud?.model, message: "" });
        recordingProviderRef.current = "local";
        onboardingTestRef.current = false;
        return;
      }
      const { category, appName, promptKey } = contextRef.current;
      const shouldRefine = withAiRefinement && settings.refinement;
      const screenContext = shouldRefine ? contextRef.current.screenContext ?? "" : "";
      // 内容は保存・記録せず文字数のみ。0なら取得失敗、0超なら送信済みで用途側の問題に切り分けられる。
      const screenChars = screenContext.length;
      if (shouldRefine) appLog.info("refine", `screen context ${screenChars} chars from ${appName} (${refreshed ? "stop" : "start"})${shot ? ` + shot ${Math.round(shot.data.length / 1024)}KB ${shot.mime}` : ""}`);
      // 詳細表示用に先頭だけ残す。デバッグモードのときだけ保存する。画面内容なのでlocalStorageの履歴消去と一緒に消える。
      const screenText = settings.debugMode && shouldRefine && screenChars > 0 ? screenContext.slice(0, 2000) : undefined;
      const customPrompt = resolveCustomPrompt(settings.customPrompts, contextRef.current);
      const refinementPrompt = shouldRefine
        ? buildRefinementPrompt(customPrompt, vocabulary, speechLocale)
        : "";
      const provider = recordingProviderRef.current;
      const captureId = captureRef.current;
      if (provider !== "local" && !captureId) throw new Error("cloud.capture_missing");
      const cloudRefinementProvider = shouldRefine && settings.refinementProvider !== "local" && Boolean(apiKeyHints[settings.refinementProvider])
        ? settings.refinementProvider
        : undefined;
      // Geminiで文字起こしも整形も行う場合は専用ルートで一本化する
      // （音声・画像・プロンプトを同時投入）。それ以外は従来の2段構成。
      // 結合ルートは両方が同じGeminiモデルのときだけ使う。
      // 値が一致すれば音声対応が保証される（転写側は対応モデルのみ保持）。
      const useGeminiCombined = provider === "gemini"
        && cloudRefinementProvider === "gemini"
        && settings.refinementModel === settings.transcriptionModel;
      let cloud: CloudResult | undefined;
      if (provider !== "local") {
        const onKeyDenied = (error: unknown) => {
          if (bridgeMessageCode(error) === "cloud.key_denied") markKeyDenied(provider);
          throw error;
        };
        if (useGeminiCombined) {
          cloud = await invoke<CloudResult>("cloud_transcribe_refine", {
            captureId,
            prompt: refinementPrompt,
            locale: speechLocale,
            screenContext,
            model: settings.refinementModel || null,
            image: shot?.data ?? null,
            imageMime: shot?.mime ?? null,
          }).catch((error) => onKeyDenied(error));
        } else {
          cloud = await invoke<CloudResult>("cloud_transcribe", {
            captureId,
            provider,
            prompt: "",
            locale: speechLocale,
            vocabulary: vocabularyHints(vocabulary),
            screenContext,
            model: settings.transcriptionModel || null,
          }).catch((error) => onKeyDenied(error));
        }
      }
      captureRef.current = undefined;
      if (stale()) return;
      const source = cloud?.text ?? raw;
      // 結合ルートは整形前の文字起こしも返す。なければ整形済みで代用する。
      const cloudRaw = cloud?.raw && cloud.raw.trim() ? cloud.raw : undefined;
      let refiner = "local";
      if (!source.trim()) {
        recordingProviderRef.current = "local";
        setRecordingState({ phase: "idle", transcript: "" });
        return;
      }
      if (cloud) setRecordingState({ transcript: source, engine: cloud.model });
      // 整形がengineRefを上書きする前に文字起こし側を確定させる
      const transcriptionEngine = cloud?.model ?? engineRef.current;
      if (cloud && useGeminiCombined && shouldRefine) refiner = cloud.model;
      let refined = source;
      if (shouldRefine && !useGeminiCombined) {
        if (cloudRefinementProvider) {
          try {
            const result = await invoke<CloudResult>("cloud_refine", { provider: cloudRefinementProvider, text: source, prompt: refinementPrompt, screenContext, model: settings.refinementModel || null, image: shot?.data ?? null, imageMime: shot?.mime ?? null });
            refined = result.text;
            refiner = result.model || cloudRefinementProvider;
            if (result.fallbackFrom) appLog.warn("refine", `fell back to ${refiner} (${result.fallbackFrom})`);
            appLog.info("refine", `cloud ${cloudRefinementProvider} ok (${refiner})`);
            setRecordingState({ transcript: refined, engine: result.model });
          } catch (error) {
            if (bridgeMessageCode(error) === "cloud.key_denied") {
              markKeyDenied(cloudRefinementProvider);
              throw error;
            }
            appLog.error("refine", `cloud ${cloudRefinementProvider} failed, falling back to local: ${error instanceof Error ? error.message : String(error)}`);
            refined = await bridge.refine(source, category, refinementPrompt, speechLocale, screenContext).catch(() => source);
            if (stale()) return;
          }
        } else {
          refined = await bridge.refine(source, category, refinementPrompt, speechLocale, screenContext).catch(() => source);
          if (stale()) return;
        }
      }
      // 整形結果がプロンプトや文脈のコピーになっていたら生テキストに戻す
      const text = postProcessTranscript(shouldDiscardRefinement(refined, source, screenContext) ? source : refined, vocabulary);
      // 履歴確認用に撮影画像の縮小版を残す（1日保持）。デバッグモードのときだけ。失敗時はなしで続行。
      const image = settings.debugMode && shot ? (await makeHistoryThumbnail(shot.data, shot.mime)) ?? undefined : undefined;
      // Space確定のときは自動ペーストせず、前後見比べの選択肢としてHUDに残す
      if (shouldRefine) {
        choiceRef.current = { text, raw: cloudRaw ?? source, category, engine: transcriptionEngine, appName, promptKey: promptKey ?? appName, refiner, screenChars, screenText, image };
        recordingProviderRef.current = "local";
        setRecordingState({ phase: "done", transcript: text, message: t("record.choose") });
        // 選択肢はHUD同一ウィンドウ内に表示する。キー操作のため一時的にフォーカス可能にする。
        if (contextRef.current.platform !== "windows") await focusHudForChoice(bridge).catch(() => undefined);
        return;
      }
      const entry: HistoryEntry = { id: crypto.randomUUID(), text, raw: cloudRaw ?? source, createdAt: Date.now(), category, engine: transcriptionEngine, appName, promptKey: promptKey ?? appName, refiner: shouldRefine ? refiner : undefined, screenChars: shouldRefine ? screenChars : undefined, screenText: shouldRefine ? screenText : undefined, image };
      setHistory((items) => purgeExpiredImages([entry, ...items]).slice(0, 500));
      if (!starPromptShown() && bumpStarCount() >= 3) { markStarPromptShown(); setStarOpen(true); }
      await bridge.insert(text, settings.autoPaste);
      recordingProviderRef.current = "local";
      setRecordingState({ phase: "done", transcript: text, message: settings.autoPaste ? t("record.inserted") : t("record.completed") });
      window.setTimeout(() => setRecordingState({ phase: "idle" }), 1400);
    } catch (error) {
      if (stale()) return;
      appLog.error("recording", `stop failed after ${Date.now() - recordStartedAt.current}ms: ${error instanceof Error ? error.message : String(error)}`);
      if (captureRef.current) {
        void invoke("discard_capture", { captureId: captureRef.current });
        captureRef.current = undefined;
      }
      recordingProviderRef.current = "local";
      setRecordingState({ phase: "error", message: localizedError(error) });
      window.setTimeout(() => {
        setRecordingState({ phase: "idle" });
        onboardingTestRef.current = false;
      }, 2500);
    }
  }, [bridge, localizedError, markKeyDenied, setHistory, setRecordingState, setStarOpen, settings, speechLocale, t, vocabulary]);

  const cancelRecording = useCallback(async () => {
    await bridge.cancel().catch(() => undefined);
    if (captureRef.current) {
      await invoke("discard_capture", { captureId: captureRef.current }).catch(() => undefined);
      captureRef.current = undefined;
    }
    recordingProviderRef.current = "local";
    setRecordingState({ phase: "idle", transcript: "", level: 0 });
    if (onboardingTestRef.current) setOnboardingTestPassed(false);
    onboardingTestRef.current = false;
  }, [bridge, setRecordingState]);

  // 処理中（文字起こし・AI整形待ち）のEscキャンセル。進行中の非同期は世代で無効化し、
  // ネイティブ側はstop応答済みのため追加操作なしで破棄する。ペーストも履歴保存もしない。
  const cancelProcessing = useCallback(() => {
    stopGenRef.current++;
    const captureId = captureRef.current;
    captureRef.current = undefined;
    if (captureId) void invoke("discard_capture", { captureId }).catch(() => undefined);
    recordingProviderRef.current = "local";
    if (onboardingTestRef.current) setOnboardingTestPassed(false);
    onboardingTestRef.current = false;
    setRecordingState({ phase: "idle", transcript: "", level: 0 });
  }, [setRecordingState]);

  // 見比べ選択の確定。which が raw なら整形前、refined なら整形後をペーストする。
  const finalizeChoice = useCallback(async (which: "raw" | "refined") => {
    const choice = choiceRef.current;
    if (!choice) return;
    choiceRef.current = null;
    const text = which === "raw" ? choice.raw : choice.text;
    const entry: HistoryEntry = { id: crypto.randomUUID(), text, raw: choice.raw, createdAt: Date.now(), category: choice.category, engine: choice.engine, appName: choice.appName, promptKey: choice.promptKey, refiner: choice.refiner, screenChars: choice.screenChars, screenText: choice.screenText, image: choice.image };
    setHistory((items) => purgeExpiredImages([entry, ...items]).slice(0, 500));
    if (!starPromptShown() && bumpStarCount() >= 3) { markStarPromptShown(); setStarOpen(true); }
    await bridge.insert(text, settings.autoPaste);
    // 選択肢表示で前面に出した分は必ず戻す（insertが切替済みでも同アプリへの再送で無害）
    await bridge.restoreApp().catch(() => undefined);
    void releaseHudFocus().catch(() => undefined);
    setRecordingState({ phase: "idle", transcript: "", level: 0 });
  }, [bridge, setHistory, setRecordingState, setStarOpen, settings.autoPaste]);

  // 見比べ選択の破棄。ペーストも履歴保存もしない。退かせた前面アプリに戻す。
  const discardChoice = useCallback(() => {
    if (!choiceRef.current) return;
    choiceRef.current = null;
    void (async () => {
      await bridge.restoreApp().catch(() => undefined);
      await releaseHudFocus().catch(() => undefined);
    })();
    setRecordingState({ phase: "idle", transcript: "", level: 0 });
  }, [bridge, setRecordingState]);

  useEffect(() => {
    actionRef.current = (action) => {
      const beginHold = (delay: number) => {
        window.clearTimeout(holdTimer.current);
        holdActive.current = false;
        holdTimer.current = window.setTimeout(() => {
          holdActive.current = true;
          void startRecording(showOnboarding).then(() => {
            if (!holdActive.current && phaseRef.current === "listening") void stopRecording();
          });
        }, delay);
      };
      const endHold = (toggleOnTap: boolean) => {
        window.clearTimeout(holdTimer.current);
        const wasHold = holdActive.current;
        if (wasHold && phaseRef.current === "listening") void stopRecording();
        holdActive.current = false;
        if (toggleOnTap && !wasHold) void (phaseRef.current === "idle" ? startRecording(showOnboarding) : stopRecording());
      };
      // 見比べ選択中はトグルで整形版確定、キャンセルで破棄する
      if (phaseRef.current === "done" && choiceRef.current) {
        if (action === "toggle" || action === "refine-stop") void finalizeChoice("refined");
        else if (action === "cancel") discardChoice();
        return;
      }
      if (action === "toggle") void (phaseRef.current === "idle" ? startRecording(showOnboarding) : stopRecording());
      if (action === "refine-stop" && phaseRef.current === "listening") void stopRecording(true);
      if (action === "cancel" && (phaseRef.current === "listening" || phaseRef.current === "preparing")) void cancelRecording();
      if (action === "cancel" && phaseRef.current === "processing") cancelProcessing();
      if (action === "hold-start") beginHold(150);
      if (action === "hold-stop") endHold(false);
      if (action === "shared-start") beginHold(300);
      if (action === "shared-stop") endHold(true);
    };
  }, [cancelProcessing, cancelRecording, discardChoice, finalizeChoice, showOnboarding, startRecording, stopRecording]);

  useEffect(() => {
    void bridge.status(speechLocale).then((next) => {
      setStatus(next);
      if (next.modelState === "ready") void bridge.warmUp(speechLocale).catch(() => undefined);
    }).catch((error) => setMessage(localizedError(error)));
    void bridge.settingsStatus().then(setDeviceStatus).catch(() => undefined);
    void isAutostartEnabled().then(setLaunchAtLogin).catch(() => undefined);
    void refreshApiKeys().catch(() => undefined);
  }, [bridge, localizedError, refreshApiKeys, speechLocale]);

  useEffect(() => { void runUpdateCheck(setUpdate, false); }, []);

  // 保存済み履歴の古い撮影画像を破棄する（1日保持）。
  useEffect(() => {
    setHistory((items) => purgeExpiredImages(items));
  }, [setHistory]);

  // 長時間起動中も古い画像が残らないよう定期的に破棄する。
  useEffect(() => {
    const timer = window.setInterval(() => {
      setHistory((items) => purgeExpiredImages(items));
    }, 3600 * 1000);
    return () => window.clearInterval(timer);
  }, [setHistory]);

  // セットアップの表示時に画面収録の確認を済ませる。初回撮影でOSが確認
  // ダイアログを出すため、画像自体は捨てる。拒否時は権限欄の誘導に任せる。
  const screenCapturePromptedRef = useRef(false);
  useEffect(() => {
    if (!showOnboarding) {
      screenCapturePromptedRef.current = false;
      return;
    }
    if (screenCapturePromptedRef.current) return;
    if (deviceStatus?.platform !== "macos") return;
    if (
      deviceStatus.screenCapturePermission === "authorized" ||
      deviceStatus.screenCapturePermission === "not-required"
    ) {
      return;
    }
    screenCapturePromptedRef.current = true;
    void (async () => {
      await bridge.screenshot().catch(() => null);
      const next = await bridge.settingsStatus().catch(() => null);
      if (next) setDeviceStatus(next);
    })();
  }, [showOnboarding, deviceStatus, bridge, setDeviceStatus]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<CloudTranscript>("cloud-transcript", (event) => {
      if (phaseRef.current === "processing") setRecordingState({ transcript: event.payload.text, engine: event.payload.model });
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [setRecordingState]);

  // 処理中の経過秒をHUDへ送る。停滞の予兆として見せる。
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (phaseRef.current !== "processing") return;
      const elapsed = Math.floor((Date.now() - processingStartRef.current) / 1000);
      if (elapsed !== elapsedRef.current) setRecordingState({ elapsed });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [setRecordingState]);

  useEffect(() => () => { void bridge.close(); }, [bridge]);

  useEffect(() => {
    if (section !== "general" && !showOnboarding) return;
    const refresh = () => void bridge.settingsStatus().then(setDeviceStatus).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [bridge, section, showOnboarding]);

  useEffect(() => {
    let alive = true;
    setShortcutError("");
    void (async () => {
      await bridge.configureModifierShortcuts([], () => undefined);
      const toggleModifierOnly = isModifierOnlyShortcut(settings.toggleShortcut);
      const holdModifierOnly = isModifierOnlyShortcut(settings.holdShortcut);
      const sharedShortcut = settings.toggleShortcut === settings.holdShortcut;
      let sharedPressed = false;
      const handleSharedShortcut = (state: "Pressed" | "Released") => {
        if (shortcutCaptureRef.current) return;
        if (state === "Pressed") {
          if (sharedPressed) return;
          sharedPressed = true;
          actionRef.current("shared-start");
        } else {
          if (!sharedPressed) return;
          sharedPressed = false;
          actionRef.current("shared-stop");
        }
      };
      if (sharedShortcut) {
        if (toggleModifierOnly) await bridge.configureModifierShortcuts([settings.toggleShortcut], (_shortcut, state) => handleSharedShortcut(state));
        else await register(settings.toggleShortcut, (event) => handleSharedShortcut(event.state));
        return;
      }
      if (!toggleModifierOnly) {
        await register(settings.toggleShortcut, (event) => {
          if (!shortcutCaptureRef.current && event.state === "Pressed") actionRef.current("toggle");
        });
      }
      if (!holdModifierOnly) {
        await register(settings.holdShortcut, (event) => {
          if (!shortcutCaptureRef.current) actionRef.current(event.state === "Pressed" ? "hold-start" : "hold-stop");
        });
      }
      const modifierShortcuts = [toggleModifierOnly && settings.toggleShortcut, holdModifierOnly && settings.holdShortcut].filter((shortcut): shortcut is string => Boolean(shortcut));
      if (modifierShortcuts.length > 0) {
        await bridge.configureModifierShortcuts(modifierShortcuts, (shortcut, state) => {
          if (shortcutCaptureRef.current) return;
          if (shortcut === settings.toggleShortcut) {
            if (state === "Pressed") actionRef.current("toggle");
          } else if (shortcut === settings.holdShortcut) {
            actionRef.current(state === "Pressed" ? "hold-start" : "hold-stop");
          }
        });
      }
    })().catch((error) => alive && setShortcutError(t("error.shortcut", { message: localizedError(error) })));
    // 他effectの登録（Esc/Space）を巻き込まないよう対象だけ外す
    return () => {
      alive = false;
      const { toggleShortcut, holdShortcut } = settings;
      void (async () => {
        await unregister(toggleShortcut).catch(() => undefined);
        if (holdShortcut !== toggleShortcut) await unregister(holdShortcut).catch(() => undefined);
      })();
    };
  }, [bridge, localizedError, settings.holdShortcut, settings.toggleShortcut, t]);

  useEffect(() => {
    if (phase !== "listening" || showOnboarding || !settings.refinement
      || settings.toggleShortcut === "Space" || settings.holdShortcut === "Space") return;
    let active = true;
    // 先に解除してから登録する。解除漏れの残骸があると登録が失敗してEscが死ぬため。
    void (async () => {
      await unregister("Space").catch(() => undefined);
      if (!active) return;
      await register("Space", (event) => {
        if (active && event.state === "Pressed" && !shortcutCaptureRef.current) actionRef.current("refine-stop");
      }).catch((error) => {
        appLog.warn("shortcut", `space register failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    })();
    return () => {
      active = false;
      void unregister("Space").catch(() => undefined);
    };
  }, [phase, settings.holdShortcut, settings.refinement, settings.toggleShortcut, showOnboarding]);

  useEffect(() => {
    if ((phase !== "listening" && phase !== "preparing" && phase !== "processing")
      || settings.toggleShortcut === "Escape" || settings.holdShortcut === "Escape") return;
    let active = true;
    // 先に解除してから登録する。解除漏れの残骸があると登録が失敗してEscが死ぬため。
    void (async () => {
      await unregister("Escape").catch(() => undefined);
      if (!active) return;
      await register("Escape", (event) => {
        if (active && event.state === "Pressed" && !shortcutCaptureRef.current) actionRef.current("cancel");
      }).catch((error) => {
        appLog.warn("shortcut", `escape register failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    })();
    return () => {
      active = false;
      void unregister("Escape").catch(() => undefined);
    };
  }, [phase, settings.holdShortcut, settings.toggleShortcut]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("hud-stop", () => actionRef.current("toggle")).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ which: "raw" | "refined" | "cancel" }>("hud-choose", (event) => {
      if (event.payload.which === "cancel") discardChoice();
      else void finalizeChoice(event.payload.which);
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [discardChoice, finalizeChoice]);

  return (
    <main className="app-shell">
      <div className="window-drag-region" data-tauri-drag-region />
      <aside className="sidebar" aria-label={t("aria.settingsCategories")}>
        <div className="sidebar-brand">Voice Latte</div>
        <nav>{nav.map((item) => {
          const Icon = item.icon;
          return <Button
            variant="ghost"
            className={cn("nav-item h-auto justify-start", item.id === section && "selected")}
            key={item.id}
            onClick={() => setSection(item.id)}
          >
            <Icon aria-hidden="true" />{t(item.label)}
          </Button>;
        })}</nav>
        {update.status === "available" && <Button size="sm" className="sidebar-update" onClick={() => void installUpdate(update, setUpdate)}>
          <Download />{t("update.install", { version: update.version })}
        </Button>}
        {update.status === "downloading" && <Button size="sm" className="sidebar-update" disabled>
          <Download />{t("update.downloading")}
        </Button>}
      </aside>

      <section className="content">
        {section === "history" && <HistoryPage
          phase={phase} transcript={transcript} history={history}
          onToggle={() => actionRef.current("toggle")} onCancel={() => void cancelRecording()}
          onSelect={setSelected} onClear={() => setHistory([])}
        />}
        {section === "general" && <GeneralPage
          settings={settings} setSettings={setSettings} deviceStatus={deviceStatus} launchAtLogin={launchAtLogin}
          onLaunchAtLogin={async (enabled) => {
            if (enabled) await enableAutostart(); else await disableAutostart();
            setLaunchAtLogin(await isAutostartEnabled());
          }}
          onRequestPermission={async (permission) => {
            await bridge.requestPermission(permission);
            setDeviceStatus(await bridge.settingsStatus());
          }}
        />}
        {section === "ai" && <AiPage
          status={status} settings={settings} setSettings={setSettings} installing={installing}
          deviceStatus={deviceStatus} apiKeyHints={apiKeyHints}
          onPrompts={() => setShowPrompts(true)}
          onInstall={() => void installSpeechModel()}
          onSaveApiKey={saveApiKey}
          onClearApiKey={clearApiKey}
        />}
        {section === "vocabulary" && <VocabularyPage entries={vocabulary} setEntries={setVocabulary} />}
        {section === "shortcuts" && <ShortcutPage settings={settings} setSettings={setSettings} error={shortcutError} onCaptureChange={setShortcutCapturing} />}
        {section === "about" && <AboutPage update={update} setUpdate={setUpdate} debugMode={settings.debugMode} onToggleDebugMode={(debugMode) => setSettings((s) => ({ ...s, debugMode }))} onOpenOnboarding={() => {
          setOnboardingShortcutChosen(false);
          setOnboardingTestPassed(false);
          setShowOnboarding(true);
        }} />}
      </section>

      {showOnboarding && <OnboardingDialog
        dismissible={onboardingComplete}
        phase={phase}
        transcript={transcript}
        level={level}
        message={message}
        settings={settings}
        setSettings={setSettings}
        status={status}
        deviceStatus={deviceStatus}
        installing={installing}
        apiKeyHints={apiKeyHints}
        shortcutChosen={onboardingShortcutChosen}
        testPassed={onboardingTestPassed}
        shortcutError={shortcutError}
        onRequestPermission={async (permission) => {
          await bridge.requestPermission(permission);
          setDeviceStatus(await bridge.settingsStatus());
        }}
        onInstall={() => void installSpeechModel()}
        onSaveApiKey={saveApiKey}
        onClearApiKey={clearApiKey}
        onShortcutCaptureChange={setShortcutCapturing}
        onShortcutChange={(shortcut) => {
          setOnboardingShortcutChosen(true);
          setOnboardingTestPassed(false);
          setSettings((current) => ({ ...current, toggleShortcut: shortcut, holdShortcut: shortcut }));
        }}
        onComplete={() => {
          setOnboardingComplete(true);
          setShowOnboarding(false);
        }}
        onClose={() => {
          if (onboardingTestRef.current) void cancelRecording();
          setShowOnboarding(false);
        }}
      />}
      {showPrompts && <PromptDialog settings={settings} setSettings={setSettings} history={history} onClose={() => setShowPrompts(false)} />}
      {selected && <HistoryDialog entry={selected} debugMode={settings.debugMode} onClose={() => setSelected(null)} />}
      {starOpen && <StarDialog onClose={() => setStarOpen(false)} />}
      {message && phase === "error" && <div className="toast error-toast">{message}</div>}
    </main>
  );
}

function bridgeMessageCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(":", 2)[0];
}

async function positionHud(platform?: "macos" | "windows", displayX?: number, displayY?: number) {
  const hud = await WebviewWindow.getByLabel("hud");
  if (!hud) return;
  const monitor = displayX !== undefined && displayY !== undefined
    ? await monitorFromPoint(displayX, displayY) ?? await currentMonitor()
    : await currentMonitor();
  if (!monitor) return;
  const windowSize = await hud.outerSize();
  const windowScale = await hud.scaleFactor();
  const area = monitor.workArea;
  const width = windowSize.width / windowScale;
  const height = windowSize.height / windowScale;
  if (platform === "macos" && displayX !== undefined && displayY !== undefined) {
    await hud.setPosition(new LogicalPosition(
      area.position.x / monitor.scaleFactor + (area.size.width / monitor.scaleFactor - width) / 2,
      area.position.y / monitor.scaleFactor + area.size.height / monitor.scaleFactor - height - 34,
    ));
    return;
  }
  await hud.setPosition(new PhysicalPosition(
    Math.round(area.position.x + (area.size.width - width * monitor.scaleFactor) / 2),
    Math.round(area.position.y + area.size.height - (height + 34) * monitor.scaleFactor),
  ));
}

// 選択肢はHUD同一ウィンドウ内に表示する。キー操作のため一時的にフォーカス可能にし、
// アプリ自体を前面に出す（非アクティブなアプリのウィンドウにはキーが届かないため）。
async function focusHudForChoice(bridge: SpeechBridgeClient) {
  const hud = await WebviewWindow.getByLabel("hud").catch(() => null);
  if (!hud) return;
  try {
    await hud.setFocusable(true);
    await bridge.focusApp();
    await hud.setFocus().catch(async () => {
      // アクティベーション直後は間に合わないことがあるため1回だけ再試行する
      await new Promise((resolve) => setTimeout(resolve, 150));
      await hud.setFocus();
    });
  } catch (error) {
    appLog.warn("hud", `choice focus failed, mouse only: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function releaseHudFocus() {
  const hud = await WebviewWindow.getByLabel("hud").catch(() => null);
  if (!hud) return;
  await hud.setFocusable(false).catch(() => undefined);
}

export default Root;
