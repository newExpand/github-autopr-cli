import { Command } from "commander";
import { createAutoPR } from "../../core/branch-pattern.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { t } from "../../i18n/index.js";
import { exec } from "child_process";
import { promisify } from "util";
import { log } from "../../utils/logger.js";
import { loadConfig } from "../../core/config.js";

const execAsync = promisify(exec);

// 원격 브랜치 존재 여부 확인
async function checkRemoteBranchExists(branch: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `git ls-remote --heads origin ${branch}`,
    );
    return stdout.trim() !== "";
  } catch (error) {
    return false;
  }
}

export function createHookCommand(): Command {
  const hookCommand = new Command("hook").description(
    t("commands.hook.description"),
  );

  hookCommand
    .command("post-checkout")
    .description(t("commands.hook.post_checkout.description"))
    .argument("<branch>", t("commands.hook.post_checkout.argument.branch"))
    .action(async (branch: string) => {
      try {
        // 설정 로드
        const config = await loadConfig();
        if (!config) {
          log.error(t("common.error.config_load_failed"));
          return;
        }

        // 보호된 브랜치(production/development)로의 체크아웃은 무시
        if (
          branch === config.defaultBranch ||
          branch === config.developmentBranch
        ) {
          return;
        }

        // merge 명령어에서의 브랜치 전환인 경우 무시
        const stackTrace = new Error().stack || "";
        if (stackTrace.includes("mergeCommand")) {
          return;
        }

        // 현재 저장소 정보 확인
        const repoInfo = await getCurrentRepoInfo();
        if (!repoInfo) {
          log.error(t("common.error.not_git_repo"));
          return;
        }

        // 원격 브랜치 존재 여부 확인
        const remoteBranchExists = await checkRemoteBranchExists(branch);

        if (!remoteBranchExists) {
          log.info(t("commands.hook.post_checkout.info.new_branch"));
          log.info(
            t("commands.hook.post_checkout.info.push_instruction", { branch }),
          );
          log.info(t("commands.hook.post_checkout.info.auto_pr"));
          return;
        }

        // 기존 브랜치의 경우 PR 생성 시도
        await createAutoPR(branch);
        log.info(t("commands.hook.post_checkout.info.draft_created"));
      } catch (error) {
        // Git 훅에서는 에러가 발생해도 프로세스를 중단하지 않음
        log.error(t("common.error.unknown"), error);
      }
    });

  return hookCommand;
}
