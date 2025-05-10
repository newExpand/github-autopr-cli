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

// 브랜치를 원격 저장소에 push하는 함수 추가
async function pushToRemote(branch: string): Promise<void> {
  try {
    await execAsync(`git push -u origin ${branch}`);
    log.info(t("commands.new.success.branch_pushed", { branch }));
  } catch (error) {
    log.error(t("commands.new.error.push_failed", { error: String(error) }));
    throw error;
  }
}

async function getDiffContent(baseBranch: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git diff origin/${baseBranch}...HEAD`);
    return stdout;
  } catch (error) {
    log.error(t("commands.new.error.diff_failed"));
    return "";
  }
}

async function getChangedFiles(baseBranch: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `git diff --name-only origin/${baseBranch}...HEAD`,
    );
    return stdout.split("\n").filter(Boolean);
  } catch (error) {
    log.error(t("commands.new.error.files_failed"));
    return [];
  }
}

/**
 * PR이 생성된 후 AI 코드 리뷰를 수행하고 결과를 PR에 코멘트로 추가합니다.
 */
async function performAICodeReview(params: {
  owner: string;
  repo: string;
  pull_number: number;
  head_ref: string;
  ai: AIFeatures;
  diffContent: string;
  title: string;
  body: string;
  author: string;
}): Promise<void> {
  const {
    owner,
    repo,
    pull_number,
    head_ref,
    ai,
    diffContent,
    title,
    body,
    author,
  } = params;

  try {
    log.info(t("commands.review.info.ai_review_start"));

    // GitHub API로 PR 파일 정보 가져오기
    const client = await getOctokit();
    const filesResponse = await client.rest.pulls.listFiles({
      owner,
      repo,
      pull_number,
    });

    // 파일 내용 가져오기
    const fileDetails = await Promise.all(
      filesResponse.data.map(async (file) => {
        let content = "";
        if (file.status !== "removed") {
          try {
            const contentResponse = await client.rest.repos.getContent({
              owner,
              repo,
              path: file.filename,
              ref: head_ref,
            });

            if ("content" in contentResponse.data) {
              const base64Content = contentResponse.data.content;
              content = Buffer.from(base64Content, "base64").toString("utf-8");
            }
          } catch (error) {
            log.debug(`파일 내용을 가져오는데 실패했습니다: ${file.filename}`);
          }
        }

        return {
          path: file.filename,
          additions: file.additions,
          deletions: file.deletions,
          content,
        };
      }),
    );

    // AI 리뷰 생성
    const review = await ai.reviewPR({
      prNumber: pull_number,
      title,
      description: body,
      author,
      changedFiles: fileDetails,
      diffContent,
    });

    // PR에 리뷰 코멘트 작성
    await client.rest.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body: review,
    });

    log.info(
      t("commands.review_bot.success.review_created", { number: pull_number }),
    );
  } catch (error) {
    log.error(t("commands.review_bot.error.review_failed"), error);
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

    // release/* 브랜치인 경우 자동으로 원격 저장소에 push
    if (pattern.type === "release") {
      try {
        await pushToRemote(repoInfo.currentBranch);
      } catch (error) {
        log.error(
          t("commands.new.error.push_failed", { error: String(error) }),
        );
        process.exit(1);
      }
    }

    let defaultTitle = repoInfo.currentBranch;
    let defaultBody = "";
    let generatedTitle = "";

    if (pattern) {
      defaultTitle = await generatePRTitle(repoInfo.currentBranch, pattern);
      defaultBody = await generatePRBody(pattern);
    }

    // 브랜치 전략에 따라 base 브랜치 결정
    const baseBranch =
      pattern?.type === "release"
        ? config.defaultBranch
        : config.developmentBranch || config.defaultBranch;

    // 변경사항 수집
    const changedFiles = await getChangedFiles(baseBranch);
    const diffContent = await getDiffContent(baseBranch);

    let generatedDescription = "";
    let aiEnabled = false;
    let ai: AIFeatures | null = null;

    // AI 기능이 설정되어 있는 경우에만 AI 관련 기능 실행
    if (config.aiConfig?.enabled) {
      try {
        ai = new AIFeatures();
        await ai.initialize();
        aiEnabled = ai.isEnabled();

        if (aiEnabled) {
          // AI로 PR 제목 생성
          try {
            log.info(t("commands.new.info.generating_title"));
            generatedTitle = await ai.generatePRTitle(
              changedFiles,
              diffContent,
              pattern,
            );
            log.section(t("commands.new.info.generated_title", { title: "" }));
            log.verbose(generatedTitle);
            defaultTitle = generatedTitle || defaultTitle;
          } catch (error) {
            log.warn(t("commands.new.warning.ai_title_failed"), error);
            log.debug("AI 제목 생성 에러:", error);
          }

          log.info(t("commands.new.info.generating_description"));
          // AI에게 템플릿을 함께 전달
          generatedDescription = await ai.generatePRDescription(
            changedFiles,
            diffContent,
            pattern ? { template: defaultBody } : undefined,
          );

          // AI가 생성한 설명 표시
          log.section(t("commands.new.info.generated_description"));
          log.section("-------------------");
          log.verbose(generatedDescription);
          log.section("-------------------");
        }
      } catch (error) {
        log.warn(t("commands.new.warning.ai_description_failed"));
        aiEnabled = false;
        ai = null;
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
      {
        type: "confirm",
        name: "performAIReview",
        message: t("commands.new.prompts.perform_ai_review", {
          defaultMessage: "AI 코드 리뷰를 자동으로 수행하시겠습니까?",
        }),
        default: true,
        when: () => aiEnabled && ai !== null,
      },
    ]);

    // PR 생성 시작을 알림
    log.info(t("commands.new.info.creating"));

    try {
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

          // 기존 PR에 AI 리뷰 수행
          if (answers.performAIReview && ai && aiEnabled) {
            await performAICodeReview({
              owner: repoInfo.owner,
              repo: repoInfo.repo,
              pull_number: existingPR.number,
              head_ref: headBranch,
              ai,
              diffContent,
              title: answers.title,
              body: newBody,
              author: (await getGitUserName()) || "unknown",
            });
          }

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

      // PR 생성 후 AI 리뷰 수행
      if (answers.performAIReview && ai && aiEnabled) {
        await performAICodeReview({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          pull_number: pr.number,
          head_ref: headBranch,
          ai,
          diffContent,
          title: answers.title,
          body: answers.useAIDescription
            ? generatedDescription
            : answers.body || "",
          author: (await getGitUserName()) || "unknown",
        });
      }
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

/**
 * Git 사용자 이름을 가져옵니다.
 */
async function getGitUserName(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git config user.name");
    return stdout.trim();
  } catch (error) {
    log.debug("Git 사용자 이름을 가져오는데 실패했습니다:", error);
    return null;
  }
}
