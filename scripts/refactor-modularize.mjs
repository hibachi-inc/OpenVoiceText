import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import ts from "typescript";

const appPath = "src/App.tsx";
let source = readFileSync(appPath, "utf8");
const sf = ts.createSourceFile(appPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const nodes = new Map();
for (const statement of sf.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name) nodes.set(statement.name.text, statement);
  if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement)) {
    if (statement.name) nodes.set(statement.name.text, statement);
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) nodes.set(declaration.name.text, statement);
    }
  }
}

const removed = new Set();
function nodeText(name) {
  const node = nodes.get(name);
  if (!node) throw new Error(`Missing top-level declaration: ${name}`);
  removed.add(node);
  return source.slice(node.getFullStart(), node.end).trim();
}
function group(names) {
  return names.map(nodeText).join("\n\n") + "\n";
}
function exportName(text, name) {
  const patterns = [
    [`async function ${name}`, `export async function ${name}`],
    [`function ${name}`, `export function ${name}`],
    [`type ${name}`, `export type ${name}`],
    [`interface ${name}`, `export interface ${name}`],
    [`class ${name}`, `export class ${name}`],
    [`const ${name}`, `export const ${name}`],
    [`let ${name}`, `export let ${name}`],
  ];
  for (const [from, to] of patterns) {
    if (text.includes(from)) return text.replace(from, to);
  }
  throw new Error(`Cannot export declaration: ${name}`);
}
function groupWithExports(names, exported) {
  let text = group(names);
  for (const name of exported) text = exportName(text, name);
  return text;
}
function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.trimStart().replace(/\s+$/u, "") + "\n");
}

const typeNames = [
  "Phase", "Section", "TranscriptionProvider", "RefinementProvider", "CaptureMode",
  "HistoryEntry", "Settings", "HudState", "PendingChoice", "PreparedCapture",
  "CloudResult", "CloudTranscript",
];
write("src/app/types.ts", `
import type { UiLanguage, UiLanguagePreference } from "../i18n";
import type { CustomPrompts } from "../text-processing";

${groupWithExports(typeNames, typeNames)}
`);

write("src/app/storage.ts", `
import { useEffect, useState } from "react";

${groupWithExports(["useStoredState"], ["useStoredState"])}
`);

write("src/app/i18n-context.tsx", `
import { createContext, useContext, useEffect, useMemo } from "react";
import { createTranslator, resolveUiLanguage, type Translator, type UiLanguage, type UiLanguagePreference } from "../i18n";

const systemUiLanguage = resolveUiLanguage("system");

${groupWithExports(["I18nContext", "I18nProvider", "useI18n"], ["I18nProvider", "useI18n"])}
`);

write("src/app/settings.ts", `
import { defaultRefinementPrompt, legacyDefaultPrompts, resolveUiLanguage, type UiLanguagePreference } from "../i18n";
import { DEFAULT_PROMPT_KEY, migrateLegacyCustomPrompts, type VocabularyEntry } from "../text-processing";
import type { RefinementProvider, Settings } from "./types";

const systemUiLanguage = resolveUiLanguage("system");

${groupWithExports(["DEFAULT_VOCABULARY", "DEFAULT_SETTINGS", "normalizeSettings"], ["DEFAULT_VOCABULARY", "DEFAULT_SETTINGS", "normalizeSettings"])}
`);

write("src/app/formatters.ts", `
import type { MessageKey, Translator, UiLanguage, UiLanguagePreference } from "../i18n";
import type { SpeechStatus } from "../speech-bridge";
import { DEFAULT_PROMPT_KEY } from "../text-processing";
import type { Phase, Settings } from "./types";

${groupWithExports([
  "withLinkedTranscriptionModel", "withLinkedRefinementModel", "shortcutFromEvent",
  "isModifierOnlyShortcut", "prettyShortcut", "phaseLabel", "relativeTime",
  "engineLabel", "modelStatusMessage", "categoryLabel", "promptKeyLabel",
  "settingsWithAppLanguage",
], [
  "withLinkedTranscriptionModel", "withLinkedRefinementModel", "shortcutFromEvent",
  "isModifierOnlyShortcut", "prettyShortcut", "phaseLabel", "relativeTime",
  "engineLabel", "modelStatusMessage", "categoryLabel", "promptKeyLabel",
  "settingsWithAppLanguage",
])}
`);

write("src/features/privacy/screen-capture.ts", `
${groupWithExports([
  "SCREEN_CAPTURE_BLOCKED_BUNDLE_HINTS", "SCREEN_CAPTURE_BLOCKED_NAME_HINTS", "isScreenCaptureAllowed",
], ["isScreenCaptureAllowed"])}
`);

