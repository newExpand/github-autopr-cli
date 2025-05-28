import inquirer from "inquirer";
import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import {
  createPullRequest,
  addReviewers,
  updatePullRequest,
  getOctokit,
  checkDraftPRAvailability,
  createPullRequestReview,
  getPullRequestFileDiff,
} from "../../core/github.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { log } from "../../utils/logger.js";
import { AIFeatures, RelatedIssue } from "../../core/ai-features.js";
import { exec } from "child_process";
import { promisify } from "util";
import {
  findMatchingPattern,
  generatePRBody,
} from "../../core/branch-pattern.js";
import { readFile } from "fs/promises";
import { stat } from "fs/promises";
import { getAvailableTemplates } from "../commands/template.js";
import { spawn } from "child_process";
import { BranchPattern } from "../../types/config.js";

const execAsync = promisify(exec);

// 파일 크기 제한 (20MB)
const MAX_FILE_SIZE = 20 * 1024 * 1024;

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

// 변경된 파일의 내용을 가져오는 함수 개선
async function getFileContents(
  files: string[],
): Promise<Array<{ path: string; content: string }>> {
  const result: Array<{ path: string; content: string }> = [];

  for (const file of files) {
    try {
      // 파일 크기 확인
      const stats = await stat(file);
      if (stats.size > MAX_FILE_SIZE) {
        log.warn(
          t("commands.new.warning.file_too_large", {
            file,
            size: Math.round(stats.size / 1024 / 1024),
          }),
        );
        continue;
      }

      const content = await readFile(file, "utf-8");
      result.push({ path: file, content });
    } catch (error) {
      log.warn(t("commands.new.warning.file_read_failed", { file }));
    }
  }

  return result;
}

