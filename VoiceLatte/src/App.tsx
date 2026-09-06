import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow, LogicalPosition, monitorFromPoint, PhysicalPosition } from "@tauri-apps/api/window";
import { register, unregister, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import {
  AlertCircle, ArrowDown, Check, ChevronDown, ChevronRight, ChevronUp, Clock3, Copy,
  Download, Info, Keyboard, ListPlus, Mic, Plus, Settings2, SlidersHorizontal, Sparkles, Square, Trash2, X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import "./App.css";
import {
  createTranslator,
  defaultRefinementPrompt,
  legacyDefaultPrompts,
  localizeBridgeMessage,
  resolveSpeechLocale,
  resolveUiLanguage,
  type MessageKey,
  type Translator,
  type UiLanguage,
  type UiLanguagePreference,
} from "./i18n";
import { SpeechBridgeClient, type DeviceSettingsStatus, type SpeechStatus } from "./speech-bridge";
import {
  DEFAULT_PROMPT_KEY,
  appPromptKey,
  buildRefinementPrompt,
  categoryPromptKey,
  migrateLegacyCustomPrompts,
  normalizeVocabularyEntries,
  parseVocabularyAliases,
  postProcessTranscript,
  resolveCustomPrompt,
  vocabularyHints,
  type CustomPrompts,
  type VocabularyEntry,
} from "./text-processing";

type Phase = "idle" | "preparing" | "listening" | "processing" | "done" | "error";
type Section = "history" | "general" | "ai" | "vocabulary" | "shortcuts" | "about";
type TranscriptionProvider = "local" | "groq" | "gemini";
type RefinementProvider = "groq" | "gemini" | "local";
type CaptureMode = "live" | "deferred";
type HistoryEntry = { id: string; text: string; raw: string; createdAt: number; category: string; engine: string; appName: string; promptKey?: string };
type Settings = {
  locale: string;
  appLanguage: UiLanguagePreference;
  autoPaste: boolean;
  refinement: boolean;
  customPrompts: CustomPrompts;
  toggleShortcut: string;
  holdShortcut: string;
  microphoneUID: string;
  muteOtherAudio: boolean;
  transcriptionProvider: TranscriptionProvider;
  refinementProvider: RefinementProvider;
  promptDefaultsVersion: number;
};
type HudState = { phase: Phase; transcript: string; level: number; engine: string; captureMode: CaptureMode; uiLanguage?: UiLanguage; message?: string };
type PreparedCapture = { captureId: string; audioPath: string };
type CloudResult = { text: string; model: string };
type CloudTranscript = { text: string; model: string };

const systemUiLanguage = resolveUiLanguage("system");
const DEFAULT_VOCABULARY: VocabularyEntry[] = [{ id: "default-ok", term: "OK", aliases: ["オーケー"] }];
const DEFAULT_SETTINGS: Settings = {
  locale: "system",
  appLanguage: "system",
  autoPaste: true,
  refinement: true,
  customPrompts: { [DEFAULT_PROMPT_KEY]: defaultRefinementPrompt(systemUiLanguage) },
  toggleShortcut: "Control+Shift+Space",
  holdShortcut: "Control",
  microphoneUID: "",
  muteOtherAudio: true,
  transcriptionProvider: "local",
  refinementProvider: "groq",
  promptDefaultsVersion: 1,
};

const nav: { id: Section; label: MessageKey; icon: LucideIcon }[] = [
  { id: "history", label: "nav.history", icon: Clock3 },
  { id: "general", label: "nav.general", icon: Settings2 },
  { id: "ai", label: "nav.ai", icon: Sparkles },
  { id: "vocabulary", label: "nav.vocabulary", icon: ListPlus },
  { id: "shortcuts", label: "nav.shortcuts", icon: Keyboard },
  { id: "about", label: "nav.about", icon: Info },
];

const promptCategories = ["chat", "email", "code", "terminal", "notes", "browser", "generic"];

const I18nContext = createContext<{ language: UiLanguage; t: Translator }>({
  language: systemUiLanguage,
  t: createTranslator(systemUiLanguage),
});

function I18nProvider({ preference, children }: { preference: UiLanguagePreference; children: React.ReactNode }) {
  const language = resolveUiLanguage(preference);
  const value = useMemo(() => ({ language, t: createTranslator(language) }), [language]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n() {
  return useContext(I18nContext);
}

function useStoredState<T>(key: string, initial: T, normalize?: (stored: unknown) => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "") as unknown;
      return normalize ? normalize(stored) : stored as T;
    } catch { return initial; }
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value]);
  return [value, setValue] as const;
}

