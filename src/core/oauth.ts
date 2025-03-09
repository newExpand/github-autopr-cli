import { exec } from "child_process";
import { promisify } from "util";
import { updateConfig } from "./config.js";
import { t } from "../i18n/index.js";
import { log } from "../utils/logger.js";

const execAsync = promisify(exec);
const CLIENT_ID = "Ov23liOUU5SAXrmM5NAS";

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

async function getDeviceCode(): Promise<DeviceCodeResponse> {
  log.info(t("oauth.device_flow.initializing"));
  log.debug(t("oauth.device_flow.client_id", { clientId: CLIENT_ID }));

  const requestBody = {
    client_id: CLIENT_ID,
    scope: "repo read:user user:email",
  };
  log.debug(
    t("oauth.device_flow.request_data"),
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

  log.debug(t("oauth.device_flow.response_status"), response.status);
  log.debug(
    t("oauth.device_flow.response_headers"),
    JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2),
  );

  if (!response.ok) {
    const errorText = await response.text();
    log.error(t("oauth.device_flow.error_response"), errorText);
    throw new Error(
      t("oauth.device_flow.init_failed", {
        status: response.status,
        error: errorText,
      }),
    );
  }

  const data = await response.json();
  log.debug(
    t("oauth.device_flow.response_data"),
    JSON.stringify(data, null, 2),
  );
  return data as DeviceCodeResponse;
}

async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<string> {
  const startTime = Date.now();
  const expiresAt = startTime + expiresIn * 1000;

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
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          t("oauth.token.request_failed", { status: response.status }),
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
          throw new Error(t("oauth.token.expired"));
        }
        throw new Error(t("oauth.token.error", { error: data.error }));
      }

      if (!data.access_token) {
        throw new Error(t("oauth.token.missing"));
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

  throw new Error(t("oauth.token.expired"));
}

export async function setupOAuthCredentials(): Promise<void> {
  try {
    log.info("\n" + t("oauth.auth.starting"));

    // Device Flow 초기화
    const deviceCode = await getDeviceCode();

    // 사용자에게 인증 방법 안내
    log.section("🔐 GitHub 인증 안내");
    log.info(t("oauth.auth.instructions"));
    log.section("📋 인증 단계");
    log.step(
      "1️⃣ " + t("oauth.auth.open_url", { url: deviceCode.verification_uri }),
    );
    log.step(
      "2️⃣ " + t("oauth.auth.enter_code", { code: deviceCode.user_code }),
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
      log.warn(t("oauth.auth.browser_open_failed"));
    }

    log.section("⏳ 인증 대기 중");
    log.info(t("oauth.auth.waiting"));
    log.info(
      t("oauth.auth.time_limit", {
        minutes: Math.floor(deviceCode.expires_in / 60),
      }),
    );

    // 토큰을 받을 때까지 폴링
    const token = await pollForToken(
      deviceCode.device_code,
      deviceCode.interval,
      deviceCode.expires_in,
    );

    // 설정 업데이트
    await updateConfig({
      githubToken: token,
    });

    log.info("\n" + t("oauth.auth.success"));
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(t("oauth.auth.failed", { error: error.message }));
    }
    throw error;
  }
}
