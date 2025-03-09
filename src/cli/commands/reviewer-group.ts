import { Command } from "commander";
import { t } from "../../i18n/index.js";
import { loadProjectConfig, saveProjectConfig } from "../../core/config.js";
import { log } from "../../utils/logger.js";
import { ReviewerGroupSchema } from "../../types/config.js";

export function createReviewerGroupCommand(): Command {
  const reviewerGroupCommand = new Command("reviewer-group").description(
    t("commands.reviewer_group.description"),
  );

  // 리뷰어 그룹 추가 명령어
  reviewerGroupCommand
    .command("add")
    .description(t("commands.reviewer_group.add.description"))
    .argument("<name>", t("commands.reviewer_group.add.argument.name"))
    .requiredOption(
      "-m, --members <members>",
      t("commands.reviewer_group.add.option.members"),
    )
    .option(
      "-s, --strategy <strategy>",
      t("commands.reviewer_group.add.option.strategy"),
      "round-robin",
    )
    .action(
      async (name: string, options: { members: string; strategy: string }) => {
        try {
          const config = await loadProjectConfig();

          // 멤버 목록을 배열로 변환
          const members = options.members.split(",").map((m) => m.trim());

          // 새 그룹 생성 및 유효성 검사
          const newGroup = ReviewerGroupSchema.parse({
            name,
            members,
            rotationStrategy: options.strategy,
          });

          // 기존 그룹과 이름 중복 체크
          if (config.reviewerGroups.some((group) => group.name === name)) {
            throw new Error(
              t("commands.reviewer_group.add.error.duplicate_name", { name }),
            );
          }

          // 그룹 추가
          config.reviewerGroups.push(newGroup);
          await saveProjectConfig(config);

          log.info(t("commands.reviewer_group.add.success", { name }));
        } catch (error) {
          log.error(t("common.error.unknown"), String(error));
          process.exit(1);
        }
      },
    );

  // 리뷰어 그룹 제거 명령어
  reviewerGroupCommand
    .command("remove")
    .description(t("commands.reviewer_group.remove.description"))
    .argument("<name>", t("commands.reviewer_group.remove.argument.name"))
    .action(async (name: string) => {
      try {
        const config = await loadProjectConfig();

        const groupIndex = config.reviewerGroups.findIndex(
          (group) => group.name === name,
        );
        if (groupIndex === -1) {
          throw new Error(
            t("commands.reviewer_group.remove.error.not_found", { name }),
          );
        }

        config.reviewerGroups.splice(groupIndex, 1);
        await saveProjectConfig(config);

        log.info(t("commands.reviewer_group.remove.success", { name }));
      } catch (error) {
        log.error(t("common.error.unknown"), String(error));
        process.exit(1);
      }
    });

  // 리뷰어 그룹 업데이트 명령어
  reviewerGroupCommand
    .command("update")
    .description(t("commands.reviewer_group.update.description"))
    .argument("<name>", t("commands.reviewer_group.update.argument.name"))
    .option(
      "-m, --members <members>",
      t("commands.reviewer_group.update.option.members"),
    )
    .option(
      "-s, --strategy <strategy>",
      t("commands.reviewer_group.update.option.strategy"),
    )
    .action(
      async (
        name: string,
        options: { members?: string; strategy?: string },
      ) => {
        try {
          const config = await loadProjectConfig();

          const groupIndex = config.reviewerGroups.findIndex(
            (group) => group.name === name,
          );
          if (groupIndex === -1) {
            throw new Error(
              t("commands.reviewer_group.update.error.not_found", { name }),
            );
          }

          const currentGroup = config.reviewerGroups[groupIndex];
          const updatedGroup = {
            ...currentGroup,
            ...(options.members && {
              members: options.members.split(",").map((m) => m.trim()),
            }),
            ...(options.strategy && {
              rotationStrategy: options.strategy,
            }),
          };

          // 유효성 검사
          config.reviewerGroups[groupIndex] =
            ReviewerGroupSchema.parse(updatedGroup);
          await saveProjectConfig(config);

          log.info(t("commands.reviewer_group.update.success", { name }));
        } catch (error) {
          log.error(t("common.error.unknown"), String(error));
          process.exit(1);
        }
      },
    );

  // 리뷰어 그룹 목록 조회 명령어
  reviewerGroupCommand
    .command("list")
    .description(t("commands.reviewer_group.list.description"))
    .action(async () => {
      try {
        const config = await loadProjectConfig();

        if (config.reviewerGroups.length === 0) {
          log.info(t("commands.reviewer_group.list.no_groups"));
          return;
        }

        for (const group of config.reviewerGroups) {
          log.info(
            t("commands.reviewer_group.list.group_info", {
              name: group.name,
              members: group.members.join(", "),
              strategy: group.rotationStrategy,
            }),
          );
        }
      } catch (error) {
        log.error(t("common.error.unknown"), String(error));
        process.exit(1);
      }
    });

  return reviewerGroupCommand;
}
