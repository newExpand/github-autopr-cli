import inquirer from "inquirer";
import { t, supportedLanguages, setLanguage } from "../../i18n/index.js";
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

async function initializeProjectConfig() {
  const PROJECT_CONFIG_FILE = ".autopr.json";
  let projectConfig = DEFAULT_PROJECT_CONFIG;

  if (existsSync(PROJECT_CONFIG_FILE)) {
    projectConfig = await loadProjectConfig();
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
    await writeFile(
      PROJECT_CONFIG_FILE,
      JSON.stringify(DEFAULT_PROJECT_CONFIG, null, 2),
    );
    projectConfig = DEFAULT_PROJECT_CONFIG;
  }
  return projectConfig;
}

async function promptUserOAuth(globalConfig: any): Promise<boolean> {
  log.info(t("commands.init.info.oauth_why"));
  let needOAuth = true;
  if (globalConfig.githubToken) {
    const { reauth } = await inquirer.prompt([
      {
        type: "confirm",
        name: "reauth",
        message: t("commands.init.prompts.oauth_already_authenticated"),
        default: false,
      },
    ]);
    if (!reauth) {
      // 기존 토큰을 그대로 사용
      return true;
    }
    needOAuth = reauth;
  } else {
    const { doOAuth } = await inquirer.prompt([
      {
        type: "confirm",
        name: "doOAuth",
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
      return true;
    } catch (error) {
      log.warn(t("commands.init.warning.oauth_auth_failed"), error);
      log.warn(t("commands.init.info.oauth_failed_why"));
      return false;
    }
  } else {
    log.warn(t("commands.init.info.oauth_skipped_why"));
    return false;
  }
}

async function acquireAIToken() {
  log.info(t("commands.init.info.ai_token_why"));
  try {
    log.info(t("commands.init.info.acquiring_ai_token"));
    const tokenSuccess = await getAIClient().getAuthToken();
    if (tokenSuccess) {
      log.info(t("commands.init.info.ai_token_success"));
    } else {
      log.warn(t("commands.init.warning.ai_token_failed"));
      log.warn(t("commands.init.info.ai_token_failed_why"));
    }
  } catch (error) {
    log.warn(t("commands.init.warning.ai_token_error"), error);
    log.warn(t("commands.init.info.ai_token_failed_why"));
  }
}

async function promptGitHubAppAuth(projectConfig: any): Promise<void> {
  let needGithubAppAuth = true;
  if (
    projectConfig.githubApp?.appId &&
    projectConfig.githubApp?.clientId &&
    projectConfig.githubApp?.installationId
  ) {
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
  } else {
    const { doAuth } = await inquirer.prompt([
      {
        type: "confirm",
        name: "doAuth",
        message: t("commands.init.prompts.github_app_authenticate", {
          fallback:
            "AI 리뷰 등 고급 기능을 위해 GitHub App 인증을 하시겠습니까? (선택)",
        }),
        default: false,
      },
    ]);
    needGithubAppAuth = doAuth;
  }
  if (needGithubAppAuth) {
    log.info(t("commands.init.info.github_app_auth_why"));
    try {
      await setupGitHubAppCredentials();
      log.info(t("commands.init.info.github_app_auth_success"));
    } catch (error) {
      log.error(t("commands.init.error.auth_failed", { error }));
      log.error(t("commands.init.info.github_app_auth_failed_why"));
    }
  } else {
    log.info(t("commands.init.info.github_app_auth_skipped"));
    log.info(t("commands.init.info.github_app_auth_skipped_why"));
    log.info(t("commands.init.info.github_app_auth_later"));
  }
}

async function promptLanguage(globalConfig: any) {
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
      // 선택한 언어를 즉시 적용
      await setLanguage(language);
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
    // 선택한 언어를 즉시 적용
    await setLanguage(language);
  }
}

async function promptProjectSettings(projectConfig: any) {
  return await inquirer.prompt([
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
}

async function saveConfigAndGitignore(globalConfig: any, projectAnswers: any) {
  try {
    await updateConfig({
      ...globalConfig,
      ...projectAnswers,
    });
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
    log.error(t("common.error.unknown", { error }));
    process.exit(1);
  }
}

export async function initCommand(): Promise<void> {
  try {
    // 1. 최신 config, globalConfig 불러오기 (언어 설정을 위해 먼저 로드)
    const config = await loadConfig();
    const globalConfig = await loadGlobalConfig();
    // 2. 언어 설정 (가장 먼저 실행)
    await promptLanguage(globalConfig);
    // 3. 프로젝트 설정 파일 생성/초기화
    const projectConfig = await initializeProjectConfig();
    // 4. 유저 OAuth 인증 (필수)
    const oauthSuccess = await promptUserOAuth(globalConfig);
    if (!oauthSuccess) {
      log.error(t("commands.init.info.oauth_required_exit"));
      process.exit(1);
    }
    // 5. AI 토큰 발급
    await acquireAIToken();
    // 6. GitHub App 인증 (선택)
    await promptGitHubAppAuth(projectConfig);
    // 7. 프로젝트 설정 입력
    const projectAnswers = await promptProjectSettings(projectConfig);
    // 8. 설정 저장 및 .gitignore 처리
    await saveConfigAndGitignore(globalConfig, projectAnswers);
  } catch (error) {
    log.error(t("common.error.unknown", { error }));
    process.exit(1);
  }
}
