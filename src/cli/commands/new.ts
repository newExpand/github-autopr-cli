import inquirer from "inquirer";
import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import {
  createPullRequest,
  addReviewers,
  updatePullRequest,
  getOctokit,
  checkDraftPRAvailability,
} from "../../core/github.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { log } from "../../utils/logger.js";
import { AIFeatures } from "../../core/ai-features.js";
import { exec } from "child_process";
import { promisify } from "util";
import {
  findMatchingPattern,
  generatePRTitle,
  generatePRBody,
} from "../../core/branch-pattern.js";

const execAsync = promisify(exec);

async function getDiffContent(): Promise<string> {
  try {
    const { stdout: defaultBranch } = await execAsync(
      "git rev-parse --abbrev-ref origin/HEAD",
    );
    const baseBranchName = defaultBranch.trim().replace("origin/", "");
    const { stdout } = await execAsync(
      `git diff origin/${baseBranchName}...HEAD`,
    );
    return stdout;
  } catch (error) {
    // 기본 브랜치를 가져오는데 실패한 경우 main을 사용
    try {
      const { stdout } = await execAsync("git diff origin/main...HEAD");
      return stdout;
    } catch (retryError) {
      log.error(t("commands.new.error.diff_failed"));
      return "";
    }
  }
}

async function getChangedFiles(): Promise<string[]> {
  try {
    const { stdout: defaultBranch } = await execAsync(
      "git rev-parse --abbrev-ref origin/HEAD",
    );
    const baseBranchName = defaultBranch.trim().replace("origin/", "");
    const { stdout } = await execAsync(
      `git diff --name-only origin/${baseBranchName}...HEAD`,
    );
    return stdout.split("\n").filter(Boolean);
  } catch (error) {
    // 기본 브랜치를 가져오는데 실패한 경우 main을 사용
    try {
      const { stdout } = await execAsync(
        "git diff --name-only origin/main...HEAD",
      );
      return stdout.split("\n").filter(Boolean);
    } catch (retryError) {
      log.error(t("commands.new.error.files_failed"));
      return [];
    }
  }
}

