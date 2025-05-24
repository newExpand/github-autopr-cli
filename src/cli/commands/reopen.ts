import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import { getPullRequest, updatePullRequest } from "../../core/github.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { log } from "../../utils/logger.js";

export async function reopenCommand(prNumber: string): Promise<void> {
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

    // PR 정보 가져오기
    const pr = await getPullRequest({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      pull_number: parseInt(prNumber, 10),
    });

    // PR이 이미 열려있는 경우
    if (pr.state === "open") {
      log.info(t("commands.reopen.error.already_open"));
      return;
    }

    // PR이 병합된 경우
    if (pr.merged) {
      log.error(t("commands.reopen.error.merged"));
      return;
    }

    // PR 다시 열기
    try {
      await updatePullRequest({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        pull_number: pr.number,
        state: "open",
      });

      log.info(t("commands.reopen.success.reopened", { number: pr.number }));
    } catch (error: any) {
      if (error.message?.includes("state cannot be changed")) {
        log.error(t("commands.reopen.error.cannot_reopen"));
      } else {
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      log.error(error.message);
    } else {
      log.error(t("common.error.unknown", { error }));
    }
    process.exit(1);
  }
}
