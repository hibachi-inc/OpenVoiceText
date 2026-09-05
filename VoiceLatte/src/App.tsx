import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import "./App.css";
import { SpeechBridgeClient, type DeviceSettingsStatus, type SpeechStatus } from "./speech-bridge";
import { postProcessTranscript, type VocabularyEntry } from "./text-processing";

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

const nav: { id: Section; label: string; icon: string }[] = [
  { id: "history", label: "音声入力 / 履歴", icon: "◴" },
  { id: "general", label: "基本設定", icon: "⚙" },
  { id: "vocabulary", label: "単語登録", icon: "≡" },
  { id: "shortcuts", label: "ショートカット", icon: "⌨" },
  { id: "about", label: "アプリについて", icon: "ⓘ" },
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
  const [vocabulary, setVocabulary] = useStoredState<VocabularyEntry[]>("voicelatte.vocabulary", []);
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
  const contextRef = useRef({ appName: "VoiceLatte", category: "generic" });
  const actionRef = useRef<(action: "toggle" | "hold-start" | "hold-stop") => void>(() => {});

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
        vocabulary.map((entry) => entry.replacement || entry.phrase),
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
      const refined = settings.refinement ? await bridge.refine(raw, category, prompt) : raw;
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
      if (action === "toggle") void (phaseRef.current === "idle" ? startRecording() : stopRecording());
      if (action === "hold-start") {
        window.clearTimeout(holdTimer.current);
        holdTimer.current = window.setTimeout(() => {
          holdActive.current = true;
          void startRecording().then(() => {
            if (!holdActive.current && phaseRef.current === "listening") void stopRecording();
          });
        }, 150);
      }
      if (action === "hold-stop") {
        window.clearTimeout(holdTimer.current);
        if (holdActive.current && phaseRef.current === "listening") void stopRecording();
        holdActive.current = false;
      }
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
      await register(settings.toggleShortcut, (event) => {
        if (event.state === "Pressed") actionRef.current("toggle");
      });
      const modifierOnly = ["Control", "Option", "Command", "Shift"].includes(settings.holdShortcut);
      await bridge.configureModifierShortcut(modifierOnly ? settings.holdShortcut : "", (state) => {
          actionRef.current(state === "Pressed" ? "hold-start" : "hold-stop");
      });
      if (!modifierOnly) {
        await register(settings.holdShortcut, (event) => {
          actionRef.current(event.state === "Pressed" ? "hold-start" : "hold-stop");
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
        <nav>{nav.map((item) => (
          <button className={item.id === section ? "nav-item selected" : "nav-item"} key={item.id} onClick={() => setSection(item.id)}>
            <span aria-hidden="true">{item.icon}</span>{item.label}
          </button>
        ))}</nav>
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
        {section === "shortcuts" && <ShortcutPage settings={settings} setSettings={setSettings} error={shortcutError} />}
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
    <button className={`record-card ${active ? "active" : ""}`} onClick={props.onToggle}>
      <span className="mic-orb">{active ? "■" : "●"}</span>
      <span><b>{active ? phaseLabel(props.phase) : "タップして音声入力を開始"}</b>{props.transcript && <small>{props.transcript}</small>}</span>
    </button>
    {active && <button className="cancel-link" onClick={props.onCancel}>キャンセル</button>}
    <button className="refine-strip" onClick={props.onPrompts}>
      <span className="strip-icon">☷</span><span><b>整形設定</b><small>デフォルト・アプリ別のプロンプト</small></span><span className="chevron">›</span>
    </button>
    <div className="list-heading"><span>履歴</span>{props.history.length > 0 && <button onClick={props.onClear}>すべてクリア</button>}</div>
    <div className="history-list">
      {props.history.length === 0 && <div className="empty-state">音声入力した内容がここに残ります</div>}
      {props.history.map((entry) => <button className="history-card" key={entry.id} onClick={() => props.onSelect(entry)}>
        <div className="tags"><span>{entry.appName || "VoiceLatte"}</span><span>{entry.category}</span><time>{relativeTime(entry.createdAt)}</time></div>
        <p>{entry.text}</p>
      </button>)}
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
  return <div className="settings-stack">
    <p className="settings-group-label">音声認識</p>
    <section className="glass-card model-card">
      <div><span className={`status-dot ${status?.modelState === "ready" ? "ready" : ""}`} /><b>{status ? engineLabel(status.backend) : "確認中"}</b></div>
      <p>{status?.message ?? "音声認識モデルを確認しています…"}</p>
      {status?.modelState === "download-required" && <button className="secondary-button" onClick={onInstall} disabled={installing}>{installing ? "追加しています…" : "高精度モデルを追加"}</button>}
    </section>
    <SettingRow label="言語" detail="音声認識に使う言語"><select value={settings.locale} onChange={(e) => setSettings((s) => ({ ...s, locale: e.target.value }))}>
      <option value="ja-JP">日本語</option><option value="en-US">英語（US）</option><option value="en-GB">英語（UK）</option>
      <option value="zh-Hans">中国語（簡体字）</option><option value="zh-Hant">中国語（繁体字）</option><option value="ko-KR">韓国語</option>
      <option value="de-DE">ドイツ語</option><option value="fr-FR">フランス語</option><option value="es-ES">スペイン語</option>
    </select></SettingRow>
    {deviceStatus?.platform === "macos" && <SettingRow label="マイク" detail="音声入力に使うデバイス"><select value={settings.microphoneUID} onChange={(e) => setSettings((s) => ({ ...s, microphoneUID: e.target.value }))}>
      <option value="">システムの既定</option>
      {deviceStatus.devices.map((device) => <option value={device.uid} key={device.uid}>{device.name}</option>)}
    </select></SettingRow>}
    {deviceStatus?.platform === "macos" && <SettingRow label="録音中は他の音声をミュート" detail="音楽などを一時的に消音します"><Toggle checked={settings.muteOtherAudio} onChange={(muteOtherAudio) => setSettings((s) => ({ ...s, muteOtherAudio }))} /></SettingRow>}
    <p className="settings-note">音声はデバイス上で処理され、サーバーには送信されません。</p>

    <p className="settings-group-label">出力と整形</p>
    <SettingRow label="カーソル位置へ自動入力" detail="オフの場合もクリップボードと履歴には残ります"><Toggle checked={settings.autoPaste} onChange={(autoPaste) => setSettings((s) => ({ ...s, autoPaste }))} /></SettingRow>
    <SettingRow label="AI整形" detail="使えない場合はルール整形へ自動で切り替え"><Toggle checked={settings.refinement} onChange={(refinement) => setSettings((s) => ({ ...s, refinement }))} /></SettingRow>

    <p className="settings-group-label">起動</p>
    <SettingRow label="ログイン時に起動" detail="PCへのログイン後、自動で待機します"><Toggle checked={launchAtLogin} onChange={(enabled) => void onLaunchAtLogin(enabled)} /></SettingRow>

    {deviceStatus?.platform === "macos" && <>
      <p className="settings-group-label">権限</p>
      <section className="glass-card permissions-card">
        <PermissionRow label="マイク" status={deviceStatus.microphonePermission} onAction={() => onRequestPermission("microphone")} />
        <PermissionRow label="音声認識" status={deviceStatus.speechPermission} onAction={() => onRequestPermission("speech")} />
        <PermissionRow label="アクセシビリティ" detail="カーソル位置への自動入力に使います" status={deviceStatus.accessibilityPermission} onAction={() => onRequestPermission("accessibility")} />
      </section>
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
    <span className={`permission-mark ${granted ? "granted" : ""}`}>{granted ? "✓" : "!"}</span>
    <div><b>{label}</b>{detail && <small>{detail}</small>}</div>
    {granted ? <span className="permission-state">許可済み</span> : <button className="secondary-button" onClick={() => void onAction()}>{status === "not-determined" ? "許可する" : "設定を開く"}</button>}
  </div>;
}

function VocabularyPage({ entries, setEntries }: { entries: VocabularyEntry[]; setEntries: React.Dispatch<React.SetStateAction<VocabularyEntry[]>> }) {
  const [phrase, setPhrase] = useState("");
  const [replacement, setReplacement] = useState("");
  const add = () => {
    if (!phrase.trim()) return;
    setEntries((items) => [...items, { id: crypto.randomUUID(), phrase: phrase.trim(), replacement: replacement.trim() }]);
    setPhrase(""); setReplacement("");
  };
  return <div className="settings-stack">
    <section className="glass-card add-word"><input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="認識される言葉" /><span>→</span><input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="置き換え後（任意）" /><button onClick={add}>追加</button></section>
    <p className="helper">専門用語や固有名詞を認識候補に加え、必要なら表記も置き換えます。</p>
    {entries.map((entry) => <div className="word-row" key={entry.id}><span>{entry.phrase}</span><span>→</span><b>{entry.replacement || entry.phrase}</b><button onClick={() => setEntries((items) => items.filter((item) => item.id !== entry.id))}>×</button></div>)}
  </div>;
}

function ShortcutPage({ settings, setSettings, error }: { settings: Settings; setSettings: React.Dispatch<React.SetStateAction<Settings>>; error: string }) {
  return <div className="settings-stack">
    <SettingRow label="録音の開始 / 停止" detail="もう一度押すと停止します"><ShortcutRecorder value={settings.toggleShortcut} onChange={(toggleShortcut) => setSettings((s) => ({ ...s, toggleShortcut }))} /></SettingRow>
    <SettingRow label="押している間だけ入力" detail="キー単体または組み合わせを設定できます"><ShortcutRecorder value={settings.holdShortcut} onChange={(holdShortcut) => setSettings((s) => ({ ...s, holdShortcut }))} /></SettingRow>
    <p className="helper">入力欄をクリックして、使いたいキーを押してください。初期設定は Control の長押しです。</p>
    {error && <p className="inline-error">{error}</p>}
  </div>;
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [recording, setRecording] = useState(false);
  const modifierOnly = useRef("");
  return <button className={`shortcut-recorder ${recording ? "recording" : ""}`} onClick={() => setRecording(true)} onKeyDown={(event) => {
    if (!recording) return;
    event.preventDefault(); event.stopPropagation();
    if (["Control", "Alt", "Meta", "Shift"].includes(event.key)) {
      modifierOnly.current = event.key === "Alt" ? "Option" : event.key === "Meta" ? "Command" : event.key;
      return;
    }
    const shortcut = shortcutFromEvent(event);
    if (shortcut) { onChange(shortcut); setRecording(false); }
  }} onKeyUp={(event) => {
    if (!recording || !modifierOnly.current) return;
    event.preventDefault();
    onChange(modifierOnly.current);
    modifierOnly.current = "";
    setRecording(false);
  }}>{recording ? "キーを押してください" : prettyShortcut(value)}</button>;
}

function AboutPage() {
  return <section className="glass-card about"><div className="about-mark">◉</div><b>VoiceLatte</b><p>Mac / Windows対応の、無料で使えるオンデバイス音声入力。</p><small>Version 0.1.0 Tauri preview</small></section>;
}

function PromptDialog({ settings, setSettings, onClose }: { settings: Settings; setSettings: React.Dispatch<React.SetStateAction<Settings>>; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal prompt-modal" onMouseDown={(e) => e.stopPropagation()}>
    <header><div><b>整形設定</b><span>用途ごとの指示を変更できます</span></div><button onClick={onClose}>×</button></header>
    <PromptField label="デフォルト" value={settings.defaultPrompt} onChange={(defaultPrompt) => setSettings((s) => ({ ...s, defaultPrompt }))} />
    <PromptField label="ChatGPT / チャット" value={settings.chatPrompt} onChange={(chatPrompt) => setSettings((s) => ({ ...s, chatPrompt }))} />
    <PromptField label="Code / ターミナル" value={settings.codePrompt} onChange={(codePrompt) => setSettings((s) => ({ ...s, codePrompt }))} />
    <footer><button className="primary-button" onClick={onClose}>完了</button></footer>
  </section></div>;
}

function PromptField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return <div className={`prompt-field ${open ? "open" : ""}`}><button onClick={() => setOpen(!open)}><b>{label}</b><span>{open ? "⌃" : "⌄"}</span></button>{open && <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} />}</div>;
}

function HistoryDialog({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal history-modal" onMouseDown={(e) => e.stopPropagation()}>
    <header><div><b>入力内容</b><span>{new Date(entry.createdAt).toLocaleString()}</span></div><button onClick={onClose}>×</button></header>
    <div className="history-full">{entry.text}</div>
    {entry.raw !== entry.text && <details><summary>整形前を表示</summary><div className="history-raw">{entry.raw}</div></details>}
    <footer><button className="secondary-button" onClick={() => void navigator.clipboard.writeText(entry.text)}>コピー</button><button className="primary-button" onClick={onClose}>閉じる</button></footer>
  </section></div>;
}

function SettingRow({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><b>{label}</b><span>{detail}</span></div>{children}</div>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <button role="switch" aria-checked={checked} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span /></button>;
}

function Hud() {
  const [state, setState] = useState<HudState>({ phase: "preparing", transcript: "", level: 0, engine: "" });
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
  return <main className={`hud ${state.phase}`} data-tauri-drag-region>
    <div className="hud-orb"><span className="hud-pulse" style={{ transform: `scale(${1 + state.level * .28})` }} /><span className="hud-mic">●</span></div>
    <div className="hud-copy"><small>{phaseLabel(state.phase)}</small><b>{state.transcript || state.message || "どうぞ"}</b></div>
    <div className="hud-meter" aria-label="マイク音量">{Array.from({ length: 14 }, (_, i) => <i key={i} className={i / 14 < state.level ? "lit" : ""} />)}</div>
    {(state.phase === "listening" || state.phase === "preparing") && <button className="hud-stop" onClick={() => void emitTo("main", "hud-stop")}>■ 停止</button>}
  </main>;
}

function shortcutFromEvent(event: React.KeyboardEvent) {
  const modifierKey = ["Control", "Alt", "Meta", "Shift"].includes(event.key);
  if (modifierKey) return event.key === "Alt" ? "Option" : event.key === "Meta" ? "Command" : event.key;
  const parts = [event.metaKey && "CommandOrControl", event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
  const key = event.code === "Space" ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...parts, key].join("+");
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
