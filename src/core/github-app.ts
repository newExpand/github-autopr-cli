import { exec } from "child_process";
import { promisify } from "util";
import { updateConfig } from "./config.js";
import { t } from "../i18n/index.js";
import { log } from "../utils/logger.js";
import { loadConfig } from "./config.js";
import inquirer from "inquirer";
import { aiClient } from "./ai-manager.js";

const execAsync = promisify(exec);

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
}

// 설치 정보 타입 추가
interface Installation {
  id: number;
  account: {
    login: string;
  };
  app_id?: number;
}

/**
 * GitHub App 설치 토큰 발급
 * @param installationId 설치 ID
 * @returns 설치 액세스 토큰
 */
export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  try {
    // 서버 API를 통해 토큰 획득
    const token = await aiClient.getGitHubAppToken(installationId);
    log.debug(t("core.github_app.token.success"));
    return token;
  } catch (error) {
    // 서버 API 실패 시 오류 전달
    log.error(t("core.github_app.token.failed"));
    throw new Error(
      `${t("core.github_app.error.token_request_failed", { status: error instanceof Error ? error.message : t("core.github_app.error.unknown") })}`,
    );
  }
}

/**
 * GitHub App 설치 목록 조회
 * @returns 설치 목록
 */
export async function listInstallations(): Promise<Installation[]> {
  try {
    // 서버 API를 통해 설치 목록 요청
    const installations =
      await aiClient.getGitHubAppInstallations<Installation[]>();
    return installations;
  } catch (error) {
    // 서버 API 실패 시 오류 전달
    log.error(t("core.github_app.installations.fetch_failed"));
    throw new Error(
      `${t("core.github_app.error.list_installations_failed", { status: error instanceof Error ? error.message : t("core.github_app.error.unknown") })}`,
    );
  }
}

/**
 * GitHub App Device Flow 시작
 * @returns Device 코드 정보
 */
async function getDeviceCode(): Promise<DeviceCodeResponse> {
  log.info(t("core.github_app.device_flow.initializing"));

  try {
    // 서버에서 GitHub App 정보(clientId) 가져오기
    const appInfo = await aiClient.getGitHubAppInfo();

    process.stdout.write(JSON.stringify(appInfo, null, 2));
    log.debug(
      t("core.github_app.device_flow.client_id", {
        clientId: appInfo.clientId,
      }),
    );

    const requestBody = {
      client_id: appInfo.clientId,
      scope: "repo read:user user:email",
    };
    log.debug(
      t("core.github_app.device_flow.request_data"),
      JSON.stringify(requestBody, null, 2),
    );

    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AutoPR-CLI",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(requestBody),
    });

    // Response 객체에서 실제로 유용한 정보만 추출해서 로깅
    // log.debug("Response status:", response.status);
    // log.debug("Response statusText:", response.statusText);

    process.stdout.write(
      JSON.stringify(`==${response.status} ${response.statusText}==`, null, 2),
    );

    // 로깅보다 응답 처리가 우선이므로 OK 체크를 먼저 함
    if (!response.ok) {
      const errorText = await response.text();
      log.error(t("core.github_app.device_flow.error_response"), errorText);
      throw new Error(
        t("core.github_app.device_flow.init_failed", {
          status: response.status,
          error: errorText,
        }),
      );
    }

    const data = await response.json();
    log.debug(
      t("core.github_app.device_flow.response_data"),
      JSON.stringify(data, null, 2),
    );
    return data as DeviceCodeResponse;
  } catch (error) {
    log.error(
      t("core.github_app.error.app_info_failed", {
        status:
          error instanceof Error
            ? error.message
            : t("core.github_app.error.unknown"),
      }),
    );
    throw new Error(
      `${t("core.github_app.device_flow.init_failed", { status: "", error: error instanceof Error ? error.message : t("core.github_app.error.unknown") })}`,
    );
  }
}

/**
 * 사용자 인증 토큰 폴링
 * @param deviceCode Device 코드
 * @param interval 폴링 간격
 * @param expiresIn 만료 시간
 * @returns 액세스 토큰
 */
