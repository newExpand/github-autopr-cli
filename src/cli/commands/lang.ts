import { Command } from "commander";
import { t, supportedLanguages, setLanguage } from "../../i18n/index.js";
import { updateConfig, loadConfig } from "../../core/config.js";
import { log } from "../../utils/logger.js";

export function createLangCommand(): Command {
  const langCommand = new Command("lang").description(
    t("commands.lang.description"),
  );

  langCommand
    .command("set")
    .description(t("commands.lang.description"))
    .argument("<language>", t("commands.lang.argument.language_code"))
    .action(async (language: string) => {
      try {
        if (!supportedLanguages.includes(language as any)) {
          log.error(t("commands.lang.error.unsupported", { language }));
          log.info(
            t("commands.lang.error.supported_list", {
              languages: supportedLanguages.join(", "),
            }),
          );
          process.exit(1);
        }

        await updateConfig({ language: language as any });
        await setLanguage(language);
        log.info(t("commands.lang.success.changed", { language }));
      } catch (error) {
        log.error(t("common.error.unknown", { error }));
        process.exit(1);
      }
    });

  langCommand
    .command("current")
    .description(t("commands.lang.description"))
    .action(async () => {
      try {
        const config = await loadConfig();
        log.info(
          t("commands.lang.success.current", {
            language: config?.language || "en",
          }),
        );
      } catch (error) {
        log.error(t("common.error.unknown", { error }));
        process.exit(1);
      }
    });

  return langCommand;
}
