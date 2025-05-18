import { Command } from "commander";
import { t } from "../../i18n/index.js";
import { log } from "../../utils/logger.js";
import inquirer from "inquirer";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const TEMPLATES_DIR = ".github/PR_TEMPLATES";

// 템플릿 디렉토리가 존재하는지 확인하고, 없으면 생성
async function ensureTemplateDirectory(): Promise<string> {
  try {
    const cwd = process.cwd();
    const templatesDir = path.join(cwd, TEMPLATES_DIR);

    try {
      await fs.access(templatesDir);
    } catch (error) {
      // 디렉토리가 없으면 생성
      await fs.mkdir(templatesDir, { recursive: true });
      log.info(
        t("commands.template.info.directory_created", { dir: TEMPLATES_DIR }),
      );
    }

    return templatesDir;
  } catch (error) {
    log.error(t("commands.template.error.directory_create_failed"), error);
    throw error;
  }
}

// 사용 가능한 모든 템플릿 목록 가져오기
export async function getAvailableTemplates(): Promise<string[]> {
  try {
    const templatesDir = await ensureTemplateDirectory();
    const files = await fs.readdir(templatesDir);
    return files
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(".md", ""));
  } catch (error) {
    log.error(t("commands.template.error.list_failed"), error);
    return [];
  }
}

// 템플릿 내용 가져오기
async function getTemplateContent(templateName: string): Promise<string> {
  try {
    const templatesDir = await ensureTemplateDirectory();
    const templatePath = path.join(templatesDir, `${templateName}.md`);
    return await fs.readFile(templatePath, "utf-8");
  } catch (error) {
    log.error(
      t("commands.template.error.read_failed", { name: templateName }),
      error,
    );
    throw error;
  }
}

// 템플릿 저장하기
async function saveTemplate(
  templateName: string,
  content: string,
): Promise<void> {
  try {
    const templatesDir = await ensureTemplateDirectory();
    const templatePath = path.join(templatesDir, `${templateName}.md`);
    await fs.writeFile(templatePath, content);
    log.info(t("commands.template.success.saved", { name: templateName }));
  } catch (error) {
    log.error(
      t("commands.template.error.save_failed", { name: templateName }),
      error,
    );
    throw error;
  }
}

// 템플릿 삭제하기
async function deleteTemplate(templateName: string): Promise<void> {
  try {
    const templatesDir = await ensureTemplateDirectory();
    const templatePath = path.join(templatesDir, `${templateName}.md`);
    await fs.unlink(templatePath);
    log.info(t("commands.template.success.deleted", { name: templateName }));
  } catch (error) {
    log.error(
      t("commands.template.error.delete_failed", { name: templateName }),
      error,
    );
    throw error;
  }
}

// 에디터로 템플릿 편집하기
async function editTemplateInEditor(
  templateName: string,
  initialContent = "",
): Promise<string> {
  // 임시 파일 생성
  const tempFilePath = path.join(process.cwd(), `.${templateName}.md.tmp`);

  try {
    // 초기 내용 작성
    await fs.writeFile(tempFilePath, initialContent);

    // 기본 에디터 열기
    const editor = process.env.EDITOR || process.env.VISUAL || "vi";

    log.info(t("commands.template.info.opening_editor", { editor }));
    await execAsync(`${editor} ${tempFilePath}`);

    // 편집된 내용 읽기
    const editedContent = await fs.readFile(tempFilePath, "utf-8");

    // 임시 파일 삭제
    await fs.unlink(tempFilePath);

    return editedContent;
  } catch (error) {
    log.error(
      t("commands.template.error.edit_failed", { name: templateName }),
      error,
    );
    // 임시 파일 정리 시도
    try {
      await fs.unlink(tempFilePath);
    } catch (e) {
      // 무시
    }
    throw error;
  }
}

// 템플릿 목록 명령어
async function listTemplates(quiet = false): Promise<void> {
  try {
    const templates = await getAvailableTemplates();

    if (templates.length === 0) {
      if (!quiet) {
        log.info(t("commands.template.info.no_templates"));
      }
      return;
    }

    if (!quiet) {
      log.info(t("commands.template.info.available_templates"));
    }

    templates.forEach((template, index) => {
      console.log(`${index + 1}. ${template}`);
    });
  } catch (error) {
    if (!quiet) {
      log.error(t("commands.template.error.list_failed"), error);
    }
  }
}

// 템플릿 생성 명령어
async function createTemplate(templateName?: string): Promise<void> {
  try {
    if (!templateName) {
      const { name } = await inquirer.prompt([
        {
          type: "input",
          name: "name",
          message: t("commands.template.prompts.enter_name"),
          validate: (input) =>
            input.trim().length > 0 ||
            t("commands.template.validation.name_required"),
        },
      ]);
      templateName = name;
    }

    // 템플릿 이름이 필요함
    if (!templateName) {
      log.error(t("commands.template.error.template_name_required"));
      return;
    }

    // 기본 템플릿 내용
    const defaultContent = `## Description
What does this PR do?

## Changes
- 

## Testing
- [ ] Test 1
- [ ] Test 2

## Screenshots

## Checklist
- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] Tests added
`;

    // 에디터로 편집
    const content = await editTemplateInEditor(templateName, defaultContent);

    // 저장
    await saveTemplate(templateName, content);
  } catch (error) {
    log.error(
      t("commands.template.error.create_failed", {
        name: templateName || "unknown",
      }),
      error,
    );
  }
}