function Root() {
  const isHud = new URLSearchParams(location.search).has("hud");
  document.documentElement.classList.toggle("hud-page", isHud);
  document.body.classList.toggle("hud-body", isHud);
  return isHud ? <Hud /> : <MainApp />;
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
  const [onboardingComplete, setOnboardingComplete] = useStoredState("voicelatte.onboardingComplete", false, (stored) => stored === true);
  const [showOnboarding, setShowOnboarding] = useState(!onboardingComplete);
  const [onboardingShortcutChosen, setOnboardingShortcutChosen] = useState(false);
  const [onboardingTestPassed, setOnboardingTestPassed] = useState(false);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);
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
  const phaseRef = useRef<Phase>("idle");
  const levelRef = useRef(0);
  const engineRef = useRef("");
  const captureModeRef = useRef<CaptureMode>("live");
  const messageRef = useRef("");
  const hudVisibleRef = useRef(false);
  const onboardingTestRef = useRef(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const holdActive = useRef(false);
  const shortcutCaptureRef = useRef(false);
  const contextRef = useRef<{ appName: string; category: string; promptKey?: string; screenContext?: string; displayX?: number; displayY?: number }>({ appName: "VoiceLatte", category: "generic" });
  const captureRef = useRef<string | undefined>(undefined);
  const recordingProviderRef = useRef<TranscriptionProvider>("local");
  const actionRef = useRef<(action: "toggle" | "refine-stop" | "hold-start" | "hold-stop" | "shared-start" | "shared-stop") => void>(() => {});
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
    if (!onboardingTestRef.current) {
      void updateHud({
        phase: nextPhase,
        transcript: next.transcript ?? transcriptRef.current,
        level: next.level ?? levelRef.current,
        engine: next.engine ?? engineRef.current,
        captureMode: next.captureMode ?? captureModeRef.current,
        uiLanguage: language,
        message: next.message ?? messageRef.current,
      });
    }
  }, [language, updateHud]);

  const startRecording = useCallback(async (onboardingTest = false) => {
    if (phaseRef.current !== "idle") return;
    if (onboardingTest && !onboardingShortcutChosen) return;
    phaseRef.current = "preparing";
    onboardingTestRef.current = onboardingTest;
    if (onboardingTest) setOnboardingTestPassed(false);
    const provider = onboardingTest ? "local" : settings.transcriptionProvider;
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
      setRecordingState({ phase: "listening", message: t("record.listening") });
    } catch (error) {
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
    setRecordingState({ phase: "processing", level: 0, message: recordingProviderRef.current === "local" ? t("record.processing") : t("record.cloudProcessing") });
    try {
      const raw = await bridge.stop();
      if (onboardingTestRef.current) {
        setOnboardingTestPassed(Boolean(raw.trim()));
        setRecordingState({ phase: "idle", transcript: raw, level: 0, message: "" });
        onboardingTestRef.current = false;
        return;
      }
      const { category, appName, promptKey } = contextRef.current;
      const shouldRefine = withAiRefinement && settings.refinement;
      const screenContext = shouldRefine ? contextRef.current.screenContext ?? "" : "";
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
      const useGeminiCombined = provider === "gemini" && cloudRefinementProvider === "gemini";
      const cloud = provider === "local" ? undefined : await invoke<CloudResult>("cloud_transcribe", {
        captureId,
        provider,
        prompt: useGeminiCombined ? refinementPrompt : "",
        locale: speechLocale,
        vocabulary: vocabularyHints(vocabulary),
        screenContext,
      }).catch((error) => {
        if (bridgeMessageCode(error) === "cloud.key_denied") markKeyDenied(provider);
        throw error;
      });
      captureRef.current = undefined;
      const source = cloud?.text ?? raw;
      if (!source.trim()) {
        recordingProviderRef.current = "local";
        setRecordingState({ phase: "idle", transcript: "" });
        return;
      }
      if (cloud) setRecordingState({ transcript: source, engine: cloud.model });
      let refined = source;
      if (shouldRefine && !useGeminiCombined) {
        if (cloudRefinementProvider) {
          try {
            const result = await invoke<CloudResult>("cloud_refine", { provider: cloudRefinementProvider, text: source, prompt: refinementPrompt, screenContext });
            refined = result.text;
            setRecordingState({ transcript: refined, engine: result.model });
          } catch (error) {
            if (bridgeMessageCode(error) === "cloud.key_denied") {
              markKeyDenied(cloudRefinementProvider);
              throw error;
            }
            refined = await bridge.refine(source, category, refinementPrompt, speechLocale, screenContext).catch(() => source);
          }
        } else {
          refined = await bridge.refine(source, category, refinementPrompt, speechLocale, screenContext).catch(() => source);
        }
      }
      const text = postProcessTranscript(refined, vocabulary);
      const entry: HistoryEntry = { id: crypto.randomUUID(), text, raw: source, createdAt: Date.now(), category, engine: cloud?.model ?? engineRef.current, appName, promptKey: promptKey ?? appName };
      setHistory((items) => [entry, ...items].slice(0, 500));
      await bridge.insert(text, settings.autoPaste);
      recordingProviderRef.current = "local";
      setRecordingState({ phase: "done", transcript: text, message: settings.autoPaste ? t("record.inserted") : t("record.completed") });
      window.setTimeout(() => setRecordingState({ phase: "idle" }), 1400);
    } catch (error) {
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
  }, [bridge, localizedError, markKeyDenied, setHistory, setRecordingState, settings, speechLocale, t, vocabulary]);

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
      if (action === "toggle") void (phaseRef.current === "idle" ? startRecording(showOnboarding) : stopRecording());
      if (action === "refine-stop" && phaseRef.current === "listening") void stopRecording(true);
      if (action === "hold-start") beginHold(150);
      if (action === "hold-stop") endHold(false);
      if (action === "shared-start") beginHold(300);
      if (action === "shared-stop") endHold(true);
    };
  }, [showOnboarding, startRecording, stopRecording]);

  useEffect(() => {
    void bridge.status(speechLocale).then(setStatus).catch((error) => setMessage(localizedError(error)));
    void bridge.warmUp(speechLocale).catch(() => undefined);
    void bridge.settingsStatus().then(setDeviceStatus).catch(() => undefined);
    void isAutostartEnabled().then(setLaunchAtLogin).catch(() => undefined);
    void refreshApiKeys().catch(() => undefined);
  }, [bridge, localizedError, refreshApiKeys, speechLocale]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<CloudTranscript>("cloud-transcript", (event) => {
      if (phaseRef.current === "processing") setRecordingState({ transcript: event.payload.text, engine: event.payload.model });
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
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
      await unregisterAll();
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
    return () => { alive = false; void unregisterAll(); };
  }, [bridge, localizedError, settings.holdShortcut, settings.toggleShortcut, t]);

  useEffect(() => {
    if (phase !== "listening" || showOnboarding || !settings.refinement
      || settings.toggleShortcut === "Space" || settings.holdShortcut === "Space") return;
    let active = true;
    void register("Space", (event) => {
      if (active && event.state === "Pressed" && !shortcutCaptureRef.current) actionRef.current("refine-stop");
    }).catch(() => undefined);
    return () => {
      active = false;
      void unregister("Space").catch(() => undefined);
    };
  }, [phase, settings.holdShortcut, settings.refinement, settings.toggleShortcut, showOnboarding]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("hud-stop", () => actionRef.current("toggle")).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  return (
    <main className="app-shell">
      <div className="window-drag-region" data-tauri-drag-region />
      <aside className="sidebar" aria-label={t("aria.settingsCategories")}>
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
          onInstall={() => void (async () => {
            setInstalling(true);
            try { await bridge.installModel(speechLocale); setStatus(await bridge.status(speechLocale)); }
            catch (error) { setMessage(localizedError(error)); }
            finally { setInstalling(false); }
          })()}
          onSaveApiKey={async (provider, key) => {
            const mask = await invoke<string>("set_api_key", { provider, key });
            setApiKeyHints((current) => ({ ...current, [provider]: mask }));
            setApiKeyDenied((current) => ({ ...current, [provider]: false }));
          }}
          onClearApiKey={async (provider) => {
            await invoke("clear_api_key", { provider });
            setApiKeyHints((current) => ({ ...current, [provider]: null }));
            setApiKeyDenied((current) => ({ ...current, [provider]: false }));
          }}
        />}
        {section === "vocabulary" && <VocabularyPage entries={vocabulary} setEntries={setVocabulary} />}
        {section === "shortcuts" && <ShortcutPage settings={settings} setSettings={setSettings} error={shortcutError} onCaptureChange={setShortcutCapturing} />}
        {section === "about" && <AboutPage onOpenOnboarding={() => {
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
        deviceStatus={deviceStatus}
        shortcutChosen={onboardingShortcutChosen}
        testPassed={onboardingTestPassed}
        shortcutError={shortcutError}
        onRequestPermission={async (permission) => {
          await bridge.requestPermission(permission);
          setDeviceStatus(await bridge.settingsStatus());
        }}
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
      {selected && <HistoryDialog entry={selected} onClose={() => setSelected(null)} />}
      {message && phase === "error" && <div className="toast error-toast">{message}</div>}
    </main>
  );
}

function HistoryPage(props: {
  phase: Phase; transcript: string; history: HistoryEntry[];
  onToggle: () => void; onCancel: () => void; onSelect: (entry: HistoryEntry) => void;
  onClear: () => void;
}) {
  const { language, t } = useI18n();
  const active = props.phase !== "idle" && props.phase !== "done" && props.phase !== "error";
  return <>
    <Button variant="ghost" className={cn("record-card h-auto", active && "active")} onClick={props.onToggle}>
      <span className="mic-orb">{active ? <Square /> : <Mic />}</span>
      <span><b>{active ? phaseLabel(props.phase, t) : t("history.start")}</b>{props.transcript && <small>{props.transcript}</small>}</span>
    </Button>
    {active && <Button variant="ghost" size="xs" className="cancel-link" onClick={props.onCancel}>{t("history.cancel")}</Button>}
    <div className="list-heading"><span>{t("history.heading")}</span>{props.history.length > 0 && <Button variant="ghost" size="xs" onClick={props.onClear}><Trash2 />{t("history.clear")}</Button>}</div>
    <div className="history-list">
      {props.history.length === 0 && <div className="empty-state">{t("history.empty")}</div>}
      {props.history.map((entry) => <Button variant="ghost" className="history-card h-auto" key={entry.id} onClick={() => props.onSelect(entry)}>
        <div className="tags"><Badge variant="secondary">{entry.appName || "VoiceLatte"}</Badge><Badge variant="secondary">{categoryLabel(entry.category, t)}</Badge><time>{relativeTime(entry.createdAt, language, t)}</time></div>
        <p>{entry.text}</p>
      </Button>)}
    </div>
  </>;
}

function GeneralPage({ settings, setSettings, deviceStatus, launchAtLogin, onLaunchAtLogin, onRequestPermission }: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  deviceStatus: DeviceSettingsStatus | null;
  launchAtLogin: boolean;
  onLaunchAtLogin: (enabled: boolean) => Promise<void>;
  onRequestPermission: (permission: "microphone" | "speech" | "accessibility") => Promise<void>;
}) {
  const { t } = useI18n();
  const locales = [
    ["system", "general.systemDefault"], ["ja-JP", "language.ja"], ["en-US", "language.enUS"], ["en-GB", "language.enGB"],
    ["zh-Hans", "language.zhHans"], ["zh-Hant", "language.zhHant"], ["ko-KR", "language.ko"],
    ["de-DE", "language.de"], ["fr-FR", "language.fr"], ["es-ES", "language.es"],
  ] as const;
  return <div className="settings-stack">
    <p className="settings-group-label">{t("general.interface")}</p>
    <SettingRow label={t("general.appLanguage")} detail={t("general.appLanguageDetail")}>
      <Select value={settings.appLanguage} onValueChange={(value) => setSettings((current) => settingsWithAppLanguage(current, value as UiLanguagePreference))}>
        <SelectTrigger size="sm" className="settings-select"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="system">{t("general.systemDefault")}</SelectItem>
          <SelectItem value="en">English</SelectItem>
          <SelectItem value="ja">日本語</SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>

    <p className="settings-group-label">{t("general.voiceInput")}</p>
    <SettingRow label={t("general.speechLanguage")} detail={t("general.speechLanguageDetail")}>
      <Select value={settings.locale} onValueChange={(locale) => setSettings((s) => ({ ...s, locale }))}>
        <SelectTrigger size="sm" className="settings-select"><SelectValue /></SelectTrigger>
        <SelectContent>{locales.map(([value, label]) => <SelectItem value={value} key={value}>{t(label)}</SelectItem>)}</SelectContent>
      </Select>
    </SettingRow>
    {deviceStatus?.platform === "macos" && <SettingRow label={t("general.microphone")} detail={t("general.microphoneDetail")}>
      <Select value={settings.microphoneUID || "system"} onValueChange={(microphoneUID) => setSettings((s) => ({ ...s, microphoneUID: microphoneUID === "system" ? "" : microphoneUID }))}>
        <SelectTrigger size="sm" className="settings-select"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="system">{t("general.systemDefault")}</SelectItem>{deviceStatus.devices.map((device) => <SelectItem value={device.uid} key={device.uid}>{device.name}</SelectItem>)}</SelectContent>
      </Select>
    </SettingRow>}
    {deviceStatus?.platform === "macos" && <SettingRow label={t("general.muteAudio")} detail={t("general.muteAudioDetail")}><Switch checked={settings.muteOtherAudio} onCheckedChange={(muteOtherAudio) => setSettings((s) => ({ ...s, muteOtherAudio }))} /></SettingRow>}
    <p className="settings-group-label">{t("general.output")}</p>
    <SettingRow label={t("general.autoPaste")} detail={t("general.autoPasteDetail")}><Switch checked={settings.autoPaste} onCheckedChange={(autoPaste) => setSettings((s) => ({ ...s, autoPaste }))} /></SettingRow>

    <p className="settings-group-label">{t("general.startup")}</p>
    <SettingRow label={t("general.launchAtLogin")} detail={t("general.launchAtLoginDetail")}><Switch checked={launchAtLogin} onCheckedChange={(enabled) => void onLaunchAtLogin(enabled)} /></SettingRow>

    {deviceStatus?.platform === "macos" && <>
      <p className="settings-group-label">{t("general.permissions")}</p>
      <Card className="glass-card permissions-card gap-0 py-0">
        <PermissionRow label={t("permission.microphone")} status={deviceStatus.microphonePermission} onAction={() => onRequestPermission("microphone")} />
        <PermissionRow label={t("permission.speech")} status={deviceStatus.speechPermission} onAction={() => onRequestPermission("speech")} />
        <PermissionRow label={t("permission.accessibility")} detail={t("permission.accessibilityDetail")} status={deviceStatus.accessibilityPermission} onAction={() => onRequestPermission("accessibility")} />
      </Card>
    </>}
  </div>;
}

function AiPage({ status, settings, setSettings, installing, deviceStatus, apiKeyHints, onPrompts, onInstall, onSaveApiKey, onClearApiKey }: {
  status: SpeechStatus | null;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  installing: boolean;
  deviceStatus: DeviceSettingsStatus | null;
  apiKeyHints: { groq: string | null; gemini: string | null };
  onPrompts: () => void;
  onInstall: () => void;
  onSaveApiKey: (provider: "groq" | "gemini", key: string) => Promise<void>;
  onClearApiKey: (provider: "groq" | "gemini") => Promise<void>;
}) {
  const { t } = useI18n();
  return <div className="settings-stack">
    <p className="settings-group-label">{t("general.speechModel")}</p>
    <Card className="glass-card recognition-card gap-0 py-0">
      <SettingRow label={t("general.processingMethod")} detail={t("general.processingMethodDetail")}>
        <Select value={settings.transcriptionProvider} onValueChange={(transcriptionProvider) => setSettings((s) => ({ ...s, transcriptionProvider: transcriptionProvider as TranscriptionProvider }))}>
          <SelectTrigger size="sm" className="settings-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="local">{t("provider.local")}</SelectItem>
            <SelectItem value="groq">Groq Cloud</SelectItem>
            <SelectItem value="gemini">Gemini</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      {settings.transcriptionProvider === "local" ? <div className="model-card">
        <div><span className={`status-dot ${status?.modelState === "ready" ? "ready" : ""}`} /><b>{status ? engineLabel(status.backend, t) : t("general.checking")}</b></div>
        <p>{modelStatusMessage(status, t)}</p>
        {status?.modelState === "download-required" && <Button variant="outline" size="sm" className="secondary-button" onClick={onInstall} disabled={installing}>{installing ? t("general.addingModel") : t("general.addModel")}</Button>}
      </div> : <ApiKeyRow
        provider={settings.transcriptionProvider}
        label={settings.transcriptionProvider === "groq" ? "Groq API Key" : "Gemini API Key"}
        keyHint={apiKeyHints[settings.transcriptionProvider]}
        onSave={onSaveApiKey}
        onClear={onClearApiKey}
      />}
      <p className="settings-note">{settings.transcriptionProvider === "local"
        ? t("general.onDevice")
        : t(deviceStatus?.platform === "macos" && settings.refinement ? "general.cloudAudioWithContext" : "general.cloudAudio")}</p>
    </Card>

    <p className="settings-group-label">{t("ai.refinement")}</p>
    <SettingRow label={t("general.refinement")} detail={t("general.refinementDetail")}><Switch checked={settings.refinement} onCheckedChange={(refinement) => setSettings((s) => ({ ...s, refinement }))} /></SettingRow>
    {settings.refinement && <SettingRow label={t("ai.refinementModel")} detail={settings.refinementProvider === "groq" ? t("ai.refinementGroqDetail") : settings.refinementProvider === "gemini" ? t("ai.refinementGeminiDetail") : t("ai.refinementLocalDetail")}>
      <Select value={settings.refinementProvider} onValueChange={(refinementProvider) => setSettings((s) => ({ ...s, refinementProvider: refinementProvider as RefinementProvider }))}>
        <SelectTrigger size="sm" className="settings-select"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="groq">Groq Cloud</SelectItem>
          <SelectItem value="gemini">Gemini</SelectItem>
          <SelectItem value="local">{t("provider.local")}</SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>}
    {settings.refinement && settings.refinementProvider !== "local" && settings.transcriptionProvider !== settings.refinementProvider && <ApiKeyRow provider={settings.refinementProvider} label={`${settings.refinementProvider === "groq" ? "Groq" : "Gemini"} API Key`} keyHint={apiKeyHints[settings.refinementProvider]} onSave={onSaveApiKey} onClear={onClearApiKey} />}
    <Button variant="ghost" className="refine-strip ai-refine-strip h-auto" onClick={onPrompts}>
      <span className="strip-icon"><SlidersHorizontal /></span><span><b>{t("history.refinement")}</b><small>{t("history.refinementDetail")}</small></span><ChevronRight className="chevron" />
    </Button>
  </div>;
}

function ApiKeyRow({ provider, label, keyHint, onSave, onClear }: {
  provider: "groq" | "gemini";
  label: string;
  keyHint: string | null;
  onSave: (provider: "groq" | "gemini", key: string) => Promise<void>;
  onClear: (provider: "groq" | "gemini") => Promise<void>;
}) {
  const { language, t } = useI18n();
  const configured = keyHint !== null;
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setError("");
    try { await action(); }
    catch (reason) { setError(localizeBridgeMessage(reason instanceof Error ? reason.message : String(reason), language, t)); }
  };
  return <div className="setting-row api-key-row">
    <div><b>{label}</b><span>{provider === "gemini" && `${t("apiKey.geminiDetail")} · `}{configured ? t("apiKey.configured") : t("apiKey.notConfigured")}</span><small>{t("apiKey.keychainNotice")}</small>{error && <small className="api-key-error">{error}</small>}</div>
    <div className="api-key-actions">
      <Input type="password" value={key} autoComplete="off" spellCheck={false} onChange={(event) => setKey(event.target.value)} placeholder={keyHint ?? t("apiKey.placeholder")} />
      <Button size="sm" disabled={!key.trim()} onClick={() => void run(async () => { await onSave(provider, key); setKey(""); })}>{configured ? t("apiKey.update") : t("apiKey.save")}</Button>
      {configured && <Button variant="ghost" size="sm" onClick={() => void run(() => onClear(provider))}>{t("apiKey.remove")}</Button>}
    </div>
  </div>;
}

function bridgeMessageCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(":", 2)[0];
}

