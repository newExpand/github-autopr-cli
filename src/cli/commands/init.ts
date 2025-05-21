import inquirer from "inquirer";
import { t, supportedLanguages } from "../../i18n/index.js";
import {
  updateConfig,
  loadGlobalConfig,
  loadProjectConfig,
  DEFAULT_PROJECT_CONFIG,
} from "../../core/config.js";
import { setupGitHubAppCredentials } from "../../core/github-app.js";
import { setupOAuthCredentials } from "../../core/oauth.js";
import { log } from "../../utils/logger.js";
import { existsSync, renameSync } from "fs";
import { writeFile, appendFile, readFile } from "fs/promises";

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

    // 1. GitHub App 인증 (필수)
    try {
      await setupGitHubAppCredentials();
      log.info(t("commands.init.info.github_app_auth_success"));
    } catch (error) {
      log.error(t("commands.init.error.auth_failed", { error }));
      process.exit(1);
    }

    // 2. 유저 OAuth 인증 (선택/권장)
    const globalConfig = await loadGlobalConfig();
    let needOAuth = true;
    if (globalConfig.githubToken) {
      // 이미 인증된 경우
      const { reauth } = await inquirer.prompt([
        {
          type: "confirm",
          name: "reauth",
          // i18n: commands.init.prompts.oauth_already_authenticated
          message: t("commands.init.prompts.oauth_already_authenticated"),
          default: false,
        },
      ]);
      needOAuth = reauth;
    } else {
      const { doOAuth } = await inquirer.prompt([
        {
          type: "confirm",
          name: "doOAuth",
          // i18n: commands.init.prompts.oauth_authenticate
          message: t("commands.init.prompts.oauth_authenticate"),
          default: true,
        },
      ]);
      needOAuth = doOAuth;
    }
    if (needOAuth) {
      try {
        await setupOAuthCredentials();
        log.info(t("commands.init.info.oauth_auth_success"));
      } catch (error) {
        log.warn(t("commands.init.warning.oauth_auth_failed"), error);
      }
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
        globalConfig.language = language;
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
      globalConfig.language = language;
    }

    // 프로젝트 설정
    const projectConfig = await loadProjectConfig();
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
      // 설정 저장 (githubApp은 이미 저장됨)
      await updateConfig({
        ...globalConfig,
        ...projectAnswers,
      });

      // .autopr.json을 .gitignore에 추가
      const gitignorePath = ".gitignore";
      let shouldAppend = true;
      if (existsSync(gitignorePath)) {
        const gitignoreContent = (await readFile(gitignorePath, "utf-8")) || "";
        if (
          gitignoreContent
            .split("\n")
            .some((line: any) => line.trim() === ".autopr.json")
        ) {
          shouldAppend = false;
        }
      }
      if (shouldAppend) {
        await appendFile(gitignorePath, "\n.autopr.json\n");
        log.info(".autopr.json이 .gitignore에 추가되었습니다.");
      }

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
