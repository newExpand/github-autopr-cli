import i18next from "i18next";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 최소한의 기본 영어 번역 (파일을 찾지 못할 경우 사용)
const defaultEnTranslation = {
  common: {
    cli: {
      description: "GitHub PR Automation CLI with AI features",
    },
  },
};

// 최소한의 기본 한국어 번역 (파일을 찾지 못할 경우 사용)
const defaultKoTranslation = {
  common: {
    cli: {
      description: "AI 기능을 갖춘 GitHub PR 자동화 CLI",
    },
  },
};

// i18n 파일 경로 설정 - 여러 경로를 시도하여 실제 파일이 있는 곳을 찾습니다
function findLocalesPath(): string {
  // 가능한 경로들
  const possiblePaths = [
    join(__dirname, "locales"), // dist/i18n/locales (컴파일된 구조)
    join(__dirname, "..", "i18n", "locales"), // dist/i18n/locales (루트에서의 상대 경로)
    join(process.cwd(), "dist", "i18n", "locales"), // 현재 작업 디렉토리 기준
    join(__dirname, "..", "locales"), // dist/locales (추가)
    join(__dirname, "..", "..", "locales"), // dist의 부모 디렉토리에 locales
    join(process.cwd(), "dist", "locales"), // 현재 작업 디렉토리 아래 dist/locales
    join(dirname(dirname(__dirname)), "locales"), // 전역 설치 환경을 위한 경로
    join(dirname(dirname(dirname(__dirname))), "dist", "locales"), // npm 전역 설치 환경
  ];

  // 실제 존재하는 경로 찾기
  for (const path of possiblePaths) {
    if (existsSync(join(path, "en.json"))) {
      console.log(`Found locales at: ${path}`);
      return path;
    }
  }

  // 기본 경로 (로그 출력 후 실패할 가능성 있음)
  console.warn(
    "Warning: Could not find locales directory. Using default path.",
  );
  return join(__dirname, "locales");
}

function loadLocale(language: string) {
  try {
    const localesPath = findLocalesPath();
    const filePath = join(localesPath, `${language}.json`);
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    console.warn(
      `Warning: Could not load ${language}.json, using basic default translations.`,
    );
    return language === "ko" ? defaultKoTranslation : defaultEnTranslation;
  }
}

const en = loadLocale("en");
const ko = loadLocale("ko");

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