// 코드 리뷰를 실행하고 PR에 리뷰 코멘트를 추가하는 함수
async function runCodeReviewAndAddComments(params: {
  owner: string;
  repo: string;
  pull_number: number;
  files: Array<{ path: string; content: string }>;
  ai: AIFeatures;
  shouldRunPRReview: boolean;
  shouldRunOverallReview: boolean;
  shouldRunLineByLineReview: boolean;
  base_branch?: string;
  base?: string;
  prTitle?: string;
  diffContent?: string;
  language?: import("../../core/ai-features.js").SupportedLanguage;
}): Promise<void> {
  try {
    if (params.files.length === 0) {
      log.warn(t("commands.new.warning.no_files_for_review"));
      return;
    }

    const reviewTasks: Promise<any>[] = [];
    const reviewResults: {
      prReview: string;
      overallReview: string;
      lineComments: Array<{
        file: string;
        line: number;
        comment: string;
        severity?: "info" | "warning" | "error";
      }>;
    } = {
      prReview: "",
      overallReview: "",
      lineComments: [],
    };

    // PR 리뷰 실행
    if (params.shouldRunPRReview) {
      log.info(t("commands.new.info.running_pr_review"));
      const prReviewTask = (async () => {
        try {
          reviewResults.prReview = await params.ai.reviewPR(
            {
              prNumber: params.pull_number,
              title: params.prTitle || "",
              changedFiles: params.files,
              diffContent: params.diffContent || "",
              repoOwner: params.owner,
              repoName: params.repo,
            },
            params.language,
          );
          log.info(t("commands.new.info.pr_review_completed"));
        } catch (error) {
          log.warn(t("commands.new.warning.ai_pr_review_failed"), error);
        }
      })();
      reviewTasks.push(prReviewTask);
    }

    // 전체 코드 리뷰 실행
    if (params.shouldRunOverallReview) {
      log.info(t("commands.new.info.running_code_review"));
      const codeReviewTask = (async () => {
        try {
          // 파일 내용을 라인별로 변환
          const lineFiles = params.files.map((f) => ({
            path: f.path,
            content: f.content.split("\n").map((text, idx) => ({
              line: idx + 1,
              text,
            })),
          }));
          reviewResults.overallReview = await params.ai.reviewCode(
            lineFiles,
            params.language,
          );
          log.info(t("commands.new.info.code_review_completed"));
        } catch (error) {
          log.warn(t("commands.new.warning.code_review_failed"), error);
        }
      })();
      reviewTasks.push(codeReviewTask);
    }

    // 라인별 코드 리뷰 실행
    if (params.shouldRunLineByLineReview) {
      log.info(t("commands.new.info.running_line_by_line_review"));
      log.info(t("commands.new.info.pr_analysis_info"));
      const lineReviewTask = (async () => {
        try {
          const comments = await params.ai.lineByLineCodeReview(
            params.files,
            {
              owner: params.owner,
              repo: params.repo,
              pull_number: params.pull_number,
              baseBranch: params.base_branch || params.base || "main",
            },
            params.language,
          );
          reviewResults.lineComments = comments;
          if (comments.length > 0) {
            log.info(t("commands.new.info.line_by_line_review_completed"));
          } else {
            log.info(t("commands.new.info.no_line_comments"));
          }
        } catch (error) {
          log.warn(t("commands.new.warning.line_review_failed"), error);
        }
      })();
      reviewTasks.push(lineReviewTask);
    }

    await Promise.all(reviewTasks);

    // PR 리뷰 별도 코멘트
    if (reviewResults.prReview) {
      try {
        await createPullRequestReview({
          owner: params.owner,
          repo: params.repo,
          pull_number: params.pull_number,
          body: `## PR 리뷰\n\n${reviewResults.prReview}`,
          event: "COMMENT",
          comments: [],
        });
        log.info(t("commands.new.success.pr_review_added"));
      } catch (error) {
        log.warn(t("commands.new.warning.code_review_add_failed"), error);
      }
    }

    // 코드 리뷰 별도 코멘트
    if (reviewResults.overallReview) {
      try {
        await createPullRequestReview({
          owner: params.owner,
          repo: params.repo,
          pull_number: params.pull_number,
          body: `## 코드 리뷰\n\n${reviewResults.overallReview}`,
          event: "COMMENT",
          comments: [],
        });
        log.info(t("commands.new.success.code_review_added"));
      } catch (error) {
        log.warn(t("commands.new.warning.code_review_add_failed"), error);
      }
    }

    // 라인별 코멘트
    if (reviewResults.lineComments.length > 0) {
      const reviewComments = [];
      const commentTasks = reviewResults.lineComments.map(async (comment) => {
        try {
          const diffInfo = await getPullRequestFileDiff({
            owner: params.owner,
            repo: params.repo,
            pull_number: params.pull_number,
            file_path: comment.file,
          });
          const lineInfo = diffInfo.changes.find(
            (change) =>
              change.newLineNumber === comment.line &&
              (change.type === "added" || change.type === "unchanged"),
          );
          if (lineInfo && lineInfo.newLineNumber) {
            let prefix = "";
            if (comment.severity === "error") {
              prefix = "🔴 ";
            } else if (comment.severity === "warning") {
              prefix = "⚠️ ";
            } else if (comment.severity === "info") {
              prefix = "ℹ️ ";
            }
            return {
              path: comment.file,
              line: lineInfo.newLineNumber,
              side: "RIGHT" as const,
              body: `${prefix}${comment.comment}`,
            };
          } else {
            log.warn(
              t("commands.new.warning.comment_add_failed", {
                file: comment.file,
                line: comment.line,
              }),
            );
            return null;
          }
        } catch (error: any) {
          log.warn(
            t("commands.new.debug.line_comment_mapping_failed", {
              file: comment.file,
              line: comment.line,
            }),
            error,
          );
          return null;
        }
      });
      const commentResults = await Promise.all(commentTasks);
      reviewComments.push(
        ...commentResults.filter((comment) => comment !== null),
      );
      if (reviewComments.length > 0) {
        try {
          await createPullRequestReview({
            owner: params.owner,
            repo: params.repo,
            pull_number: params.pull_number,
            body: t("commands.new.info.line_by_line_review_comment"),
            event: "COMMENT",
            comments: reviewComments,
          });
          log.info(t("commands.new.success.line_review_added"));
        } catch (error) {
          log.warn(t("commands.new.warning.code_review_add_failed"), error);
        }
      }
    }
    if (
      !reviewResults.prReview &&
      !reviewResults.overallReview &&
      reviewResults.lineComments.length === 0
    ) {
      log.info(t("commands.new.info.no_review_comments"));
    }
  } catch (error) {
    log.warn(t("commands.new.warning.code_review_add_failed"), error);
  }
}

