import { useCallback, useEffect, useMemo, useState } from "react";
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next, useTranslation } from "react-i18next";
import {
  LOCALE_OPTIONS,
  LOCALE_TAGS,
  SUPPORTED_LOCALES,
  loadMessages,
  type Locale,
  type LocaleOption,
  type Messages,
} from "./locales";
import {
  loadAppSettings,
  updateAppSettings,
} from "./lib/appSettings";

export { LOCALE_OPTIONS, SUPPORTED_LOCALES };
export type { Locale, LocaleOption, Messages };

const STORAGE_KEY = "neordm-locale";

function normalizeLocale(language?: string): Locale {
  const normalized = language?.toLowerCase();
  const matched = LOCALE_OPTIONS.find((option) =>
    normalized?.startsWith(option.value)
  );

  return matched?.value ?? "en";
}

function syncDocumentLanguage(language?: string) {
  if (typeof document === "undefined") return;

  const locale = normalizeLocale(language);
  const localeOption =
    LOCALE_OPTIONS.find((option) => option.value === locale) ?? LOCALE_OPTIONS[0];

  document.documentElement.lang = LOCALE_TAGS[locale];
  document.documentElement.dir = localeOption.direction;
}

async function ensureLocaleLoaded(locale: Locale) {
  if (i18n.hasResourceBundle(locale, "translation")) {
    return;
  }

  const messages = await loadMessages(locale);
  i18n.addResourceBundle(locale, "translation", messages, true, true);
}

const initPromise = i18n.isInitialized
  ? Promise.resolve(i18n)
  : i18n
      .use(LanguageDetector)
      .use(initReactI18next)
      .init({
        fallbackLng: "en",
        supportedLngs: [...SUPPORTED_LOCALES],
        nonExplicitSupportedLngs: true,
        load: "languageOnly",
        detection: {
          order: ["localStorage", "navigator"],
          caches: ["localStorage"],
          lookupLocalStorage: STORAGE_KEY,
        },
        interpolation: {
          escapeValue: false,
        },
        react: {
          useSuspense: false,
        },
        returnNull: false,
      })
      .then(() => i18n);

i18n.on("languageChanged", syncDocumentLanguage);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const prepareI18n = async () => {
      await initPromise;
      const appSettings = await loadAppSettings();
      const configuredLocale = appSettings.general.locale;

      const currentLocale = normalizeLocale(
        i18n.resolvedLanguage ?? i18n.language
      );

      await Promise.all([
        ensureLocaleLoaded("en"),
        ensureLocaleLoaded(configuredLocale),
      ]);

      if (configuredLocale !== currentLocale) {
        await i18n.changeLanguage(configuredLocale);
      }

      syncDocumentLanguage(configuredLocale);

      if (!cancelled) {
        setReady(true);
      }
    };

    void prepareI18n();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return null;
  }

  return <>{children}</>;
}

export function useI18n() {
  const { i18n: i18nInstance } = useTranslation();

  const locale = useMemo(
    () => normalizeLocale(i18nInstance.resolvedLanguage ?? i18nInstance.language),
    [i18nInstance.language, i18nInstance.resolvedLanguage]
  );

  const setLocale = useCallback(
    async (nextLocale: Locale) => {
      await ensureLocaleLoaded(nextLocale);
      await i18nInstance.changeLanguage(nextLocale);
      await updateAppSettings((current) => ({
        ...current,
        general: {
          ...current.general,
          locale: nextLocale,
        },
      }));
    },
    [i18nInstance]
  );

  const messages = useMemo(() => {
    const activeBundle = i18nInstance.getResourceBundle(
      locale,
      "translation"
    ) as Messages | undefined;
    const fallbackBundle = i18nInstance.getResourceBundle(
      "en",
      "translation"
    ) as Messages | undefined;

    if (activeBundle) {
      return activeBundle;
    }

    if (fallbackBundle) {
      return fallbackBundle;
    }

    throw new Error("i18n messages are not loaded yet");
  }, [i18nInstance, locale]);

  const format = useCallback(
    (template: string, values: Record<string, string | number> = {}) =>
      template.replace(/\{(\w+)\}/g, (_, key: string) =>
        Object.prototype.hasOwnProperty.call(values, key)
          ? String(values[key])
          : `{${key}}`
      ),
    []
  );

  return {
    locale,
    localeTag: LOCALE_TAGS[locale],
    localeOptions: LOCALE_OPTIONS,
    setLocale,
    messages,
    format,
  };
}
