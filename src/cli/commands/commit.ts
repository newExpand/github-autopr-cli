import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { AIFeatures } from "../../core/ai-features.js";
import { log } from "../../utils/logger.js";
import { exec } from "child_process";
import { promisify } from "util";
import inquirer from "inquirer";

const execAsync = promisify(exec);

interface CommitOptions {
  all?: boolean;
  patch?: boolean;
  push?: boolean;
}

async function stageChanges(options: CommitOptions): Promise<boolean> {
  try {
    if (options.all) {
      await execAsync("git add -A");
      return true;
    } else if (options.patch) {
      // 대화형 패치 모드는 직접 git add -p를 실행하도록 안내
      log.info(t("commands.commit.info.patch_mode"));
      return false;
    }
    return true;
  } catch (error) {
    log.error(t("commands.commit.error.staging_failed"));
    return false;
  }
}

async function getStagedDiff(): Promise<string> {
  try {
    const { stdout } = await execAsync("git diff --staged");
    return stdout;
  } catch (error) {
    log.error(t("commands.commit.error.diff_failed"));
    return "";
  }
}

async function getCurrentCommitMessage(): Promise<string> {
  try {
    const { stdout } = await execAsync("git log -1 --pretty=%B");
    return stdout.trim();
  } catch (error) {
    return "";
  }
}

async function getCurrentBranch(): Promise<string> {
  try {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD");
    return stdout.trim();
  } catch (error) {
    throw new Error(t("commands.commit.error.get_branch_failed"));
  }
}

async function pushToRemote(branch: string): Promise<void> {
  try {
    await execAsync(`git push origin ${branch}`);
    log.info(t("commands.commit.success.pushed", { branch }));
  } catch (error) {
    log.error(t("commands.commit.error.push_failed", { error: String(error) }));
    throw error;
  }
}

export async function commitCommand(
  subcommand?: string,
  message?: string,
  options: CommitOptions = {},
): Promise<void> {
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

    let aiEnabled = false;

    // AI 기능이 설정되어 있는 경우에만 AI 관련 기능 활성화
    if (config.aiConfig?.enabled) {
      try {
        const ai = new AIFeatures();
        aiEnabled = ai.isEnabled();
      } catch (error) {
        aiEnabled = false;
      }
    }

    if (!aiEnabled && subcommand === "improve") {
      log.error(t("ai.error.not_initialized"));
      process.exit(1);
    }

    // -a 옵션이 있으면 자동으로 push 옵션도 활성화
    if (options.all) {
      options.push = true;
    }

    // 변경사항 스테이징
    if (options.all || options.patch) {
      const staged = await stageChanges(options);
      if (!staged && options.patch) {
        log.info(t("commands.commit.info.run_patch_mode"));
        process.exit(0);
      }
    }

    const diffContent = await getStagedDiff();

    if (!diffContent) {
      log.error(t("commands.commit.error.no_staged_changes"));
      process.exit(1);
    }

    let commitMessage = "";
    if (subcommand === "improve") {
      // 기존 메시지 개선
      log.info(t("commands.commit.info.improving_message"));
      const currentMessage = message || (await getCurrentCommitMessage());
      if (!currentMessage) {
        log.error(t("commands.commit.error.no_commit_message"));
        process.exit(1);
      }
      const ai = new AIFeatures();
      commitMessage = await ai.improveCommitMessage(
        currentMessage,
        diffContent,
      );
    } else if (subcommand) {
      // 알 수 없는 서브커맨드
      log.error(t("commands.commit.error.invalid_subcommand"));
      process.exit(1);
    } else if (aiEnabled) {
      // AI 기능이 활성화된 경우: 새로운 메시지 제안
      log.info(t("commands.commit.info.analyzing_changes"));
      const ai = new AIFeatures();
      commitMessage = await ai.improveCommitMessage("", diffContent);
    }

    if (aiEnabled && commitMessage) {
      // 제안된 메시지 표시
      log.info("\n" + t("commands.commit.info.suggested_message"));
      log.info("-------------------");
      log.info(commitMessage);
      log.info("-------------------\n");

      // 사용자 확인
      const { useMessage } = await inquirer.prompt([
        {
          type: "confirm",
          name: "useMessage",
          message: t("commands.commit.prompts.use_message"),
          default: true,
        },
      ]);

      if (!useMessage) {
        // 사용자가 메시지를 수정하고 싶은 경우
        const { editedMessage } = await inquirer.prompt([
          {
            type: "editor",
            name: "editedMessage",
            message: t("commands.commit.prompts.edit_message"),
            default: commitMessage,
          },
        ]);
        commitMessage = editedMessage;
      }
    } else {
      // AI가 비활성화되어 있거나 메시지 생성에 실패한 경우: 직접 입력
      const { editedMessage } = await inquirer.prompt([
        {
          type: "editor",
          name: "editedMessage",
          message: t("commands.commit.prompts.edit_message"),
        },
      ]);
      commitMessage = editedMessage;
    }

    // 커밋 실행
    try {
      await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
      log.info(t("commands.commit.success.committed"));

      // push 옵션이 활성화된 경우 자동으로 push 실행
      if (options.push) {
        const currentBranch = await getCurrentBranch();
        await pushToRemote(currentBranch);
      }
    } catch (error) {
      log.error(t("commands.commit.error.commit_failed"), error);
      process.exit(1);
    }
  } catch (error) {
    log.error(t("common.error.unknown"), error);
    process.exit(1);
  }
}
