import inquirer from "inquirer";
import { t, supportedLanguages } from "../../i18n/index.js";
import {
  updateConfig,
  loadGlobalConfig,
  loadProjectConfig,
  updateProjectConfig,
} from "../../core/config.js";
import { validateGitHubToken } from "../../core/github.js";
import { setupOAuthCredentials } from "../../core/oauth.js";
import { writeFile, mkdir, readFile, access } from "fs/promises";
import { join } from "path";
import { log } from "../../utils/logger.js";
import dotenv from "dotenv";
import { constants } from "fs";
import OpenAI from "openai";
import { AIManager } from "../../core/ai-manager.js";
import { Config } from "../../types/config.js";
import { OPENROUTER_CONFIG } from "../../config/openrouter.js";

const AI_PROVIDERS = ["openai", "openrouter"] as const;

async function validateOpenAIKey(apiKey: string): Promise<boolean> {
  try {
    const openai = new OpenAI({ apiKey });
    await openai.models.list();
    return true;
  } catch (error) {
    log.warn(t("commands.init.error.model_fetch_failed"));
    return false;
  }
}

async function getAvailableModels(
  provider: (typeof AI_PROVIDERS)[number],
  apiKey: string,
): Promise<string[]> {
  switch (provider) {
    case "openai":
      // API 키 유효성만 검사하고 모델 목록은 AIManager에서 가져옴
      await validateOpenAIKey(apiKey);
      return AIManager.getDefaultModels(provider);
    default:
      return AIManager.getDefaultModels(provider);
  }
}

async function setupAIConfig(): Promise<{
  provider: (typeof AI_PROVIDERS)[number];
  apiKey: string;
  model: string;
}> {
  const { provider } = await inquirer.prompt([
    {
      type: "list",
      name: "provider",
      message: t("commands.init.prompts.select_ai_provider"),
      choices: [
        {
          name: "OpenRouter (Free AI Model)",
          value: "openrouter",
        },
        {
          name: "OpenAI",
          value: "openai",
        },
      ],
    },
  ]);

  // OpenRouter 선택 시 즉시 반환
  if (provider === "openrouter") {
    log.info(t("commands.init.info.openrouter_selected"));
    return {
      provider: "openrouter",
      apiKey: OPENROUTER_CONFIG.API_KEY,
      model: OPENROUTER_CONFIG.DEFAULT_MODEL,
    };
  }

  // OpenAI 설정
  const apiKeyResponse = await inquirer.prompt([
    {
      type: "password",
      name: "apiKey",
      message: t("commands.init.prompts.enter_api_key", {
        provider: provider.toUpperCase(),
      }),
      validate: (value: string) => value.length > 0,
    },
  ]);
  const apiKey = apiKeyResponse.apiKey;

  const models = await getAvailableModels(provider, apiKey);
  const modelResponse = await inquirer.prompt([
    {
      type: "list",
      name: "model",
      message: t("commands.init.prompts.select_model"),
      choices: models,
    },
  ]);
  const model = modelResponse.model;

  return { provider, apiKey, model };
}

async function updateEnvFile(aiConfig: {
  provider: string;
  apiKey: string;
  model: string;
}): Promise<void> {
  try {
    // OpenRouter의 경우 .env 파일에 저장하지 않음
    if (aiConfig.provider === "openrouter") {
      log.info(t("commands.init.info.openrouter_config_skipped"));
      return;
    }

    let envContent = "";
    try {
      await access(".env", constants.F_OK);
      envContent = await readFile(".env", "utf-8");
    } catch (error) {
      log.info(t("commands.init.info.creating_env"));
    }

    const envConfig = dotenv.parse(envContent);

    envConfig.AI_PROVIDER = aiConfig.provider;
    envConfig.AI_API_KEY = aiConfig.apiKey;
    envConfig.AI_MODEL = aiConfig.model;

    const newEnvContent = Object.entries(envConfig)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    await writeFile(".env", newEnvContent);
    log.info(t("commands.init.info.ai_config_saved"));
  } catch (error) {
    log.error(t("commands.init.error.ai_config_save_failed", { error }));
    throw error;
  }
}

async function setupGitHooks(): Promise<void> {
  try {
    // Git 훅 디렉토리 생성
    const hooksDir = join(process.cwd(), ".git", "hooks");
    await mkdir(hooksDir, { recursive: true });

    // post-checkout 훅 스크립트 생성
    const hookPath = join(hooksDir, "post-checkout");
    const hookScript = `#!/bin/sh
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
npx autopr hook post-checkout "$BRANCH_NAME"
`;

    await writeFile(hookPath, hookScript, { mode: 0o755 });
  } catch (error) {
    log.error(t("commands.init.error.git_hooks", { error }));
  }
}

async function setupGitHubActions(aiProvider?: string): Promise<void> {
  try {
    // GitHub Actions 디렉토리 생성
    const workflowsDir = join(process.cwd(), ".github", "workflows");
    await mkdir(workflowsDir, { recursive: true });

    // AI 환경 변수 설정 부분 생성
    // OpenRouter는 API 키가 필요 없으므로, OpenRouter 선택 시 AI_PROVIDER만 설정
    // 다른 AI 제공자는 GitHub Secrets의 AI_API_KEY를 사용
    const aiEnvVars =
      aiProvider === "openrouter"
        ? `          AI_PROVIDER: "openrouter"`
        : `          AI_API_KEY: \${{ secrets.AI_API_KEY }}`;

    // PR 리뷰 워크플로우 파일 생성
    const workflowPath = join(workflowsDir, "pr-review.yml");
    const workflowContent = `# PR Review Bot Workflow
name: PR Review Bot

on:
  pull_request:
    types: [opened, synchronize]
  pull_request_review_comment:
    types: [created]
  pull_request_review:
    types: [submitted]

# 명시적으로 권한 설정 추가
permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run PR Review Bot
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
${aiEnvVars}
        run: npx autopr review-bot
`;

    await writeFile(workflowPath, workflowContent);
    log.info(t("commands.init.info.github_actions_setup"));
  } catch (error) {
    log.error(t("commands.init.error.github_actions", { error }));
  }
}

