import { readFileSync, writeFileSync } from "node:fs";

const appPath = "src/App.tsx";
let app = readFileSync(appPath, "utf8");
app = app.replace(
  'import { buildRefinementPrompt, normalizeVocabularyEntries, postProcessTranscript, resolveCustomPrompt, shouldDiscardRefinement, vocabularyHints, type VocabularyEntry } from "./text-processing";',
  'import { normalizeVocabularyEntries, type VocabularyEntry } from "./text-processing";',
);
app = app.replace(
  'import type { CaptureMode, CloudResult, CloudTranscript, HistoryEntry, HudState, PendingChoice, Phase, PreparedCapture, Section, Settings, TranscriptionProvider } from "./app/types";',
  'import type { CloudTranscript, HistoryEntry, Phase, Section, Settings } from "./app/types";',
);
app = app.replace('import { bumpStarCount, markStarPromptShown, starPromptShown } from "./features/about/star-prompt";\n', '');
app = app.replace(
  'import { jpegToWebp, makeHistoryThumbnail, purgeExpiredImages } from "./features/history/history-media";',
  'import { purgeExpiredImages } from "./features/history/history-media";',
);
app = app.replace('import { isScreenCaptureAllowed } from "./features/privacy/screen-capture";\n', '');
writeFileSync(appPath, app);

const hookPath = "src/features/recording/useRecordingController.ts";
let hook = readFileSync(hookPath, "utf8");
hook = hook.replace('type RecordingAction = "toggle" | "refine-stop" | "cancel" | "hold-start" | "hold-stop" | "shared-start" | "shared-stop";\n', '');
writeFileSync(hookPath, hook);
