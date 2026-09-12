import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "../../app/i18n-context";
import { categoryLabel, promptKeyLabel } from "../../app/formatters";
import type { HistoryEntry, Settings } from "../../app/types";
import { DEFAULT_PROMPT_KEY, appPromptKey, categoryPromptKey } from "../../text-processing";

const promptCategories = ["chat", "email", "code", "terminal", "notes", "browser", "generic"];

export function PromptDialog({ settings, setSettings, history, onClose }: {
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
