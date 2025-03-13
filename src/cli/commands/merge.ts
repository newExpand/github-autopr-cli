import inquirer from "inquirer";
import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import {
  getPullRequest,
  mergePullRequest,
  listBranches,
  updatePullRequest,
  getPullRequestConflicts,
} from "../../core/github.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { AIFeatures } from "../../core/ai-features.js";
import { log } from "../../utils/logger.js";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import os from "os";
import { getOctokit } from "../../core/github.js";

interface ConflictFile {
  file: string;
  conflict: string;
}

async function handleConflicts(
  owner: string,
  repo: string,
  prNumber: number,
  config: any,
  conflicts: ConflictFile[],
  baseBranch: string,
): Promise<void> {
  let aiEnabled = false;

  // AI 기능이 설정되어 있는 경우에만 AI 관련 기능 활성화
  if (config.aiConfig?.enabled) {
    try {
      const ai = new AIFeatures();
      await ai.initialize();
      aiEnabled = ai.isEnabled();

      if (aiEnabled) {
        log.info(t("commands.merge.conflict.ai_suggestion_start"));

        // PR의 전체 컨텍스트를 가져옵니다
        const client = await getOctokit();
        const { data: pr } = await client.rest.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });

        // PR의 변경사항 정보를 가져옵니다
        const { data: files } = await client.rest.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
        });

        // AI에 전달할 추가 컨텍스트를 구성합니다
        const prContext = {
          title: pr.title,
          description: pr.body || "",
          changedFiles: files.map((f) => ({
            filename: f.filename,
            additions: f.additions,
            deletions: f.deletions,
            changes: f.changes,
          })),
        };

        const suggestions = await ai.suggestConflictResolution(
          conflicts,
          prContext,
        );

        log.info("\n" + t("commands.merge.conflict.ai_suggestions"));
        log.info("-------------------");
        log.info(suggestions);

        const { useAiSuggestions } = await inquirer.prompt([
          {
            type: "confirm",
            name: "useAiSuggestions",
            message: t("commands.merge.conflict.use_ai_suggestions"),
            default: true,
          },
        ]);

        if (!useAiSuggestions) {
          log.info(t("commands.merge.conflict.manual_resolution"));
        }
      }
    } catch (error) {
      log.warn(t("commands.merge.conflict.ai_suggestion_failed"));
      aiEnabled = false;
    }
  }

  // 기존의 충돌 해결 가이드 표시
  log.section(t("commands.merge.conflict.resolve_guide"));
  log.section(t("commands.merge.conflict.help_message"));
  log.section("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log.step(
    t("commands.merge.conflict.detected_editor", {
      editor: t("commands.merge.editor.default"),
    }),
  );
  log.step(
    t("commands.merge.conflict.files_to_open", {
      count: conflicts.length,
    }),
  );
  log.section("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log.section(t("commands.merge.conflict.steps.checkout"));
  log.step(t("commands.merge.conflict.steps.open"));
  log.step(t("commands.merge.conflict.steps.resolve"));
  log.step(t("commands.merge.conflict.steps.update"));

  // 파일이 3개 이상일 경우 추가 확인
  if (conflicts.length >= 3) {
    log.warn(
      t("commands.merge.conflict.many_files", {
        count: conflicts.length,
      }),
    );
    const { confirmManyFiles } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmManyFiles",
        message: t("commands.merge.prompts.confirm_many_files"),
        default: false,
      },
    ]);

    if (!confirmManyFiles) {
      log.info(t("commands.merge.success.cancelled"));
      return;
    }
  }

  const { shouldContinue } = await inquirer.prompt([
    {
      type: "confirm",
      name: "shouldContinue",
      message: t("commands.merge.prompts.start_resolution"),
      default: true,
    },
  ]);

  if (!shouldContinue) {
    log.info(t("commands.merge.success.cancelled"));
    return;
  }

  // 충돌이 있는 파일들을 체크아웃
  log.section(t("commands.merge.conflict.checking_out_files"));
  try {
    execSync(`git merge ${baseBranch}`, { stdio: "inherit" });
  } catch (error) {
    // merge 명령이 충돌로 인해 실패하는 것은 예상된 동작입니다
  }

  // 충돌이 있는 파일들을 편집기로 열기
  log.section(t("commands.merge.conflict.opening_files"));
  for (const conflict of conflicts) {
    try {
      const fullPath = resolve(process.cwd(), conflict.file);
      if (!existsSync(fullPath)) {
        log.warn(
          t("commands.merge.error.file_not_found", {
            file: conflict.file,
          }),
        );
        continue;
      }
      log.step(
        t("commands.merge.conflict.trying_to_open", {
          file: conflict.file,
        }),
      );

      // 설정된 편집기가 있으면 해당 편집기로 열기
      if (process.env.EDITOR || process.env.VISUAL) {
        execSync(`${process.env.EDITOR || process.env.VISUAL} "${fullPath}"`, {
          stdio: "inherit",
        });
      } else if (os.platform() === "darwin") {
        try {
          // 현재 실행 중인 프로세스 목록 가져오기
          const psOutput = execSync(
            "ps aux | grep -i 'cursor\\|code\\|subl\\|webstorm\\|idea\\|pycharm\\|goland\\|phpstorm\\|atom\\|nvim\\|vim\\|emacs' | grep -v grep",
          )
            .toString()
            .trim();

          if (psOutput.includes("cursor")) {
            execSync(`cursor "${fullPath}"`, { stdio: "inherit" });
          } else if (psOutput.includes("code")) {
            execSync(`code "${fullPath}"`, { stdio: "inherit" });
          } else if (psOutput.includes("subl")) {
            execSync(`subl "${fullPath}"`, { stdio: "inherit" });
          } else if (
            psOutput.includes("webstorm") ||
            psOutput.includes("idea")
          ) {
            execSync(`webstorm "${fullPath}"`, { stdio: "inherit" });
          } else if (psOutput.includes("pycharm")) {
            execSync(`pycharm "${fullPath}"`, { stdio: "inherit" });
          } else if (psOutput.includes("goland")) {
            execSync(`goland "${fullPath}"`, { stdio: "inherit" });
          } else if (psOutput.includes("phpstorm")) {
            execSync(`phpstorm "${fullPath}"`, { stdio: "inherit" });
          } else if (psOutput.includes("atom")) {
            execSync(`atom "${fullPath}"`, { stdio: "inherit" });
          } else if (psOutput.includes("nvim")) {
            execSync(`nvim "${fullPath}"`, { stdio: "inherit" });
          } else if (psOutput.includes("vim")) {
            execSync(`vim "${fullPath}"`, { stdio: "inherit" });
          } else if (psOutput.includes("emacs")) {
            execSync(`emacs "${fullPath}"`, { stdio: "inherit" });
          } else {
            execSync(`open "${fullPath}"`, { stdio: "inherit" });
          }
        } catch (error) {
          // 프로세스 감지 실패 시 기본 동작
          execSync(`open "${fullPath}"`, { stdio: "inherit" });
        }
      } else if (os.platform() === "linux") {
        execSync(`xdg-open "${fullPath}"`, { stdio: "inherit" });
      } else if (os.platform() === "win32") {
        execSync(`start "" "${fullPath}"`, { stdio: "inherit" });
      }

      log.step(
        t("commands.merge.conflict.file_opened", {
          file: conflict.file,
        }),
      );
    } catch (error) {
      log.warn(
        t("commands.merge.error.cannot_open_file", {
          file: conflict.file,
          error: String(error),
        }),
      );
    }
  }

  // 충돌 해결 후 PR 업데이트 안내
  log.section(t("commands.merge.conflict.next_steps"));
  log.step("1. git add .");
  log.step("2. git commit -m '충돌 해결'");
  log.step("3. git push");
  log.step(
    t("commands.merge.conflict.run_again", {
      command: `autopr merge ${prNumber}`,
    }),
  );
}

