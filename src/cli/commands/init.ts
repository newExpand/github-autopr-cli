import inquirer from "inquirer";
import { t, supportedLanguages } from "../../i18n/index.js";
import {
  updateConfig,
  loadGlobalConfig,
  loadProjectConfig,
  DEFAULT_PROJECT_CONFIG,
} from "../../core/config.js";
import { setupGitHubAppCredentials } from "../../core/github-app.js";
import { log } from "../../utils/logger.js";
import { existsSync, renameSync } from "fs";
import { writeFile } from "fs/promises";

import { Config } from "../../types/config.js";

export async function initCommand(): Promise<void> {
  try {
    // 오버라이드: 기존 .autopr.json 파일이 있으면 백업 후 새로 생성
    const PROJECT_CONFIG_FILE = ".autopr.json";
    if (existsSync(PROJECT_CONFIG_FILE)) {
      const backupFile = PROJECT_CONFIG_FILE + ".bak";
      renameSync(PROJECT_CONFIG_FILE, backupFile);
      await writeFile(
        PROJECT_CONFIG_FILE,
        JSON.stringify(DEFAULT_PROJECT_CONFIG, null, 2),
      );
      log.info(".autopr.json 파일이 백업되고, 새로 초기화되었습니다.");
    }

    // 기존 설정 로드
    const globalConfig = await loadGlobalConfig();
    const projectConfig = await loadProjectConfig();

    const answers: Partial<Config> = {};

    // GitHub App 설정
    log.info(t("commands.init.setup.info"));

    try {
      // 디바이스 플로우로 GitHub App 인증 진행
      await setupGitHubAppCredentials();

      // 인증 완료 메시지
      log.info(t("commands.init.info.github_app_auth_success"));
    } catch (error) {
      log.error(t("commands.init.error.auth_failed", { error }));
      process.exit(1);
    }

    // 언어 설정
    if (globalConfig.language) {
      const { updateLanguage } = await inquirer.prompt([
        {
          type: "confirm",
          name: "updateLanguage",
          message: t("commands.init.prompts.update_language", {
            language: globalConfig.language,
          }),
          default: false,
        },
      ]);

      if (updateLanguage) {
        const { language } = await inquirer.prompt([
          {
            type: "list",
            name: "language",
            message: t("commands.init.prompts.language"),
            choices: supportedLanguages,
            default: globalConfig.language,
          },
        ]);
        answers.language = language;
      } else {
        answers.language = globalConfig.language;
      }
    } else {
      const { language } = await inquirer.prompt([
        {
          type: "list",
          name: "language",
          message: t("commands.init.prompts.language"),
          choices: supportedLanguages,
          default: "en",
        },
      ]);
      answers.language = language;
    }

    // 프로젝트 설정
    const projectAnswers = await inquirer.prompt([
      {
        type: "input",
        name: "defaultReviewers",
        message: t("commands.init.prompts.reviewers"),
        default: projectConfig.defaultReviewers.join(", "),
        filter: (value: string) =>
          value
            .split(",")
            .map((reviewer) => reviewer.trim())
            .filter(Boolean),
      },
    ]);

    try {
      // 설정 저장
      await updateConfig({
        ...answers,
        defaultReviewers: projectAnswers.defaultReviewers,
      });

      log.info(t("common.success.init"));
    } catch (error) {
      log.error(t("common.error.unknown"), error);
      process.exit(1);
    }
  } catch (error) {
    log.error(t("common.error.unknown"), error);
    process.exit(1);
  }
}
