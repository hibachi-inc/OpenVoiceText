import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import {
  AlertCircle, Check, ChevronDown, ChevronRight, ChevronUp, Clock3, Copy,
  Info, Keyboard, ListPlus, Mic, Settings2, SlidersHorizontal, Square, Trash2, X,
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
import { SpeechBridgeClient, type DeviceSettingsStatus, type SpeechStatus } from "./speech-bridge";
import {
  buildRefinementPrompt,
  normalizeVocabularyEntries,
  parseVocabularyAliases,
  postProcessTranscript,
  vocabularyHints,
  type VocabularyEntry,
} from "./text-processing";

type Phase = "idle" | "preparing" | "listening" | "processing" | "done" | "error";
type Section = "history" | "general" | "vocabulary" | "shortcuts" | "about";
type HistoryEntry = { id: string; text: string; raw: string; createdAt: number; category: string; engine: string; appName: string };
type Settings = {
  locale: string;
  autoPaste: boolean;
  refinement: boolean;
  defaultPrompt: string;
  chatPrompt: string;
  codePrompt: string;
  toggleShortcut: string;
  holdShortcut: string;
  microphoneUID: string;
  muteOtherAudio: boolean;
};
type HudState = { phase: Phase; transcript: string; level: number; engine: string; message?: string };

const DEFAULT_SETTINGS: Settings = {
  locale: "ja-JP",
  autoPaste: true,
  refinement: true,
  defaultPrompt: "フィラーを削除し、句読点・数字・金額・日付・単位だけを自然な表記に整えてください。言い換えや要約はしないでください。",
  chatPrompt: "会話らしい自然さを保ち、簡潔に整えてください。",
  codePrompt: "技術用語、識別子、コマンド、パスを変更しないでください。",
  toggleShortcut: "Control+Shift+Space",
  holdShortcut: "Control",
  microphoneUID: "",
  muteOtherAudio: false,
};

const nav: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "history", label: "音声入力 / 履歴", icon: Clock3 },
  { id: "general", label: "基本設定", icon: Settings2 },
  { id: "vocabulary", label: "辞書登録", icon: ListPlus },
  { id: "shortcuts", label: "ショートカット", icon: Keyboard },
  { id: "about", label: "アプリについて", icon: Info },
];

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
  const bridge = useMemo(() => new SpeechBridgeClient(), []);
  const [section, setSection] = useState<Section>("history");
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [, setLevel] = useState(0);
  const [engine, setEngine] = useState("");
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useStoredState<Settings>(
    "voicelatte.settings",
    DEFAULT_SETTINGS,
    (stored) => ({ ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) }),
  );
  const [history, setHistory] = useStoredState<HistoryEntry[]>("voicelatte.history", []);
  const [vocabulary, setVocabulary] = useStoredState<VocabularyEntry[]>("voicelatte.vocabulary", [], normalizeVocabularyEntries);
  const [showPrompts, setShowPrompts] = useState(false);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);
  const [shortcutError, setShortcutError] = useState("");
  const [installing, setInstalling] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<DeviceSettingsStatus | null>(null);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const transcriptRef = useRef("");
  const phaseRef = useRef<Phase>("idle");
  const levelRef = useRef(0);
  const engineRef = useRef("");
  const messageRef = useRef("");
  const holdTimer = useRef<number | undefined>(undefined);
  const holdActive = useRef(false);
  const shortcutCaptureRef = useRef(false);
  const contextRef = useRef({ appName: "VoiceLatte", category: "generic" });
  const actionRef = useRef<(action: "toggle" | "hold-start" | "hold-stop" | "shared-start" | "shared-stop") => void>(() => {});
  const setShortcutCapturing = useCallback((capturing: boolean) => { shortcutCaptureRef.current = capturing; }, []);

  const updateHud = useCallback(async (next: HudState) => {
    await emitTo("hud", "recording-state", next);
    const hud = await WebviewWindow.getByLabel("hud");
    if (!hud) return;
    if (next.phase === "idle") await hud.hide();
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
    if (next.engine !== undefined) { engineRef.current = next.engine; setEngine(next.engine); }
    if (next.message !== undefined) { messageRef.current = next.message; setMessage(next.message); }
    void updateHud({
      phase: nextPhase,
      transcript: next.transcript ?? transcriptRef.current,
      level: next.level ?? levelRef.current,
      engine: next.engine ?? engineRef.current,
      message: next.message ?? messageRef.current,
    });
  }, [updateHud]);

  const startRecording = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    setRecordingState({ phase: "preparing", transcript: "", level: 0, message: "マイクを準備しています" });
    contextRef.current = await bridge.context().catch(() => ({ appName: "Unknown", category: "generic" }));
    try {
      await bridge.start(
        settings.locale,
        vocabularyHints(vocabulary),
        settings.microphoneUID,
        settings.muteOtherAudio,
        {
        onTranscript: (text) => setRecordingState({ transcript: text }),
        onAudioLevel: (nextLevel) => setRecordingState({ level: nextLevel }),
        onEngine: (nextEngine) => setRecordingState({ engine: nextEngine }),
        onError: (error) => setRecordingState({ phase: "error", message: error }),
        },
      );
      setRecordingState({ phase: "listening", message: "聞き取り中" });
    } catch (error) {
      setRecordingState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      window.setTimeout(() => setRecordingState({ phase: "idle" }), 2500);
    }
  }, [bridge, setRecordingState, settings.locale, settings.microphoneUID, settings.muteOtherAudio, vocabulary]);

  const stopRecording = useCallback(async () => {
    if (phaseRef.current !== "listening" && phaseRef.current !== "preparing") return;
    setRecordingState({ phase: "processing", level: 0, message: "整えています" });
    try {
      const raw = await bridge.stop();
      if (!raw.trim()) {
        setRecordingState({ phase: "idle", transcript: "" });
        return;
      }
      const { category, appName } = contextRef.current;
      const prompt = category === "code" || category === "terminal"
        ? settings.codePrompt
        : category === "chat" || category === "email"
          ? settings.chatPrompt
          : settings.defaultPrompt;
      const refined = settings.refinement ? await bridge.refine(raw, category, buildRefinementPrompt(prompt, vocabulary)) : raw;
      const text = postProcessTranscript(refined, vocabulary);
      const entry: HistoryEntry = { id: crypto.randomUUID(), text, raw, createdAt: Date.now(), category, engine, appName };
      setHistory((items) => [entry, ...items].slice(0, 500));
      await bridge.insert(text, settings.autoPaste);
      setRecordingState({ phase: "done", transcript: text, message: settings.autoPaste ? "入力しました" : "完了しました" });
      window.setTimeout(() => setRecordingState({ phase: "idle" }), 1400);
    } catch (error) {
      setRecordingState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      window.setTimeout(() => setRecordingState({ phase: "idle" }), 2500);
    }
  }, [bridge, engine, setHistory, setRecordingState, settings, vocabulary]);

  const cancelRecording = useCallback(async () => {
    await bridge.cancel().catch(() => undefined);
    setRecordingState({ phase: "idle", transcript: "", level: 0 });
  }, [bridge, setRecordingState]);

  useEffect(() => {
    actionRef.current = (action) => {
      const beginHold = (delay: number) => {
        window.clearTimeout(holdTimer.current);
        holdActive.current = false;
        holdTimer.current = window.setTimeout(() => {
          holdActive.current = true;
          void startRecording().then(() => {
            if (!holdActive.current && phaseRef.current === "listening") void stopRecording();
          });
        }, delay);
      };
      const endHold = (toggleOnTap: boolean) => {
        window.clearTimeout(holdTimer.current);
        const wasHold = holdActive.current;
        if (wasHold && phaseRef.current === "listening") void stopRecording();
        holdActive.current = false;
        if (toggleOnTap && !wasHold) void (phaseRef.current === "idle" ? startRecording() : stopRecording());
      };
      if (action === "toggle") void (phaseRef.current === "idle" ? startRecording() : stopRecording());
      if (action === "hold-start") beginHold(150);
      if (action === "hold-stop") endHold(false);
      if (action === "shared-start") beginHold(300);
      if (action === "shared-stop") endHold(true);
    };
  }, [startRecording, stopRecording]);

  useEffect(() => {
    void bridge.status(settings.locale).then(setStatus).catch((error) => setMessage(String(error)));
    void bridge.warmUp(settings.locale).catch(() => undefined);
    void bridge.settingsStatus().then(setDeviceStatus).catch(() => undefined);
    void isAutostartEnabled().then(setLaunchAtLogin).catch(() => undefined);
    return () => void bridge.close();
  }, [bridge, settings.locale]);

  useEffect(() => {
    if (section !== "general") return;
    const refresh = () => void bridge.settingsStatus().then(setDeviceStatus).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [bridge, section]);

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
    })().catch((error) => alive && setShortcutError(`登録できません: ${String(error)}`));
    return () => { alive = false; void unregisterAll(); };
  }, [bridge, settings.holdShortcut, settings.toggleShortcut]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("hud-stop", () => actionRef.current("toggle")).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  return (
    <main className="app-shell">
      <div className="window-drag-region" data-tauri-drag-region />
      <aside className="sidebar" aria-label="設定カテゴリ">
        <nav>{nav.map((item) => {
          const Icon = item.icon;
          return <Button
            variant="ghost"
            className={cn("nav-item h-auto justify-start", item.id === section && "selected")}
            key={item.id}
            onClick={() => setSection(item.id)}
          >
            <Icon aria-hidden="true" />{item.label}
          </Button>;
        })}</nav>
      </aside>

      <section className="content">
        {section === "history" && <HistoryPage
          phase={phase} transcript={transcript} history={history}
          onToggle={() => actionRef.current("toggle")} onCancel={() => void cancelRecording()}
          onSelect={setSelected} onPrompts={() => setShowPrompts(true)}
          onClear={() => setHistory([])}
        />}
        {section === "general" && <GeneralPage
          status={status} settings={settings} setSettings={setSettings} installing={installing}
          deviceStatus={deviceStatus} launchAtLogin={launchAtLogin}
          onLaunchAtLogin={async (enabled) => {
            if (enabled) await enableAutostart(); else await disableAutostart();
            setLaunchAtLogin(await isAutostartEnabled());
          }}
          onRequestPermission={async (permission) => {
            await bridge.requestPermission(permission);
            setDeviceStatus(await bridge.settingsStatus());
          }}
          onInstall={() => void (async () => {
            setInstalling(true);
            try { await bridge.installModel(settings.locale); setStatus(await bridge.status(settings.locale)); }
            catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
            finally { setInstalling(false); }
          })()}
        />}
        {section === "vocabulary" && <VocabularyPage entries={vocabulary} setEntries={setVocabulary} />}
        {section === "shortcuts" && <ShortcutPage settings={settings} setSettings={setSettings} error={shortcutError} onCaptureChange={setShortcutCapturing} />}
        {section === "about" && <AboutPage />}
      </section>

      {showPrompts && <PromptDialog settings={settings} setSettings={setSettings} onClose={() => setShowPrompts(false)} />}
      {selected && <HistoryDialog entry={selected} onClose={() => setSelected(null)} />}
      {message && phase === "error" && <div className="toast error-toast">{message}</div>}
    </main>
  );
}

