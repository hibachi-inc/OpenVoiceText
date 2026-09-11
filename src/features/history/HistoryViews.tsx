import { useEffect, useRef, useState } from "react";
import { ArrowDown, Check, ChevronDown, ChevronUp, Copy, Info, Mic, Square, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "../../app/i18n-context";
import { categoryLabel, phaseLabel, relativeTime } from "../../app/formatters";
import type { HistoryEntry, Phase } from "../../app/types";

export function HistoryPage(props: {
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
            <div className="history-version-header"><b>{t("historyDialog.refined")}</b>{entry.refiner && <small>{t("historyDialog.refiner", { model: entry.refiner })}</small>}<Button variant="ghost" size="xs" aria-live="polite" onClick={() => void copy(entry.text, "refined")}>{copied === "refined" ? <Check /> : <Copy />}{copied === "refined" ? t("action.copied") : t("action.copy")}</Button></div>
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
