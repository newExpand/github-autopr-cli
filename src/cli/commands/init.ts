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

      // 개인 키 설정 안내
      log.section("🔑 GitHub App 개인 키 설정");
      log.info("GitHub App API 호출을 위해 개인 키가 필요합니다.");
      log.info(
        "GitHub 개발자 설정에서 다운로드한 .pem 파일의 경로를 입력하세요.",
      );
      log.info("개인 키가 없으면 GitHub 개발자 설정에서 생성할 수 있습니다.");
      log.info(
        "(https://github.com/settings/apps > 앱 선택 > Private Keys > Generate a private key)",
      );

      const { privateKeyPath } = await inquirer.prompt([
        {
          type: "input",
          name: "privateKeyPath",
          message: t("commands.github_app.private_key.prompt"),
          validate: (value: string) => {
            if (!value.trim()) {
              return "개인 키는 필수입니다. GitHub App API를 사용하려면 개인 키가 필요합니다.";
            }

            // 파일 존재 여부 확인
            if (!existsSync(value)) {
              return "해당 경로에 파일이 존재하지 않습니다.";
            }

            return true;
          },
        },
      ]);

      if (privateKeyPath) {
        try {
          // 개인 키 파일 읽기
          const privateKey = await readFile(privateKeyPath, "utf8");

          // 현재 설정 불러오기
          const currentConfig = await loadConfig();

          // githubApp 설정이 존재하는지 확인
          if (!currentConfig.githubApp || !currentConfig.githubApp.appId) {
            throw new Error(
              "GitHub App 설정이 불완전합니다. 'autopr init' 명령어를 다시 실행하세요.",
            );
          }

          // 설정에 개인 키 저장
          await updateConfig({
            githubApp: {
              ...currentConfig.githubApp, // 기존 GitHub App 설정 유지
              privateKey, // 개인 키 업데이트
            },
          });

          log.info(t("commands.github_app.private_key.success"));
        } catch (error) {
          log.error(t("commands.github_app.private_key.failed", { error }));
          process.exit(1);
        }
      }
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
