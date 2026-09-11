import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, Check, ChevronRight, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useI18n } from "../../app/i18n-context";
import { engineLabel, modelStatusMessage, prettyShortcut, settingsWithAppLanguage, shortcutFromEvent, withLinkedRefinementModel, withLinkedTranscriptionModel } from "../../app/formatters";
import type { RefinementProvider, Settings, TranscriptionProvider } from "../../app/types";
import { localizeBridgeMessage, type UiLanguagePreference } from "../../i18n";
import { appLog } from "../../applog";
import type { DeviceSettingsStatus, SpeechStatus } from "../../speech-bridge";
import { parseVocabularyAliases, type VocabularyEntry } from "../../text-processing";

export function GeneralPage({ settings, setSettings, deviceStatus, launchAtLogin, onLaunchAtLogin, onRequestPermission }: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  deviceStatus: DeviceSettingsStatus | null;
  launchAtLogin: boolean;
  onLaunchAtLogin: (enabled: boolean) => Promise<void>;
  onRequestPermission: (permission: "microphone" | "speech" | "accessibility" | "screencapture") => Promise<void>;
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
        <ScreenCaptureRow status={deviceStatus.screenCapturePermission} onOpenSettings={() => onRequestPermission("screencapture")} />
      </Card>
    </>}
  </div>;
}