function HistoryPage(props: {
  phase: Phase; transcript: string; history: HistoryEntry[];
  onToggle: () => void; onCancel: () => void; onSelect: (entry: HistoryEntry) => void;
  onPrompts: () => void; onClear: () => void;
}) {
  const active = props.phase !== "idle" && props.phase !== "done" && props.phase !== "error";
  return <>
    <Button variant="ghost" className={cn("record-card h-auto", active && "active")} onClick={props.onToggle}>
      <span className="mic-orb">{active ? <Square /> : <Mic />}</span>
      <span><b>{active ? phaseLabel(props.phase) : "タップして音声入力を開始"}</b>{props.transcript && <small>{props.transcript}</small>}</span>
    </Button>
    {active && <Button variant="ghost" size="xs" className="cancel-link" onClick={props.onCancel}>キャンセル</Button>}
    <Button variant="ghost" className="refine-strip h-auto" onClick={props.onPrompts}>
      <span className="strip-icon"><SlidersHorizontal /></span><span><b>整形設定</b><small>デフォルト・アプリ別のプロンプト</small></span><ChevronRight className="chevron" />
    </Button>
    <div className="list-heading"><span>履歴</span>{props.history.length > 0 && <Button variant="ghost" size="xs" onClick={props.onClear}><Trash2 />すべてクリア</Button>}</div>
    <div className="history-list">
      {props.history.length === 0 && <div className="empty-state">音声入力した内容がここに残ります</div>}
      {props.history.map((entry) => <Button variant="ghost" className="history-card h-auto" key={entry.id} onClick={() => props.onSelect(entry)}>
        <div className="tags"><Badge variant="secondary">{entry.appName || "VoiceLatte"}</Badge><Badge variant="secondary">{entry.category}</Badge><time>{relativeTime(entry.createdAt)}</time></div>
        <p>{entry.text}</p>
      </Button>)}
    </div>
  </>;
}

