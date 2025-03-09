import inquirer from "inquirer";
import { t, supportedLanguages } from "../../i18n/index.js";
import {
  updateConfig,
  loadGlobalConfig,
  loadProjectConfig,
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

const AI_PROVIDERS = ["openai", "github-copilot", "anthropic"] as const;

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
  // OpenAI만 선택 가능하도록 자동 설정
  const provider = "openai" as const;

  const { apiKey } = await inquirer.prompt([
    {
      type: "password",
      name: "apiKey",
      message: t("commands.init.prompts.enter_api_key", {
        provider: provider.toUpperCase(),
      }),
      validate: (value: string) => value.length > 0,
    },
  ]);

  const models = await getAvailableModels(provider, apiKey);
  const { model } = await inquirer.prompt([
    {
      type: "list",
      name: "model",
      message: t("commands.init.prompts.select_model"),
      choices: models,
    },
  ]);

  return { provider, apiKey, model };
}

async function updateEnvFile(aiConfig: {
  provider: string;
  apiKey: string;
  model: string;
}): Promise<void> {
  try {
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

export async function initCommand(): Promise<void> {
  try {
    // 기존 설정 로드
    const globalConfig = await loadGlobalConfig();
    const projectConfig = await loadProjectConfig();

    let answers: any = {};

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

    if (setupAI) {
      const aiConfig = await setupAIConfig();
      await updateEnvFile(aiConfig);

      answers.aiConfig = {
        enabled: true,
        provider: aiConfig.provider,
        options: {
          model: aiConfig.model,
        },
      };
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
        name: "defaultReviewers",
        message: t("commands.init.prompts.reviewers"),
        default: projectConfig.defaultReviewers.join(", "),
        filter: (value: string) =>
          value
            .split(",")
            .map((reviewer) => reviewer.trim())
            .filter(Boolean),
      },
      {
        type: "confirm",
        name: "setupHooks",
        message: t("commands.init.prompts.setup_hooks"),
        default: true,
      },
    ]);

    try {
      // 설정 저장
      await updateConfig({
        ...answers,
        defaultBranch: projectAnswers.defaultBranch,
        defaultReviewers: projectAnswers.defaultReviewers,
      });

      // Git 훅 설정
      if (projectAnswers.setupHooks) {
        await setupGitHooks();
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