export async function mergeCommand(prNumber: string): Promise<void> {
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

    let pr = await getPullRequest({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      pull_number: parseInt(prNumber, 10),
    });

    // PR 정보 표시
    log.section(t("commands.merge.info.title"));
    log.info(`#${pr.number} ${pr.title}`);
    log.section(t("commands.merge.info.branch_info"));
    log.step(t("commands.merge.info.pr_branch", { branch: pr.head.ref }));
    log.step(t("commands.merge.info.target_branch", { branch: pr.base.ref }));
    log.step(t("commands.merge.info.author", { author: pr.user.login }));

    // 충돌 확인
    log.section(t("commands.merge.info.checking_conflicts"));

    const conflicts = await getPullRequestConflicts(
      repoInfo.owner,
      repoInfo.repo,
      parseInt(prNumber, 10),
    );

    if (conflicts.hasConflicts) {
      log.warn(t("commands.merge.conflict.found"));

      // Git 상태 확인
      try {
        execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
      } catch (error) {
        log.error(t("common.error.not_git_repo"));
        process.exit(1);
      }

      // 현재 브랜치의 변경사항 저장
      try {
        execSync("git stash", { stdio: "inherit" });
      } catch (error) {
        // 저장할 변경사항이 없는 경우 무시
      }

      // PR 브랜치로 전환
      try {
        execSync(`git fetch origin ${pr.head.ref}`, { stdio: "inherit" });
        execSync(`git checkout ${pr.head.ref}`, { stdio: "inherit" });
      } catch (error) {
        log.error(t("commands.merge.error.branch_checkout_failed"));
        process.exit(1);
      }

      // 실제 충돌이 있는 파일 확인
      const actualConflicts = await Promise.all(
        conflicts.conflicts.map(async (conflict) => {
          try {
            const fullPath = resolve(process.cwd(), conflict.filename);

            // 파일이 존재하지 않는 경우 새로 생성된 파일일 수 있음
            if (!existsSync(fullPath)) {
              return {
                filename: conflict.filename,
                isNew: true,
                hasConflict: true,
              };
            }

            const content = execSync(`cat "${fullPath}"`).toString();
            const hasConflictMarkers =
              content.includes("<<<<<<<") &&
              content.includes("=======") &&
              content.includes(">>>>>>>");

            // Git의 merge-base를 사용하여 공통 조상과의 차이 확인
            const hasActualChanges = execSync(
              `git merge-base --is-ancestor origin/${pr.base.ref} origin/${pr.head.ref} || echo "diverged"`,
              { stdio: "pipe" },
            )
              .toString()
              .includes("diverged");

            return {
              filename: conflict.filename,
              isNew: false,
              hasConflict: hasConflictMarkers || hasActualChanges,
            };
          } catch (error) {
            log.warn(
              t("commands.merge.error.conflict_check_failed", {
                file: conflict.filename,
                error: String(error),
              }),
            );
            // 에러가 발생한 경우 안전하게 충돌로 간주
            return {
              filename: conflict.filename,
              isNew: false,
              hasConflict: true,
            };
          }
        }),
      );

      const conflictingFiles = actualConflicts.filter((c) => c.hasConflict);

      if (conflictingFiles.length === 0) {
        log.info(t("commands.merge.conflict.no_actual_conflicts"));

        // 원래 브랜치로 복귀
        try {
          execSync(`git checkout -`, { stdio: "inherit" });
          execSync("git stash pop", { stdio: "inherit" });
        } catch (error) {
          // stash가 없는 경우 무시
        }

        return;
      }

      // AI 충돌 해결 제안 처리
      await handleConflicts(
        repoInfo.owner,
        repoInfo.repo,
        parseInt(prNumber, 10),
        config,
        conflictingFiles.map((conflict) => ({
          file: conflict.filename,
          conflict: conflict.isNew
            ? ""
            : execSync(
                `cat "${resolve(process.cwd(), conflict.filename)}"`,
              ).toString(),
        })),
        pr.base.ref,
      );

      return;
    } else {
      log.info(t("commands.merge.conflict.none"));
    }

    // 사용 가능한 브랜치 목록 가져오기
    const branches = await listBranches({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    });

    const branchNames = branches.map((branch) => branch.name);

    // base 브랜치 변경 여부 확인
    const { changeBase } = await inquirer.prompt([
      {
        type: "confirm",
        name: "changeBase",
        message: t("commands.merge.prompts.change_base"),
        default: false,
      },
    ]);

    // base 브랜치 변경
    if (changeBase) {
      const { newBase } = await inquirer.prompt([
        {
          type: "list",
          name: "newBase",
          message: t("commands.merge.prompts.select_base"),
          choices: branchNames,
          default: pr.base.ref,
        },
      ]);

      if (newBase !== pr.base.ref) {
        // base 브랜치 변경 확인
        const { confirmBaseChange } = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirmBaseChange",
            message: t("commands.merge.prompts.confirm_base_change", {
              from: pr.base.ref,
              to: newBase,
            }),
            default: false,
          },
        ]);

        if (!confirmBaseChange) {
          log.info(t("commands.merge.success.cancelled"));
          return;
        }

        try {
          // PR의 base 브랜치 업데이트
          pr = await updatePullRequest({
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            pull_number: pr.number,
            base: newBase,
          });

          log.info(
            t("commands.merge.success.base_changed", { branch: newBase }),
          );
        } catch (error) {
          log.error(t("commands.merge.error.base_change_failed"));
          log.error(String(error));
          return;
        }
      }
    }

    // 병합 방법 선택
    const { mergeMethod } = await inquirer.prompt([
      {
        type: "list",
        name: "mergeMethod",
        message: t("commands.merge.prompts.merge_method"),
        choices: [
          { name: t("commands.merge.methods.merge"), value: "merge" },
          { name: t("commands.merge.methods.squash"), value: "squash" },
          { name: t("commands.merge.methods.rebase"), value: "rebase" },
        ],
        default: "merge",
      },
    ]);

    // 커밋 메시지 입력 (squash 병합의 경우)
    let commitTitle = "";
    let commitMessage = "";
    if (mergeMethod === "squash") {
      const { title, message } = await inquirer.prompt([
        {
          type: "input",
          name: "title",
          message: t("commands.merge.prompts.commit_title"),
          default: pr.title,
        },
        {
          type: "editor",
          name: "message",
          message: t("commands.merge.prompts.commit_message"),
          default: pr.body || "",
        },
      ]);
      commitTitle = title;
      commitMessage = message;
    }

    // 브랜치 삭제 여부 확인
    const { deleteBranch } = await inquirer.prompt([
      {
        type: "confirm",
        name: "deleteBranch",
        message: t("commands.merge.prompts.delete_branch"),
        default: true,
      },
    ]);

    // 최종 확인
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: t("commands.merge.prompts.confirm"),
        default: false,
      },
    ]);

    if (!confirm) {
      log.info(t("commands.merge.success.cancelled"));
      return;
    }

    // PR 병합 실행
    await mergePullRequest({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      pull_number: pr.number,
      merge_method: mergeMethod,
      commit_title: commitTitle,
      commit_message: commitMessage,
      delete_branch: deleteBranch,
    });

    log.info(t("commands.merge.success.merged"));

    // GitHub API를 통한 원격 브랜치 삭제
    if (deleteBranch) {
      try {
        // 1. GitHub API를 통한 삭제 시도
        const client = await getOctokit();
        await client.rest.git.deleteRef({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          ref: `heads/${pr.head.ref}`,
        });

        // 2. git 명령어로 원격 브랜치 삭제 시도
        try {
          execSync(`git push origin --delete ${pr.head.ref}`, {
            stdio: "pipe",
          });
        } catch (pushError) {
          // 이미 삭제된 경우 무시
        }

        // 3. 원격 브랜치 정보 정리
        execSync("git remote prune origin", { stdio: "pipe" });
        execSync("git fetch --prune", { stdio: "pipe" });
      } catch (error) {
        // API 삭제 실패 시 git 명령어로 재시도
        try {
          execSync(`git push origin --delete ${pr.head.ref}`, {
            stdio: "pipe",
          });
          execSync("git remote prune origin", { stdio: "pipe" });
          execSync("git fetch --prune", { stdio: "pipe" });
        } catch (pushError) {
          // 이미 삭제된 경우 무시
        }
      }
    }

    // 로컬 브랜치 정리
    log.info(t("commands.merge.cleanup.start"));

    try {
      // 대상 브랜치(base branch) 최신화
      log.info(
        t("commands.merge.cleanup.updating_base_branch", {
          branch: pr.base.ref,
        }),
      );

      // 로컬에 대상 브랜치가 있는지 확인
      const localBranches = execSync("git branch --list").toString();
      const hasLocalBase = localBranches.includes(pr.base.ref);

      if (hasLocalBase) {
        // 먼저 대상 브랜치로 전환
        log.info(
          t("commands.merge.cleanup.switching_to_base", {
            branch: pr.base.ref,
          }),
        );
        execSync(`git checkout ${pr.base.ref}`, { stdio: "inherit" });

        // PR 브랜치가 로컬에 있는 경우 삭제
        if (deleteBranch) {
          try {
            log.info(
              t("commands.merge.cleanup.deleting_branch", {
                branch: pr.head.ref,
              }),
            );
            execSync(`git branch -D ${pr.head.ref}`, { stdio: "inherit" });
            log.info(t("commands.merge.cleanup.branch_deleted"));

            // 원격 브랜치 삭제 상태 확인 및 정리
            try {
              // 원격 브랜치 목록 업데이트 및 정리
              execSync("git remote prune origin", { stdio: "pipe" });
              execSync("git fetch --prune", { stdio: "pipe" });

              // 원격 브랜치가 여전히 존재하는지 확인
              const remoteExists = execSync(
                `git ls-remote --heads origin ${pr.head.ref}`,
                { stdio: "pipe" },
              )
                .toString()
                .trim();

              if (remoteExists) {
                log.info(t("commands.merge.cleanup.deleting_remote_branch"));
                execSync(`git push origin --delete ${pr.head.ref}`, {
                  stdio: "inherit",
                });
                // 다시 한번 원격 브랜치 정리
                execSync("git remote prune origin", { stdio: "pipe" });
                execSync("git fetch --prune", { stdio: "pipe" });
              }
            } catch (error) {
              // 원격 브랜치 관련 오류는 무시
            }
          } catch (error) {
            // 브랜치가 이미 없는 경우 무시
            log.info(t("commands.merge.cleanup.branch_already_deleted"));
          }
        }

        // 대상 브랜치 최신화
        log.info(t("commands.merge.cleanup.syncing_with_remote"));
        execSync("git fetch origin", { stdio: "inherit" });
        execSync(`git reset --hard origin/${pr.base.ref}`, {
          stdio: "inherit",
        });
      } else {
        log.warn(
          t("commands.merge.warning.base_branch_not_found", {
            branch: pr.base.ref,
          }),
        );
      }

      log.info(t("commands.merge.cleanup.complete"));
    } catch (error) {
      log.warn(
        t("commands.merge.error.cleanup_failed", { error: String(error) }),
      );
      log.warn(t("commands.merge.error.manual_cleanup"));
    }
  } catch (error) {
    if (error instanceof Error) {
      log.error(error.message);
    } else {
      log.error(t("common.error.unknown"), String(error));
    }
    process.exit(1);
  }
}