// 템플릿 편집 명령어
async function editTemplate(templateName?: string): Promise<void> {
  try {
    const templates = await getAvailableTemplates();

    if (templates.length === 0) {
      log.info(t("commands.template.info.no_templates"));
      return;
    }

    // 템플릿 선택 또는 이름으로 찾기
    if (!templateName) {
      const { template } = await inquirer.prompt([
        {
          type: "list",
          name: "template",
          message: t("commands.template.prompts.select_template"),
          choices: templates,
        },
      ]);
      templateName = template;
    } else if (!templates.includes(templateName)) {
      log.error(
        t("commands.template.error.template_not_found", { name: templateName }),
      );
      return;
    }

    // 이 시점에서는 templateName이 반드시 string 타입이어야 함
    if (!templateName) {
      log.error(t("commands.template.error.template_name_required"));
      return;
    }

    // 기존 내용 가져오기
    const currentContent = await getTemplateContent(templateName);

    // 에디터로 편집
    const newContent = await editTemplateInEditor(templateName, currentContent);

    // 변경 사항이 있는지 확인
    if (newContent === currentContent) {
      log.info(t("commands.template.info.no_changes"));
      return;
    }

    // 저장
    await saveTemplate(templateName, newContent);
  } catch (error) {
    log.error(
      t("commands.template.error.edit_failed", {
        name: templateName || "unknown",
      }),
      error,
    );
  }
}

// 템플릿 삭제 명령어
async function deleteTemplateCommand(templateName?: string): Promise<void> {
  try {
    const templates = await getAvailableTemplates();

    if (templates.length === 0) {
      log.info(t("commands.template.info.no_templates"));
      return;
    }

    // 템플릿 선택 또는 이름으로 찾기
    if (!templateName) {
      const { template } = await inquirer.prompt([
        {
          type: "list",
          name: "template",
          message: t("commands.template.prompts.select_delete"),
          choices: templates,
        },
      ]);
      templateName = template;
    } else if (!templates.includes(templateName)) {
      log.error(
        t("commands.template.error.template_not_found", { name: templateName }),
      );
      return;
    }

    // 이 시점에서는 templateName이 반드시 string 타입이어야 함
    if (!templateName) {
      log.error(t("commands.template.error.template_name_required"));
      return;
    }

    // 삭제 확인
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: t("commands.template.prompts.confirm_delete", {
          name: templateName,
        }),
        default: false,
      },
    ]);

    if (!confirm) {
      log.info(t("commands.template.info.delete_cancelled"));
      return;
    }

    // 삭제
    await deleteTemplate(templateName);
  } catch (error) {
    log.error(
      t("commands.template.error.delete_failed", {
        name: templateName || "unknown",
      }),
      error,
    );
  }
}

// 템플릿 보기 명령어
async function viewTemplate(templateName?: string): Promise<void> {
  try {
    const templates = await getAvailableTemplates();

    if (templates.length === 0) {
      log.info(t("commands.template.info.no_templates"));
      return;
    }

    // 템플릿 선택 또는 이름으로 찾기
    if (!templateName) {
      const { template } = await inquirer.prompt([
        {
          type: "list",
          name: "template",
          message: t("commands.template.prompts.select_view"),
          choices: templates,
        },
      ]);
      templateName = template;
    } else if (!templates.includes(templateName)) {
      log.error(
        t("commands.template.error.template_not_found", { name: templateName }),
      );
      return;
    }

    // 이 시점에서는 templateName이 반드시 string 타입이어야 함
    if (!templateName) {
      log.error(t("commands.template.error.template_name_required"));
      return;
    }

    // 내용 가져오기
    const content = await getTemplateContent(templateName);

    // 표시
    log.info(
      t("commands.template.info.template_content", { name: templateName }),
    );
    console.log("\n" + content + "\n");
  } catch (error) {
    log.error(
      t("commands.template.error.view_failed", {
        name: templateName || "unknown",
      }),
      error,
    );
  }
}

// 템플릿 명령어 생성
export function createTemplateCommand(): Command {
  const command = new Command("template")
    .description(t("commands.template.description"))
    .addHelpText(
      "after",
      `
${t("commands.template.help.examples")}:
  $ autopr template list              - ${t("commands.template.help.list")}
  $ autopr template create            - ${t("commands.template.help.create")}
  $ autopr template create feature-2  - ${t("commands.template.help.create_named")}
  $ autopr template edit              - ${t("commands.template.help.edit")}
  $ autopr template edit bugfix       - ${t("commands.template.help.edit_named")}
  $ autopr template delete            - ${t("commands.template.help.delete")}
  $ autopr template view              - ${t("commands.template.help.view")}
`,
    );

  command
    .command("list")
    .description(t("commands.template.subcommands.list"))
    .option("-q, --quiet", "Quiet mode - only output template names")
    .action((options) => listTemplates(options.quiet));

  command
    .command("create [name]")
    .description(t("commands.template.subcommands.create"))
    .action(createTemplate);

  command
    .command("edit [name]")
    .description(t("commands.template.subcommands.edit"))
    .action(editTemplate);

  command
    .command("delete [name]")
    .description(t("commands.template.subcommands.delete"))
    .action(deleteTemplateCommand);

  command
    .command("view [name]")
    .description(t("commands.template.subcommands.view"))
    .action(viewTemplate);

  return command;
}
