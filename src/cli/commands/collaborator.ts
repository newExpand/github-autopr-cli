import { Command } from "commander";
import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { log } from "../../utils/logger.js";
import {
  inviteCollaborator,
  getCollaborators,
  removeCollaborator,
  getInvitationStatus,
  getAllInvitationStatuses,
} from "../../core/github.js";
import inquirer from "inquirer";

export function createCollaboratorCommand(): Command {
  const collaboratorCommand = new Command("collaborator").description(
    t("commands.collaborator.description"),
  );

  // collaborator 초대
  collaboratorCommand
    .command("invite")
    .description(t("commands.collaborator.invite.description"))
    .argument("<username>", "GitHub 사용자명")
    .action(async (username: string) => {
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

        // 초대 권한 선택
        const { permission } = await inquirer.prompt([
          {
            type: "list",
            name: "permission",
            message: t("commands.collaborator.prompts.permission"),
            choices: [
              {
                name: t("commands.collaborator.permissions.pull"),
                value: "pull",
              },
              {
                name: t("commands.collaborator.permissions.push"),
                value: "push",
              },
              {
                name: t("commands.collaborator.permissions.admin"),
                value: "admin",
              },
            ],
            default: "push",
          },
        ]);

        await inviteCollaborator({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          username,
          permission,
        });

        log.info(t("commands.collaborator.success.invited", { username }));
      } catch (error) {
        if (error instanceof Error) {
          log.error(error.message);
        } else {
          log.error(t("common.error.unknown"), String(error));
        }
        process.exit(1);
      }
    });

  // collaborator 목록 조회
  collaboratorCommand
    .command("list")
    .description(t("commands.collaborator.list.description"))
    .action(async () => {
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

        const collaborators = await getCollaborators({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
        });

        if (collaborators.length === 0) {
          log.info(t("commands.collaborator.no_collaborators"));
          return;
        }

        log.info(t("commands.collaborator.list.title"));
        for (const collaborator of collaborators) {
          log.info(
            t("commands.collaborator.list.item", {
              username: collaborator.login,
              permission: collaborator.permissions.admin
                ? t("commands.collaborator.permissions.admin")
                : collaborator.permissions.push
                  ? t("commands.collaborator.permissions.push")
                  : t("commands.collaborator.permissions.pull"),
            }),
          );
        }
      } catch (error) {
        log.error(t("common.error.unknown"), String(error));
        process.exit(1);
      }
    });

  // collaborator 제거
  collaboratorCommand
    .command("remove")
    .description(t("commands.collaborator.remove.description"))
    .action(async () => {
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

        const collaborators = await getCollaborators({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
        });

        if (collaborators.length === 0) {
          log.info(t("commands.collaborator.no_collaborators"));
          return;
        }

        // 체크박스로 collaborator 선택
        const { selectedCollaborators } = await inquirer.prompt([
          {
            type: "checkbox",
            name: "selectedCollaborators",
            message: t("commands.collaborator.prompts.select_to_remove"),
            choices: collaborators.map((collaborator) => ({
              name: `${collaborator.login} (${
                collaborator.permissions.admin
                  ? t("commands.collaborator.permissions.admin")
                  : collaborator.permissions.push
                    ? t("commands.collaborator.permissions.push")
                    : t("commands.collaborator.permissions.pull")
              })`,
              value: collaborator.login,
            })),
          },
        ]);

        if (selectedCollaborators.length === 0) {
          log.info(t("commands.collaborator.success.cancelled"));
          return;
        }

        // 선택된 collaborator 제거 확인
        const { confirm } = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirm",
            message: t(
              "commands.collaborator.prompts.confirm_remove_multiple",
              {
                count: selectedCollaborators.length,
              },
            ),
            default: false,
          },
        ]);

        if (!confirm) {
          log.info(t("commands.collaborator.success.cancelled"));
          return;
        }

        // 선택된 collaborator들 제거
        for (const username of selectedCollaborators) {
          await removeCollaborator({
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            username,
          });
          log.info(t("commands.collaborator.success.removed", { username }));
        }

        log.info(t("commands.collaborator.success.all_removed"));
      } catch (error) {
        if (error instanceof Error) {
          log.error(error.message);
        } else {
          log.error(t("common.error.unknown"), String(error));
        }
        process.exit(1);
      }
    });

  // collaborator 초대 상태 확인
  collaboratorCommand
    .command("status")
    .description(t("commands.collaborator.status.description"))
    .argument("<username>", "GitHub 사용자명")
    .action(async (username: string) => {
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

        const status = await getInvitationStatus({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          username,
        });

        if (!status) {
          log.info(
            t("commands.collaborator.status.no_invitation", { username }),
          );
          return;
        }

        const statusText = {
          pending: t("commands.collaborator.status.pending"),
          accepted: t("commands.collaborator.status.accepted"),
          expired: t("commands.collaborator.status.expired"),
        }[status.status];

        log.info(
          t("commands.collaborator.status.info", {
            username,
            status: statusText,
            invitedAt: new Date(status.invitedAt).toLocaleString(),
            expiresAt: new Date(status.expiresAt).toLocaleString(),
          }),
        );
      } catch (error) {
        if (error instanceof Error) {
          log.error(error.message);
        } else {
          log.error(t("common.error.unknown"), String(error));
        }
        process.exit(1);
      }
    });

  // 모든 collaborator 초대 상태 확인
  collaboratorCommand
    .command("status-all")
    .description(t("commands.collaborator.status_all.description"))
    .action(async () => {
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

        const statuses = await getAllInvitationStatuses({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
        });

        if (statuses.length === 0) {
          log.info(t("commands.collaborator.status.no_invitations"));
          return;
        }

        log.info(t("commands.collaborator.status.all_title"));
        for (const status of statuses) {
          const statusText = {
            pending: t("commands.collaborator.status.pending"),
            accepted: t("commands.collaborator.status.accepted"),
            expired: t("commands.collaborator.status.expired"),
          }[status.status];

          log.info(
            t("commands.collaborator.status.info", {
              username: status.username,
              status: statusText,
              invitedAt: new Date(status.invitedAt).toLocaleString(),
              expiresAt: new Date(status.expiresAt).toLocaleString(),
            }),
          );
        }
      } catch (error) {
        if (error instanceof Error) {
          log.error(error.message);
        } else {
          log.error(t("common.error.unknown"), String(error));
        }
        process.exit(1);
      }
    });

  return collaboratorCommand;
}