// 템플릿 제안 및 선택 개선 함수 (루트로 이동)
async function selectTemplateImproved(
  pattern: BranchPattern | undefined,
  t: any,
  log: any,
): Promise<string> {
  // 가능한 모든 템플릿 가져오기
  const customTemplates = await getAvailableTemplates().catch(() => []);
  // 기본 템플릿 목록
  const standardTemplates = [
    "feature",
    "bugfix",
    "refactor",
    "docs",
    "chore",
    "test",
  ];
  // 추천 템플릿 (패턴 매칭에서 가져옴)
  let recommendedTemplate = pattern?.type || "feature";
  if (pattern?.template) {
    recommendedTemplate = pattern.template;
  }
  // 템플릿 옵션 구성 (타입을 any로 설정하여 다양한 형태를 허용)
  const templateChoices: any[] = standardTemplates.map((template) => ({
    name:
      template === recommendedTemplate
        ? `${template} (${t("commands.new.info.recommended")})`
        : template,
    value: template,
  }));
  // 사용자 정의 템플릿 추가
  if (customTemplates.length > 0) {
    // inquirer의 Separator로 구분선 추가
    templateChoices.push(
      new inquirer.Separator("---- 사용자 정의 템플릿 ----"),
    );
    // 사용자 정의 템플릿 추가
    customTemplates.forEach((template) => {
      templateChoices.push({
        name:
          template === recommendedTemplate
            ? `${template} (${t("commands.new.info.recommended")})`
            : template,
        value: template,
      });
    });
  }
  // 새 템플릿 생성 옵션 추가
  templateChoices.push(new inquirer.Separator("----------------"));
  templateChoices.push({
    name: t("commands.new.prompts.create_new_template"),
    value: "custom",
  });
  // 템플릿 선택
  const { template } = await inquirer.prompt([
    {
      type: "list",
      name: "template",
      message: t("commands.new.prompts.select_template"),
      choices: templateChoices,
      default: recommendedTemplate,
      pageSize: 15,
    },
  ]);
  if (template === "custom") {
    return await handleCustomTemplateSelection(t, log);
  }
  return template;
}

