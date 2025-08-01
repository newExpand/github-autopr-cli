#!/usr/bin/env node
import { Command } from "commander";
import { initializeI18n, t } from "../i18n/index.js";
import { initCommand } from "./commands/init.js";
import { newCommand } from "./commands/new.js";
import { listCommand } from "./commands/list.js";
import { updateCommand } from "./commands/update.js";
import { mergeCommand } from "./commands/merge.js";
import { reopenCommand } from "./commands/reopen.js";
import { createLangCommand } from "./commands/lang.js";
import { createCollaboratorCommand } from "./commands/collaborator.js";
import { commitCommand } from "./commands/commit.js";
import { loadConfig } from "../core/config.js";
import { log } from "../utils/logger.js";
import { createReviewerGroupCommand } from "./commands/reviewer-group.js";
import { createDailyReportCommand } from "./commands/daily-report.js";
import { createTemplateCommand } from "./commands/template.js";
import { authGithubAppCommand } from "./commands/auth.js";

const program = new Command();

async function main() {
  try {
    const config = await loadConfig();
    await initializeI18n(config?.language);

    program
      .name("autopr")
      .description(t("commands.index.program.description"))
      .version("1.0.2");

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
      .option("-s, --select", t("commands.commit.options.select"))
      .option(
        "-sp, --selectpush",
        t("commands.commit.options.select_with_push"),
      )
      .option("-f, --force", t("commands.commit.options.force"))
      .addHelpText(
        "after",
        `
        ${t("commands.commit.help.examples")}:
          $ autopr commit                    - ${t("commands.commit.help.default")}
          $ autopr commit -a                 - ${t("commands.commit.help.all_with_push")}
          $ autopr commit -s                 - ${t("commands.commit.help.select")}
          $ autopr commit -sp                - ${t("commands.commit.help.select_with_push")}
          $ autopr commit -f                 - ${t("commands.commit.help.force")}
          $ autopr commit -af                - ${t("commands.commit.help.all_force")}
          $ autopr commit improve            - ${t("commands.commit.help.improve_last")}
          $ autopr commit improve "message"  - ${t("commands.commit.help.improve_message")}
          $ autopr commit improve -a         - ${t("commands.commit.help.improve_all_with_push")}
          $ autopr commit improve -sp        - ${t("commands.commit.help.improve_select_with_push")}
          $ autopr commit improve -f         - ${t("commands.commit.help.improve_force")}
      `,
      )
      .action(commitCommand);

    // 일일 커밋 보고서 명령어 추가
    program.addCommand(createDailyReportCommand());

    // 언어 설정 명령어
    program.addCommand(createLangCommand());

    // Collaborator 관리 명령어
    program.addCommand(createCollaboratorCommand());

    // 새로운 reviewer-group 명령어 추가
    program.addCommand(createReviewerGroupCommand());

    // 템플릿 관리 명령어 추가
    program.addCommand(createTemplateCommand());

    // 기타 명령어 등록 후 아래에 추가
    program
      .command("auth github-app")
      .description(t("commands.auth.github_app.description"))
      .action(authGithubAppCommand);

    await program.parseAsync();
  } catch (error) {
    log.error(t("commands.index.error.unknown"), error);
    process.exit(1);
  }
}

main();
