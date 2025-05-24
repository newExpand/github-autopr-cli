import inquirer from "inquirer";
import { t, supportedLanguages } from "../../i18n/index.js";
import {
  updateConfig,
  loadGlobalConfig,
  loadProjectConfig,
  DEFAULT_PROJECT_CONFIG,
  loadConfig,
} from "../../core/config.js";
import { setupGitHubAppCredentials } from "../../core/github-app.js";
import { setupOAuthCredentials } from "../../core/oauth.js";
import { log } from "../../utils/logger.js";
import { existsSync, renameSync } from "fs";
import { writeFile, appendFile, readFile } from "fs/promises";
import { getAIClient } from "../../core/ai-manager.js";

export async function initCommand(): Promise<void> {
  try {
    const PROJECT_CONFIG_FILE = ".autopr.json";
    let projectConfig = DEFAULT_PROJECT_CONFIG;

    if (existsSync(PROJECT_CONFIG_FILE)) {
      // 기존 설정 읽기
      projectConfig = await loadProjectConfig();

      // 인증 정보가 모두 있으면
      if (
        projectConfig.githubApp?.appId &&
        projectConfig.githubApp?.clientId &&
        projectConfig.githubApp?.installationId
      ) {
        const { doInit } = await inquirer.prompt([
          {
            type: "confirm",
            name: "doInit",
            message: t("commands.init.prompts.project_already_initialized", {
              fallback:
                "기존 설정이 있습니다. 초기화(백업 후 새로 생성) 하시겠습니까?",
            }),
            default: false,
          },
        ]);
        if (doInit) {
          // 백업 후 새로 생성
          const backupFile = PROJECT_CONFIG_FILE + ".bak";
          renameSync(PROJECT_CONFIG_FILE, backupFile);
          await writeFile(
            PROJECT_CONFIG_FILE,
            JSON.stringify(DEFAULT_PROJECT_CONFIG, null, 2),
          );
          log.info(".autopr.json 파일이 백업되고, 새로 초기화되었습니다.");
          projectConfig = DEFAULT_PROJECT_CONFIG;
        } else {
          log.info("기존 설정을 유지합니다.");
        }
      } else {
        // 인증 정보가 없으면 무조건 백업 후 새로 생성
        const backupFile = PROJECT_CONFIG_FILE + ".bak";
        renameSync(PROJECT_CONFIG_FILE, backupFile);
        await writeFile(
          PROJECT_CONFIG_FILE,
          JSON.stringify(DEFAULT_PROJECT_CONFIG, null, 2),
        );
        log.info(".autopr.json 파일이 백업되고, 새로 초기화되었습니다.");
        projectConfig = DEFAULT_PROJECT_CONFIG;
      }
    } else {
      // 파일이 없으면 새로 생성
      await writeFile(
        PROJECT_CONFIG_FILE,
        JSON.stringify(DEFAULT_PROJECT_CONFIG, null, 2),
      );
      projectConfig = DEFAULT_PROJECT_CONFIG;
    }

    // config는 항상 최신값으로 불러옴
    const config = await loadConfig();
    const globalConfig = await loadGlobalConfig();
    let needGithubAppAuth = true;

    // GitHub App 설정값이 모두 있는지 확인 (projectConfig 기준)
    if (
      projectConfig.githubApp?.appId &&
      projectConfig.githubApp?.clientId &&
      projectConfig.githubApp?.installationId
    ) {
      // 이미 GitHub App이 인증된 경우 재인증 여부 묻기
      const { reauth } = await inquirer.prompt([
        {
          type: "confirm",
          name: "reauth",
          message: t("commands.init.prompts.github_app_already_authenticated", {
            fallback:
              "GitHub App이 이미 인증되어 있습니다. 다시 인증하시겠습니까?",
          }),
          default: false,
        },
      ]);
      needGithubAppAuth = reauth;
    }

    // GitHub App 인증 (필요한 경우에만)
    if (needGithubAppAuth) {
      log.info(
        t("commands.init.info.github_app_auth_why", {
          fallback:
            "이 인증은 자동 PR 생성을 위해 필수입니다. 인증하지 않으면 주요 기능을 사용할 수 없습니다.",
        }),
      );
      try {
        await setupGitHubAppCredentials();
        log.info(t("commands.init.info.github_app_auth_success"));
      } catch (error) {
        log.error(t("commands.init.error.auth_failed", { error }));
        log.error(
          t("commands.init.info.github_app_auth_failed_why", {
            fallback:
              "GitHub App 인증이 완료되어야만 자동 PR 기능을 사용할 수 있습니다.",
          }),
        );
        process.exit(1);
      }
    } else {
      log.info(
        t("commands.init.info.github_app_auth_skipped", {
          fallback: "GitHub App 인증을 건너뛰었습니다.",
        }),
      );
      log.info(
        t("commands.init.info.github_app_auth_skipped_why", {
          fallback:
            "GitHub App 인증을 건너뛰면 자동 PR 생성 등 일부 기능이 제한됩니다.",
        }),
      );
    }

    // 2. AI API JWT 토큰 발급 (누구나 가능)
    log.info(
      t("commands.init.info.ai_token_why", {
        fallback:
          "AI 기능(코드 리뷰, 자동 설명 등)을 사용하려면 토큰이 필요합니다. 인증하지 않아도 기본 기능은 사용 가능합니다.",
      }),
    );
    try {
      log.info(t("commands.init.info.acquiring_ai_token"));
      const tokenSuccess = await getAIClient().getAuthToken();
      if (tokenSuccess) {
        log.info(t("commands.init.info.ai_token_success"));
      } else {
        log.warn(t("commands.init.warning.ai_token_failed"));
        log.warn(
          t("commands.init.info.ai_token_failed_why", {
            fallback:
              "AI 토큰 발급에 실패하여 AI 관련 기능(코드 리뷰, 자동 설명 등)을 사용할 수 없습니다.",
          }),
        );
      }
    } catch (error) {
      log.warn(t("commands.init.warning.ai_token_error"), error);
      log.warn(
        t("commands.init.info.ai_token_failed_why", {
          fallback:
            "AI 토큰 발급에 실패하여 AI 관련 기능(코드 리뷰, 자동 설명 등)을 사용할 수 없습니다.",
        }),
      );
    }

    // 4. 유저 OAuth 인증 (선택/권장)
    log.info(
      t("commands.init.info.oauth_why", {
        fallback:
          "PR 생성 등 일부 기능을 위해 필요합니다. 인증하지 않으면 일부 기능이 제한됩니다.",
      }),
    );
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
        log.warn(
          t("commands.init.info.oauth_failed_why", {
            fallback:
              "OAuth 인증에 실패하면 PR 생성 등 일부 기능을 사용할 수 없습니다.",
          }),
        );
      }
    } else {
      log.info(
        t("commands.init.info.oauth_skipped_why", {
          fallback: "OAuth 인증을 건너뛰면 PR 생성 등 일부 기능이 제한됩니다.",
        }),
      );
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

      // 설정 완료 후 안내
      log.info(t("common.success.init"));
    } catch (error) {
      log.error(t("common.error.unknown", { error }));
      process.exit(1);
    }
  } catch (error) {
    log.error(t("common.error.unknown", { error }));
    process.exit(1);
  }
}
