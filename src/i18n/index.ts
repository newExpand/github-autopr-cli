import i18next from "i18next";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// i18n 파일 경로 설정
const localesPath = join(__dirname, "..", "i18n", "locales");

const en = JSON.parse(readFileSync(join(localesPath, "en.json"), "utf-8"));
const ko = JSON.parse(readFileSync(join(localesPath, "ko.json"), "utf-8"));

export const initializeI18n = async (
  language: string = "en",
): Promise<typeof i18next> => {
  await i18next.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: en },
      ko: { translation: ko },
    },
    interpolation: {
      escapeValue: false,
    },
  });

  return i18next;
};

export const setLanguage = async (language: string): Promise<void> => {
  await i18next.changeLanguage(language);
};

export const t = i18next.t.bind(i18next);

export const supportedLanguages = ["en", "ko"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];
