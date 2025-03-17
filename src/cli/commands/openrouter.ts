/**
 * OpenRouter API 키 관리 명령어 (개발 전용)
 *
 * 이 파일은 개발 중에만 사용되는 명령어를 포함하고 있습니다.
 * 프로덕션 환경에서는 NODE_ENV=development 설정 시에만 활성화됩니다.
 * 실제 사용자에게는 이 명령어가 노출되지 않으며, API 키 활성화는 자동으로 처리됩니다.
 */
import { Command } from "commander";
import { t } from "../../i18n/index.js";
import { log } from "../../utils/logger.js";
import {
  getKey,
  listKeys,
  updateKeyStatus,
} from "../../utils/openrouter-provisioning.js";
import { OPENROUTER_CONFIG } from "../../config/openrouter.js";

// OpenRouter API 키 정보 조회 명령어
async function getKeyCommand(hash?: string): Promise<void> {
  try {
    // 키 해시가 제공되지 않은 경우 기본 API 키 해시 사용
    const keyHash = hash || OPENROUTER_CONFIG.API_KEY_HASH;
    log.debug(`사용할 API 키 해시: ${keyHash}`);

    const result = await getKey(keyHash);

    log.info(t("commands.openrouter.info.key_info"));
    log.info(JSON.stringify(result, null, 2));
  } catch (error) {
    log.error(t("commands.openrouter.error.get_key_failed"), error);
  }
}

// OpenRouter API 키 목록 조회 명령어
async function listKeysCommand(options: { offset?: number }): Promise<void> {
  try {
    const result = await listKeys(options.offset || 0);

    log.info(t("commands.openrouter.info.key_list"));
    log.info(JSON.stringify(result, null, 2));
  } catch (error) {
    log.error(t("commands.openrouter.error.list_keys_failed"), error);
  }
}

// OpenRouter API 키 활성화/비활성화 명령어
async function updateKeyStatusCommand(
  hash?: string,
  options: { enable?: boolean; disable?: boolean } = {},
): Promise<void> {
  try {
    // 키 해시가 제공되지 않은 경우 기본 API 키 해시 사용
    const keyHash = hash || OPENROUTER_CONFIG.API_KEY_HASH;
    log.debug(`사용할 API 키 해시: ${keyHash}`);

    // enable과 disable 옵션 중 하나만 지정되어야 함
    if (options.enable && options.disable) {
      log.error(t("commands.openrouter.error.conflicting_options"));
      return;
    }

    // 옵션이 지정되지 않은 경우 현재 상태 확인
    if (!options.enable && !options.disable) {
      const keyInfo = await getKey(keyHash);
      // API 응답 형식에 맞게 타입 지정
      interface KeyResponse {
        data: {
          disabled: boolean;
          [key: string]: any;
        };
      }
      const typedKeyInfo = keyInfo as KeyResponse;
      log.info(
        t("commands.openrouter.info.key_status", {
          status: typedKeyInfo.data.disabled ? "비활성화" : "활성화",
        }),
      );
      return;
    }

    // 키 상태 업데이트
    const disabled = options.disable === true;
    const result = await updateKeyStatus(keyHash, disabled);

    log.info(
      t("commands.openrouter.success.key_status_updated", {
        status: disabled ? "비활성화" : "활성화",
      }),
    );
    log.info(JSON.stringify(result, null, 2));
  } catch (error) {
    log.error(t("commands.openrouter.error.update_key_status_failed"), error);
  }
}

// OpenRouter 명령어 생성
export function createOpenRouterCommand(): Command {
  const openrouterCommand = new Command("openrouter").description(
    t("commands.openrouter.description"),
  );

  // get 서브커맨드
  openrouterCommand
    .command("get [keyHash]")
    .description(t("commands.openrouter.get.description"))
    .action(getKeyCommand);

  // list 서브커맨드
  openrouterCommand
    .command("list")
    .description(t("commands.openrouter.list.description"))
    .option(
      "-o, --offset <number>",
      t("commands.openrouter.list.options.offset"),
    )
    .action(listKeysCommand);

  // status 서브커맨드
  openrouterCommand
    .command("status [keyHash]")
    .description(t("commands.openrouter.status.description"))
    .option("-e, --enable", t("commands.openrouter.status.options.enable"))
    .option("-d, --disable", t("commands.openrouter.status.options.disable"))
    .action(updateKeyStatusCommand);

  return openrouterCommand;
}
