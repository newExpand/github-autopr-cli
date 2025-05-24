import { exec } from "child_process";
import { promisify } from "util";
import { updateConfig } from "./config.js";
import { t } from "../i18n/index.js";
import { log } from "../utils/logger.js";
import { getAIClient } from "./ai-manager.js";

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

async function getDeviceCode(CLIENT_ID: string): Promise<DeviceCodeResponse> {
  log.info(t("core.oauth.device_flow.initializing"));
  log.debug(t("core.oauth.device_flow.client_id", { clientId: CLIENT_ID }));

  const requestBody = {
    client_id: CLIENT_ID,
    scope: "repo read:user user:email",
  };
  log.debug(
    t("core.oauth.device_flow.request_data"),
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

  log.debug(t("core.oauth.device_flow.response_status"), response.status);
  log.debug(
    t("core.oauth.device_flow.response_headers"),
    JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2),
  );

  if (!response.ok) {
    const errorText = await response.text();
    log.error(t("core.oauth.device_flow.error_response"), errorText);
    throw new Error(
      t("core.oauth.device_flow.init_failed", {
        status: response.status,
        error: errorText,
      }),
    );
  }

  const data = await response.json();
  log.debug(
    t("core.oauth.device_flow.response_data"),
    JSON.stringify(data, null, 2),
  );
  return data as DeviceCodeResponse;
}

async function pollForToken(
  CLIENT_ID: string,
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
          t("core.oauth.token.request_failed", { status: response.status }),
        );
      }

      const data = (await response.json()) as AccessTokenResponse;

      if (data.error) {
        if (data.error === "authorization_pending") {
          await new Promise((resolve) => setTimeout(resolve, interval * 1000));
          continue;
        }
        if (data.error === "slow_down") {
          interval += 5;
          await new Promise((resolve) => setTimeout(resolve, interval * 1000));
          continue;
        }
        if (data.error === "expired_token") {
          throw new Error(t("core.oauth.token.expired"));
        }
        throw new Error(t("core.oauth.token.error", { error: data.error }));
      }

      if (!data.access_token) {
        throw new Error(t("core.oauth.token.missing"));
      }

      return data.access_token;
    } catch (error) {
      if (error instanceof Error && error.message.includes("expired")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    }
  }

  throw new Error(t("core.oauth.token.expired"));
}

export async function setupOAuthCredentials(): Promise<void> {
  try {
    log.info("\n" + t("core.oauth.auth.starting"));

    const { oauthClientId } = await getAIClient().getGitHubOAuthClientInfo();

    const deviceCode = await getDeviceCode(oauthClientId);

    log.section(t("core.oauth.ui.auth_guide_title"));
    log.info(t("core.oauth.auth.instructions"));
    log.section(t("core.oauth.ui.auth_steps_title"));
    log.step(
      "1️⃣ " +
        t("core.oauth.auth.open_url", { url: deviceCode.verification_uri }),
    );
    log.step(
      "2️⃣ " + t("core.oauth.auth.enter_code", { code: deviceCode.user_code }),
    );

    try {
      if (process.platform === "darwin") {
        await execAsync(`open "${deviceCode.verification_uri}"`);
      } else if (process.platform === "win32") {
        await execAsync(`start "${deviceCode.verification_uri}"`);
      } else {
        await execAsync(`xdg-open "${deviceCode.verification_uri}"`);
      }
    } catch (error) {
      log.warn(t("core.oauth.auth.browser_open_failed"));
    }

    log.section(t("core.oauth.ui.auth_waiting_title"));
    log.info(t("core.oauth.auth.waiting"));
    log.info(
      t("core.oauth.auth.time_limit", {
        minutes: Math.floor(deviceCode.expires_in / 60),
      }),
    );

    const token = await pollForToken(
      oauthClientId,
      deviceCode.device_code,
      deviceCode.interval,
      deviceCode.expires_in,
    );

    await updateConfig({ githubToken: token });

    log.info("\n" + t("core.oauth.auth.success"));
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(t("core.oauth.auth.failed", { error: error.message }));
    }
    throw error;
  }
}
