import {
  LOCALE_OPTIONS,
  LOCALE_TAGS,
  SUPPORTED_LOCALES,
  type Locale,
  type LocaleOption,
  type Messages,
} from "./types";

export { LOCALE_OPTIONS, LOCALE_TAGS, SUPPORTED_LOCALES };
export type { Locale, LocaleOption, Messages };

const localeModules = import.meta.glob("./[a-z][a-z].ts");

export async function loadMessages(locale: Locale): Promise<Messages> {
  const loader = localeModules[`./${locale}.ts`];

  if (!loader) {
    throw new Error(`Missing locale module for '${locale}'`);
  }

  const module = (await loader()) as Record<string, Messages>;
  const messages = module[locale];

  if (!messages) {
    throw new Error(`Locale module '${locale}' does not export messages`);
  }

  return messages;
}
