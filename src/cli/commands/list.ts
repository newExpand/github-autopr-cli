import inquirer from "inquirer";
import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import { listPullRequests, getPullRequestStatus } from "../../core/github.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { log } from "../../utils/logger.js";
import { promisify } from "util";
import { exec } from "child_process";

// Create promisified exec function
const execAsync = promisify(exec);

export async function listCommand(): Promise<void> {
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

    // PR 상태 선택 프롬프트 추가
    const { prState } = await inquirer.prompt([
      {
        type: "list",
        name: "prState",
        message:
          t("commands.list.prompts.select_state") ||
          "Select PR state to display:",
        choices: [
          { name: t("commands.list.states.open") || "Open", value: "open" },
          {
            name: t("commands.list.states.closed") || "Closed",
            value: "closed",
          },
          { name: t("commands.list.states.all") || "All", value: "all" },
        ],
        default: "open",
      },
    ]);

    // PR 표시 개수 선택 (닫힌 PR이 많을 경우를 위해)
    const { prCount } = await inquirer.prompt([
      {
        type: "list",
        name: "prCount",
        message:
          t("commands.list.prompts.select_count") ||
          "How many PRs do you want to see?",
        choices: [
          { name: "10", value: 10 },
          { name: "20", value: 20 },
          { name: "30", value: 30 },
          { name: "50", value: 50 },
        ],
        default: 10,
      },
    ]);

    // 페이지 번호 (기본값 1)
    let currentPage = 1;
    let prs = [];
    let hasMore = false;

    // PR 목록 가져오기
    prs = await listPullRequests({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      state: prState,
      per_page: prCount,
      page: currentPage,
    });

    // 결과가 요청한 개수와 같으면 더 있을 수 있음
    hasMore = prs.length === prCount;

    if (prs.length === 0) {
      log.info(t("commands.list.no_prs"));

      // PR이 없을 때 사용자에게 다른 상태로 확인할지 물어봄
      const { tryAnotherState } = await inquirer.prompt([
        {
          type: "confirm",
          name: "tryAnotherState",
          message:
            t("commands.list.prompts.try_another_state") ||
            "No PRs found with this state. Would you like to try another state?",
          default: true,
        },
      ]);

      if (tryAnotherState) {
        // 재귀 호출로 처음부터 다시 시작
        return listCommand();
      }
      return;
    }

    const stateText =
      prState === "open"
        ? t("commands.list.open_prs")
        : prState === "closed"
          ? t("commands.list.closed_prs")
          : t("commands.list.all_prs");

    log.info(stateText);

    // Display PRs with numbers
    for (let i = 0; i < prs.length; i++) {
      const pr = prs[i];
      const stateIcon = pr.state === "open" ? "🟢" : pr.merged ? "🟣" : "🔴";

      log.info(`${i + 1}. ${stateIcon} #${pr.number} ${pr.title}`);
      log.verbose(t("commands.list.author", { login: pr.user.login }));
      log.verbose(
        t("commands.list.status", {
          status: pr.draft
            ? t("commands.list.status.draft")
            : t("commands.list.status.ready"),
        }),
      );

      // 오픈 상태인 PR에 대해서만 병합 상태 확인
      if (pr.state === "open") {
        const status = await getPullRequestStatus({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          pull_number: pr.number,
        });

        const statusText =
          status === "CHECKING"
            ? t("commands.list.status.checking")
            : status === "CONFLICTING"
              ? t("commands.list.status.conflicting")
              : status === "MERGEABLE"
                ? t("commands.list.status.mergeable")
                : t("commands.list.status.unknown");

        log.info(
          `   ${t("commands.list.merge_status", { status: statusText })}`,
        );
      } else {
        // 닫힌 PR의 경우 병합 여부 표시
        const stateText = pr.merged
          ? t("commands.list.states.merged")
          : t("commands.list.states.closed");
        log.info(`   ${t("commands.list.state", { state: stateText })}`);

        // 병합된 PR에는 병합됨 태그 추가, 그냥 닫힌 PR에는 닫힘 태그 추가
        if (pr.merged) {
          log.info(`   ${t("commands.list.merged_info")}`);
        }
      }

      log.verbose(t("commands.list.url", { url: pr.html_url }));
      log.verbose("---");
    }

    // 더 많은 PR이 있을 수 있는 경우 로드 옵션 제공
    if (hasMore) {
      const { loadMore } = await inquirer.prompt([
        {
          type: "confirm",
          name: "loadMore",
          message:
            t("commands.list.prompts.load_more") ||
            "There might be more PRs. Load more?",
          default: false,
        },
      ]);

      if (loadMore) {
        // 더 많은 PR을 계속 로드할 수 있도록 반복문 사용
        let continueLoading = true;

        while (continueLoading) {
          currentPage++;
          log.info(t("commands.list.loading_more", { page: currentPage }));

          const morePrs = await listPullRequests({
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            state: prState,
            per_page: prCount,
            page: currentPage,
          });

          if (morePrs.length > 0) {
            // 추가 PR 표시
            for (let i = 0; i < morePrs.length; i++) {
              const pr = morePrs[i];
              const stateIcon =
                pr.state === "open" ? "🟢" : pr.merged ? "🟣" : "🔴";

              const index = prs.length + i + 1;
              log.info(`${index}. ${stateIcon} #${pr.number} ${pr.title}`);

              // 닫힌 PR의 경우 병합 여부 표시
              if (pr.state !== "open") {
                const stateText = pr.merged
                  ? t("commands.list.states.merged")
                  : t("commands.list.states.closed");
                log.info(
                  `   ${t("commands.list.state", { state: stateText })}`,
                );

                // 병합된 PR에는 병합됨 태그 추가
                if (pr.merged) {
                  log.info(`   ${t("commands.list.merged_info")}`);
                }
              }
            }

            // 목록에 추가
            prs = [...prs, ...morePrs];

            // 더 불러올 PR이 있는지 확인
            const mightHaveMore = morePrs.length === prCount;

            // 더 많은 PR이 있을 수 있고, 이미 너무 많이 로드하지 않았으면 더 로드할지 물어봄
            if (mightHaveMore) {
              if (currentPage >= 10) {
                log.info(t("commands.list.max_pages_reached"));
                continueLoading = false;
              } else {
                // 최대 10페이지까지만 허용
                const { loadMoreAgain } = await inquirer.prompt([
                  {
                    type: "confirm",
                    name: "loadMoreAgain",
                    message: t("commands.list.prompts.load_more_again"),
                    default: false,
                  },
                ]);

                continueLoading = loadMoreAgain;
              }
            } else {
              log.info(t("commands.list.no_more_prs"));
              continueLoading = false;
            }
          } else {
            log.info(t("commands.list.no_more_prs"));
            continueLoading = false;
          }
        }
      }
    }

    // Ask if user wants to select a PR
    const { wantToSelect } = await inquirer.prompt([
      {
        type: "confirm",
        name: "wantToSelect",
        message:
          t("commands.list.prompts.want_to_select") ||
          "Would you like to select a PR for an action?",
        default: false,
      },
    ]);

    if (!wantToSelect) {
      return;
    }

    // Let user select a PR
    const { selectedPrIndex } = await inquirer.prompt([
      {
        type: "list",
        name: "selectedPrIndex",
        message: t("commands.list.prompts.select_pr") || "Select a PR:",
        choices: prs.map((pr, index) => ({
          name: `#${pr.number} ${pr.title}`,
          value: index,
        })),
      },
    ]);

    const selectedPr = prs[selectedPrIndex];

    // 디버깅을 위해 선택된 PR 정보와 액션 출력
    log.debug(
      `선택된 PR: #${selectedPr.number}, 상태: ${selectedPr.state}, 병합됨: ${selectedPr.merged ? "예" : "아니오"}`,
    );

    // 선택된 PR이 닫혀있는 경우 가능한 작업이 다름
    const isOpenPr = selectedPr.state === "open";

    // Ask for action
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message:
          t("commands.list.prompts.action") ||
          "What would you like to do with this PR?",
        choices: [
          ...(isOpenPr
            ? [
                {
                  name: t("commands.list.actions.review") || "Review",
                  value: "review",
                },
                {
                  name: t("commands.list.actions.merge") || "Merge",
                  value: "merge",
                },
                {
                  name: t("commands.list.actions.update") || "Update",
                  value: "update",
                },
              ]
            : []),
          {
            name: t("commands.list.actions.reopen") || "Reopen",
            value: "reopen",
            disabled: isOpenPr || selectedPr.merged,
          },
          {
            name: t("commands.list.actions.open") || "Open in Browser",
            value: "open",
          },
          {
            name: t("commands.list.actions.cancel") || "Cancel",
            value: "cancel",
          },
        ],
      },
    ]);

    log.debug(`선택된 작업: ${action}`);

    // Execute the selected action
    switch (action) {
      case "review":
        await execAsync(`autopr review ${selectedPr.number}`);
        break;
      case "merge":
        await execAsync(`autopr merge ${selectedPr.number}`);
        break;
      case "update":
        await execAsync(`autopr update ${selectedPr.number}`);
        break;
      case "reopen":
        // 병합된 PR인 경우 즉시 에러 메시지 표시
        if (selectedPr.merged === true) {
          log.error(t("commands.reopen.error.merged"));
        } else {
          await execAsync(`autopr reopen ${selectedPr.number}`);
        }
        break;
      case "open":
        try {
          await execAsync(`open ${selectedPr.html_url}`);
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
        log.info(t("commands.list.success.cancelled"));
        break;
    }
  } catch (error) {
    log.error(t("common.error.unknown"), error);
    process.exit(1);
  }
}
