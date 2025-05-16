import inquirer from "inquirer";
import { t, supportedLanguages } from "../../i18n/index.js";
import {
  updateConfig,
  loadGlobalConfig,
  loadProjectConfig,
  loadConfig,
} from "../../core/config.js";
import { setupGitHubAppCredentials } from "../../core/github-app.js";
import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { log } from "../../utils/logger.js";

import { Config } from "../../types/config.js";

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

    const answers: Partial<Config> = {};

    // GitHub App 설정
    log.info(t("commands.github_app.setup.info"));

    try {
      // 디바이스 플로우로 GitHub App 인증 진행
      await setupGitHubAppCredentials();

      // 인증 완료 메시지
      log.info(
        "GitHub App 인증이 완료되었습니다. 서버를 통해 자동 인증됩니다.",
      );
    } catch (error) {
      log.error(t("commands.github_app.auth.failed", { error }));
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