// 사용자 정의 템플릿 처리 함수 (루트로 이동)
async function handleCustomTemplateSelection(
  t: any,
  log: any,
): Promise<string> {
  try {
    // 사용자 정의 템플릿 목록 가져오기
    const customTemplates = await getAvailableTemplates();
    if (customTemplates.length > 0) {
      // 템플릿 선택 또는 새 템플릿 만들기 옵션 제공
      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: t("commands.new.prompts.custom_template_action"),
          choices: [
            {
              name: t("commands.new.prompts.use_existing_template"),
              value: "use",
            },
            {
              name: t("commands.new.prompts.create_new_template"),
              value: "create",
            },
          ],
        },
      ]);
      if (action === "use") {
        // 기존 템플릿 선택
        const { template } = await inquirer.prompt([
          {
            type: "list",
            name: "template",
            message: t("commands.new.prompts.select_custom_template"),
            choices: customTemplates,
          },
        ]);
        return template;
      }
    }
    // 새 템플릿 생성
    const { newTemplate } = await inquirer.prompt([
      {
        type: "input",
        name: "newTemplate",
        message: t("commands.new.prompts.custom_template_name"),
        validate: (value: string) => value.length > 0,
      },
    ]);
    // 에디터로 템플릿 생성
    log.info(t("commands.new.info.creating_template"));
    // 템플릿 생성 프로세스 실행
    const templateProcess = spawn(
      "autopr",
      ["template", "create", newTemplate],
      {
        stdio: "inherit",
        shell: true,
      },
    );
    return new Promise((resolve) => {
      templateProcess.on("close", (code) => {
        if (code === 0) {
          resolve(newTemplate);
        } else {
          log.warn(t("commands.new.warning.template_create_failed"));
          resolve("feature"); // 실패 시 기본 템플릿 사용
        }
      });
    });
  } catch (error) {
    log.warn(t("commands.new.warning.template_list_failed"));
    // 사용자 정의 템플릿 이름 입력 받기 (기존 방식)
    const { customTemplate } = await inquirer.prompt([
      {
        type: "input",
        name: "customTemplate",
        message: t("commands.new.prompts.custom_template_name"),
        validate: (value: string) => value.length > 0,
      },
    ]);
    return customTemplate;
  }
}