async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<string> {
  const startTime = Date.now();
  const expiresAt = startTime + expiresIn * 1000;

  // 서버에서 GitHub App 정보(clientId) 가져오기
  const appInfo = await aiClient.getGitHubAppInfo();
  const clientId = appInfo.clientId;

  while (Date.now() < expiresAt) {
    try {
      const response = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "AutoPR-CLI",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          t("core.github_app.token.request_failed", {
            status: response.status,
          }),
        );
      }

      const data = (await response.json()) as AccessTokenResponse;

      if (data.error) {
        if (data.error === "authorization_pending") {
          // 사용자가 아직 인증을 완료하지 않음
          await new Promise((resolve) => setTimeout(resolve, interval * 1000));
          continue;
        }
        if (data.error === "slow_down") {
          // GitHub가 요청 속도를 늦추라고 요청
          interval += 5;
          await new Promise((resolve) => setTimeout(resolve, interval * 1000));
          continue;
        }
        if (data.error === "expired_token") {
          throw new Error(t("core.github_app.token.expired"));
        }
        throw new Error(
          t("core.github_app.token.error", { error: data.error }),
        );
      }

      if (!data.access_token) {
        throw new Error(t("core.github_app.token.missing"));
      }

      return data.access_token;
    } catch (error) {
      if (error instanceof Error && error.message.includes("expired")) {
        throw error;
      }
      // 네트워크 오류 등은 재시도
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    }
  }

  throw new Error(t("core.github_app.token.expired"));
}

/**
 * GitHub App 설정 초기화
 */
