import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const path = "src/App.tsx";
let source = readFileSync(path, "utf8");

function take(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  const chunk = source.slice(start, end);
  source = source.slice(0, start) + source.slice(end);
  return chunk.trimEnd();
}

const refs = take(
  '  const transcriptRef = useRef("");',
  '  const localizedError = useCallback((error: unknown) => {',
);

const recording = take(
  '  const updateHud = useCallback(async (next: HudState) => {',
  '  useEffect(() => {\n    void bridge.status(speechLocale)',
);

const helpers = take(
  'function bridgeMessageCode(error: unknown) {',
  'export default Root;',
);

const hookCall = `  const {
    actionRef,
    shortcutCaptureRef,
    onboardingTestRef,
    setShortcutCapturing,
    cancelRecording,
    finalizeChoice,
    discardChoice,
    setRecordingState,
    phaseRef,
    processingStartRef,
    elapsedRef,
  } = useRecordingController({
    bridge,
    settings,
    speechLocale,
    vocabulary,
    apiKeyHints,
    onboardingShortcutChosen,
    showOnboarding,
    language,
    t,
    localizedError,
    markKeyDenied,
    setPhase,
    setTranscript,
    setLevel,
    setMessage,
    setHistory,
    setStarOpen,
    setOnboardingTestPassed,
  });

`;
const insertion = source.indexOf('  useEffect(() => {\n    void bridge.status(speechLocale)');
if (insertion < 0) throw new Error("recording hook insertion point missing");
source = source.slice(0, insertion) + hookCall + source.slice(insertion);

source = source.replace(
  'import { emitTo, listen } from "@tauri-apps/api/event";',
  'import { listen } from "@tauri-apps/api/event";',
);
source = source.replace(
  'import { WebviewWindow } from "@tauri-apps/api/webviewWindow";\nimport { currentMonitor, LogicalPosition, monitorFromPoint, PhysicalPosition } from "@tauri-apps/api/window";\n',
  '',
);
source = source.replace(
  'import { AiPage, GeneralPage, ShortcutPage, VocabularyPage } from "./features/settings/SettingsViews";',
  'import { AiPage, GeneralPage, ShortcutPage, VocabularyPage } from "./features/settings/SettingsViews";\nimport { useRecordingController } from "./features/recording/useRecordingController";',
);
source = source.replace(/\n{3,}/g, "\n\n");
writeFileSync(path, source);

mkdirSync("src/features/recording", { recursive: true });
const hook = `import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, LogicalPosition, monitorFromPoint, PhysicalPosition } from "@tauri-apps/api/window";
import { appLog } from "../../applog";
import { localizeBridgeMessage, type Translator, type UiLanguage } from "../../i18n";
import { type SpeechBridgeClient } from "../../speech-bridge";
import { buildRefinementPrompt, postProcessTranscript, resolveCustomPrompt, shouldDiscardRefinement, vocabularyHints, type VocabularyEntry } from "../../text-processing";
import type { CaptureMode, CloudResult, HistoryEntry, HudState, PendingChoice, Phase, PreparedCapture, Settings, TranscriptionProvider } from "../../app/types";
import { bumpStarCount, markStarPromptShown, starPromptShown } from "../about/star-prompt";
import { jpegToWebp, makeHistoryThumbnail, purgeExpiredImages } from "../history/history-media";
import { isScreenCaptureAllowed } from "../privacy/screen-capture";

type ApiKeyHints = { groq: string | null; gemini: string | null };
type CloudProvider = "groq" | "gemini";
type RecordingAction = "toggle" | "refine-stop" | "cancel" | "hold-start" | "hold-stop" | "shared-start" | "shared-stop";

type Options = {
  bridge: SpeechBridgeClient;
  settings: Settings;
  speechLocale: string;
  vocabulary: VocabularyEntry[];
  apiKeyHints: ApiKeyHints;
  onboardingShortcutChosen: boolean;
  showOnboarding: boolean;
  language: UiLanguage;
  t: Translator;
  localizedError: (error: unknown) => string;
  markKeyDenied: (provider: CloudProvider) => void;
  setPhase: Dispatch<SetStateAction<Phase>>;
  setTranscript: Dispatch<SetStateAction<string>>;
  setLevel: Dispatch<SetStateAction<number>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setHistory: Dispatch<SetStateAction<HistoryEntry[]>>;
  setStarOpen: Dispatch<SetStateAction<boolean>>;
  setOnboardingTestPassed: Dispatch<SetStateAction<boolean>>;
};

export function useRecordingController({
  bridge,
  settings,
  speechLocale,
  vocabulary,
  apiKeyHints,
  onboardingShortcutChosen,
  showOnboarding,
  language,
  t,
  localizedError,
  markKeyDenied,
  setPhase,
  setTranscript,
  setLevel,
  setMessage,
  setHistory,
  setStarOpen,
  setOnboardingTestPassed,
}: Options) {
${refs}

${recording}

  return {
    actionRef,
    shortcutCaptureRef,
    onboardingTestRef,
    setShortcutCapturing,
    cancelRecording,
    finalizeChoice,
    discardChoice,
    setRecordingState,
    phaseRef,
    processingStartRef,
    elapsedRef,
  };
}

${helpers}
`;
writeFileSync("src/features/recording/useRecordingController.ts", hook);
console.log("Extracted recording controller from src/App.tsx");
