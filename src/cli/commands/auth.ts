import { setupGitHubAppCredentials } from "../../core/github-app.js";
import { t } from "../../i18n/index.js";
import { log } from "../../utils/logger.js";

export async function authGithubAppCommand() {
  try {
    await setupGitHubAppCredentials();
    log.info(t("commands.auth.github_app.success"));
  } catch (error) {
    log.error(t("commands.auth.github_app.failed", { error: String(error) }));
    process.exit(1);
  }
}