function PermissionRow({ label, detail, status, onAction }: {
  label: string;
  detail?: string;
  status: DeviceSettingsStatus["microphonePermission"] | DeviceSettingsStatus["accessibilityPermission"];
  onAction: () => Promise<void>;
}) {
  const { t } = useI18n();
  const granted = status === "authorized" || status === "system-managed" || status === "not-required";
  return <div className="permission-row">
    <span className={cn("permission-mark", granted && "granted")}>{granted ? <Check /> : <AlertCircle />}</span>
    <div><b>{label}</b>{detail && <small>{detail}</small>}</div>
    {granted ? <span className="permission-state">{t("permission.granted")}</span> : <Button variant="outline" size="xs" className="secondary-button" onClick={() => void onAction()}>{status === "not-determined" ? t("permission.allow") : t("permission.openSettings")}</Button>}
  </div>;
}

function VocabularyPage({ entries, setEntries }: { entries: VocabularyEntry[]; setEntries: React.Dispatch<React.SetStateAction<VocabularyEntry[]>> }) {
  const { t } = useI18n();
  const [term, setTerm] = useState("");
  const [aliases, setAliases] = useState<string[]>([]);
  const [aliasDraft, setAliasDraft] = useState("");
  const aliasInput = useRef<HTMLInputElement>(null);
  const commitAliases = () => {
    setAliases(parseVocabularyAliases([...aliases, aliasDraft].join(","), term));
    setAliasDraft("");
  };
  const add = () => {
    const normalizedTerm = term.trim();
    if (!normalizedTerm) return;
    const nextAliases = parseVocabularyAliases([...aliases, aliasDraft].join(","), normalizedTerm);
    setEntries((items) => [...items, { id: crypto.randomUUID(), term: normalizedTerm, aliases: nextAliases }]);
    setTerm(""); setAliases([]); setAliasDraft("");
  };
  return <div className="settings-stack">
    <Card className="glass-card add-word gap-3 py-3">
      <label className="dictionary-field"><span>{t("vocabulary.term")}</span><Input value={term} maxLength={80} onChange={(e) => setTerm(e.target.value)} placeholder={t("vocabulary.termPlaceholder")} /></label>
      <div className="dictionary-field"><span>{t("vocabulary.aliases")}</span><div className="alias-input" onClick={() => aliasInput.current?.focus()}>
        {aliases.map((alias) => <Badge variant="secondary" className="alias-tag" key={alias}>{alias}<button type="button" aria-label={t("vocabulary.remove", { term: alias })} onClick={(event) => { event.stopPropagation(); setAliases((items) => items.filter((item) => item !== alias)); }}><X /></button></Badge>)}
        <Input ref={aliasInput} className="alias-editor" value={aliasDraft} maxLength={80} aria-label={t("vocabulary.aliasAria")} onChange={(event) => setAliasDraft(event.target.value)} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") { event.preventDefault(); commitAliases(); }
          if (event.key === "Backspace" && !aliasDraft && aliases.length > 0) setAliases((items) => items.slice(0, -1));
        }} placeholder={aliases.length > 0 ? t("vocabulary.addMore") : t("vocabulary.aliasPlaceholder")} />
      </div></div>
      <Button size="sm" className="dictionary-add" onClick={add} disabled={!term.trim()}>{t("vocabulary.add")}</Button>
    </Card>
    <p className="helper">{t("vocabulary.helper")}</p>
    <div className="dictionary-example"><span>{t("vocabulary.example")}</span><Badge variant="secondary">{t("vocabulary.exampleOne")}</Badge><Badge variant="secondary">{t("vocabulary.exampleTwo")}</Badge><Badge variant="secondary">{t("vocabulary.exampleThree")}</Badge></div>
    {entries.map((entry) => <Card className="word-row gap-2 py-0" key={entry.id}><div><b>{entry.term}</b>{entry.aliases.length > 0 ? <div className="word-aliases">{entry.aliases.map((alias) => <Badge variant="secondary" key={alias}>{alias}</Badge>)}</div> : <small>{t("vocabulary.hintOnly")}</small>}</div><Button variant="ghost" size="icon-xs" aria-label={t("vocabulary.remove", { term: entry.term })} onClick={() => setEntries((items) => items.filter((item) => item.id !== entry.id))}><Trash2 /></Button></Card>)}
  </div>;
}

