import inquirer from "inquirer";
import { t, supportedLanguages } from "../../i18n/index.js";
import {
  updateConfig,
  loadGlobalConfig,
  loadProjectConfig,
} from "../../core/config.js";
import { setupGitHubAppCredentials } from "../../core/github-app.js";
import { log } from "../../utils/logger.js";

import { Config } from "../../types/config.js";

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
      log.info(t("commands.init.info.github_app_auth_success"));
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
