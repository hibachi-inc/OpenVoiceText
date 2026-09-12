import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { localizeBridgeMessage } from "../i18n";
import { useI18n } from "../app-hooks";
import type { DeviceSettingsStatus } from "../speech-bridge";

export function SettingRow({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><b>{label}</b><span>{detail}</span></div>{children}</div>;
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
      <Select value={selectValue} disabled={!hasKey || models === null} onValueChange={(v) => onChange(v === "__auto__" ? "" : v)}>
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
