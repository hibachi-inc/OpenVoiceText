import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowDown, Bot, Check, ChevronDown, ChevronUp, Copy, Info, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "../app-hooks";
import { getLogText, subscribeLog } from "../applog";
import { categoryLabel } from "../format";
import type { HistoryEntry } from "../types";
import { AnthropicMark } from "./brand-marks";

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

export function ReportDialog({ kind, version, onClose }: { kind: "bug" | "request"; version: string; onClose: () => void }) {
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

export function LogDialog({ onClose }: { onClose: () => void }) {
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

export function HistoryDialog({ entry, debugMode, onClose }: { entry: HistoryEntry; debugMode: boolean; onClose: () => void }) {
  const { language, t } = useI18n();
  const [copied, setCopied] = useState<"original" | "refined" | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const copy = async (text: string, version: "original" | "refined") => {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setCopied(version);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1600);
  };
  const details: [string, string][] = [
    [t("historyDialog.date"), new Date(entry.createdAt).toLocaleString(language)],
    [t("historyDialog.app"), entry.appName || "VoiceLatte"],
    [t("historyDialog.category"), categoryLabel(entry.category, t)],
    [t("historyDialog.transcription"), entry.engine || "—"],
    [t("historyDialog.refineEngine"), entry.refiner || "—"],
    [t("historyDialog.promptKey"), entry.promptKey || "—"],
    [t("historyDialog.context"), entry.screenChars === undefined ? "—" : t("historyDialog.contextValue", { count: entry.screenChars })],
    [t("historyDialog.chars"), `${entry.raw.length} → ${entry.text.length}`],
  ];
  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="modal history-modal sm:max-w-[520px]">
      <DialogHeader><DialogTitle>{t("historyDialog.title")}</DialogTitle><DialogDescription>{new Date(entry.createdAt).toLocaleString(language)}</DialogDescription></DialogHeader>
      {debugMode && <div className="history-meta-bar">
        <Button variant="ghost" size="xs" aria-expanded={showInfo} onClick={() => setShowInfo((v) => !v)}><Info />{t("historyDialog.details")}{showInfo ? <ChevronUp /> : <ChevronDown />}</Button>
      </div>}
      {debugMode && showInfo && <dl className="history-details">
        {details.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}
      </dl>}
      {debugMode && showInfo && entry.screenText && <div className="history-full original history-context-body">{entry.screenText}</div>}
      {debugMode && entry.image && <div className="history-screenshot-wrap">
        <small>{t("historyDialog.image")}</small>
        <img className="history-screenshot" src={`data:image/jpeg;base64,${entry.image}`} alt="" />
      </div>}
      <div className="history-versions">
        {entry.refiner !== undefined && entry.raw !== entry.text ? <>
          <section className="history-version">
            <div className="history-version-header"><b>{t("historyDialog.original")}</b><Button variant="ghost" size="xs" aria-live="polite" onClick={() => void copy(entry.raw, "original")}>{copied === "original" ? <Check /> : <Copy />}{copied === "original" ? t("action.copied") : t("action.copy")}</Button></div>
            <div className="history-full original">{entry.raw}</div>
          </section>
          <div className="history-flow-arrow" aria-hidden="true"><ArrowDown /></div>
          <section className="history-version">
            <div className="history-version-header"><b>{t("historyDialog.refined")}</b>{entry.refiner && <small>{t("historyDialog.refiner", { model: entry.refiner })}</small>}<Button variant="ghost" size="xs" aria-live="polite" onClick={() => void copy(entry.text, "refined")}>{copied === "original" ? <Check /> : <Copy />}{copied === "original" ? t("action.copied") : t("action.copy")}</Button></div>
            <div className="history-full">{entry.text}</div>
          </section>
        </> : <section className="history-version">
          <div className="history-version-header"><b>{t("historyDialog.transcription")}</b><Button variant="ghost" size="xs" aria-live="polite" onClick={() => void copy(entry.text, "original")}>{copied === "original" ? <Check /> : <Copy />}{copied === "original" ? t("action.copied") : t("action.copy")}</Button></div>
          <div className="history-full">{entry.text}</div>
        </section>}
      </div>
    </DialogContent>
  </Dialog>;
}
