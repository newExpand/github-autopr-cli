import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import { listPullRequests, getPullRequestStatus } from "../../core/github.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { log } from "../../utils/logger.js";

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

    const prs = await listPullRequests({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      state: "open",
    });

    if (prs.length === 0) {
      log.info(t("commands.list.no_prs"));
      return;
    }

    log.info(t("commands.list.open_prs"));
    for (const pr of prs) {
      log.info(
        t("commands.list.pr_number_title", {
          number: pr.number,
          title: pr.title,
        }),
      );
      log.verbose(t("commands.list.author", { login: pr.user.login }));
      log.verbose(
        t("commands.list.status", {
          status: pr.draft
            ? t("commands.review.status.draft")
            : t("commands.review.status.ready"),
        }),
      );

      const status = await getPullRequestStatus({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        pull_number: pr.number,
      });

      const statusText =
        status === "CHECKING"
          ? t("commands.review.status.checking")
          : status === "CONFLICTING"
            ? t("commands.review.status.conflicting")
            : status === "MERGEABLE"
              ? t("commands.review.status.mergeable")
              : t("commands.review.status.unknown");

      log.info(t("commands.list.merge_status", { status: statusText }));
      log.verbose(t("commands.list.url", { url: pr.html_url }));
      log.verbose("---");
    }
  } catch (error) {
    log.error(t("common.error.unknown"), error);
    process.exit(1);
  }
}
