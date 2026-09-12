import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createTranslator, resolveUiLanguage, type Translator, type UiLanguage, type UiLanguagePreference } from "./i18n";

const I18nContext = createContext<{ language: UiLanguage; t: Translator }>({
  language: resolveUiLanguage("system"),
  t: createTranslator(resolveUiLanguage("system")),
});

export function I18nProvider({ preference, children }: { preference: UiLanguagePreference; children: React.ReactNode }) {
  const language = resolveUiLanguage(preference);
  const value = useMemo(() => ({ language, t: createTranslator(language) }), [language]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useStoredState<T>(key: string, initial: T, normalize?: (stored: unknown) => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "") as unknown;
      return normalize ? normalize(stored) : stored as T;
    } catch { return initial; }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // クォータ超過時は画像だけ捨てて再試行する（履歴サムネ用）。
      // それでもだめなら永続化を諦める（メモリ上の値は維持）。
      try {
        localStorage.setItem(key, JSON.stringify(value, (k, v) => (k === "image" ? undefined : v)));
      } catch { /* ignore */ }
    }
  }, [key, value]);
  return [value, setValue] as const;
}
