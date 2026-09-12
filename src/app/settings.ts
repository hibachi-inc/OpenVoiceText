import { defaultRefinementPrompt, legacyDefaultPrompts, resolveUiLanguage, type UiLanguagePreference } from "../i18n";
import { DEFAULT_PROMPT_KEY, migrateLegacyCustomPrompts, type VocabularyEntry } from "../text-processing";
import { settingsWithAppLanguage } from "./formatters";
import type { RefinementProvider, Settings } from "./types";

const systemUiLanguage = resolveUiLanguage("system");

export const DEFAULT_VOCABULARY: VocabularyEntry[] = [
  { id: "default-ok", term: "OK", aliases: ["オーケー"] },
  { id: "default-voicelatte", term: "VoiceLatte", aliases: ["ボイスラテ", "ボイスラッテ"] },
];

export const DEFAULT_SETTINGS: Settings = {
  locale: "system",
  appLanguage: "system",
  autoPaste: true,
  refinement: true,
  customPrompts: { [DEFAULT_PROMPT_KEY]: defaultRefinementPrompt(systemUiLanguage) },
  toggleShortcut: "Control",
  holdShortcut: "Control",
  microphoneUID: "",
  muteOtherAudio: true,
  transcriptionProvider: "local",
  refinementProvider: "gemini",
  refinementModel: "",
  transcriptionModel: "",
  linkModels: true,
  debugMode: false,
  telemetry: false,
  promptDefaultsVersion: 1,
};

export function normalizeSettings(stored: unknown): Settings {
  if (!stored || typeof stored !== "object") return DEFAULT_SETTINGS;
  const legacy = stored as Partial<Settings> & { defaultPrompt?: string; chatPrompt?: string; codePrompt?: string; screenContextEnabled?: boolean; screenshotContext?: boolean };
  const appLanguage: UiLanguagePreference = ["system", "ja", "en"].includes(legacy.appLanguage ?? "")
    ? legacy.appLanguage as UiLanguagePreference
    : "system";
  const refinementProvider: RefinementProvider = ["groq", "gemini", "local"].includes(legacy.refinementProvider ?? "")
    ? legacy.refinementProvider as RefinementProvider
    : DEFAULT_SETTINGS.refinementProvider;
  const refinementModel = typeof legacy.refinementModel === "string"
    ? legacy.refinementModel.slice(0, 120)
    : DEFAULT_SETTINGS.refinementModel;
  const transcriptionModel = typeof legacy.transcriptionModel === "string"
    ? legacy.transcriptionModel.slice(0, 120)
    : DEFAULT_SETTINGS.transcriptionModel;
  // 連動フラグの移行：値が一致している既存設定だけオンにする。
  const linkModels = typeof legacy.linkModels === "boolean"
    ? legacy.linkModels
    : transcriptionModel === refinementModel;
  const debugMode = legacy.debugMode === true;
  const telemetry = legacy.telemetry === true;
  const jaDefaults = legacyDefaultPrompts("ja");
  const enDefaults = legacyDefaultPrompts("en");
  const customPrompts = migrateLegacyCustomPrompts(legacy, {
    defaultPrompt: [jaDefaults.defaultPrompt, enDefaults.defaultPrompt],
    chatPrompt: [jaDefaults.chatPrompt, enDefaults.chatPrompt],
    codePrompt: [jaDefaults.codePrompt, enDefaults.codePrompt],
  });
  const promptDefaultsVersion = Number.isFinite(legacy.promptDefaultsVersion) ? legacy.promptDefaultsVersion! : 0;
  if (promptDefaultsVersion < 1 && !(DEFAULT_PROMPT_KEY in customPrompts)) {
    customPrompts[DEFAULT_PROMPT_KEY] = defaultRefinementPrompt(resolveUiLanguage(appLanguage));
  }
  const { defaultPrompt: _defaultPrompt, chatPrompt: _chatPrompt, codePrompt: _codePrompt, screenContextEnabled: _screenContextEnabled, screenshotContext: _screenshotContext, ...current } = legacy;
  const settings = { ...DEFAULT_SETTINGS, ...current, appLanguage, refinementProvider, refinementModel, transcriptionModel, linkModels, debugMode, telemetry, promptDefaultsVersion: 1, customPrompts };
  if (legacy.appLanguage === undefined) {
    return settingsWithAppLanguage({ ...settings, locale: legacy.locale === "ja-JP" ? "system" : settings.locale }, "system");
  }
  return settings;
}
