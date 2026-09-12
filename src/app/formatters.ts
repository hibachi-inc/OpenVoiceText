import type { MessageKey, Translator, UiLanguage, UiLanguagePreference } from "../i18n";
import type { SpeechStatus } from "../speech-bridge";
import { DEFAULT_PROMPT_KEY } from "../text-processing";
import type { Phase, Settings } from "./types";

// 両方がGeminiのときは転写・整形で同じモデルを使うよう連動させる。
// 連動OFFやGemma選択時は独立に動かせる（分岐は値の一致で決める）。
export function withLinkedTranscriptionModel(current: Settings, transcriptionModel: string): Settings {
  return {
    ...current,
    transcriptionModel,
    ...(current.linkModels && current.refinementProvider === "gemini" ? { refinementModel: transcriptionModel } : {}),
  };
}

export function withLinkedRefinementModel(current: Settings, refinementModel: string): Settings {
  // Gemmaは音声非対応のため転写側には連動させない（結合ルートの成立条件を保つ）。
  const linkable = current.linkModels
    && current.transcriptionProvider === "gemini"
    && !refinementModel.toLowerCase().includes("gemma");
  return {
    ...current,
    refinementModel,
    ...(linkable ? { transcriptionModel: refinementModel } : {}),
  };
}

export function shortcutFromEvent(event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">) {
  const modifierKey = ["Control", "Alt", "Meta", "Shift"].includes(event.key);
  if (modifierKey) return event.key === "Alt" ? "Option" : event.key === "Meta" ? "Command" : event.key;
  const parts = [event.metaKey && "CommandOrControl", event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
  const key = event.code === "Space" ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...parts, key].join("+");
}

export function isModifierOnlyShortcut(shortcut: string) {
  return ["Control", "Option", "Command", "Shift"].includes(shortcut);
}

export function prettyShortcut(shortcut: string) {
  return shortcut.replace("CommandOrControl", "⌘/Ctrl").replace("Control", "⌃").replace("Option", "⌥").replace("Command", "⌘").split("+").join(" ");
}

export function phaseLabel(phase: Phase, t: Translator, deferred = false, refining = false) {
  if (phase === "preparing") return t("state.preparing");
  if (phase === "listening") return t(deferred ? "state.recording" : "state.listening");
  if (phase === "processing") return t(deferred || !refining ? "state.transcribing" : "state.processing");
  if (phase === "done") return t("state.done");
  if (phase === "error") return t("state.error");
  return t("state.idle");
}

export function relativeTime(time: number, language: UiLanguage, t: Translator) {
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return t("relative.justNow");
  if (minutes < 60) return t("relative.minutes", { count: minutes });
  if (minutes < 1440) return t("relative.hours", { count: Math.floor(minutes / 60) });
  return new Date(time).toLocaleDateString(language);
}

export function engineLabel(backend: string, t: Translator) {
  if (backend === "apple-speech-analyzer") return t("engine.appleEnhanced");
  if (backend === "apple-speech-classic") return t("engine.appleClassic");
  if (backend === "windows-speech-classic") return t("engine.windowsClassic");
  return t("engine.windowsAI");
}

export function modelStatusMessage(status: SpeechStatus | null, t: Translator) {
  if (!status || status.modelState === "unknown") return t("general.modelChecking");
  if (status.modelState === "download-required") return t("general.modelDownload");
  if (status.modelState === "unsupported") return t("general.modelUnsupported");
  if (status.backend === "apple-speech-classic") return t("general.modelReadyAppleClassic");
  return status.platform === "windows" ? t("general.modelReadyWindows") : t("general.modelReadyApple");
}

export function categoryLabel(category: string, t: Translator) {
  const key = `category.${category}` as MessageKey;
  return ["chat", "email", "code", "terminal", "notes", "browser", "generic"].includes(category) ? t(key) : category;
}

export function promptKeyLabel(key: string, t: Translator) {
  if (key === DEFAULT_PROMPT_KEY) return t("prompt.default");
  if (key.startsWith("category:")) {
    return t("prompt.categoryTarget", { name: categoryLabel(key.slice("category:".length), t) });
  }
  if (key.startsWith("app:")) return t("prompt.appTarget", { name: key.slice("app:".length) });
  return key;
}

export function settingsWithAppLanguage(settings: Settings, appLanguage: UiLanguagePreference): Settings {
  return { ...settings, appLanguage };
}
