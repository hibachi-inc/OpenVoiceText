import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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
import { useRecordingController } from "./features/recording/useRecordingController";

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

  const {
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
  } = useRecordingController({
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
  });

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

export default Root;
