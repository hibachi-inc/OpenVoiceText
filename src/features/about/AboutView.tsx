import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Bot, Bug, Check, ChevronDown, ChevronRight, ChevronUp, Copy, Download, Lightbulb, Settings2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import voicelatteCow from "../../assets/voicelatte-cow.png";
import { getLogText, subscribeLog } from "../../applog";
import { useI18n } from "../../app/i18n-context";
import { installUpdate, runUpdateCheck, type UpdateState } from "../../app/update";
import { SettingRow } from "../settings/SettingsViews";

function GithubMark() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>;
}

function XMark() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" /></svg>;
}

function AnthropicMark() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" /></svg>;
}

export function StarDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="modal sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>{t("star.title")}</DialogTitle>
        <DialogDescription>{t("star.body")}</DialogDescription>
      </DialogHeader>
      <DialogFooter className="dialog-actions">
        <Button variant="outline" onClick={onClose}>{t("star.later")}</Button>
        <Button onClick={() => { void invoke("open_url", { url: "https://github.com/hibachi-inc/OpenVoiceText" }).catch(() => undefined); onClose(); }}><Star />{t("star.action")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ReportDialog({ kind, version, onClose }: { kind: "bug" | "request"; version: string; onClose: () => void }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState("");
  const [copied, setCopied] = useState(false);
  const template = kind === "bug" ? "bug_report.yml" : "feature_request.yml";
  const [previewOpen, setPreviewOpen] = useState(false);
  const prompt = t(kind === "bug" ? "about.reportPromptBug" : "about.reportPromptRequest", {
    summary: summary.trim() || t("about.reportNoSummary"),
    version: version || "?",
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); } catch { return; }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  // 指示文をコピーしてAIを開く。URLが長すぎて反映されない機種でも貼り付け一発で送れる。
  const openAi = async (base: string) => {
    try { await navigator.clipboard.writeText(prompt); } catch { /* 開くだけ続行 */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    void invoke("open_url", { url: `${base}${encodeURIComponent(prompt)}` }).catch(() => undefined);
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="modal sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>{t(kind === "bug" ? "about.reportBugTitle" : "about.reportRequestTitle")}</DialogTitle>
        <DialogDescription>{t("about.reportHint")}</DialogDescription>
      </DialogHeader>
      <Textarea value={summary} placeholder={t("about.reportSummaryPlaceholder")} onChange={(e) => setSummary(e.target.value)} rows={3} />
      <Collapsible open={previewOpen} onOpenChange={setPreviewOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="xs" className="report-preview-trigger"><span>{t("about.reportPreview")}</span>{previewOpen ? <ChevronUp /> : <ChevronDown />}</Button>
        </CollapsibleTrigger>
        <CollapsibleContent><div className="report-preview">{prompt}</div></CollapsibleContent>
      </Collapsible>
      <DialogFooter className="dialog-actions">
        <Button variant="outline" onClick={() => void invoke("open_url", { url: `https://github.com/hibachi-inc/OpenVoiceText/issues/new?template=${template}` }).catch(() => undefined)}>{t("about.reportManual")}</Button>
        <Button onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? t("about.reportCopied") : t("about.reportCopy")}</Button>
      </DialogFooter>
      <div className="report-ai">
        <span className="report-ai-label">{t("about.reportAiRow")}</span>
        <div className="report-ai-buttons">
          <Button variant="outline" size="sm" onClick={() => void openAi("https://chatgpt.com/?q=")}><Bot />ChatGPT</Button>
          <Button variant="outline" size="sm" onClick={() => void openAi("https://claude.ai/new?q=")}><AnthropicMark />Claude</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}

export function AboutPage({ update, setUpdate, onOpenOnboarding, debugMode, onToggleDebugMode }: { update: UpdateState; setUpdate: (state: UpdateState) => void; onOpenOnboarding: () => void; debugMode: boolean; onToggleDebugMode: (debugMode: boolean) => void }) {
  const { t } = useI18n();
  const [version, setVersion] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const [reportKind, setReportKind] = useState<null | "bug" | "request">(null);
  useEffect(() => { void getVersion().then(setVersion).catch(() => undefined); }, []);
  const openExternal = (url: string) => () => void invoke("open_url", { url }).catch(() => undefined);
  return <>
    <Card className="glass-card about gap-0 py-0">
      <img className="about-character" src={voicelatteCow} alt="" />
      <b>Voice Latte</b>
      <p>{t("about.tagline")}</p>
      <small>{version ? t("about.version", { version }) : ""}</small>
      <UpdateRow state={update} onCheck={() => void runUpdateCheck(setUpdate, true)} onInstall={() => void installUpdate(update, setUpdate)} />
      <div className="about-actions">
        <Button variant="outline" size="sm" className="about-setup" onClick={onOpenOnboarding}><Settings2 />{t("about.openOnboarding")}</Button>
        <Button variant="outline" size="sm" className="about-setup" onClick={() => setLogOpen(true)}>{t("general.errorLog")}</Button>
      </div>
      {logOpen && <LogDialog onClose={() => setLogOpen(false)} />}
    </Card>
    <div className="about-groups">
      <span className="settings-group-label">{t("about.sectionAbout")}</span>
      <Button variant="ghost" className="refine-strip h-auto" onClick={openExternal("https://github.com/hibachi-inc/OpenVoiceText")}>
        <span className="strip-icon brand"><GithubMark /></span>
        <span><b>OpenVoiceText</b><small>hibachi-inc/OpenVoiceText</small></span>
        <ChevronRight className="chevron" />
      </Button>
      <Button variant="ghost" className="refine-strip h-auto" onClick={() => setReportKind("bug")}>
        <span className="strip-icon"><Bug /></span>
        <span><b>{t("about.bugReport")}</b><small>{t("about.bugReportDetail")}</small></span>
        <ChevronRight className="chevron" />
      </Button>
      <Button variant="ghost" className="refine-strip h-auto" onClick={() => setReportKind("request")}>
        <span className="strip-icon"><Lightbulb /></span>
        <span><b>{t("about.featureRequest")}</b><small>{t("about.featureRequestDetail")}</small></span>
        <ChevronRight className="chevron" />
      </Button>
      <span className="settings-group-label">{t("about.maintainer")}</span>
      <Button variant="ghost" className="refine-strip h-auto" onClick={openExternal("https://x.com/tanakaisworking")}>
        <span className="strip-icon brand"><XMark /></span>
        <span><b>@tanakaisworking</b><small>{t("about.maintainerDetail")}</small></span>
        <ChevronRight className="chevron" />
      </Button>
    </div>
    <div className="about-debug"><SettingRow label={t("about.debugMode")} detail={t("about.debugModeDetail")}><Switch checked={debugMode} onCheckedChange={onToggleDebugMode} /></SettingRow></div>
    {reportKind && <ReportDialog kind={reportKind} version={version} onClose={() => setReportKind(null)} />}
  </>;
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

function LogDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(() => getLogText());
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    setText(getLogText());
    const unsubscribe = subscribeLog(() => setText(getLogText()));
    return () => {
      unsubscribe();
      window.clearTimeout(copyTimer.current);
    };
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="modal sm:max-w-[560px]">
      <DialogHeader><DialogTitle>{t("general.errorLog")}</DialogTitle><DialogDescription>{t("general.errorLogDetail")}</DialogDescription></DialogHeader>
      <div className="log-body">{text || t("general.errorLogEmpty")}</div>
      <DialogFooter className="dialog-actions">
        <Button variant="ghost" size="xs" aria-live="polite" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? t("action.copied") : t("action.copy")}</Button>
        <Button onClick={onClose}>{t("action.done")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
