import { createContext, useContext, useEffect, useMemo } from "react";
import { createTranslator, resolveUiLanguage, type Translator, type UiLanguage, type UiLanguagePreference } from "../i18n";

const systemUiLanguage = resolveUiLanguage("system");

const I18nContext = createContext<{ language: UiLanguage; t: Translator }>({
  language: systemUiLanguage,
  t: createTranslator(systemUiLanguage),
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
