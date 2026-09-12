import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, LogicalPosition, monitorFromPoint, PhysicalPosition } from "@tauri-apps/api/window";
import { appLog } from "../../applog";
import { localizeBridgeMessage, type Translator, type UiLanguage } from "../../i18n";
import { type SpeechBridgeClient } from "../../speech-bridge";
import { buildRefinementPrompt, postProcessTranscript, resolveCustomPrompt, shouldDiscardRefinement, vocabularyHints, type VocabularyEntry } from "../../text-processing";
import type { CaptureMode, CloudResult, HistoryEntry, HudState, PendingChoice, Phase, PreparedCapture, Settings, TranscriptionProvider } from "../../app/types";
import { bumpStarCount, markStarPromptShown, starPromptShown } from "../about/star-prompt";
import { jpegToWebp, makeHistoryThumbnail, purgeExpiredImages } from "../history/history-media";
import { isScreenCaptureAllowed } from "../privacy/screen-capture";

type ApiKeyHints = { groq: string | null; gemini: string | null };
type CloudProvider = "groq" | "gemini";

type Options = {
  bridge: SpeechBridgeClient;
  settings: Settings;
  speechLocale: string;
  vocabulary: VocabularyEntry[];
  apiKeyHints: ApiKeyHints;
  onboardingShortcutChosen: boolean;
  showOnboarding: boolean;
  language: UiLanguage;
  t: Translator;
  localizedError: (error: unknown) => string;
  markKeyDenied: (provider: CloudProvider) => void;
  setPhase: Dispatch<SetStateAction<Phase>>;
  setTranscript: Dispatch<SetStateAction<string>>;
  setLevel: Dispatch<SetStateAction<number>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setHistory: Dispatch<SetStateAction<HistoryEntry[]>>;
  setStarOpen: Dispatch<SetStateAction<boolean>>;
  setOnboardingTestPassed: Dispatch<SetStateAction<boolean>>;
};

export function useRecordingController({
  bridge,
  settings,
  speechLocale,
  vocabulary,
  apiKeyHints,
  onboardingShortcutChosen,
  showOnboarding,
  language,
  t,
  localizedError,
  markKeyDenied,
  setPhase,
  setTranscript,
  setLevel,
  setMessage,
  setHistory,
  setStarOpen,
  setOnboardingTestPassed,
}: Options) {
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
      const startedCtx = contextRef.current;
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
      if (refreshed) contextRef.current = { ...startedCtx, screenContext: freshTree };
      const raw = stopResult.text;
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
      const screenChars = screenContext.length;
      if (shouldRefine) appLog.info("refine", `screen context ${screenChars} chars from ${appName} (${refreshed ? "stop" : "start"})${shot ? ` + shot ${Math.round(shot.data.length / 1024)}KB ${shot.mime}` : ""}`);
      const screenText = settings.debugMode && shouldRefine && screenChars > 0 ? screenContext.slice(0, 2000) : undefined;
      const customPrompt = resolveCustomPrompt(settings.customPrompts, contextRef.current);
      const refinementPrompt = shouldRefine ? buildRefinementPrompt(customPrompt, vocabulary, speechLocale) : "";
      const provider = recordingProviderRef.current;
      const captureId = captureRef.current;
      if (provider !== "local" && !captureId) throw new Error("cloud.capture_missing");
      const cloudRefinementProvider = shouldRefine && settings.refinementProvider !== "local" && Boolean(apiKeyHints[settings.refinementProvider])
        ? settings.refinementProvider
        : undefined;
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
      const cloudRaw = cloud?.raw && cloud.raw.trim() ? cloud.raw : undefined;
      let refiner = "local";
      if (!source.trim()) {
        recordingProviderRef.current = "local";
        setRecordingState({ phase: "idle", transcript: "" });
        return;
      }
      if (cloud) setRecordingState({ transcript: source, engine: cloud.model });
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
      const text = postProcessTranscript(shouldDiscardRefinement(refined, source, screenContext) ? source : refined, vocabulary);
      const image = settings.debugMode && shot ? (await makeHistoryThumbnail(shot.data, shot.mime)) ?? undefined : undefined;
      if (shouldRefine) {
        choiceRef.current = { text, raw: cloudRaw ?? source, category, engine: transcriptionEngine, appName, promptKey: promptKey ?? appName, refiner, screenChars, screenText, image };
        recordingProviderRef.current = "local";
        setRecordingState({ phase: "done", transcript: text, message: t("record.choose") });
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

  const finalizeChoice = useCallback(async (which: "raw" | "refined") => {
    const choice = choiceRef.current;
    if (!choice) return;
    choiceRef.current = null;
    const text = which === "raw" ? choice.raw : choice.text;
    const entry: HistoryEntry = { id: crypto.randomUUID(), text, raw: choice.raw, createdAt: Date.now(), category: choice.category, engine: choice.engine, appName: choice.appName, promptKey: choice.promptKey, refiner: choice.refiner, screenChars: choice.screenChars, screenText: choice.screenText, image: choice.image };
    setHistory((items) => purgeExpiredImages([entry, ...items]).slice(0, 500));
    if (!starPromptShown() && bumpStarCount() >= 3) { markStarPromptShown(); setStarOpen(true); }
    await bridge.insert(text, settings.autoPaste);
    await bridge.restoreApp().catch(() => undefined);
    void releaseHudFocus().catch(() => undefined);
    setRecordingState({ phase: "idle", transcript: "", level: 0 });
  }, [bridge, setHistory, setRecordingState, setStarOpen, settings.autoPaste]);

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

  return {
    actionRef,
    shortcutCaptureRef,
    onboardingTestRef,
    setShortcutCapturing,
    cancelRecording,
    finalizeChoice,
    discardChoice,
    setRecordingState,
    phaseRef,
    processingStartRef,
    elapsedRef,
  };
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

async function focusHudForChoice(bridge: SpeechBridgeClient) {
  const hud = await WebviewWindow.getByLabel("hud").catch(() => null);
  if (!hud) return;
  try {
    await hud.setFocusable(true);
    await bridge.focusApp();
    for (let attempt = 0; attempt < 6; attempt++) {
      await hud.setFocus().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (await hud.isFocused().catch(() => false)) return;
    }
    throw new Error("hud never focused");
  } catch (error) {
    appLog.warn("hud", `choice focus failed, mouse only: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function releaseHudFocus() {
  const hud = await WebviewWindow.getByLabel("hud").catch(() => null);
  if (!hud) return;
  await hud.setFocusable(false).catch(() => undefined);
}
