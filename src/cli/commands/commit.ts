import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import { getCurrentRepoInfo, getAllBranches } from "../../utils/git.js";
import { AIFeatures } from "../../core/ai-features.js";
import { log } from "../../utils/logger.js";
import { exec } from "child_process";
import { promisify } from "util";
import inquirer from "inquirer";
import { createAutoPR } from "../../core/branch-pattern.js";
import { getOctokit } from "../../core/github.js";

const execAsync = promisify(exec);

interface CommitOptions {
  all?: boolean;
  patch?: boolean;
  push?: boolean;
  select?: boolean;
  selectPush?: boolean;
}

// 브랜치 전략 관련 인터페이스 추가
interface BranchStrategy {
  developmentBranch: string; // 개발 브랜치 (e.g., 'dev', 'develop', 'staging')
  productionBranch: string; // 프로덕션 브랜치 (e.g., 'main', 'master', 'production')
  releasePRTitle: string; // 릴리스 PR 제목 템플릿
  releasePRBody: string; // 릴리스 PR 본문 템플릿
}

// 기본 브랜치 전략
const DEFAULT_BRANCH_STRATEGY: BranchStrategy = {
  developmentBranch: "dev",
  productionBranch: "main",
  releasePRTitle: "Release: {development} to {production}",
  releasePRBody: "Merge {development} branch into {production} for release",
};

// 설정에서 브랜치 전략 가져오기
function getBranchStrategy(config: any): BranchStrategy {
  const strategy = {
    developmentBranch:
      config.developmentBranch || DEFAULT_BRANCH_STRATEGY.developmentBranch,
    productionBranch:
      config.defaultBranch || DEFAULT_BRANCH_STRATEGY.productionBranch,
    releasePRTitle:
      config.releasePRTitle || DEFAULT_BRANCH_STRATEGY.releasePRTitle,
    releasePRBody:
      config.releasePRBody || DEFAULT_BRANCH_STRATEGY.releasePRBody,
  };

  // 템플릿의 플레이스홀더 치환
  strategy.releasePRTitle = strategy.releasePRTitle
    .replace("{development}", strategy.developmentBranch)
    .replace("{production}", strategy.productionBranch);

  strategy.releasePRBody = strategy.releasePRBody
    .replace("{development}", strategy.developmentBranch)
    .replace("{production}", strategy.productionBranch);

  return strategy;
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
    } else if (options.select) {
      // 파일 선택 모드는 selectFilesToStage 함수에서 처리
      return true;
    }
    return true;
  } catch (error) {
    log.error(t("commands.commit.error.staging_failed"));
    return false;
  }
}

// 변경된 파일 목록 가져오기 (스테이징되지 않은 파일 포함)
async function getUnstagedFiles(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("git status --porcelain");
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const status = line.substring(0, 2);
        const file = line.substring(3);
        // 스테이징되지 않은 파일만 반환 (첫 번째 열이 M, A, D, R, C 등이고 두 번째 열이 공백이 아닌 경우)
        if (status[1] !== " " && status[1] !== "?") {
          return file;
        }
        // 새로 추가된 파일 (Untracked)
        if (status[0] === "?" && status[1] === "?") {
          return file;
        }
        return null;
      })
      .filter(Boolean) as string[];
  } catch (error) {
    log.error(t("commands.commit.error.files_failed"));
    return [];
  }
}

