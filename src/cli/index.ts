#!/usr/bin/env node
import { Command } from "commander";
import { initializeI18n, t } from "../i18n/index.js";
import { initCommand } from "./commands/init.js";
import { newCommand } from "./commands/new.js";
import { listCommand } from "./commands/list.js";
import { reviewCommand } from "./commands/review.js";
import { updateCommand } from "./commands/update.js";
import { mergeCommand } from "./commands/merge.js";
import { reopenCommand } from "./commands/reopen.js";
import { createLangCommand } from "./commands/lang.js";
import { createHookCommand } from "./commands/hook.js";
import { createCollaboratorCommand } from "./commands/collaborator.js";
import { commitCommand } from "./commands/commit.js";
import { loadConfig } from "../core/config.js";
import { log } from "../utils/logger.js";
import { createReviewerGroupCommand } from "./commands/reviewer-group.js";

const program = new Command();

async function main() {
  try {
    const config = await loadConfig();
    await initializeI18n(config?.language);

    program
      .name("autopr")
      .description(t("common.cli.description"))
      .version("0.1.0");

    // 기본 명령어들
    program
      .command("init")
      .description(t("commands.init.description"))
      .action(initCommand);

    program
      .command("new")
      .description(t("commands.new.description"))
      .action(newCommand);

    program
      .command("list")
      .description(t("commands.list.description"))
      .action(listCommand);

    program
      .command("review <pr-number>")
      .description(t("commands.review.description"))
      .action(reviewCommand);

    program
      .command("update <pr-number>")
      .description(t("commands.update.description"))
      .action(updateCommand);

    program
      .command("merge <pr-number>")
      .description(t("commands.merge.description"))
      .action(mergeCommand);

    program
      .command("reopen <pr-number>")
      .description(t("commands.reopen.description"))
      .action(reopenCommand);

    // 커밋 명령어 추가
    program
      .command("commit")
      .description(t("commands.commit.description"))
      .argument("[subcommand]", t("commands.commit.args.subcommand"))
      .argument("[message]", t("commands.commit.args.message"))
      .option("-a, --all", t("commands.commit.options.all_with_push"))
      .option("-p, --patch", t("commands.commit.options.patch"))
      .addHelpText(
        "after",
        `
        ${t("commands.commit.help.examples")}:
          $ autopr commit                    - ${t("commands.commit.help.default")}
          $ autopr commit -a                 - ${t("commands.commit.help.all_with_push")}
          $ autopr commit improve            - ${t("commands.commit.help.improve_last")}
          $ autopr commit improve "message"  - ${t("commands.commit.help.improve_message")}
          $ autopr commit improve -a         - ${t("commands.commit.help.improve_all_with_push")}
      `,
      )
      .action(commitCommand);

    // 언어 설정 명령어
    program.addCommand(createLangCommand());

    // Git 훅 처리 명령어
    program.addCommand(createHookCommand());

    // Collaborator 관리 명령어
    program.addCommand(createCollaboratorCommand());

    // 새로운 reviewer-group 명령어 추가
    program.addCommand(createReviewerGroupCommand());

    await program.parseAsync();
  } catch (error) {
    log.error(t("common.error.unknown"), error);
    process.exit(1);
  }
}

main();
