import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import {
  getPullRequest,
  getPullRequestStatus,
  getOctokit,
} from "../../core/github.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { AIFeatures } from "../../core/ai-features.js";
import inquirer from "inquirer";
import { exec } from "child_process";
import { promisify } from "util";
import { log } from "../../utils/logger.js";

const execAsync = promisify(exec);

interface FileContent {
  path: string;
  content: string;
  status: "added" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  base_ref: string;
  head_ref: string;
}

async function getChangedFiles(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<FileContent[]> {
  try {
    // GitHub API를 사용하여 PR의 변경된 파일 목록을 가져옵니다
    const client = await getOctokit();
    const { data: pr } = await client.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    // PR이 닫혀있거나 병합된 경우 처리
    if (pr.state !== "open") {
      throw new Error(t("commands.review.error.pr_closed"));
    }

    // PR의 변경된 파일 목록을 가져옵니다
    const { data: files } = await client.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    // 각 파일의 내용을 가져옵니다
    const fileContents = await Promise.all(
      files.map(async (file) => {
        try {
          // 파일이 삭제된 경우 제외
          if (file.status === "removed") {
            return null;
          }

          // GitHub API를 통해 파일 내용을 가져옵니다
          // PR의 head 브랜치에서 파일 내용을 가져옵니다
          const { data: blob } = await client.rest.git.getBlob({
            owner,
            repo,
            file_sha: file.sha,
          });

          // 파일 내용이 이진 파일이거나 너무 큰 경우 건너뜁니다
          if (blob.encoding !== "base64" || (blob.size ?? 0) > 1024 * 1024) {
            // 1MB 제한
            log.warn(
              t("commands.review.warning.file_too_large", {
                file: file.filename,
              }),
            );
            return null;
          }

          return {
            path: file.filename,
            content: Buffer.from(blob.content, "base64").toString("utf-8"),
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            base_ref: pr.base.ref,
            head_ref: pr.head.ref,
          } as FileContent;
        } catch (error) {
          log.warn(
            t("commands.review.error.file_content_failed", {
              file: file.filename,
            }),
          );
          return null;
        }
      }),
    );

    return fileContents.filter((file): file is FileContent => file !== null);
  } catch (error) {
    if (error instanceof Error) {
      log.error(
        t(
          `commands.review.error.${error.message === "pr_closed" ? "pr_closed" : "files_failed"}`,
        ),
      );
    } else {
      log.error(t("commands.review.error.files_failed"));
    }
    return [];
  }
}

export async function reviewCommand(prNumber: string): Promise<void> {
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

    const pr = await getPullRequest({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      pull_number: parseInt(prNumber, 10),
    });

    // 파일 변경 통계 정보 가져오기
    const files = await getChangedFiles(
      repoInfo.owner,
      repoInfo.repo,
      pr.number,
    );

    // PR 상태 확인
    const status = await getPullRequestStatus({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      pull_number: pr.number,
    });

    // PR 정보 표시
    log.info("\n" + t("commands.review.info.title"));
    log.info(t("commands.review.info.author", { author: pr.user.login }));
    log.info(
      t("commands.review.info.status", {
        status: pr.draft
          ? t("commands.review.status.draft")
          : t("commands.review.status.ready"),
      }),
    );
    log.info(
      t("commands.review.info.merge_status", {
        status: t(`commands.review.status.${status.toLowerCase()}`),
      }),
    );
    log.info(t("commands.review.info.url", { url: pr.html_url }));

    // 파일 변경 통계 출력
    const stats = {
      total: files.length,
      processed: files.filter((f) => f !== null).length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      changes: files.reduce((sum, file) => sum + file.changes, 0),
    };

    log.info(
      t("commands.review.info.file_stats", {
        total: stats.total,
        processed: stats.processed,
        additions: stats.additions,
        deletions: stats.deletions,
        changes: stats.changes,
        base_branch: pr.base.ref,
        head_branch: pr.head.ref,
      }),
    );
    log.info("\n");

    let aiEnabled = false;
    let ai: AIFeatures | null = null;

    // AI 기능이 설정되어 있는 경우에만 AI 관련 기능 활성화
    if (config.aiConfig?.enabled) {
      try {
        ai = new AIFeatures();
        await ai.initialize();
        aiEnabled = ai.isEnabled();
      } catch (error) {
        aiEnabled = false;
        ai = null;
      }
    }

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: t("commands.review.prompts.action"),
        choices: [
          { name: t("commands.review.actions.view"), value: "view" },
          ...(aiEnabled
            ? [
                {
                  name: t("commands.review.actions.ai_review"),
                  value: "ai_review",
                },
              ]
            : []),
          { name: t("commands.review.actions.review"), value: "review" },
          { name: t("commands.review.actions.checkout"), value: "checkout" },
          { name: t("commands.review.actions.open"), value: "open" },
          { name: t("commands.review.actions.cancel"), value: "cancel" },
        ],
      },
    ]);

    switch (action) {
      case "view":
        log.info("\n" + t("commands.review.content.title"));
        log.info("-------------------");
        log.info(pr.body || t("commands.review.content.empty"));
        break;

      case "ai_review":
        if (!aiEnabled) {
          log.error(t("ai.error.not_initialized"));
          break;
        }

        log.info(t("commands.review.info.ai_review_start"));
        // 이미 생성된 AI 인스턴스 사용
        if (!ai) {
          ai = new AIFeatures();
          await ai.initialize();
        }

        const reviewFiles = await getChangedFiles(
          repoInfo.owner,
          repoInfo.repo,
          pr.number,
        );

        if (reviewFiles.length === 0) {
          log.warn(t("commands.review.warning.no_changes"));
          break;
        }

        try {
          const review = await ai.reviewCode(reviewFiles);
          log.info("\n" + t("commands.review.content.ai_review_title"));
          log.info("-------------------");
          log.info(review);
        } catch (error) {
          log.error(t("ai.error.code_review_failed"));
        }
        break;

      case "review": {
        const { reviewType, comment } = await inquirer.prompt([
          {
            type: "list",
            name: "reviewType",
            message: t("commands.review.prompts.review_type"),
            choices: [
              {
                name: t("commands.review.review_types.approve"),
                value: "APPROVE",
              },
              {
                name: t("commands.review.review_types.request_changes"),
                value: "REQUEST_CHANGES",
              },
              {
                name: t("commands.review.review_types.comment"),
                value: "COMMENT",
              },
            ],
          },
          {
            type: "input",
            name: "comment",
            message: (answers) => {
              const type = answers.reviewType.toLowerCase();
              return t(`commands.review.prompts.comment.${type}`);
            },
            validate: (value: string) =>
              value.length > 0 || t("commands.review.error.comment_required"),
          },
        ]);

        try {
          const client = await getOctokit();
          await client.rest.pulls.createReview({
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            pull_number: pr.number,
            event: reviewType,
            body: comment,
          });
          log.info(t("common.success.review_submitted"));
        } catch (error) {
          log.error(t("commands.review.error.submit_failed"), error);
        }
        break;
      }

      case "checkout":
        try {
          const { stdout } = await execAsync(
            `git fetch origin pull/${pr.number}/head:pr-${pr.number} && git checkout pr-${pr.number}`,
          );
          log.info(t("commands.review.success.checkout"));
          log.debug(stdout);
        } catch (error) {
          log.error(
            t("commands.review.error.checkout_failed", {
              error: String(error),
            }),
          );
        }
        break;

      case "open":
        try {
          await execAsync(`open ${pr.html_url}`);
          log.info(t("commands.review.success.opened"));
        } catch (error) {
          log.error(
            t("commands.review.error.browser_open_failed", {
              error: String(error),
            }),
          );
        }
        break;

      case "cancel":
        log.info(t("commands.review.success.cancelled"));
        break;
    }
  } catch (error) {
    log.error(t("common.error.unknown"), error);
    process.exit(1);
  }
}