function GeneralPage({ status, settings, setSettings, installing, deviceStatus, launchAtLogin, onLaunchAtLogin, onRequestPermission, onInstall }: {
  status: SpeechStatus | null;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  installing: boolean;
  deviceStatus: DeviceSettingsStatus | null;
  launchAtLogin: boolean;
  onLaunchAtLogin: (enabled: boolean) => Promise<void>;
  onRequestPermission: (permission: "microphone" | "speech" | "accessibility") => Promise<void>;
  onInstall: () => void;
}) {
  const locales = [
    ["ja-JP", "日本語"], ["en-US", "英語（US）"], ["en-GB", "英語（UK）"],
    ["zh-Hans", "中国語（簡体字）"], ["zh-Hant", "中国語（繁体字）"], ["ko-KR", "韓国語"],
    ["de-DE", "ドイツ語"], ["fr-FR", "フランス語"], ["es-ES", "スペイン語"],
  ] as const;
  return <div className="settings-stack">
    <p className="settings-group-label">音声認識</p>
    <Card className="glass-card model-card gap-0 py-0">
      <div><span className={`status-dot ${status?.modelState === "ready" ? "ready" : ""}`} /><b>{status ? engineLabel(status.backend) : "確認中"}</b></div>
      <p>{status?.message ?? "音声認識モデルを確認しています…"}</p>
      {status?.modelState === "download-required" && <Button variant="outline" size="sm" className="secondary-button" onClick={onInstall} disabled={installing}>{installing ? "追加しています…" : "高精度モデルを追加"}</Button>}
    </Card>
    <SettingRow label="言語" detail="音声認識に使う言語">
      <Select value={settings.locale} onValueChange={(locale) => setSettings((s) => ({ ...s, locale }))}>
        <SelectTrigger size="sm" className="settings-select"><SelectValue /></SelectTrigger>
        <SelectContent>{locales.map(([value, label]) => <SelectItem value={value} key={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
    </SettingRow>
    {deviceStatus?.platform === "macos" && <SettingRow label="マイク" detail="音声入力に使うデバイス">
      <Select value={settings.microphoneUID || "system"} onValueChange={(microphoneUID) => setSettings((s) => ({ ...s, microphoneUID: microphoneUID === "system" ? "" : microphoneUID }))}>
        <SelectTrigger size="sm" className="settings-select"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="system">システムの既定</SelectItem>{deviceStatus.devices.map((device) => <SelectItem value={device.uid} key={device.uid}>{device.name}</SelectItem>)}</SelectContent>
      </Select>
    </SettingRow>}
    {deviceStatus?.platform === "macos" && <SettingRow label="録音中は他の音声をミュート" detail="音楽などを一時的に消音します"><Switch checked={settings.muteOtherAudio} onCheckedChange={(muteOtherAudio) => setSettings((s) => ({ ...s, muteOtherAudio }))} /></SettingRow>}
    <p className="settings-note">音声はデバイス上で処理され、サーバーには送信されません。</p>

    <p className="settings-group-label">出力と整形</p>
    <SettingRow label="カーソル位置へ自動入力" detail="オフの場合もクリップボードと履歴には残ります"><Switch checked={settings.autoPaste} onCheckedChange={(autoPaste) => setSettings((s) => ({ ...s, autoPaste }))} /></SettingRow>
    <SettingRow label="AI整形" detail="使えない場合はルール整形へ自動で切り替え"><Switch checked={settings.refinement} onCheckedChange={(refinement) => setSettings((s) => ({ ...s, refinement }))} /></SettingRow>

    <p className="settings-group-label">起動</p>
    <SettingRow label="ログイン時に起動" detail="PCへのログイン後、自動で待機します"><Switch checked={launchAtLogin} onCheckedChange={(enabled) => void onLaunchAtLogin(enabled)} /></SettingRow>

    {deviceStatus?.platform === "macos" && <>
      <p className="settings-group-label">権限</p>
      <Card className="glass-card permissions-card gap-0 py-0">
        <PermissionRow label="マイク" status={deviceStatus.microphonePermission} onAction={() => onRequestPermission("microphone")} />
        <PermissionRow label="音声認識" status={deviceStatus.speechPermission} onAction={() => onRequestPermission("speech")} />
        <PermissionRow label="アクセシビリティ" detail="カーソル位置への自動入力に使います" status={deviceStatus.accessibilityPermission} onAction={() => onRequestPermission("accessibility")} />
      </Card>
    </>}
  </div>;
}

function PermissionRow({ label, detail, status, onAction }: {
  label: string;
  detail?: string;
  status: DeviceSettingsStatus["microphonePermission"] | DeviceSettingsStatus["accessibilityPermission"];
  onAction: () => Promise<void>;
}) {
  const granted = status === "authorized" || status === "not-required";
  return <div className="permission-row">
    <span className={cn("permission-mark", granted && "granted")}>{granted ? <Check /> : <AlertCircle />}</span>
    <div><b>{label}</b>{detail && <small>{detail}</small>}</div>
    {granted ? <span className="permission-state">許可済み</span> : <Button variant="outline" size="xs" className="secondary-button" onClick={() => void onAction()}>{status === "not-determined" ? "許可する" : "設定を開く"}</Button>}
  </div>;
}

function VocabularyPage({ entries, setEntries }: { entries: VocabularyEntry[]; setEntries: React.Dispatch<React.SetStateAction<VocabularyEntry[]>> }) {
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
      <label className="dictionary-field"><span>正しい表記</span><Input value={term} maxLength={80} onChange={(e) => setTerm(e.target.value)} placeholder="例：音声入力" /></label>
      <div className="dictionary-field"><span>読み・誤認識</span><div className="alias-input" onClick={() => aliasInput.current?.focus()}>
        {aliases.map((alias) => <Badge variant="secondary" className="alias-tag" key={alias}>{alias}<button type="button" aria-label={`${alias}を削除`} onClick={(event) => { event.stopPropagation(); setAliases((items) => items.filter((item) => item !== alias)); }}><X /></button></Badge>)}
        <Input ref={aliasInput} className="alias-editor" value={aliasDraft} maxLength={80} aria-label="読みや誤認識を追加" onChange={(event) => setAliasDraft(event.target.value)} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") { event.preventDefault(); commitAliases(); }
          if (event.key === "Backspace" && !aliasDraft && aliases.length > 0) setAliases((items) => items.slice(0, -1));
        }} placeholder={aliases.length > 0 ? "追加…" : "例：オンエー入力"} />
      </div></div>
      <Button size="sm" className="dictionary-add" onClick={add} disabled={!term.trim()}>追加</Button>
    </Card>
    <p className="helper">読みや間違って認識される表記を入力し、Enterで複数追加できます。</p>
    <div className="dictionary-example"><span>例：</span><Badge variant="secondary">オンエー入力</Badge><Badge variant="secondary">音声入浴</Badge><Badge variant="secondary">音声入力機</Badge></div>
    {entries.map((entry) => <Card className="word-row gap-2 py-0" key={entry.id}><div><b>{entry.term}</b>{entry.aliases.length > 0 ? <div className="word-aliases">{entry.aliases.map((alias) => <Badge variant="secondary" key={alias}>{alias}</Badge>)}</div> : <small>認識ヒントとして使用</small>}</div><Button variant="ghost" size="icon-xs" aria-label={`${entry.term}を削除`} onClick={() => setEntries((items) => items.filter((item) => item.id !== entry.id))}><Trash2 /></Button></Card>)}
  </div>;
}

function ShortcutPage({ settings, setSettings, error, onCaptureChange }: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  error: string;
  onCaptureChange: (capturing: boolean) => void;
}) {
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
    <SettingRow label="録音の開始 / 停止" detail="短く押すと開始し、もう一度押すと停止します"><ShortcutRecorder value={settings.toggleShortcut} active={capturing === "toggle"} onStart={() => setCapturing("toggle")} onChange={setToggleShortcut} /></SettingRow>
    <SettingRow label="押している間だけ入力" detail="長押し中に録音し、離すと確定します"><ShortcutRecorder value={settings.holdShortcut} active={capturing === "hold"} onStart={() => setCapturing("hold")} onChange={setHoldShortcut} /></SettingRow>
    <p className="helper">同じキーも設定できます。同じ場合は短押しと300ms以上の長押しを自動で判別します。</p>
    {error && <p className="inline-error">{error}</p>}
  </div>;
}