export async function newCommand(): Promise<void> {
  try {
    const config = await loadConfig();
    if (!config) {
      log.error(t("common.error.github_token"));
      process.exit(1);
    }

    const repoInfo = await getCurrentRepoInfo();
    if (!repoInfo) {
      log.error(t("common.error.not_git_repo"));
      process.exit(1);
    }

    // main/master 브랜치 체크
    if (
      repoInfo.currentBranch === config.defaultBranch ||
      repoInfo.currentBranch === config.developmentBranch
    ) {
      log.error(
        t("commands.new.error.protected_branch", {
          branch: repoInfo.currentBranch,
          development: config.developmentBranch,
          production: config.defaultBranch,
        }),
      );
      process.exit(1);
    }

    // 브랜치 패턴 매칭
    const pattern = await findMatchingPattern(repoInfo.currentBranch);
    if (!pattern) return;

    let defaultTitle = repoInfo.currentBranch;
    let defaultBody = "";

    if (pattern) {
      defaultTitle = await generatePRTitle(repoInfo.currentBranch, pattern);
      defaultBody = await generatePRBody(pattern);
    }

    // 변경사항 수집
    const changedFiles = await getChangedFiles();
    const diffContent = await getDiffContent();

    let generatedDescription = "";
    let aiEnabled = false;

    // AI 기능이 설정되어 있는 경우에만 AI 관련 기능 실행
    if (config.aiConfig?.enabled) {
      try {
        const ai = new AIFeatures();
        aiEnabled = ai.isEnabled();

        if (aiEnabled) {
          log.info(t("commands.new.info.generating_description"));
          // AI에게 템플릿을 함께 전달
          generatedDescription = await ai.generatePRDescription(
            changedFiles,
            diffContent,
            pattern ? { template: defaultBody } : undefined,
          );

          // AI가 생성한 설명 표시
          log.info("\n" + t("commands.new.info.generated_description"));
          log.info("-------------------");
          log.info(generatedDescription);
          log.info("-------------------\n");
        }
      } catch (error) {
        log.warn(t("commands.new.warning.ai_description_failed"));
        aiEnabled = false;
      }
    }

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "title",
        message: t("commands.new.prompts.title"),
        default: defaultTitle,
        validate: (value: string) => value.length > 0,
      },
      {
        type: "confirm",
        name: "useAIDescription",
        message: t("commands.new.prompts.use_ai_description"),
        default: true,
        when: () => aiEnabled && !!generatedDescription,
      },
      {
        type: "confirm",
        name: "editAIDescription",
        message: t("commands.new.prompts.edit_ai_description"),
        default: false,
        when: (answers) =>
          aiEnabled && !!generatedDescription && answers.useAIDescription,
      },
      {
        type: "editor",
        name: "body",
        message: t("commands.new.prompts.body"),
        default: (answers) => {
          if (aiEnabled && generatedDescription && answers.useAIDescription) {
            return answers.editAIDescription ? generatedDescription : undefined;
          }
          return defaultBody;
        },
        when: (answers) =>
          !aiEnabled ||
          !generatedDescription ||
          !answers.useAIDescription ||
          answers.editAIDescription,
      },
      {
        type: "input",
        name: "reviewers",
        message: t("commands.new.prompts.reviewers"),
        default: pattern?.autoAssignReviewers
          ? [
              ...new Set([
                ...config.defaultReviewers,
                ...(pattern.reviewers || []),
              ]),
            ].join(", ")
          : config.defaultReviewers.join(", "),
        filter: (value: string) =>
          value
            .split(",")
            .map((reviewer) => reviewer.trim())
            .filter(Boolean),
      },
    ]);

    // PR 생성 시작을 알림
    log.info(t("commands.new.info.creating"));

    try {
      // 브랜치 전략에 따라 base 브랜치 결정
      const baseBranch =
        pattern?.type === "release"
          ? config.defaultBranch
          : config.developmentBranch || config.defaultBranch;

      // head 브랜치 참조 형식 수정
      const headBranch = repoInfo.currentBranch;

      // draft PR 사용 가능 여부 확인
      const draftAvailable = await checkDraftPRAvailability({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
      });

      // pattern에서 draft 설정을 가져오되, draft PR 사용 불가능한 경우 false로 설정
      let isDraft = pattern?.draft ?? false;

      // draft PR 사용 가능한 경우 선택권 제공
      if (draftAvailable) {
        const { shouldBeDraft } = await inquirer.prompt([
          {
            type: "confirm",
            name: "shouldBeDraft",
            message: t("commands.new.prompts.create_as_draft"),
            default: pattern?.draft ?? false,
          },
        ]);
        isDraft = shouldBeDraft;
      } else {
        // draft PR 사용 불가능한 경우 강제로 false
        isDraft = false;
        if (pattern?.draft) {
          log.warn(t("commands.new.warning.draft_not_available"));
        }
      }

      // PR이 이미 존재하는지 확인
      const client = await getOctokit();
      const existingPRs = await client.rest.pulls.list({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        head: `${repoInfo.owner}:${headBranch}`,
        state: "open",
      });

      if (existingPRs.data.length > 0) {
        const existingPR = existingPRs.data[0];
        log.info(
          t("commands.new.info.pr_exists", { number: existingPR.number }),
        );

        // 기존 PR 업데이트 여부 확인
        const { updateExisting } = await inquirer.prompt([
          {
            type: "confirm",
            name: "updateExisting",
            message: t("commands.new.prompts.update_existing"),
            default: true,
          },
        ]);

        if (updateExisting) {
          // 기존 PR 업데이트
          const newBody = `
# 이전 내용
${existingPR.body || "(내용 없음)"}

---
# 업데이트된 내용
${answers.useAIDescription ? generatedDescription : answers.body || ""}
`;

          await updatePullRequest({
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            pull_number: existingPR.number,
            title: answers.title,
            body: newBody,
          });

          // 리뷰어 업데이트
          if (answers.reviewers.length > 0) {
            await addReviewers({
              owner: repoInfo.owner,
              repo: repoInfo.repo,
              pull_number: existingPR.number,
              reviewers: answers.reviewers,
            });
          }

          log.info(
            t("commands.new.success.pr_updated", { number: existingPR.number }),
          );
          log.info(`PR URL: ${existingPR.html_url}`);
          return;
        } else {
          log.info(t("commands.new.success.cancelled"));
          return;
        }
      }

      const pr = await createPullRequest({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        title: answers.title,
        body: answers.useAIDescription
          ? generatedDescription
          : answers.body || "",
        head: headBranch,
        base: baseBranch,
        draft: isDraft,
      });

      // 리뷰어 추가 시도
      if (answers.reviewers.length > 0) {
        log.debug(t("commands.new.info.adding_reviewers"));
        await addReviewers({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          pull_number: pr.number,
          reviewers: answers.reviewers,
        });
        log.verbose(
          t("commands.new.info.reviewers_added", {
            reviewers: answers.reviewers.join(", "),
          }),
        );
      }

      log.info(t("common.success.pr_created"));
      log.info(`PR URL: ${pr.html_url}`);
    } catch (error: any) {
      if (error.message?.includes("No commits between")) {
        log.error(t("common.error.no_commits"));
      } else if (error.message?.includes("A pull request already exists")) {
        log.error(t("common.error.pr_exists"));
      } else if (error.message?.includes("Base branch was modified")) {
        log.error(t("common.error.base_modified"));
      } else {
        log.error(
          t("commands.new.error.create_failed", { error: String(error) }),
        );
      }
      process.exit(1);
    }
  } catch (error) {
    log.error(t("common.error.unknown"), String(error));
    process.exit(1);
  }
}
