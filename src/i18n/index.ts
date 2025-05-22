import i18next from "i18next";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
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

// JSON 파일을 동적으로 로드하는 함수
function loadJsonFile(filePath: string) {
  try {
    if (existsSync(filePath)) {
      const data = readFileSync(filePath, "utf8");
      return JSON.parse(data);
    }
    console.warn(`Warning: JSON file not found: ${filePath}`);
    return {};
  } catch (error) {
    console.error(`Error loading JSON file ${filePath}:`, error);
    return {};
  }
}

// 로케일 디렉토리 경로 찾기
function findLocalesPath(): string | null {
  // 빌드 후 구조: dist/i18n/locales 또는 dist/locales
  const localesPath = join(__dirname, "locales");
  if (existsSync(localesPath)) {
    return localesPath;
  }
  // 혹시 모를 구조 대응 (dist/i18n/locales)
  const altPath = join(__dirname, "i18n", "locales");
  if (existsSync(altPath)) {
    return altPath;
  }
  console.warn("Warning: Could not find locales directory.");
  return null;
}

// 특정 언어의 모든 번역 로드
function loadTranslations(lang: string) {
  const localesPath = findLocalesPath();
  if (!localesPath) {
    return lang === "ko" ? defaultKoTranslation : defaultEnTranslation;
  }

  try {
    // 기본 common.json 파일 로드
    const commonPath = join(localesPath, lang, "common.json");
    const common = loadJsonFile(commonPath);

    // core 디렉토리의 모든 JSON 파일 로드
    const corePath = join(localesPath, lang, "core");
    const core = existsSync(corePath) ? loadJsonFiles(corePath) : {};

    // commands 디렉토리의 모든 JSON 파일 로드
    const commandsPath = join(localesPath, lang, "commands");
    const commands = existsSync(commandsPath)
      ? loadJsonFiles(commandsPath)
      : {};

    return {
      common,
      core,
      commands,
    };
  } catch (error) {
    console.error(`Error loading translations for ${lang}:`, error);
    return lang === "ko" ? defaultKoTranslation : defaultEnTranslation;
  }
}

// 디렉토리 내 모든 JSON 파일 로드
function loadJsonFiles(dirPath: string) {
  if (!existsSync(dirPath)) {
    return {};
  }

  const result: Record<string, any> = {};

  try {
    const files = readdirSync(dirPath);

    for (const file of files) {
      const filePath = join(dirPath, file);
      const stats = statSync(filePath);

      if (stats.isDirectory()) {
        // 재귀적으로 하위 디렉토리 처리
        result[file] = loadJsonFiles(filePath);
      } else if (file.endsWith(".json")) {
        // JSON 파일 로드
        const key = file.replace(".json", "").replace(/-/g, "_");
        result[key] = loadJsonFile(filePath);
      }
    }
  } catch (error) {
    console.error(`Error loading files from directory ${dirPath}:`, error);
  }

  return result;
}

// 번역 초기화
export const initializeI18n = async (
  language: string = "en",
): Promise<typeof i18next> => {
  const enTranslations = loadTranslations("en");
  const koTranslations = loadTranslations("ko");

  await i18next.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: enTranslations },
      ko: { translation: koTranslations },
    },
    interpolation: {
      escapeValue: false,
    },
    debug: process.env.NODE_ENV === "development",
  });

  return i18next;
};

export const setLanguage = async (language: string): Promise<void> => {
  await i18next.changeLanguage(language);
};

export const t = (...args: Parameters<typeof i18next.t>) => i18next.t(...args);

export const supportedLanguages = ["en", "ko"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];