function ShortcutRecorder({ value, active, onStart, onChange }: { value: string; active: boolean; onStart: () => void; onChange: (value: string) => void }) {
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
  return <Button variant="outline" size="sm" className={cn("shortcut-recorder", active && "recording")} onClick={() => { modifierOnly.current = ""; onStart(); }}>{active ? "キーを押してください" : prettyShortcut(value)}</Button>;
}

function AboutPage() {
  return <Card className="glass-card about gap-0 py-0"><div className="about-mark"><Mic /></div><b>VoiceLatte</b><p>Mac / Windows対応の、無料で使えるオンデバイス音声入力。</p><small>Version 0.1.0 Tauri preview</small></Card>;
}

function PromptDialog({ settings, setSettings, onClose }: { settings: Settings; setSettings: React.Dispatch<React.SetStateAction<Settings>>; onClose: () => void }) {
  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="modal prompt-modal sm:max-w-[520px]">
      <DialogHeader><DialogTitle>整形設定</DialogTitle><DialogDescription>用途ごとの指示を変更できます</DialogDescription></DialogHeader>
      <div className="prompt-fields">
        <PromptField label="デフォルト" value={settings.defaultPrompt} onChange={(defaultPrompt) => setSettings((s) => ({ ...s, defaultPrompt }))} />
        <PromptField label="ChatGPT / チャット" value={settings.chatPrompt} onChange={(chatPrompt) => setSettings((s) => ({ ...s, chatPrompt }))} />
        <PromptField label="Code / ターミナル" value={settings.codePrompt} onChange={(codePrompt) => setSettings((s) => ({ ...s, codePrompt }))} />
      </div>
      <DialogFooter className="dialog-actions"><Button onClick={onClose}>完了</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function PromptField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return <Collapsible open={open} onOpenChange={setOpen} className="prompt-field">
    <CollapsibleTrigger asChild><Button variant="ghost" className="prompt-trigger h-auto"><b>{label}</b>{open ? <ChevronUp /> : <ChevronDown />}</Button></CollapsibleTrigger>
    <CollapsibleContent><Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} /></CollapsibleContent>
  </Collapsible>;
}