export async function newCommand(): Promise<void> {
  try {
    log.info(
      t("commands.new.auth.why", {
        fallback:
          "이 작업을 위해 GitHub 인증이 필요합니다. 인증하지 않으면 PR 생성 기능을 사용할 수 없습니다.",
      }),
    );
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
    // 브랜치 패턴 매칭 (참고용 제안으로만 사용)
    const foundPattern = await findMatchingPattern(repoInfo.currentBranch);
    const pattern: BranchPattern | undefined =
      foundPattern === null ? undefined : foundPattern;
    const defaultTitle = repoInfo.currentBranch;
    let defaultBody = "";
    let selectedTemplate = "";

    // selectTemplateImproved 함수 호출 시 인자 전달
    selectedTemplate = await selectTemplateImproved(pattern, t, log);

    // 선택된 템플릿으로 PR 본문 생성
    if (pattern && selectedTemplate) {
      const templatePattern = { ...pattern, template: selectedTemplate };
      defaultBody = await generatePRBody(templatePattern);
    } else if (selectedTemplate) {
      // 패턴이 없어도 선택된 템플릿으로 본문 생성
      const dummyPattern: BranchPattern = {
        type: selectedTemplate as any,
        template: selectedTemplate,
        pattern: "",
        draft: false,
        labels: [],
        autoAssignReviewers: false,
        reviewers: [],
        reviewerGroups: [],
      };
      defaultBody = await generatePRBody(dummyPattern);
    }

    // 현재 브랜치 안내
    log.info(
      t("commands.new.info.current_branch", { branch: repoInfo.currentBranch }),
    );

    // 사용자에게 대상 브랜치 선택 요청
    let availableBranches: string[] = [];
    try {
      const { stdout } = await execAsync("git branch -r");
      availableBranches = stdout
        .split("\n")
        .map((b: string) => b.trim().replace("origin/", ""))
        .filter((b: string) => b && !b.includes("HEAD ->"));

      // 로컬 브랜치도 추가
      const { stdout: localBranches } = await execAsync("git branch");
      const localBranchList = localBranches
        .split("\n")
        .map((b: string) => b.trim().replace("* ", ""))
        .filter((b: string) => b && b !== repoInfo.currentBranch);

      // 중복 제거하여 병합
      availableBranches = [
        ...new Set([...availableBranches, ...localBranchList]),
      ];
    } catch (error) {
      log.warn(t("commands.new.warning.branch_list_failed"));
      availableBranches = ["main", "master", "dev", "develop"];
    }

    // 현재 브랜치를 리스트에서 제외
    availableBranches = availableBranches.filter(
      (b) => b !== repoInfo.currentBranch,
    );

    // 사용자에게 대상 브랜치 선택 요청 (메시지에 현재 브랜치명 포함)
    const { baseBranch } = await inquirer.prompt([
      {
        type: "list",
        name: "baseBranch",
        message: t("commands.new.prompts.select_base_branch_with_current", {
          branch: repoInfo.currentBranch,
        }),
        choices: availableBranches,
        default: availableBranches.includes("main")
          ? "main"
          : availableBranches.includes("master")
            ? "master"
            : availableBranches[0],
      },
    ]);

    // === PR 생성 전, origin에 브랜치가 있는지 확인 ===
    const branch = repoInfo.currentBranch;
    let branchExistsOnOrigin = false;
    try {
      const { stdout: remoteBranches } = await execAsync(
        `git ls-remote --heads origin ${branch}`,
      );
      branchExistsOnOrigin = remoteBranches.includes(branch);
    } catch (error) {
      branchExistsOnOrigin = false;
    }
    if (!branchExistsOnOrigin) {
      const { shouldPush } = await inquirer.prompt([
        {
          type: "confirm",
          name: "shouldPush",
          message: t("commands.new.warning.push_branch_prompt"),
          default: true,
        },
      ]);
      if (shouldPush) {
        try {
          await execAsync(`git push --set-upstream origin ${branch}`);
          log.info(t("commands.new.warning.push_branch_success"));
          // push 후 origin 정보 갱신
          await execAsync(`git fetch origin ${branch}`);
        } catch (error) {
          log.warn(
            t("commands.new.warning.push_branch_failed", {
              error: String(error),
            }),
          );
          return;
        }
      } else {
        log.info(t("commands.new.warning.push_branch_cancelled"));
        return;
      }
    } else {
      // origin에 브랜치가 있을 때, 로컬 커밋이 origin에 없는 경우 push 안내
      let localHash = "";
      let remoteHash = "";
      try {
        const { stdout: lh } = await execAsync(`git rev-parse ${branch}`);
        localHash = lh.trim();
      } catch (error) {
        log.debug(
          t("commands.new.debug.debug_local_hash_failed", { branch }),
          error,
        );
      }
      try {
        const { stdout: rh } = await execAsync(
          `git rev-parse origin/${branch}`,
        );
        remoteHash = rh.trim();
      } catch (error) {
        log.debug(
          t("commands.new.debug.debug_remote_hash_failed", { branch }),
          error,
        );
      }
      if (localHash && remoteHash && localHash !== remoteHash) {
        log.info(t("commands.new.warning.push_branch_ahead_notice"));
        return;
      }
    }

    // 변경사항 수집
    const changedFiles = await getChangedFiles(baseBranch);
    const diffContent = await getDiffContent(baseBranch);

    // 변경 시작: 관련 이슈 정보 입력 받기
    let relatedIssues: string[] = [];

    try {
      // GitHub API로 열린 이슈 목록을 가져옵니다
      log.info(t("commands.new.info.fetching_issues_list"));
      const client = await getOctokit();

      try {
        // 페이징 처리를 위한 상태 변수들
        let currentPage = 1;
        let hasMorePages = true;
        const perPage = 10; // 한 번에 표시할 이슈 수 줄임
        const selectedIssuesSet = new Set<string>();

        // 페이징 처리하며 이슈 선택
        while (hasMorePages) {
          const { data: openIssues } = await client.rest.issues.listForRepo({
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            state: "open",
            sort: "updated",
            direction: "desc",
            per_page: perPage,
            page: currentPage,
          });

          // 이슈가 있는 경우
          if (openIssues.length > 0) {
            // 첫 페이지에서만 선택 방식을 물어봅니다
            if (currentPage === 1) {
              const { issueSelectionMethod } = await inquirer.prompt([
                {
                  type: "list",
                  name: "issueSelectionMethod",
                  message: t("commands.new.prompts.related_issues_method"),
                  choices: [
                    {
                      name: t("commands.new.prompts.select_from_list"),
                      value: "list",
                    },
                    {
                      name: t("commands.new.prompts.enter_manually"),
                      value: "manual",
                    },
                  ],
                },
              ]);

              if (issueSelectionMethod === "manual") {
                // 직접 입력하는 경우 페이징 루프 종료
                const { manualIssues } = await inquirer.prompt([
                  {
                    type: "input",
                    name: "manualIssues",
                    message: t("commands.new.prompts.related_issues"),
                    default: "",
                    filter: (value: string) =>
                      value
                        .split(",")
                        .map((issue) => issue.trim().replace("#", ""))
                        .filter(Boolean),
                  },
                ]);

                relatedIssues = manualIssues;
                break; // 페이징 루프 종료
              }
            }

            // 이슈 목록에서 선택하는 경우
            const issueChoices = openIssues.map((issue) => {
              // 이미 선택된 이슈는 표시
              const isSelected = selectedIssuesSet.has(issue.number.toString());
              return {
                name: `${isSelected ? "[✓] " : ""}#${issue.number} - ${issue.title}`,
                value: issue.number.toString(),
                checked: isSelected,
              };
            });

            // 체크박스(이슈 선택) 프롬프트 먼저
            const { selectedIssues } = await inquirer.prompt([
              {
                type: "checkbox",
                name: "selectedIssues",
                message: t("commands.new.prompts.select_related_issues"),
                choices: issueChoices,
              },
            ]);

            // 선택한 이슈들 업데이트
            selectedIssues.forEach((issueNumber: string) => {
              selectedIssuesSet.add(issueNumber);
            });
            // 선택 취소된 이슈들 제거
            openIssues.forEach((issue) => {
              const issueNumber = issue.number.toString();
              if (!selectedIssues.includes(issueNumber)) {
                selectedIssuesSet.delete(issueNumber);
              }
            });

            // 페이지 네비게이션과 완료 옵션 추가
            const navigationChoices = [];

            if (currentPage > 1) {
              navigationChoices.push({
                name: t("commands.new.prompts.previous_page"),
                value: "prev",
              });
            }

            if (openIssues.length === perPage) {
              navigationChoices.push({
                name: t("commands.new.prompts.next_page"),
                value: "next",
              });
            }

            navigationChoices.push({
              name: t("commands.new.prompts.manual_entry"),
              value: "manual",
            });

            navigationChoices.push({
              name: t("commands.new.prompts.finish_selection"),
              value: "finish",
            });

            // 현재 페이지 상태 표시
            log.info(t("commands.new.info.issues_page", { page: currentPage }));

            const { action } = await inquirer.prompt([
              {
                type: "list",
                name: "action",
                message: t("commands.new.prompts.page_navigation"),
                choices: navigationChoices,
              },
            ]);

            if (action === "prev") {
              currentPage--;
              continue;
            } else if (action === "next") {
              currentPage++;
              continue;
            } else if (action === "manual") {
              // 직접 입력
              const { manualIssues } = await inquirer.prompt([
                {
                  type: "input",
                  name: "manualIssues",
                  message: t("commands.new.prompts.related_issues"),
                  default: "",
                  filter: (value: string) =>
                    value
                      .split(",")
                      .map((issue) => issue.trim().replace("#", ""))
                      .filter(Boolean),
                },
              ]);

              // 기존 선택과 합치기
              relatedIssues = [
                ...Array.from(selectedIssuesSet),
                ...manualIssues,
              ];
              break;
            } else if (action === "finish") {
              // 선택 완료
              relatedIssues = Array.from(selectedIssuesSet);
              break;
            }
          } else {
            // 열린 이슈가 없으면 입력 프롬프트 없이 바로 빈 배열 처리
            if (currentPage === 1) {
              log.info(t("commands.new.prompts.no_issues_found"));
              relatedIssues = [];
            }
            hasMorePages = false;
          }
        }
      } catch (error) {
        // API 오류 발생 시 경고 표시 후 직접 입력 받기
        log.warn(t("commands.new.warning.issues_list_failed"));

        const { manualIssues } = await inquirer.prompt([
          {
            type: "input",
            name: "manualIssues",
            message: t("commands.new.prompts.related_issues"),
            default: "",
            filter: (value: string) =>
              value
                .split(",")
                .map((issue) => issue.trim().replace("#", ""))
                .filter(Boolean),
          },
        ]);

        relatedIssues = manualIssues;
      }
    } catch (error) {
      // 그 외 오류가 발생한 경우 기존 방식으로 입력 받기
      const { manualIssues } = await inquirer.prompt([
        {
          type: "input",
          name: "manualIssues",
          message: t("commands.new.prompts.related_issues"),
          default: "",
          filter: (value: string) =>
            value
              .split(",")
              .map((issue) => issue.trim().replace("#", ""))
              .filter(Boolean),
        },
      ]);

      relatedIssues = manualIssues;
    }

    // GitHub API로 이슈 정보 가져오기
    const relatedIssuesData: RelatedIssue[] = [];
    if (relatedIssues.length > 0) {
      log.info(t("commands.new.info.fetching_issues"));
      const client = await getOctokit();

      for (const issueNumber of relatedIssues) {
        try {
          const { data: issue } = await client.rest.issues.get({
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            issue_number: parseInt(issueNumber, 10),
          });

          relatedIssuesData.push({
            id: issue.number,
            title: issue.title,
            url: issue.html_url,
          });
        } catch (error) {
          log.warn(
            t("commands.new.warning.issue_fetch_failed", { issueNumber }),
          );
        }
      }

      if (relatedIssuesData.length > 0) {
        log.info(
          t("commands.new.info.issues_fetched", {
            count: relatedIssuesData.length,
          }),
        );
      }
    }
    // 변경 끝

    // === PR 생성 전, AI로 PR 제목 생성 ===
    log.info(t("commands.new.info.generating_title"));
    let generatedTitle = "";
    try {
      const ai = new AIFeatures(config.language);
      generatedTitle = await ai.generatePRTitle(
        changedFiles,
        diffContent,
        { type: pattern?.type || selectedTemplate },
        config.language,
      );
      log.section(
        t("commands.new.info.generated_title", { title: generatedTitle }),
      );
    } catch (error) {
      log.warn(t("commands.new.warning.ai_title_failed"), error);
    }

    // === PR 생성 전, 제목/리뷰어 입력 프롬프트 ===
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "title",
        message: t("commands.new.prompts.title"),
        default: generatedTitle || defaultTitle,
        validate: (value: string) => value.length > 0,
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

    // === 사용자 인증 토큰이 없으면 PR 생성 스킵, 리뷰만 진행 ===
    const ai = new AIFeatures(config.language);
    if (!config.githubToken || config.githubToken.trim() === "") {
      log.info(
        t("commands.new.auth.why", {
          fallback:
            "이 작업을 위해 GitHub 인증이 필요합니다. 인증하지 않으면 PR 생성 기능을 사용할 수 없습니다.",
        }),
      );
    }
    log.info(t("commands.new.info.ai_initialized"));

    // AI로 PR 본문(통합) 생성
    let generatedPRContent = "";
    try {
      if (!config.githubToken || config.githubToken.trim() === "") {
        log.warn(t("commands.new.warning.no_github_token_for_pr"));
      } else {
        log.info(t("commands.new.info.generating_pr_content"));
        generatedPRContent = await ai.generatePRContent(
          changedFiles,
          diffContent,
          pattern?.type || selectedTemplate,
          {
            relatedIssues: relatedIssuesData,
            language: config.language,
          },
        );
        log.section(t("commands.new.info.generated_pr_content"));
        log.verbose(generatedPRContent);
      }
    } catch (error) {
      log.warn(t("commands.new.warning.ai_pr_content_failed"), error);
    }

    // head 브랜치 참조 형식 수정
    const headBranch = repoInfo.currentBranch;

    // draft PR 사용 가능 여부 확인
    const draftAvailable = await checkDraftPRAvailability({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    });

    let isDraft = pattern?.draft ?? false;
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
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    // PR 본문 설정 (AI 생성)
    const finalBody = generatedPRContent || defaultBody;

    let pr;
    if (existingPRs.data.length > 0) {
      const existingPR = existingPRs.data[0];
      log.info(t("commands.new.info.pr_exists", { number: existingPR.number }));
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
        const newBody = `\n${t("commands.new.pr_update.previous_content")}\n${existingPR.body || t("commands.new.pr_update.no_content")}\n\n${t("commands.new.pr_update.divider")}\n${t("commands.new.pr_update.updated_content")}\n${finalBody}\n`;
        await updatePullRequest({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          pull_number: existingPR.number,
          title: answers.title,
          body: newBody,
        });
        pr = existingPR;
      } else {
        log.info(t("commands.new.success.cancelled"));
        return;
      }
    } else {
      // 새 PR 생성 (유저 토큰 사용)
      pr = await createPullRequest({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        title: answers.title,
        body: finalBody,
        head: headBranch,
        base: baseBranch,
        draft: isDraft,
        token: config.githubToken,
      });
    }

    // 리뷰어 추가
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

    log.info(t("commands.new.info.pr_created_checking_ai_review"));

    // === PR 생성 후, GitHub App(봇) 토큰으로 리뷰 실행 ===
    // GitHub App 설치 토큰 가져오기
    const hasGithubApp = !!config.githubApp?.installationId;
    let botToken: string | undefined = undefined;
    if (hasGithubApp) {
      const { getInstallationToken } = await import("../../core/github-app.js");
      try {
        botToken = await getInstallationToken(config.githubApp.installationId);
        log.info(t("commands.new.info.bot_token_acquired"));
      } catch (error) {
        log.warn(t("commands.new.warning.bot_token_failed"), error);
      }
    }
    const aiBot = new AIFeatures(config.language);
    const fileContents = await getFileContents(changedFiles);

    if (hasGithubApp) {
      // 코드 리뷰 실행 여부 프롬프트
      const { shouldRunCodeReview } = await inquirer.prompt([
        {
          type: "confirm",
          name: "shouldRunCodeReview",
          message: t("commands.new.prompts.run_all_code_reviews"),
          default: true,
        },
      ]);

      if (shouldRunCodeReview) {
        await runCodeReviewAndAddComments({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          pull_number: pr.number,
          files: fileContents,
          ai: aiBot,
          shouldRunPRReview: true,
          shouldRunOverallReview: true,
          shouldRunLineByLineReview: true,
          base_branch: baseBranch,
          prTitle: answers.title,
          diffContent: diffContent,
          language: config.language,
        });
      } else {
        log.info(t("commands.new.info.no_review_comments"));
      }
    } else {
      log.info(t("commands.new.info.github_app_required_for_review"));
    }

    // === 모든 자동화가 끝난 후 PR URL/브라우저 안내 ===
    log.info(t("common.success.pr_created"));
    log.info(`PR URL: ${pr.html_url}`);
    const { openBrowser } = await inquirer.prompt([
      {
        type: "confirm",
        name: "openBrowser",
        message: t("commands.new.prompts.open_browser"),
        default: true,
      },
    ]);
    if (openBrowser) {
      log.info(t("commands.new.info.opening_browser"));
      const command =
        process.platform === "win32"
          ? `start ${pr.html_url}`
          : process.platform === "darwin"
            ? `open ${pr.html_url}`
            : `xdg-open ${pr.html_url}`;
      try {
        await execAsync(command);
      } catch (error) {
        log.warn(t("commands.new.warning.browser_open_failed"));
      }
    }
    return;
  } catch (error) {
    log.error(t("common.error.unknown", { error }));
    process.exit(1);
  }
}