function ShortcutPage({ settings, setSettings, error, onCaptureChange }: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  error: string;
  onCaptureChange: (capturing: boolean) => void;
}) {
  const { t } = useI18n();
  const [capturing, setCapturing] = useState<"toggle" | "hold" | null>(null);
  const setToggleShortcut = useCallback((toggleShortcut: string) => {
    setSettings((current) => ({ ...current, toggleShortcut }));
    setCapturing(null);
  }, [setSettings]);
  const setHoldShortcut = useCallback((holdShortcut: string) => {
    setSettings((current) => ({ ...current, holdShortcut }));
    setCapturing(null);
  }, [setSettings]);
  useEffect(() => {
    onCaptureChange(capturing !== null);
    return () => onCaptureChange(false);
  }, [capturing, onCaptureChange]);

  return <div className="settings-stack">
    <SettingRow label={t("shortcuts.toggle")} detail={t("shortcuts.toggleDetail")}><ShortcutRecorder value={settings.toggleShortcut} active={capturing === "toggle"} onStart={() => setCapturing("toggle")} onChange={setToggleShortcut} /></SettingRow>
    <SettingRow label={t("shortcuts.hold")} detail={t("shortcuts.holdDetail")}><ShortcutRecorder value={settings.holdShortcut} active={capturing === "hold"} onStart={() => setCapturing("hold")} onChange={setHoldShortcut} /></SettingRow>
    <p className="helper">{t("shortcuts.helper")}</p>
    {error && <p className="inline-error">{error}</p>}
  </div>;
}