function HistoryDialog({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }) {
  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="modal history-modal sm:max-w-[520px]">
      <DialogHeader><DialogTitle>入力内容</DialogTitle><DialogDescription>{new Date(entry.createdAt).toLocaleString()}</DialogDescription></DialogHeader>
      <div className="history-full">{entry.text}</div>
      {entry.raw !== entry.text && <details><summary>整形前を表示</summary><div className="history-raw">{entry.raw}</div></details>}
      <DialogFooter className="dialog-actions"><Button variant="outline" onClick={() => void navigator.clipboard.writeText(entry.text)}><Copy />コピー</Button><Button onClick={onClose}>閉じる</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function SettingRow({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><b>{label}</b><span>{detail}</span></div>{children}</div>;
}

function Hud() {
  const [state, setState] = useState<HudState>({ phase: "preparing", transcript: "", level: 0, engine: "" });
  const transcriptViewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const hudWindow = getCurrentWindow();
    void (async () => {
      await hudWindow.setBackgroundColor([0, 0, 0, 0]);
      const monitor = await currentMonitor();
      if (!monitor) return;
      const windowSize = await hudWindow.outerSize();
      const area = monitor.workArea;
      await hudWindow.setPosition(new PhysicalPosition(
        Math.round(area.position.x + (area.size.width - windowSize.width) / 2),
        Math.round(area.position.y + area.size.height - windowSize.height - 34 * monitor.scaleFactor),
      ));
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
  return <main className={`hud ${state.phase}`} data-tauri-drag-region>
    <div className="hud-orb"><span className="hud-pulse" /><span className="hud-mic">●</span></div>
    <div className="hud-copy"><small>{phaseLabel(state.phase)}</small><b ref={transcriptViewRef} className={!state.transcript && state.phase === "listening" ? "placeholder" : undefined}>{state.transcript || (state.phase === "listening" ? "どうぞ" : state.message) || "どうぞ"}</b></div>
    <div className="hud-meter" aria-label="マイク音量">{Array.from({ length: 7 }, (_, i) => <i key={i} className={i / 7 < state.level ? "lit" : ""} />)}</div>
    {(state.phase === "listening" || state.phase === "preparing") && <Button variant="ghost" className="hud-stop h-9 rounded-none" onClick={() => void emitTo("main", "hud-stop")}><Square />停止</Button>}
  </main>;
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

function phaseLabel(phase: Phase) {
  if (phase === "preparing") return "準備中";
  if (phase === "listening") return "聞き取り中";
  if (phase === "processing") return "整形中";
  if (phase === "done") return "完了";
  if (phase === "error") return "エラー";
  return "待機中";
}

function relativeTime(time: number) {
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}時間前`;
  return new Date(time).toLocaleDateString();
}

function engineLabel(backend: string) {
  if (backend === "apple-speech-analyzer") return "Apple高精度モデル";
  if (backend === "apple-speech-classic") return "Apple標準モデル（自動フォールバック）";
  if (backend === "windows-speech-classic") return "Windows標準モデル（自動フォールバック）";
  return "Microsoft Windows AI Speech";
}

export default Root;
