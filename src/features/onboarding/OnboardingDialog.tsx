import { useEffect, useState } from "react";
import { Check, Mic } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useI18n } from "../../app/i18n-context";
import { modelStatusMessage, phaseLabel, prettyShortcut, withLinkedRefinementModel, withLinkedTranscriptionModel } from "../../app/formatters";
import type { Phase, RefinementProvider, Settings, TranscriptionProvider } from "../../app/types";
import type { DeviceSettingsStatus, SpeechStatus } from "../../speech-bridge";
import { ApiKeyRow, PermissionRow, RefineModelCatalog, ScreenCaptureRow, ShortcutRecorder } from "../settings/SettingsViews";

export function OnboardingDialog({ dismissible, phase, transcript, level, message, settings, setSettings, status, deviceStatus, installing, apiKeyHints, shortcutChosen, testPassed, shortcutError, onRequestPermission, onInstall, onSaveApiKey, onClearApiKey, onShortcutCaptureChange, onShortcutChange, onComplete, onClose }: {
  dismissible: boolean;
  phase: Phase;
  transcript: string;
  level: number;
  message: string;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  status: SpeechStatus | null;
  deviceStatus: DeviceSettingsStatus | null;
  installing: boolean;
  apiKeyHints: { groq: string | null; gemini: string | null };
  shortcutChosen: boolean;
  testPassed: boolean;
  shortcutError: string;
  onRequestPermission: (permission: "microphone" | "speech" | "accessibility" | "screencapture") => Promise<void>;
  onInstall: () => void;
  onSaveApiKey: (provider: "groq" | "gemini", key: string) => Promise<void>;
  onClearApiKey: (provider: "groq" | "gemini") => Promise<void>;
  onShortcutCaptureChange: (capturing: boolean) => void;
  onShortcutChange: (shortcut: string) => void;
  onComplete: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [capturingShortcut, setCapturingShortcut] = useState(false);
  const [microphoneConfirmed, setMicrophoneConfirmed] = useState(false);
  const testActive = phase === "listening";
  const testBusy = phase === "preparing" || phase === "processing";
  const devices = deviceStatus?.devices ?? [];
  const shortcut = prettyShortcut(settings.toggleShortcut);
  const platform = status?.platform ?? deviceStatus?.platform ?? "macos";
  const providerReady = settings.transcriptionProvider === "local"
    ? status?.modelState === "ready"
    : Boolean(apiKeyHints[settings.transcriptionProvider]);
  const spaceKeyMissing = settings.refinement && settings.refinementProvider !== "local"
    && !apiKeyHints[settings.refinementProvider];
  useEffect(() => {
    onShortcutCaptureChange(capturingShortcut);
    return () => onShortcutCaptureChange(false);
  }, [capturingShortcut, onShortcutCaptureChange]);
  useEffect(() => {
    if (level >= 0.015 || testPassed) setMicrophoneConfirmed(true);
  }, [level, testPassed]);

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
            {deviceStatus.platform === "macos" && deviceStatus.screenCapturePermission !== "not-required" && <ScreenCaptureRow status={deviceStatus.screenCapturePermission} onOpenSettings={() => onRequestPermission("screencapture")} />}
          </div> : <p className="onboarding-hint">{t("onboarding.checkingPermissions")}</p>}
        </Card>

        <Card className="onboarding-section gap-0 py-0">
          <b className="onboarding-step-title">{t("onboarding.apiKeys")}</b>
          <p className="onboarding-hint">{t("onboarding.apiKeysHint")}</p>
          <ApiKeyRow provider="gemini" label="Gemini API Key" keyHint={apiKeyHints.gemini} onSave={onSaveApiKey} onClear={onClearApiKey} />
          <ApiKeyRow provider="groq" label="Groq API Key" keyHint={apiKeyHints.groq} onSave={onSaveApiKey} onClear={onClearApiKey} />
        </Card>

        <Card className="onboarding-section gap-0 py-0">
          <b className="onboarding-step-title">{t("onboarding.recognition")}</b>
          <div className="onboarding-method-row">
            <div><b>{t("general.processingMethod")}</b><span>{t("onboarding.recognitionHint")}</span></div>
            <Select value={settings.transcriptionProvider} onValueChange={(transcriptionProvider) => setSettings((s) => ({ ...s, transcriptionProvider: transcriptionProvider as TranscriptionProvider }))}>
              <SelectTrigger size="sm" className="settings-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="local">{t(platform === "windows" ? "onboarding.localWindows" : "onboarding.localApple")} <Badge variant="secondary">{t("onboarding.recommended")}</Badge></SelectItem>
                <SelectItem value="groq">Groq Cloud</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {settings.transcriptionProvider === "local" && <div className="onboarding-model-status">
            <div><span className={`status-dot ${status?.modelState === "ready" ? "ready" : ""}`} /><span>{modelStatusMessage(status, t)}</span></div>
            {status?.modelState === "download-required" && <Button variant="outline" size="sm" onClick={onInstall} disabled={installing}>{installing ? t("general.addingModel") : t("general.addModel")}</Button>}
          </div>}
          {settings.transcriptionProvider === "gemini" && <RefineModelCatalog
            provider="gemini"
            hasKey={apiKeyHints.gemini !== null}
            value={settings.transcriptionModel}
            task="transcribe"
            onChange={(transcriptionModel) => setSettings((s) => withLinkedTranscriptionModel(s, transcriptionModel))}
          />}
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

        {settings.refinement && <Card className="onboarding-section gap-0 py-0">
          <b className="onboarding-step-title">{t("onboarding.refinement")}</b>
          <div className="onboarding-method-row">
            <div><b>{t("ai.refinementModel")}</b><span>{settings.refinementProvider === "groq" ? t("ai.refinementGroqDetail") : settings.refinementProvider === "gemini" ? t(settings.refinementModel ? "ai.refinementGeminiDetailCustom" : "ai.refinementGeminiDetail") : t("ai.refinementLocalDetail")}</span></div>
            <Select value={settings.refinementProvider} onValueChange={(refinementProvider) => setSettings((s) => ({ ...s, refinementProvider: refinementProvider as RefinementProvider }))}>
              <SelectTrigger size="sm" className="settings-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini">Gemini <Badge variant="secondary">{t("onboarding.recommended")}</Badge></SelectItem>
                <SelectItem value="groq">Groq Cloud</SelectItem>
                <SelectItem value="local">{t("provider.local")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {settings.refinementProvider !== "local" && <RefineModelCatalog
            provider={settings.refinementProvider}
            hasKey={apiKeyHints[settings.refinementProvider] !== null}
            value={settings.refinementModel}
            task="refine"
            linkActive={settings.linkModels && settings.transcriptionProvider === "gemini" && settings.refinementProvider === "gemini"}
            onChange={(refinementModel) => setSettings((s) => withLinkedRefinementModel(s, refinementModel))}
          />}
          {settings.transcriptionProvider === "gemini" && settings.refinementProvider === "gemini" && <div className="onboarding-method-row">
            <div><b>{t("ai.linkModels")}</b><span>{t("ai.linkModelsDetail")}</span></div>
            <Switch checked={settings.linkModels} onCheckedChange={(linkModels) => setSettings((s) => ({ ...s, linkModels }))} />
          </div>}
        </Card>}

        <Card className="onboarding-section gap-0 py-0">
          <b className="onboarding-step-title">{t("onboarding.test")}</b>
          <div className="onboarding-level" aria-label={t("hud.audioLevel")}><span style={{ width: `${Math.round(Math.min(1, level) * 100)}%` }} /></div>
          <div className="onboarding-test-row">
            <kbd>{shortcut}</kbd>
            <span>{!shortcutChosen ? t("onboarding.chooseShortcutFirst") : testActive ? t("onboarding.testActive", { shortcut }) : testBusy ? phaseLabel(phase, t) : testPassed ? t("onboarding.testPassed") : !providerReady ? t("onboarding.recognitionRequired", { shortcut }) : t("onboarding.testHint", { shortcut })}</span>
          </div>
          {shortcutChosen && <p className="onboarding-hint">{t("onboarding.stopHint", { shortcut })}{settings.refinement ? t("onboarding.spaceHint") : ""}{spaceKeyMissing ? t("onboarding.spaceKeyNote") : ""}</p>}
          {microphoneConfirmed && <div className="onboarding-mic-confirmed"><Check />{t("onboarding.microphoneConfirmed")}</div>}
          {transcript && shortcutChosen && <div className={cn("onboarding-result", testPassed && "passed")}>{testPassed ? <Check /> : <Mic />}{transcript}</div>}
          {phase === "error" && message && <p className="inline-error">{message}</p>}
        </Card>
      </div>

      <DialogFooter className="dialog-actions"><Button onClick={onComplete} disabled={!microphoneConfirmed || testActive || testBusy}>{t("onboarding.complete")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