function ShortcutRecorder({ value, active, disabled = false, onStart, onChange }: { value: string; active: boolean; disabled?: boolean; onStart: () => void; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const modifierOnly = useRef("");
  useEffect(() => {
    if (!active) return;
    const finish = (shortcut: string) => {
      onChange(shortcut);
    };
    const keyDown = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (["Control", "Alt", "Meta", "Shift"].includes(event.key)) {
        modifierOnly.current = event.key === "Alt" ? "Option" : event.key === "Meta" ? "Command" : event.key;
        return;
      }
      const shortcut = shortcutFromEvent(event);
      if (shortcut) {
        modifierOnly.current = "";
        finish(shortcut);
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (!modifierOnly.current) return;
      event.preventDefault(); event.stopPropagation();
      finish(modifierOnly.current);
      modifierOnly.current = "";
    };
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);
    return () => {
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
    };
  }, [active, onChange]);
  return <Button variant="outline" size="sm" disabled={disabled} className={cn("shortcut-recorder", active && "recording")} onClick={() => { modifierOnly.current = ""; onStart(); }}>{active ? t("shortcuts.press") : prettyShortcut(value)}</Button>;
}

function AboutPage({ onOpenOnboarding }: { onOpenOnboarding: () => void }) {
  const { t } = useI18n();
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  useEffect(() => { void getVersion().then(setVersion).catch(() => undefined); }, []);
  useEffect(() => { void runUpdateCheck(setUpdate, false); }, []);
  return <Card className="glass-card about gap-0 py-0">
    <div className="about-mark"><Mic /></div>
    <b>VoiceLatte</b>
    <p>{t("about.tagline")}</p>
    <small>{version ? t("about.version", { version }) : ""}</small>
    <UpdateRow state={update} onCheck={() => void runUpdateCheck(setUpdate, true)} onInstall={() => void installUpdate(update, setUpdate)} />
    <Button variant="outline" size="sm" className="about-setup" onClick={onOpenOnboarding}><Settings2 />{t("about.openOnboarding")}</Button>
  </Card>;
}

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; version: string; update: Awaited<ReturnType<typeof checkUpdate>> }
  | { status: "downloading"; version: string }
  | { status: "ready" }
  | { status: "error"; message: string };

