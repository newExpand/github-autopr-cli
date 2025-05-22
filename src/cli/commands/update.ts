import inquirer from "inquirer";
import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import { getPullRequest, updatePullRequest } from "../../core/github.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { log } from "../../utils/logger.js";

export async function updateCommand(prNumber: string): Promise<void> {
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

    log.info("\n" + t("commands.update.info.title"));
    log.info(`#${pr.number} ${pr.title}`);
    const currentStatus = pr.draft ? "draft" : "ready";
    log.info(
      t("commands.update.info.current_status", {
        status: t(`commands.update.status.${currentStatus}`),
      }),
    );

    const { actions } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "actions",
        message: t("commands.update.prompts.action"),
        choices: [
          { name: t("commands.update.actions.title"), value: "title" },
          { name: t("commands.update.actions.body"), value: "body" },
          { name: t("commands.update.actions.status"), value: "status" },
        ],
      },
    ]);

    if (actions.length === 0) {
      log.info(t("commands.update.success.cancelled"));
      return;
    }

    const baseUpdates = {
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      pull_number: pr.number,
    };

    const updates: any = { ...baseUpdates };

    for (const action of actions) {
      switch (action) {
        case "title": {
          const { title } = await inquirer.prompt([
            {
              type: "input",
              name: "title",
              message: t("commands.update.prompts.new_title"),
              default: pr.title,
            },
          ]);
          updates.title = title;
          break;
        }

        case "body": {
          const { body } = await inquirer.prompt([
            {
              type: "editor",
              name: "body",
              message: t("commands.update.prompts.new_body"),
              default: pr.body || "",
            },
          ]);
          updates.body = body;
          break;
        }

        case "status": {
          const { status } = await inquirer.prompt([
            {
              type: "list",
              name: "status",
              message: t("commands.update.prompts.new_status"),
              choices: [
                { name: t("commands.update.status.draft"), value: "draft" },
                { name: t("commands.update.status.ready"), value: "ready" },
              ],
              default: pr.draft ? "draft" : "ready",
            },
          ]);

          updates.draft = status === "draft";
          log.info(
            `상태를 ${status === "draft" ? "초안" : "리뷰 준비됨"}으로 변경합니다...`,
          );
          log.info(`API 요청 데이터: ${JSON.stringify(updates, null, 2)}`);
          break;
        }
      }
    }

    try {
      const _updatedPr = await updatePullRequest(updates);
      log.info(t("commands.update.success.all"));

      // 상태가 변경된 경우 약간의 지연 후 최신 상태 확인
      if (updates.draft !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const finalPr = await getPullRequest({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          pull_number: parseInt(prNumber, 10),
        });

        const newStatus = finalPr.draft ? "draft" : "ready";
        log.info(
          t("commands.update.info.current_status", {
            status: t(`commands.update.status.${newStatus}`),
          }),
        );
      }
    } catch (updateError: any) {
      log.error("Update failed:", updateError.message);
      if (updateError.response) {
        log.error(
          "API Response:",
          JSON.stringify(updateError.response.data, null, 2),
        );
      }
      process.exit(1);
    }
  } catch (error: any) {
    log.error(t("common.error.unknown", { error }));
    if (error.response) {
      log.error("API Response:", JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}