write("src/features/history/history-media.ts", `
import type { HistoryEntry } from "../../app/types";

${groupWithExports(["IMAGE_RETENTION_MS", "jpegToWebp", "makeHistoryThumbnail", "purgeExpiredImages"], ["jpegToWebp", "makeHistoryThumbnail", "purgeExpiredImages"])}
`);

write("src/features/history/HistoryViews.tsx", `
import { useEffect, useRef, useState } from "react";
import { ArrowDown, Check, ChevronDown, ChevronUp, Copy, Info, Mic, Square, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "../../app/i18n-context";
import { categoryLabel, phaseLabel, relativeTime } from "../../app/formatters";
import type { HistoryEntry, Phase } from "../../app/types";

${groupWithExports(["HistoryPage", "HistoryDialog"], ["HistoryPage", "HistoryDialog"])}
`);

write("src/features/hud/Hud.tsx", `
import { useEffect, useMemo, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createTranslator, resolveUiLanguage } from "../../i18n";
import { phaseLabel } from "../../app/formatters";
import type { HudState } from "../../app/types";

const systemUiLanguage = resolveUiLanguage("system");

${groupWithExports(["Hud", "confirmChoice"], ["Hud"])}
`);

write("src/app/update.ts", `
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

${groupWithExports(["UpdateState", "runUpdateCheck", "installUpdate"], ["UpdateState", "runUpdateCheck", "installUpdate"])}
`);

write("src/features/settings/SettingsViews.tsx", `
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

${groupWithExports([
  "GeneralPage", "AiPage", "ApiKeyRow", "RefineModelCatalog", "ScreenCaptureRow",
  "PermissionRow", "VocabularyPage", "ShortcutPage", "ShortcutRecorder", "SettingRow",
], [
  "GeneralPage", "AiPage", "ApiKeyRow", "RefineModelCatalog", "ScreenCaptureRow",
  "PermissionRow", "VocabularyPage", "ShortcutPage", "ShortcutRecorder", "SettingRow",
])}
`);

write("src/features/onboarding/OnboardingDialog.tsx", `
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

${groupWithExports(["OnboardingDialog"], ["OnboardingDialog"])}
`);

write("src/features/prompts/PromptDialog.tsx", `
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

${groupWithExports(["PromptDialog", "PromptField"], ["PromptDialog"])}
`);

write("src/features/about/star-prompt.ts", `
${groupWithExports([
  "STAR_COUNT_KEY", "STAR_SHOWN_KEY", "readStarCount", "starPromptShown", "markStarPromptShown", "bumpStarCount",
], ["starPromptShown", "markStarPromptShown", "bumpStarCount"])}
`);

write("src/features/about/AboutView.tsx", `
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

${groupWithExports([
  "GithubMark", "XMark", "AnthropicMark", "StarDialog", "ReportDialog", "AboutPage", "UpdateRow", "LogDialog",
], ["StarDialog", "AboutPage"])}
`);

// Remove extracted declarations from App.tsx.
const spans = [...removed].map((node) => [node.getFullStart(), node.end]).sort((a, b) => b[0] - a[0]);
for (const [start, end] of spans) source = source.slice(0, start) + source.slice(end);

// Replace the original import block with a deliberately small App-level dependency set.
const importNodes = sf.statements.filter(ts.isImportDeclaration);
const importStart = importNodes[0].getFullStart();
const importEnd = importNodes.at(-1).end;
const imports = `import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, LogicalPosition, monitorFromPoint, PhysicalPosition } from "@tauri-apps/api/window";
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
import { AiPage, GeneralPage, ShortcutPage, VocabularyPage } from "./features/settings/SettingsViews";`;

// Import offsets belong to the original source, so apply this replacement after declaration removals
// by finding the remaining first/last import text rather than reusing stale offsets.
const afterSf = ts.createSourceFile(appPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const afterImports = afterSf.statements.filter(ts.isImportDeclaration);
const start = afterImports[0].getFullStart();
const end = afterImports.at(-1).end;
source = source.slice(0, start) + imports + source.slice(end);

// These declarations moved with their consumers.
source = source.replace(/\nconst systemUiLanguage = resolveUiLanguage\("system"\);\n/u, "\n");
source = source.replace(/\nconst promptCategories = \[[^\n]+\];\n/u, "\n");

writeFileSync(appPath, source.replace(/\n{3,}/g, "\n\n").trimStart());
console.log("Modularized src/App.tsx into app/features modules");