export async function initCommand(): Promise<void> {
  try {
    // 기존 설정 로드
    const globalConfig = await loadGlobalConfig();
    const projectConfig = await loadProjectConfig();

    const answers: Partial<Config> = {};

    // GitHub 토큰 설정
    if (globalConfig.githubToken) {
      const { updateToken } = await inquirer.prompt([
        {
          type: "confirm",
          name: "updateToken",
          message: t("commands.init.prompts.update_token"),
          default: false,
        },
      ]);

      if (updateToken) {
        const { authMethod } = await inquirer.prompt([
          {
            type: "list",
            name: "authMethod",
            message: t("commands.init.prompts.auth_method"),
            choices: [
              {
                name: t("commands.init.prompts.auth_choices.oauth"),
                value: "oauth",
              },
              {
                name: t("commands.init.prompts.auth_choices.manual"),
                value: "manual",
              },
            ],
          },
        ]);

        if (authMethod === "oauth") {
          try {
            await setupOAuthCredentials();
          } catch (error) {
            log.error(t("oauth.auth.failed", { error }));
            process.exit(1);
          }
        } else {
          const { githubToken } = await inquirer.prompt([
            {
              type: "password",
              name: "githubToken",
              message: t("commands.init.prompts.token"),
              validate: async (value: string) => {
                if (!value) return false;
                const isValid = await validateGitHubToken(value);
                return isValid ? true : t("commands.init.error.invalid_token");
              },
            },
          ]);
          answers.githubToken = githubToken;
        }
      } else {
        answers.githubToken = globalConfig.githubToken;
      }
    } else {
      const { authMethod } = await inquirer.prompt([
        {
          type: "list",
          name: "authMethod",
          message: t("commands.init.prompts.auth_method"),
          choices: [
            {
              name: t("commands.init.prompts.auth_choices.oauth"),
              value: "oauth",
            },
            {
              name: t("commands.init.prompts.auth_choices.manual"),
              value: "manual",
            },
          ],
        },
      ]);

      if (authMethod === "oauth") {
        try {
          await setupOAuthCredentials();
        } catch (error) {
          log.error(t("oauth.auth.failed", { error }));
          process.exit(1);
        }
      } else {
        const { githubToken } = await inquirer.prompt([
          {
            type: "password",
            name: "githubToken",
            message: t("commands.init.prompts.token"),
            validate: async (value: string) => {
              if (!value) return false;
              const isValid = await validateGitHubToken(value);
              return isValid ? true : t("commands.init.error.invalid_token");
            },
          },
        ]);
        answers.githubToken = githubToken;
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

    // AI 설정
    const { setupAI } = await inquirer.prompt([
      {
        type: "confirm",
        name: "setupAI",
        message: t("commands.init.prompts.setup_ai"),
        default: true,
      },
    ]);

    // GitHub Actions 설정 추가
    const { setupGitHubAction } = await inquirer.prompt([
      {
        type: "confirm",
        name: "setupGitHubAction",
        message: t("commands.init.prompts.setup_github_action"),
        default: true,
      },
    ]);

    // AI 제공자 정보를 저장
    let aiProvider = "openrouter"; // 기본값

    if (setupAI) {
      const aiConfig = await setupAIConfig();
      await updateEnvFile(aiConfig);

      // AI 설정을 프로젝트 설정에 저장
      const projectAIConfig = {
        enabled: true,
        provider: aiConfig.provider,
        options: {
          model: aiConfig.model,
        },
      };

      // AI 제공자 정보 업데이트
      aiProvider = aiConfig.provider;

      // 프로젝트 설정 업데이트
      await updateProjectConfig({
        aiConfig: projectAIConfig,
      });
    }

    if (setupGitHubAction) {
      await setupGitHubActions(aiProvider);
    }

    // 프로젝트 설정
    const projectAnswers = await inquirer.prompt([
      {
        type: "input",
        name: "defaultBranch",
        message: t("commands.init.prompts.default_branch"),
        default: projectConfig.defaultBranch || "main",
      },
      {
        type: "input",
        name: "developmentBranch",
        message: t("commands.init.prompts.development_branch"),
        default: projectConfig.developmentBranch || "dev",
      },
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
      // 릴리스 PR 템플릿 기본값 설정
      const releasePRTitle = "Release: {development} to {production}";
      const releasePRBody =
        "Merge {development} branch into {production} for release";

      // 설정 저장
      await updateConfig({
        ...answers,
        defaultBranch: projectAnswers.defaultBranch,
        developmentBranch: projectAnswers.developmentBranch,
        releasePRTitle,
        releasePRBody,
        defaultReviewers: projectAnswers.defaultReviewers,
      });

      // 브랜치 전략 설정 결과 출력
      log.info(t("commands.init.info.branch_strategy"));
      log.info(
        t("commands.init.info.production_branch_set", {
          branch: projectAnswers.defaultBranch,
        }),
      );
      log.info(
        t("commands.init.info.development_branch_set", {
          branch: projectAnswers.developmentBranch,
        }),
      );
      log.info(t("commands.init.info.release_template_set_automatically"));

      // Git 훅 설정 - 사용자 선택 없이 무조건 설정
      await setupGitHooks();
      log.info(t("commands.init.info.hooks_setup_automatically"));

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