// 사용자가 선택한 파일을 스테이징
async function selectFilesToStage(): Promise<boolean> {
  try {
    const unstagedFiles = await getUnstagedFiles();

    if (unstagedFiles.length === 0) {
      log.info(t("commands.commit.info.no_unstaged_files"));
      return false;
    }

    const { selectedFiles } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "selectedFiles",
        message: t("commands.commit.prompts.select_files"),
        choices: unstagedFiles.map((file) => ({
          name: file,
          value: file,
        })),
        pageSize: 15,
      },
    ]);

    if (selectedFiles.length === 0) {
      log.info(t("commands.commit.info.no_files_selected"));
      return false;
    }

    // 선택된 파일들을 스테이징
    for (const file of selectedFiles) {
      await execAsync(`git add "${file}"`);
    }

    log.info(
      t("commands.commit.success.files_staged", {
        count: selectedFiles.length,
      }),
    );
    return true;
  } catch (error) {
    log.error(t("commands.commit.error.file_selection_failed"), error);
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

async function pushToRemote(currentBranch: string): Promise<void> {
  try {
    // 브랜치 목록 가져오기
    const { remote, all } = await getAllBranches();

    // 현재 브랜치가 이미 원격에 있는지 확인
    const branchExists = remote.includes(currentBranch);

    // 현재 브랜치가 원격에 존재하지 않는 경우 알림
    if (!branchExists) {
      log.info(
        t("commands.commit.info.branch_not_on_remote", {
          branch: currentBranch,
        }),
      );
    }

    // 사용자에게 푸시할 브랜치 선택 요청
    const { targetBranch } = await inquirer.prompt([
      {
        type: "list",
        name: "targetBranch",
        message: t("commands.commit.prompts.select_push_branch"),
        choices: [
          // 현재 브랜치를 첫 번째 옵션으로 표시 (원격 상태 포함)
          {
            name: `${currentBranch} (${t("commands.commit.branch.current")})${branchExists ? ` (${t("commands.commit.branch.remote")})` : ` (${t("commands.commit.branch.local_only")})`}`,
            value: currentBranch,
          },
          // 다른 브랜치들 표시
          ...all
            .filter((branch) => branch !== currentBranch)
            .map((branch) => ({
              name: `${branch} ${remote.includes(branch) ? `(${t("commands.commit.branch.remote")})` : `(${t("commands.commit.branch.local_only")})`}`,
              value: branch,
            })),
          // 새 브랜치 생성 옵션
          { name: t("commands.commit.branch.create_new"), value: "new" },
        ],
        default: currentBranch,
      },
    ]);

    let pushBranch = targetBranch;

    // 새 브랜치 생성 옵션 선택 시
    if (targetBranch === "new") {
      const { newBranchName } = await inquirer.prompt([
        {
          type: "input",
          name: "newBranchName",
          message: t("commands.commit.prompts.enter_new_branch_name"),
          validate: (input: string) => {
            if (!input.trim()) {
              return t("commands.commit.error.branch_name_empty");
            }
            if (all.includes(input.trim())) {
              return t("commands.commit.error.branch_exists");
            }
            return true;
          },
        },
      ]);

      // 새 브랜치 생성
      await execAsync(`git branch ${newBranchName}`);
      log.info(
        t("commands.commit.success.branch_created", { branch: newBranchName }),
      );

      // 새 브랜치로 체크아웃할지 확인
      const { checkout } = await inquirer.prompt([
        {
          type: "confirm",
          name: "checkout",
          message: t("commands.commit.prompts.checkout_new_branch", {
            branch: newBranchName,
          }),
          default: true,
        },
      ]);

      if (checkout) {
        await execAsync(`git checkout ${newBranchName}`);
        log.info(
          t("commands.commit.success.branch_checked_out", {
            branch: newBranchName,
          }),
        );
      }

      pushBranch = newBranchName;
    }

    // 선택한 브랜치가 현재 브랜치와 다른 경우 확인
    if (pushBranch !== currentBranch) {
      const { confirmPush } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmPush",
          message: t("commands.commit.prompts.confirm_push_different_branch", {
            target: pushBranch,
          }),
          default: false,
        },
      ]);

      if (!confirmPush) {
        log.info(t("commands.commit.info.push_cancelled"));
        return;
      }
    }

    // 선택한 브랜치가 원격에 존재하는지 확인
    const targetBranchExists = remote.includes(pushBranch);

    // 원격 브랜치가 존재하지 않는 경우 -u 옵션 추가 및 알림
    if (!targetBranchExists) {
      log.info(
        t("commands.commit.info.creating_remote_branch", {
          branch: pushBranch,
        }),
      );
      await execAsync(`git push -u origin ${pushBranch}`);
    } else {
      await execAsync(`git push origin ${pushBranch}`);
    }

    log.info(t("commands.commit.success.pushed", { branch: pushBranch }));
  } catch (error) {
    log.error(t("commands.commit.error.push_failed", { error: String(error) }));
    throw error;
  }
}

// 릴리스 PR인지 확인하는 함수 수정
async function isReleasePR(
  branch: string,
  strategy: BranchStrategy,
): Promise<boolean> {
  return branch === strategy.developmentBranch;
}