export async function setupGitHubAppCredentials(): Promise<void> {
  try {
    log.info("\n" + t("core.github_app.setup.starting"));

    // Device Flow 초기화
    const deviceCode = await getDeviceCode();

    // 사용자에게 인증 방법 안내
    log.section(t("core.github_app.ui.auth_guide_title"));
    log.info(t("core.github_app.auth.instructions"));
    log.section(t("core.github_app.ui.auth_steps_title"));
    log.step(
      "1️⃣ " +
        t("core.github_app.auth.open_url", {
          url: deviceCode.verification_uri,
        }),
    );
    log.step(
      "2️⃣ " +
        t("core.github_app.auth.enter_code", {
          code: deviceCode.user_code,
        }),
    );

    // 브라우저 자동 실행
    try {
      if (process.platform === "darwin") {
        await execAsync(`open "${deviceCode.verification_uri}"`);
      } else if (process.platform === "win32") {
        await execAsync(`start "${deviceCode.verification_uri}"`);
      } else {
        await execAsync(`xdg-open "${deviceCode.verification_uri}"`);
      }
    } catch (error) {
      // 브라우저를 열지 못해도 계속 진행 (사용자가 수동으로 URL을 열 수 있음)
      log.warn(t("core.github_app.auth.browser_open_failed"));
    }

    log.section(t("core.github_app.ui.auth_waiting_title"));
    log.info(t("core.github_app.auth.waiting"));
    log.info(
      t("core.github_app.auth.time_limit", {
        minutes: Math.floor(deviceCode.expires_in / 60),
      }),
    );

    // 토큰을 받을 때까지 폴링
    const token = await pollForToken(
      deviceCode.device_code,
      deviceCode.interval,
      deviceCode.expires_in,
    );

    // 토큰으로 설치 목록 직접 가져오기
    log.info(t("core.github_app.installations.fetching"));
    const installationsResponse = await fetch(
      "https://api.github.com/user/installations",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "AutoPR-CLI",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!installationsResponse.ok) {
      throw new Error(
        t("core.github_app.error.list_installations_failed", {
          status: installationsResponse.status,
        }),
      );
    }

    // 응답 내용 로깅
    const installationsRawData = (await installationsResponse.json()) as {
      installations?: Installation[];
    };
    log.debug(
      "Installations response: " +
        JSON.stringify(installationsRawData, null, 2),
    );

    // 응답 구조 처리
    const installations = installationsRawData.installations || [];

    if (installations.length === 0) {
      // 앱 정보 가져오기
      log.info(t("core.github_app.installations.not_found"));

      // 앱 설치 안내 시작
      log.section(t("core.github_app.ui.install_required_title"));
      log.warn(t("core.github_app.ui.install_not_found"));
      log.info(t("core.github_app.ui.install_steps"));
      log.step(t("core.github_app.ui.install_browser_step"));

      // 서버에서 GitHub App 정보 가져오기
      const appInfo = await aiClient.getGitHubAppInfo();
      let appId = appInfo.appId;
      let installUrl = `https://github.com/apps/new-autopr-bot/installations/new`;

      // 앱 정보 가져오기 시도
      try {
        const appInfoResponse = await fetch("https://api.github.com/app", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "AutoPR-CLI",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });

        if (appInfoResponse.ok) {
          const appInfo = (await appInfoResponse.json()) as {
            id?: number;
            name?: string;
            html_url?: string;
          };
          log.debug("App info: " + JSON.stringify(appInfo, null, 2));

          // 가져온 정보로 업데이트
          if (appInfo.id) {
            appId = appInfo.id.toString();
          }
          if (appInfo.html_url) {
            installUrl = appInfo.html_url;
          }
        }
      } catch (error) {
        // 앱 정보를 가져오지 못해도 계속 진행
        log.debug("Failed to get app info, using default values");
      }

      // 앱 설치 URL 생성 및 브라우저로 열기
      log.step(t("core.github_app.ui.install_url_step", { url: installUrl }));
      log.step(t("core.github_app.ui.install_select_step"));

      try {
        if (process.platform === "darwin") {
          await execAsync(`open "${installUrl}"`);
        } else if (process.platform === "win32") {
          await execAsync(`start "${installUrl}"`);
        } else {
          await execAsync(`xdg-open "${installUrl}"`);
        }
      } catch (error) {
        log.warn(t("core.github_app.auth.browser_open_failed"));
      }

      // 사용자에게 설치 완료 여부 확인
      log.section(t("core.github_app.ui.install_completion_title"));

      // 사용자 입력 받기
      const { confirmed } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmed",
          message: t("core.github_app.ui.install_confirm"),
          default: false,
        },
      ]);

      if (!confirmed) {
        throw new Error(t("core.github_app.error.installation_cancelled"));
      }

      // 설치 정보 다시 확인
      log.info(t("core.github_app.installations.verification"));
      const refreshResponse = await fetch(
        "https://api.github.com/user/installations",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "AutoPR-CLI",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );

      if (refreshResponse.ok) {
        const refreshData = (await refreshResponse.json()) as {
          installations?: Installation[];
        };
        const refreshInstallations = refreshData.installations || [];

        if (refreshInstallations.length > 0) {
          log.info(t("core.github_app.installations.success"));
          // 첫 번째 설치 ID 사용
          const installationId = refreshInstallations[0].id;

          // 설정 저장
          await updateConfig({
            githubApp: {
              appId,
              clientId: appInfo.clientId,
              installationId,
            },
          });

          // 설정 완료 메시지
          log.info("\n" + t("core.github_app.auth.success"));
          log.info(t("core.github_app.setup.auto_complete"));
          return;
        }
      }

      throw new Error(
        t("core.github_app.error.installation_verification_failed"),
      );
    }

    let installationId = installations[0].id;
    // 설치 정보에서 앱 ID 추출
    const appId = installations[0].app_id
      ? installations[0].app_id.toString()
      : (await aiClient.getGitHubAppInfo()).appId;

    // 여러 설치가 있는 경우 사용자에게 선택 요청
    if (installations.length > 1) {
      log.info(t("core.github_app.setup.multiple_installations"));

      // 설치 목록 표시
      installations.forEach((inst: Installation, index: number) => {
        log.info(`${index + 1}. ${inst.account.login} (${inst.id})`);
      });

      // inquirer로 사용자에게 선택 요청
      const { selectedInstallation } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedInstallation",
          message: t("core.github_app.ui.multiple_installations"),
          choices: installations.map((inst, index) => ({
            name: `${inst.account.login} (${inst.id})`,
            value: index,
          })),
          default: 0,
        },
      ]);

      installationId = installations[selectedInstallation].id;
    }

    // 서버에서 GitHub App 정보 가져오기
    const appInfo = await aiClient.getGitHubAppInfo();

    // 설정 저장
    await updateConfig({
      githubApp: {
        appId,
        clientId: appInfo.clientId,
        installationId,
      },
    });

    // 설정 완료 메시지
    log.info("\n" + t("core.github_app.auth.success"));
    log.info(t("core.github_app.setup.auto_complete"));
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(
        t("core.github_app.auth.failed", { error: error.message }),
      );
    }
    throw error;
  }
}
