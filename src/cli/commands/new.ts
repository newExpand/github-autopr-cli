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
  generatePRTitle,
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
  shouldRunOverallReview: boolean;
  shouldRunLineByLineReview: boolean;
  shouldRunPRReview?: boolean; // PR 리뷰 실행 여부
  prTitle?: string; // PR 제목
  prDescription?: string; // PR 설명
  diffContent?: string; // PR diff 내용
  base_branch?: string;
  base?: string;
}): Promise<void> {
  try {
    // 파일이 없는 경우 빠르게 종료
    if (params.files.length === 0) {
      log.warn(t("commands.new.warning.no_files_for_review"));
      return;
    }

    // 병렬로 실행할 리뷰 작업들을 배열로 준비
    const reviewTasks: Promise<any>[] = [];
    const reviewResults: {
      overallReview: string;
      prReview: string;
      lineComments: Array<{
        file: string;
        line: number;
        comment: string;
        severity?: "info" | "warning" | "error";
      }>;
    } = {
      overallReview: "",
      prReview: "",
      lineComments: [],
    };

    // PR 리뷰 실행 준비
    if (params.shouldRunPRReview && params.prTitle && params.diffContent) {
      log.info(t("commands.new.info.running_pr_review"));

      const prReviewTask = (async () => {
        try {
          // PR 컨텍스트 구성
          const prContext = {
            prNumber: params.pull_number,
            title: params.prTitle as string,
            changedFiles: params.files.map((file) => ({
              path: file.path,
              content: file.content,
            })),
            diffContent: params.diffContent as string,
            // 선택적 GitHub API 연동 정보
            repoOwner: params.owner,
            repoName: params.repo,
          };

          reviewResults.prReview = await params.ai.reviewPR(prContext);
          log.info(t("commands.new.info.pr_review_completed"));
        } catch (error) {
          // 오류 메시지를 더 자세하게 출력
          log.warn(
            t("commands.new.warning.code_review_failed"),
            JSON.stringify(error, null, 2),
          );
        }
      })();

      reviewTasks.push(prReviewTask);
    }

    // 전체 코드 리뷰 실행 준비
    if (params.shouldRunOverallReview) {
      log.info(t("commands.new.info.running_code_review"));

      const codeReviewTask = (async () => {
        try {
          reviewResults.overallReview = await params.ai.reviewCode(
            params.files,
          );
          log.info(t("commands.new.info.code_review_completed"));
        } catch (error) {
          log.warn(t("commands.new.warning.code_review_failed"), error);
        }
      })();

      reviewTasks.push(codeReviewTask);
    }

    // 라인별 코드 리뷰 실행 준비
    if (params.shouldRunLineByLineReview) {
      log.info(t("commands.new.info.running_line_by_line_review"));
      log.info(t("commands.new.info.pr_analysis_info"));

      const lineReviewTask = (async () => {
        try {
          // PR 컨텍스트 정보 전달
          const comments = await params.ai.lineByLineCodeReview(
            params.files,
            {
              owner: params.owner,
              repo: params.repo,
              pull_number: params.pull_number,
              baseBranch: params.base_branch || params.base || "main",
            },
            // 한국어로 설정 (국제화가 필요한 경우 config에서 가져오도록 수정)
            "ko",
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

    // 모든 리뷰 작업을 병렬로 실행하고 완료될 때까지 대기
    await Promise.all(reviewTasks);

    // 코드 리뷰, PR 리뷰, 라인별 코멘트가 있는 경우에만 PR 리뷰 생성
    if (
      reviewResults.overallReview ||
      reviewResults.prReview ||
      reviewResults.lineComments.length > 0
    ) {
      log.info(t("commands.new.info.adding_code_review"));

      // 리뷰 코멘트 준비
      const reviewComments = [];

      // 라인별 코멘트가 있는 경우 GitHub API에 맞게 변환
      if (reviewResults.lineComments.length > 0) {
        // 각 코멘트에 대한 diff 정보 조회도 병렬로 처리
        const commentTasks = reviewResults.lineComments.map(async (comment) => {
          try {
            // 파일의 diff 정보를 가져와 정확한 라인 번호 매핑
            const diffInfo = await getPullRequestFileDiff({
              owner: params.owner,
              repo: params.repo,
              pull_number: params.pull_number,
              file_path: comment.file,
            });

            // 코멘트를 달 라인 찾기 (추가된 라인이나 변경되지 않은 라인에만 코멘트 가능)
            // 파일의 전체 내용 라인 번호와 diff에서의 라인 번호가 일치하는지 확인
            const lineInfo = diffInfo.changes.find(
              (change) =>
                change.newLineNumber === comment.line &&
                (change.type === "added" || change.type === "unchanged"),
            );

            if (lineInfo && lineInfo.newLineNumber) {
              // 심각도에 따라 이모지 추가
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
              // diff에서 해당 라인을 찾지 못한 경우 (PR에 포함되지 않은 파일의 라인)
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

        // 모든 코멘트 처리가 완료될 때까지 대기하고 유효한 코멘트만 필터링
        const commentResults = await Promise.all(commentTasks);
        reviewComments.push(
          ...commentResults.filter((comment) => comment !== null),
        );
      }

      // 코드 리뷰 결과를 PR에 코멘트로 추가
      try {
        let finalReviewBody = "";

        // PR 리뷰가 있으면 추가
        if (reviewResults.prReview) {
          finalReviewBody += `## PR 리뷰\n\n${reviewResults.prReview}\n\n`;
        }

        // 코드 리뷰가 있으면 추가
        if (reviewResults.overallReview) {
          finalReviewBody += `## 코드 리뷰\n\n${reviewResults.overallReview}`;
        }

        // 아무 리뷰도 없으면 기본 메시지
        if (!finalReviewBody) {
          finalReviewBody = "코드 리뷰가 완료되었습니다.";
        }

        await createPullRequestReview({
          owner: params.owner,
          repo: params.repo,
          pull_number: params.pull_number,
          body: finalReviewBody,
          event: "COMMENT",
          comments: reviewComments,
        });

        log.info(t("commands.new.success.code_review_added"));
      } catch (error) {
        log.warn(t("commands.new.warning.code_review_add_failed"), error);
      }
    } else {
      log.info(t("commands.new.info.no_review_comments"));
    }
  } catch (error) {
    log.warn(t("commands.new.warning.code_review_add_failed"), error);
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

    // 브랜치 패턴 매칭 (참고용 제안으로만 사용)
    const pattern = await findMatchingPattern(repoInfo.currentBranch);

    let defaultTitle = repoInfo.currentBranch;
    let defaultBody = "";
    let generatedTitle = "";
    let selectedTemplate = "";

    // 템플릿 제안 및 선택 개선
    async function selectTemplateImproved(): Promise<string> {
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
        return await handleCustomTemplateSelection();
      }

      return template;
    }

    // 브랜치 패턴에서 제목 제안 가져오기
    if (pattern) {
      defaultTitle = await generatePRTitle(repoInfo.currentBranch, pattern);
      log.info(t("commands.new.info.suggested_title", { title: defaultTitle }));
    }

    // 템플릿 선택
    selectedTemplate = await selectTemplateImproved();

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

    // 사용자 정의 템플릿 처리 함수
    async function handleCustomTemplateSelection(): Promise<string> {
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

    // 사용 가능한 브랜치 목록 가져오기
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

    // 사용자에게 대상 브랜치 선택 요청
    const { baseBranch } = await inquirer.prompt([
      {
        type: "list",
        name: "baseBranch",
        message: t("commands.new.prompts.select_base_branch"),
        choices: availableBranches,
        default: availableBranches.includes("main")
          ? "main"
          : availableBranches.includes("master")
            ? "master"
            : availableBranches[0],
      },
    ]);

    // 변경사항 수집
    const changedFiles = await getChangedFiles(baseBranch);
    const diffContent = await getDiffContent(baseBranch);

    let generatedDescription = "";
    let ai: AIFeatures | null = null;
    let shouldRunCodeReview = false;
    let shouldRunLineByLineReview = false;
    let shouldRunPRReview = false;

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
        let selectedIssuesSet = new Set<string>();

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

            // 현재 페이지에서 이슈 선택
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
          } else {
            // 이슈가 없는 경우
            if (currentPage === 1) {
              log.info(t("commands.new.prompts.no_issues_found"));
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

    // AI 인스턴스 생성
    try {
      ai = new AIFeatures();
      log.info(t("commands.new.info.ai_initialized"));

      // AI로 PR 제목 생성
      try {
        log.info(t("commands.new.info.generating_title"));
        generatedTitle = await ai.generatePRTitle(
          changedFiles,
          diffContent,
          pattern || { type: selectedTemplate as any },
        );
        log.section(t("commands.new.info.generated_title", { title: "" }));
        log.verbose(generatedTitle);
        defaultTitle = generatedTitle || defaultTitle;
      } catch (error) {
        log.warn(t("commands.new.warning.ai_title_failed"), error);
        log.debug(t("commands.new.info.ai_title_error"), error);
      }

      log.info(t("commands.new.info.generating_description"));
      // 변경 시작: AI에게 템플릿과 함께 관련 이슈 정보도 전달
      generatedDescription = await ai.generatePRDescription(
        changedFiles,
        diffContent,
        {
          template: defaultBody,
          relatedIssues: relatedIssuesData,
        },
      );
      // 변경 끝

      // AI가 생성한 설명 표시
      log.section(t("commands.new.info.generated_description"));
      log.section(t("commands.new.ui.section_divider"));
      log.verbose(generatedDescription);
      log.section(t("commands.new.ui.section_divider"));
    } catch (error) {
      log.warn(t("commands.new.warning.ai_initialization_failed"), error);
      ai = null;
    }

    // 코드 리뷰 실행 여부 물어보기
    const { runCodeReview } = ai
      ? await inquirer.prompt([
          {
            type: "confirm",
            name: "runCodeReview",
            message: t("commands.new.prompts.run_all_code_reviews"),
            default: true,
          },
        ])
      : { runCodeReview: false };

    // 코드 리뷰 실행이 선택되면 모든 리뷰 유형을 실행
    if (runCodeReview) {
      shouldRunCodeReview = true; // 전체 코드 리뷰
      shouldRunLineByLineReview = true; // 라인별 리뷰
      shouldRunPRReview = true; // PR 전체 리뷰

      // 사용자에게 어떤 리뷰가 실행될지 안내
      log.info(t("commands.new.info.running_all_reviews"));
    } else {
      shouldRunCodeReview = false;
      shouldRunLineByLineReview = false;
      shouldRunPRReview = false;
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
        when: () => !!ai && !!generatedDescription,
      },
      {
        type: "confirm",
        name: "editAIDescription",
        message: t("commands.new.prompts.edit_ai_description"),
        default: false,
        when: (answers) =>
          !!ai && !!generatedDescription && answers.useAIDescription,
      },
      {
        type: "editor",
        name: "body",
        message: t("commands.new.prompts.body"),
        default: (answers) => {
          if (ai && generatedDescription && answers.useAIDescription) {
            return answers.editAIDescription ? generatedDescription : undefined;
          }
          return defaultBody;
        },
        when: (answers) =>
          !ai ||
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

      // PR 본문 설정 (AI 생성 또는 사용자 입력)
      const finalBody = answers.useAIDescription
        ? generatedDescription
        : answers.body || "";

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
${t("commands.new.pr_update.previous_content")}
${existingPR.body || t("commands.new.pr_update.no_content")}

${t("commands.new.pr_update.divider")}
${t("commands.new.pr_update.updated_content")}
${finalBody}
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

          // 기존 PR에 코드 리뷰 추가
          if (ai && runCodeReview) {
            const fileContents = await getFileContents(changedFiles);

            if (fileContents.length > 0) {
              log.info(t("commands.new.info.adding_code_review_to_pr"));

              await runCodeReviewAndAddComments({
                owner: repoInfo.owner,
                repo: repoInfo.repo,
                pull_number: existingPR.number,
                files: fileContents,
                ai,
                shouldRunOverallReview: shouldRunCodeReview,
                shouldRunLineByLineReview: shouldRunLineByLineReview,
                shouldRunPRReview: shouldRunPRReview,
                prTitle: answers.title,
                prDescription: finalBody,
                diffContent: diffContent,
                base_branch: baseBranch,
              });
            } else {
              log.warn(t("commands.new.warning.no_files_for_review"));
            }
          }

          return;
        } else {
          log.info(t("commands.new.success.cancelled"));
          return;
        }
      }

      // 새 PR 생성
      const pr = await createPullRequest({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        title: answers.title,
        body: finalBody,
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

      // PR이 생성된 후 코드 리뷰를 실행
      if (ai && runCodeReview) {
        const fileContents = await getFileContents(changedFiles);

        if (fileContents.length > 0) {
          log.info(t("commands.new.info.adding_code_review_to_pr"));

          await runCodeReviewAndAddComments({
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            pull_number: pr.number,
            files: fileContents,
            ai,
            shouldRunOverallReview: shouldRunCodeReview,
            shouldRunLineByLineReview: shouldRunLineByLineReview,
            shouldRunPRReview: shouldRunPRReview,
            prTitle: answers.title,
            prDescription: finalBody,
            diffContent: diffContent,
            base_branch: baseBranch,
          });
        } else {
          log.warn(t("commands.new.warning.no_files_for_review"));
        }
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
    log.error(t("common.error.unknown"), error);
    process.exit(1);
  }
}