async function runUpdateCheck(setState: (state: UpdateState) => void, manual: boolean) {
  if (manual) setState({ status: "checking" });
  try {
    const update = await checkUpdate();
    if (update) setState({ status: "available", version: update.version, update });
    else if (manual) setState({ status: "current" });
  } catch (error) {
    if (manual) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

async function installUpdate(state: UpdateState, setState: (state: UpdateState) => void) {
  if (state.status !== "available" || !state.update) return;
  setState({ status: "downloading", version: state.version });
  try {
    await state.update.downloadAndInstall();
    setState({ status: "ready" });
    await relaunch();
  } catch (error) {
    setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

function UpdateRow({ state, onCheck, onInstall }: { state: UpdateState; onCheck: () => void; onInstall: () => void }) {
  const { t } = useI18n();
  const busy = state.status === "checking" || state.status === "downloading";
  return <div className="about-update">
    {state.status === "available" && <Button size="sm" className="about-setup" onClick={onInstall}><Download />{t("update.install", { version: state.version })}</Button>}
    {state.status !== "available" && <Button variant="ghost" size="sm" className="about-setup" disabled={busy} onClick={onCheck}>{busy ? t("update.checking") : t("update.check")}</Button>}
    {state.status === "current" && <small>{t("update.current")}</small>}
    {state.status === "downloading" && <small>{t("update.downloading")}</small>}
    {state.status === "ready" && <small>{t("update.ready")}</small>}
    {state.status === "error" && <small className="api-key-error">{t("update.error")}</small>}
  </div>;
}

function OnboardingDialog({ dismissible, phase, transcript, level, message, settings, setSettings, deviceStatus, shortcutChosen, testPassed, shortcutError, onRequestPermission, onShortcutCaptureChange, onShortcutChange, onComplete, onClose }: {
  dismissible: boolean;
  phase: Phase;
  transcript: string;
  level: number;
  message: string;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  deviceStatus: DeviceSettingsStatus | null;
  shortcutChosen: boolean;
  testPassed: boolean;
  shortcutError: string;
  onRequestPermission: (permission: "microphone" | "speech" | "accessibility") => Promise<void>;
  onShortcutCaptureChange: (capturing: boolean) => void;
  onShortcutChange: (shortcut: string) => void;
  onComplete: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [capturingShortcut, setCapturingShortcut] = useState(false);
  const permissionReady = (status?: string) => status === "authorized" || status === "system-managed" || status === "not-required";
  const permissionsReady = permissionReady(deviceStatus?.microphonePermission)
    && permissionReady(deviceStatus?.speechPermission)
    && permissionReady(deviceStatus?.accessibilityPermission);
  const testActive = phase === "listening";
  const testBusy = phase === "preparing" || phase === "processing";
  const devices = deviceStatus?.devices ?? [];
  const shortcut = prettyShortcut(settings.toggleShortcut);
  useEffect(() => {
    onShortcutCaptureChange(capturingShortcut);
    return () => onShortcutCaptureChange(false);
  }, [capturingShortcut, onShortcutCaptureChange]);

  return <Dialog open onOpenChange={(open) => { if (!open && dismissible) onClose(); }}>
    <DialogContent
      className="modal onboarding-modal sm:max-w-[560px]"
      showCloseButton={dismissible}
      onEscapeKeyDown={(event) => { if (!dismissible) event.preventDefault(); }}
      onPointerDownOutside={(event) => { if (!dismissible) event.preventDefault(); }}
    >
      <DialogHeader>
        <DialogTitle>{t("onboarding.title")}</DialogTitle>
        <DialogDescription>{t("onboarding.subtitle")}</DialogDescription>
      </DialogHeader>

      <div className="onboarding-sections">
        <Card className="onboarding-section gap-0 py-0">
          <b className="onboarding-step-title">{t("onboarding.permissions")}</b>
          {deviceStatus ? <div className="onboarding-permissions">
            <PermissionRow label={t("permission.microphone")} status={deviceStatus.microphonePermission} onAction={() => onRequestPermission("microphone")} />
            <PermissionRow label={t("permission.speech")} status={deviceStatus.speechPermission} onAction={() => onRequestPermission("speech")} />
            <PermissionRow label={t("permission.accessibility")} detail={t("permission.accessibilityDetail")} status={deviceStatus.accessibilityPermission} onAction={() => onRequestPermission("accessibility")} />
          </div> : <p className="onboarding-hint">{t("onboarding.checkingPermissions")}</p>}
        </Card>

        <Card className="onboarding-section gap-0 py-0">
          <b className="onboarding-step-title">{t("onboarding.microphone")}</b>
          <Select value={settings.microphoneUID || "system"} onValueChange={(microphoneUID) => setSettings((current) => ({ ...current, microphoneUID: microphoneUID === "system" ? "" : microphoneUID }))}>
            <SelectTrigger size="sm" className="onboarding-microphone"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("general.systemDefault")}</SelectItem>
              {devices.map((device) => <SelectItem value={device.uid} key={device.uid}>{device.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Card>

        <Card className="onboarding-section gap-0 py-0">
          <b className="onboarding-step-title">{t("onboarding.shortcut")}</b>
          <div className="onboarding-shortcut-row">
            <div><b>{t("onboarding.shortcutLabel")}</b><span>{t("onboarding.shortcutHint")}</span></div>
            <ShortcutRecorder
              value={settings.toggleShortcut}
              active={capturingShortcut}
              disabled={testActive || testBusy}
              onStart={() => setCapturingShortcut(true)}
              onChange={(value) => {
                setCapturingShortcut(false);
                onShortcutChange(value);
              }}
            />
          </div>
          {shortcutError && <p className="inline-error">{shortcutError}</p>}
        </Card>

        <Card className="onboarding-section gap-0 py-0">
          <b className="onboarding-step-title">{t("onboarding.test")}</b>
          <div className="onboarding-level" aria-label={t("hud.audioLevel")}><span style={{ width: `${Math.round(Math.min(1, level) * 100)}%` }} /></div>
          <div className="onboarding-test-row">
            <kbd>{shortcut}</kbd>
            <span>{!shortcutChosen ? t("onboarding.chooseShortcutFirst") : testActive ? t("onboarding.testActive", { shortcut }) : testBusy ? phaseLabel(phase, t) : testPassed ? t("onboarding.testPassed") : t("onboarding.testHint", { shortcut })}</span>
          </div>
          {transcript && shortcutChosen && <div className={cn("onboarding-result", testPassed && "passed")}>{testPassed ? <Check /> : <Mic />}{transcript}</div>}
          {phase === "error" && message && <p className="inline-error">{message}</p>}
        </Card>
      </div>

      <DialogFooter className="dialog-actions"><Button onClick={onComplete} disabled={!permissionsReady || !shortcutChosen || !testPassed || testActive || testBusy}>{t("onboarding.complete")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function PromptDialog({ settings, setSettings, history, onClose }: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  history: HistoryEntry[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [targetToAdd, setTargetToAdd] = useState("");
  const [lastAdded, setLastAdded] = useState("");
  const targets = useMemo(() => {
    const knownApps = new Map<string, string>();
    for (const entry of history) {
      const promptKey = entry.promptKey || entry.appName;
      if (!promptKey || promptKey === "Unknown" || promptKey === "VoiceLatte") continue;
      const label = promptKey === entry.appName ? entry.appName : `${promptKey} · ${entry.appName}`;
      knownApps.set(appPromptKey(promptKey), label);
    }
    return [
      { key: DEFAULT_PROMPT_KEY, label: t("prompt.default") },
      ...promptCategories.map((category) => ({
        key: categoryPromptKey(category),
        label: t("prompt.categoryTarget", { name: categoryLabel(category, t) }),
      })),
      ...[...knownApps].map(([key, name]) => ({ key, label: t("prompt.appTarget", { name }) })),
    ];
  }, [history, t]);
  const availableTargets = targets.filter(({ key }) => !(key in settings.customPrompts));
  const configuredTargets = Object.keys(settings.customPrompts).map((key) => ({
    key,
    label: targets.find((target) => target.key === key)?.label ?? promptKeyLabel(key, t),
  }));
  const addPrompt = () => {
    if (!targetToAdd) return;
    setSettings((current) => ({
      ...current,
      customPrompts: { ...current.customPrompts, [targetToAdd]: "" },
    }));
    setLastAdded(targetToAdd);
    setTargetToAdd("");
  };
  const updatePrompt = (key: string, value: string) => setSettings((current) => ({
    ...current,
    customPrompts: { ...current.customPrompts, [key]: value },
  }));
  const removePrompt = (key: string) => setSettings((current) => {
    const customPrompts = { ...current.customPrompts };
    delete customPrompts[key];
    return { ...current, customPrompts };
  });

  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="modal prompt-modal sm:max-w-[520px]">
      <DialogHeader><DialogTitle>{t("prompt.title")}</DialogTitle><DialogDescription>{t("prompt.description")}</DialogDescription></DialogHeader>
      <p className="prompt-base-note">{t("prompt.baseNote")}</p>
      {availableTargets.length > 0 && <div className="prompt-add-row">
        <Select value={targetToAdd} onValueChange={setTargetToAdd}>
          <SelectTrigger aria-label={t("prompt.addTarget")}><SelectValue placeholder={t("prompt.addTarget")} /></SelectTrigger>
          <SelectContent>{availableTargets.map((target) => <SelectItem key={target.key} value={target.key}>{target.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={addPrompt} disabled={!targetToAdd}><Plus />{t("prompt.add")}</Button>
      </div>}
      <div className="prompt-fields">
        {configuredTargets.length === 0 && <div className="prompt-empty">{t("prompt.empty")}</div>}
        {configuredTargets.map(({ key, label }) => <PromptField
          key={key}
          label={label}
          value={settings.customPrompts[key] ?? ""}
          defaultOpen={key === lastAdded}
          onChange={(value) => updatePrompt(key, value)}
          onRemove={() => removePrompt(key)}
        />)}
      </div>
      <DialogFooter className="dialog-actions"><Button onClick={onClose}>{t("action.done")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function PromptField({ label, value, defaultOpen, onChange, onRemove }: {
  label: string;
  value: string;
  defaultOpen: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  return <Collapsible open={open} onOpenChange={setOpen} className="prompt-field">
    <div className="prompt-field-header">
      <CollapsibleTrigger asChild><Button variant="ghost" className="prompt-trigger h-auto"><b>{label}</b>{open ? <ChevronUp /> : <ChevronDown />}</Button></CollapsibleTrigger>
      <Button variant="ghost" size="icon-xs" aria-label={t("prompt.remove", { name: label })} onClick={onRemove}><Trash2 /></Button>
    </div>
    <CollapsibleContent><Textarea autoFocus={defaultOpen} value={value} placeholder={t("prompt.placeholder")} onChange={(e) => onChange(e.target.value)} rows={4} /></CollapsibleContent>
  </Collapsible>;
}

function HistoryDialog({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }) {
  const { language, t } = useI18n();
  const [copied, setCopied] = useState<"original" | "refined" | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const copy = async (text: string, version: "original" | "refined") => {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setCopied(version);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1600);
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="modal history-modal sm:max-w-[520px]">
      <DialogHeader><DialogTitle>{t("historyDialog.title")}</DialogTitle><DialogDescription>{new Date(entry.createdAt).toLocaleString(language)}</DialogDescription></DialogHeader>
      <div className="history-versions">
        <section className="history-version">
          <div className="history-version-header"><b>{t("historyDialog.original")}</b><Button variant="ghost" size="xs" aria-live="polite" onClick={() => void copy(entry.raw, "original")}>{copied === "original" ? <Check /> : <Copy />}{copied === "original" ? t("action.copied") : t("action.copy")}</Button></div>
          <div className="history-full original">{entry.raw}</div>
        </section>
        <div className="history-flow-arrow" aria-hidden="true"><ArrowDown /></div>
        <section className="history-version">
          <div className="history-version-header"><b>{t("historyDialog.refined")}</b><Button variant="ghost" size="xs" aria-live="polite" onClick={() => void copy(entry.text, "refined")}>{copied === "refined" ? <Check /> : <Copy />}{copied === "refined" ? t("action.copied") : t("action.copy")}</Button></div>
          <div className="history-full">{entry.text}</div>
        </section>
      </div>
    </DialogContent>
  </Dialog>;
}

function SettingRow({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><b>{label}</b><span>{detail}</span></div>{children}</div>;
}

function Hud() {
  const [state, setState] = useState<HudState>({ phase: "preparing", transcript: "", level: 0, engine: "", captureMode: "live", uiLanguage: systemUiLanguage });
  const t = useMemo(() => createTranslator(state.uiLanguage ?? systemUiLanguage), [state.uiLanguage]);
  const transcriptViewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const hudWindow = getCurrentWindow();
    void (async () => {
      await hudWindow.setBackgroundColor([0, 0, 0, 0]);
    })();
    let unlisten: (() => void) | undefined;
    void listen<HudState>("recording-state", (event) => setState(event.payload)).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);
  useEffect(() => {
    const view = transcriptViewRef.current;
    if (!view) return;
    if (!state.transcript) view.scrollLeft = 0;
    else view.scrollTo({ left: view.scrollWidth, behavior: "smooth" });
  }, [state.transcript]);
  const deferred = state.captureMode === "deferred";
  const placeholder = !state.transcript && state.phase === "listening";
  const displayText = state.transcript || (placeholder ? t(deferred ? "hud.deferredPrompt" : "hud.prompt") : state.message) || t("hud.prompt");
  return <main className={`hud ${state.phase}${deferred ? " deferred" : ""}`} data-tauri-drag-region>
    <div className="hud-orb"><span className="hud-pulse" /><span className="hud-mic">●</span></div>
    <div className="hud-copy"><small>{phaseLabel(state.phase, t, deferred)}</small><b ref={transcriptViewRef} className={placeholder ? "placeholder" : undefined}>{displayText}</b></div>
    <div className="hud-meter" aria-label={t("hud.audioLevel")}>{Array.from({ length: 7 }, (_, i) => <i key={i} className={i / 7 < state.level ? "lit" : ""} />)}</div>
    {(state.phase === "listening" || state.phase === "preparing") && <Button variant="ghost" className="hud-stop h-9 rounded-none" onClick={() => void emitTo("main", "hud-stop")}><Square />{t("hud.stop")}</Button>}
  </main>;
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

function shortcutFromEvent(event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">) {
  const modifierKey = ["Control", "Alt", "Meta", "Shift"].includes(event.key);
  if (modifierKey) return event.key === "Alt" ? "Option" : event.key === "Meta" ? "Command" : event.key;
  const parts = [event.metaKey && "CommandOrControl", event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
  const key = event.code === "Space" ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...parts, key].join("+");
}

function isModifierOnlyShortcut(shortcut: string) {
  return ["Control", "Option", "Command", "Shift"].includes(shortcut);
}

function prettyShortcut(shortcut: string) {
  return shortcut.replace("CommandOrControl", "⌘/Ctrl").replace("Control", "⌃").replace("Option", "⌥").replace("Command", "⌘").split("+").join(" ");
}

function phaseLabel(phase: Phase, t: Translator, deferred = false) {
  if (phase === "preparing") return t("state.preparing");
  if (phase === "listening") return t(deferred ? "state.recording" : "state.listening");
  if (phase === "processing") return t(deferred ? "state.transcribing" : "state.processing");
  if (phase === "done") return t("state.done");
  if (phase === "error") return t("state.error");
  return t("state.idle");
}

function relativeTime(time: number, language: UiLanguage, t: Translator) {
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return t("relative.justNow");
  if (minutes < 60) return t("relative.minutes", { count: minutes });
  if (minutes < 1440) return t("relative.hours", { count: Math.floor(minutes / 60) });
  return new Date(time).toLocaleDateString(language);
}

function engineLabel(backend: string, t: Translator) {
  if (backend === "apple-speech-analyzer") return t("engine.appleEnhanced");
  if (backend === "apple-speech-classic") return t("engine.appleClassic");
  if (backend === "windows-speech-classic") return t("engine.windowsClassic");
  return t("engine.windowsAI");
}

function modelStatusMessage(status: SpeechStatus | null, t: Translator) {
  if (!status || status.modelState === "unknown") return t("general.modelChecking");
  if (status.modelState === "download-required") return t("general.modelDownload");
  if (status.modelState === "unsupported") return t("general.modelUnsupported");
  if (status.backend === "apple-speech-classic") return t("general.modelReadyAppleClassic");
  return status.platform === "windows" ? t("general.modelReadyWindows") : t("general.modelReadyApple");
}

function categoryLabel(category: string, t: Translator) {
  const key = `category.${category}` as MessageKey;
  return ["chat", "email", "code", "terminal", "notes", "browser", "generic"].includes(category) ? t(key) : category;
}

function promptKeyLabel(key: string, t: Translator) {
  if (key === DEFAULT_PROMPT_KEY) return t("prompt.default");
  if (key.startsWith("category:")) {
    return t("prompt.categoryTarget", { name: categoryLabel(key.slice("category:".length), t) });
  }
  if (key.startsWith("app:")) return t("prompt.appTarget", { name: key.slice("app:".length) });
  return key;
}

function settingsWithAppLanguage(settings: Settings, appLanguage: UiLanguagePreference): Settings {
  return { ...settings, appLanguage };
}

function normalizeSettings(stored: unknown): Settings {
  if (!stored || typeof stored !== "object") return DEFAULT_SETTINGS;
  const legacy = stored as Partial<Settings> & { defaultPrompt?: string; chatPrompt?: string; codePrompt?: string; screenContextEnabled?: boolean };
  const appLanguage: UiLanguagePreference = ["system", "ja", "en"].includes(legacy.appLanguage ?? "")
    ? legacy.appLanguage as UiLanguagePreference
    : "system";
  const refinementProvider: RefinementProvider = ["groq", "gemini", "local"].includes(legacy.refinementProvider ?? "")
    ? legacy.refinementProvider as RefinementProvider
    : DEFAULT_SETTINGS.refinementProvider;
  const jaDefaults = legacyDefaultPrompts("ja");
  const enDefaults = legacyDefaultPrompts("en");
  const customPrompts = migrateLegacyCustomPrompts(legacy, {
    defaultPrompt: [jaDefaults.defaultPrompt, enDefaults.defaultPrompt],
    chatPrompt: [jaDefaults.chatPrompt, enDefaults.chatPrompt],
    codePrompt: [jaDefaults.codePrompt, enDefaults.codePrompt],
  });
  const promptDefaultsVersion = Number.isFinite(legacy.promptDefaultsVersion) ? legacy.promptDefaultsVersion! : 0;
  if (promptDefaultsVersion < 1 && !(DEFAULT_PROMPT_KEY in customPrompts)) {
    customPrompts[DEFAULT_PROMPT_KEY] = defaultRefinementPrompt(resolveUiLanguage(appLanguage));
  }
  const { defaultPrompt: _defaultPrompt, chatPrompt: _chatPrompt, codePrompt: _codePrompt, screenContextEnabled: _screenContextEnabled, ...current } = legacy;
  const settings = { ...DEFAULT_SETTINGS, ...current, appLanguage, refinementProvider, promptDefaultsVersion: 1, customPrompts };
  if (legacy.appLanguage === undefined) {
    return settingsWithAppLanguage({ ...settings, locale: legacy.locale === "ja-JP" ? "system" : settings.locale }, "system");
  }
  return settings;
}

export default Root;