// PR이 이미 존재하는지 확인하는 함수는 그대로 유지
async function checkExistingPR(
  owner: string,
  repo: string,
  branch: string,
  baseBranch?: string,
): Promise<boolean> {
  try {
    const client = await getOctokit();
    const { data: pulls } = await client.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      base: baseBranch,
      state: "open",
    });
    return pulls.length > 0;
  } catch (error) {
    log.warn(t("commands.commit.warning.pr_check_failed"));
    return false;
  }
}

// 브랜치가 dev인지 확인하는 함수 추가
async function _isDevToMainPR(branch: string, config: any): Promise<boolean> {
  return branch === "dev" && config.defaultBranch === "main";
}

async function getChangedFiles(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("git diff --staged --name-only");
    return stdout.split("\n").filter(Boolean);
  } catch (error) {
    log.error(t("commands.commit.error.files_failed"));
    return [];
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
    // AI 인스턴스를 한 번만 생성하고 재사용
    let ai: AIFeatures | null = null;

    // AI 기능이 설정되어 있는 경우에만 AI 관련 기능 활성화
    if (config.aiConfig?.enabled) {
      try {
        ai = new AIFeatures();
        await ai.initialize();
        aiEnabled = ai.isEnabled();
        if (aiEnabled) {
          log.info(t("ai.initialization.success"));
        }
      } catch (error) {
        aiEnabled = false;
        ai = null;
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

    // -sp 옵션이 있으면 select와 push 옵션 모두 활성화
    if (options.selectPush) {
      options.select = true;
      options.push = true;
    }

    // 파일 선택 모드가 활성화된 경우
    if (options.select) {
      const filesSelected = await selectFilesToStage();
      if (!filesSelected) {
        process.exit(0);
      }
    } else if (options.patch) {
      // 패치 모드가 지정된 경우 대화형 패치 모드 실행
      const staged = await stageChanges({ patch: true });
      if (!staged) {
        log.info(t("commands.commit.info.run_patch_mode"));
        process.exit(0);
      }
    } else {
      // 패치 모드나 선택 모드가 아닌 경우 모든 변경사항 스테이징
      await stageChanges({ all: true });
    }

    const diffContent = await getStagedDiff();
    const changedFiles = await getChangedFiles();

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

      // AI 인스턴스가 없으면 새로 생성
      if (!ai) {
        ai = new AIFeatures();
        await ai.initialize();
      }

      commitMessage = await ai.improveCommitMessage(
        currentMessage,
        diffContent,
        changedFiles,
      );
    } else if (subcommand) {
      // 알 수 없는 서브커맨드
      log.error(t("commands.commit.error.invalid_subcommand"));
      process.exit(1);
    } else if (aiEnabled && ai) {
      // AI 기능이 활성화된 경우: 새로운 메시지 제안
      log.info(t("commands.commit.info.analyzing_changes"));

      commitMessage = await ai.improveCommitMessage(
        "",
        diffContent,
        changedFiles,
      );
    }

    if (aiEnabled && commitMessage) {
      // 제안된 메시지 표시
      log.section(t("commands.commit.info.suggested_message"));
      log.section("-------------------");
      log.verbose(commitMessage);
      log.section("-------------------");

      // 사용자 확인
      try {
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
      } catch (error) {
        log.debug("프롬프트 처리 중 오류 발생:", error);
        // 오류 발생 시 기본 메시지 사용
        log.info(t("commands.commit.info.using_default_message"));
      }
    } else {
      // AI가 비활성화되어 있거나 메시지 생성에 실패한 경우: 직접 입력
      try {
        const { editedMessage } = await inquirer.prompt([
          {
            type: "editor",
            name: "editedMessage",
            message: t("commands.commit.prompts.edit_message"),
          },
        ]);
        commitMessage = editedMessage;
      } catch (error) {
        log.debug("프롬프트 처리 중 오류 발생:", error);
        log.error(t("commands.commit.error.message_input_failed"));
        process.exit(1);
      }
    }

    // 커밋 실행
    try {
      await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
      log.info(t("commands.commit.success.committed"));

      // push 옵션이 활성화된 경우 자동으로 push 실행
      if (options.push) {
        const currentBranch = await getCurrentBranch();
        await pushToRemote(currentBranch);

        // PR 생성 안내 메시지 표시
        log.info("\n" + t("commands.commit.info.pr_creation_guide"));
        log.info(t("commands.commit.info.run_new_command"));
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
