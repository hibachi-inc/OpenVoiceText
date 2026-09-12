import type { UiLanguage, UiLanguagePreference } from "../i18n";
import type { CustomPrompts } from "../text-processing";

export type Phase = "idle" | "preparing" | "listening" | "processing" | "done" | "error";

export type Section = "history" | "general" | "ai" | "vocabulary" | "shortcuts" | "about";

export type TranscriptionProvider = "local" | "groq" | "gemini";

export type RefinementProvider = "groq" | "gemini" | "local";

export type CaptureMode = "live" | "deferred";

export type HistoryEntry = { id: string; text: string; raw: string; createdAt: number; category: string; engine: string; appName: string; promptKey?: string; refiner?: string; screenChars?: number; screenText?: string; image?: string };

export type Settings = {
  locale: string;
  appLanguage: UiLanguagePreference;
  autoPaste: boolean;
  refinement: boolean;
  customPrompts: CustomPrompts;
  toggleShortcut: string;
  holdShortcut: string;
  microphoneUID: string;
  muteOtherAudio: boolean;
  transcriptionProvider: TranscriptionProvider;
  refinementProvider: RefinementProvider;
  refinementModel: string;
  transcriptionModel: string;
  linkModels: boolean;
  debugMode: boolean;
  telemetry: boolean;
  promptDefaultsVersion: number;
};

export type HudState = { phase: Phase; transcript: string; raw: string; level: number; engine: string; captureMode: CaptureMode; uiLanguage?: UiLanguage; message?: string; spaceHint?: boolean; refining?: boolean; elapsed?: number; choice?: { raw: string; refined: string } };

export type PendingChoice = { text: string; raw: string; category: string; engine: string; appName: string; promptKey?: string; refiner?: string; screenChars?: number; screenText?: string; image?: string };

export type PreparedCapture = { captureId: string; audioPath: string };

export type CloudResult = { text: string; model: string; fallbackFrom?: string; raw?: string };

export type CloudTranscript = { text: string; model: string };