export function AiPage({ status, settings, setSettings, installing, deviceStatus, apiKeyHints, onPrompts, onInstall, onSaveApiKey, onClearApiKey }: {
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
      {settings.transcriptionProvider === "gemini" && <RefineModelCatalog
        provider="gemini"
        hasKey={apiKeyHints.gemini !== null}
        value={settings.transcriptionModel}
        task="transcribe"
        onChange={(transcriptionModel) => setSettings((s) => withLinkedTranscriptionModel(s, transcriptionModel))}
      />}
      <p className="settings-note">{settings.transcriptionProvider === "local"
        ? t("general.onDevice")
        : t(deviceStatus?.platform === "macos" && settings.refinement ? "general.cloudAudioWithContext" : "general.cloudAudio")}</p>
    </Card>

    <p className="settings-group-label">{t("ai.refinement")}</p>
    <SettingRow label={t("general.refinement")} detail={t("general.refinementDetail")}><Switch checked={settings.refinement} onCheckedChange={(refinement) => setSettings((s) => ({ ...s, refinement }))} /></SettingRow>
    {settings.refinement && <Card className="glass-card recognition-card gap-0 py-0">
      <SettingRow label={t("ai.refinementModel")} detail={settings.refinementProvider === "groq" ? t("ai.refinementGroqDetail") : settings.refinementProvider === "gemini" ? t(settings.refinementModel ? "ai.refinementGeminiDetailCustom" : "ai.refinementGeminiDetail") : t("ai.refinementLocalDetail")}>
        <Select value={settings.refinementProvider} onValueChange={(refinementProvider) => setSettings((s) => ({ ...s, refinementProvider: refinementProvider as RefinementProvider }))}>
          <SelectTrigger size="sm" className="settings-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="groq">Groq Cloud</SelectItem>
            <SelectItem value="gemini">Gemini</SelectItem>
            <SelectItem value="local">{t("provider.local")}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      {settings.refinementProvider === "local"
        ? <p className="settings-note">{t("ai.refinementLocalDetail")}</p>
        : <>
          {settings.transcriptionProvider !== settings.refinementProvider && <ApiKeyRow provider={settings.refinementProvider} label={`${settings.refinementProvider === "groq" ? "Groq" : "Gemini"} API Key`} keyHint={apiKeyHints[settings.refinementProvider]} onSave={onSaveApiKey} onClear={onClearApiKey} />}
          <RefineModelCatalog
            provider={settings.refinementProvider}
            hasKey={apiKeyHints[settings.refinementProvider] !== null}
            value={settings.refinementModel}
            task="refine"
            linkActive={settings.linkModels && settings.transcriptionProvider === "gemini" && settings.refinementProvider === "gemini"}
            onChange={(refinementModel) => setSettings((s) => withLinkedRefinementModel(s, refinementModel))}
          />
          {settings.transcriptionProvider === "gemini" && settings.refinementProvider === "gemini" && <SettingRow label={t("ai.linkModels")} detail={t("ai.linkModelsDetail")}><Switch checked={settings.linkModels} onCheckedChange={(linkModels) => setSettings((s) => ({ ...s, linkModels }))} /></SettingRow>}
        </>}
    </Card>}
    <Button variant="ghost" className="refine-strip ai-refine-strip h-auto" onClick={onPrompts}>
      <span className="strip-icon"><SlidersHorizontal /></span><span><b>{t("history.refinement")}</b><small>{t("history.refinementDetail")}</small></span><ChevronRight className="chevron" />
    </Button>
  </div>;
}

export function ApiKeyRow({ provider, label, keyHint, onSave, onClear }: {
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
  const keyUrl = provider === "gemini" ? "https://aistudio.google.com/apikey" : "https://console.groq.com/keys";
  return <div className="setting-row api-key-row">
    <div><b>{label}</b><span>{provider === "gemini" && `${t("apiKey.geminiDetail")} · `}{configured ? t("apiKey.configured") : t("apiKey.notConfigured")}</span><small>{t("apiKey.keychainNotice")} <Button variant="link" size="xs" className="api-key-link" onClick={() => void run(() => invoke("open_url", { url: keyUrl }))}>{t("apiKey.getKey")}</Button></small>{error && <small className="api-key-error">{error}</small>}</div>
    <div className="api-key-actions">
      <Input type="password" value={key} autoComplete="off" spellCheck={false} onChange={(event) => setKey(event.target.value)} placeholder={keyHint ?? t("apiKey.placeholder")} />
      <Button variant="ghost" size="xs" disabled={!key.trim()} onClick={() => void run(async () => { await onSave(provider, key); setKey(""); })}>{configured ? t("apiKey.update") : t("apiKey.save")}</Button>
      {configured && <Button variant="ghost" size="xs" onClick={() => void run(() => onClear(provider))}>{t("apiKey.remove")}</Button>}
    </div>
  </div>;
}

// モデル選択カタログ。表示可否はサーバ返却の eligibility に従う（ID判定を書かない）。
export function RefineModelCatalog({ provider, hasKey, value, onChange, task, linkActive }: {
  provider: "groq" | "gemini";
  hasKey: boolean;
  value: string;
  onChange: (model: string) => void;
  task: "transcribe" | "refine";
  // 連動中は転写対応モデルのみ表示する（整形側）。
  linkActive?: boolean;
}) {
  const { language, t } = useI18n();
  type CatalogModel = {
    id: string;
    vision?: boolean;
    audio?: boolean;
    transcriptionEligible?: boolean;
    refinementEligible?: boolean;
  };
  const [models, setModels] = useState<CatalogModel[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setModels(await invoke<CatalogModel[]>("list_provider_models", { provider }));
    } catch (reason) {
      setModels(null);
      setError(localizeBridgeMessage(reason instanceof Error ? reason.message : String(reason), language, t));
    } finally {
      setLoading(false);
    }
  }, [language, provider, t]);
  useEffect(() => {
    if (!hasKey) {
      setModels(null);
      setError("");
      return;
    }
    void load();
  }, [hasKey, load]);
  const visibleModels = (models ?? []).filter((m) => {
    const eligible = task === "transcribe" ? m.transcriptionEligible === true : m.refinementEligible === true;
    if (!eligible) return false;
    if (linkActive === true && m.transcriptionEligible !== true) return false;
    return true;
  });
  const ids = visibleModels.map((m) => m.id);
  const stale = value !== "" && models !== null && !ids.includes(value);
  const selectValue = value === "" ? "__auto__" : value;
  // トリガーにはIDだけ出す（バッジは一覧内のみ）。バッジ付きだと崩れるため。
  const triggerLabel = selectValue === "__auto__"
    ? (loading ? t("ai.modelsLoading") : t("ai.modelAuto"))
    : selectValue;
  return <div className="setting-row api-key-row">
    <div>
      <b>{t("ai.modelSelect")}</b>
      <span>{t("ai.modelSelectDetail")}</span>
      {stale && <small className="api-key-error">{t("ai.modelStale")}</small>}
      {!hasKey && <small>{t("apiKey.notConfigured")}</small>}
      {provider === "gemini" && <Button variant="link" size="xs" className="api-key-link" onClick={() => void invoke("open_url", { url: "https://aistudio.google.com/rate-limit?timeRange=last-28-days" }).catch(() => undefined)}>{t("ai.rateLimit")}</Button>}
      {linkActive === true && <small>{t("ai.linkHidesModels")}</small>}
      {error && <small className="api-key-error">{error}</small>}
    </div>
    <div className="api-key-actions">
      <Select value={selectValue} disabled={!hasKey || models === null} onValueChange={(v) => onChange(v === "__auto__" ? "" : v)} onOpenChange={(open) => appLog.info("catalog", `${provider}/${task} dropdown open=${open}`)}>
        <SelectTrigger size="sm" className="settings-select"><span className="model-trigger-label">{triggerLabel}</span></SelectTrigger>
        <SelectContent position="popper" sideOffset={4} align="start">
          <SelectItem value="__auto__">{t("ai.modelAuto")}</SelectItem>
          {visibleModels.map((m) => <SelectItem value={m.id} key={m.id}>
            <span className="model-option"><span className="model-option-id">{m.id}</span>
            {m.vision === true && <Badge variant="secondary" title={t("ai.modelVisionDetail")}>{t("ai.modelVision")}</Badge>}
            {m.audio === true && <Badge variant="secondary" title={t("ai.modelAudioDetail")}>{t("ai.modelAudio")}</Badge>}
            </span>
          </SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  </div>;
}

export function ScreenCaptureRow({ status, onOpenSettings }: {
  status: DeviceSettingsStatus["screenCapturePermission"];
  onOpenSettings: () => Promise<void>;
}) {
  const { t } = useI18n();
  const granted = status === "authorized" || status === "not-required";
  return <div className="permission-row">
    <span className={cn("permission-mark", granted && "granted")}>{granted ? <Check /> : <AlertCircle />}</span>
    <div><b>{t("permission.screenCapture")}</b><small>{t("permission.screenCaptureDetail")}</small></div>
    {granted
      ? <span className="permission-state">{t("permission.granted")}</span>
      : <Button variant="outline" size="xs" className="secondary-button" onClick={() => void onOpenSettings()}>{t("permission.openSettings")}</Button>}
  </div>;
}

export function PermissionRow({ label, detail, status, onAction }: {
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

export function VocabularyPage({ entries, setEntries }: { entries: VocabularyEntry[]; setEntries: React.Dispatch<React.SetStateAction<VocabularyEntry[]>> }) {
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

export function ShortcutPage({ settings, setSettings, error, onCaptureChange }: {
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

export function ShortcutRecorder({ value, active, disabled = false, onStart, onChange }: { value: string; active: boolean; disabled?: boolean; onStart: () => void; onChange: (value: string) => void }) {
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

export function SettingRow({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><b>{label}</b><span>{detail}</span></div>{children}</div>;
}
