import OpenAI from "openai";
import { t } from "../i18n/index.js";
import { log } from "../utils/logger.js";
import { OPENROUTER_CONFIG } from "../config/openrouter.js";
import { ensureKeyActive } from "../utils/openrouter-provisioning.js";

const AI_PROVIDERS = ["openai", "openrouter"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

export class AIManager {
  private static instance: AIManager;
  private aiConfig: AIConfig | null = null;
  private openai: OpenAI | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private lastKeyActivationCheck: number = 0;
  private readonly KEY_ACTIVATION_CHECK_THRESHOLD = 60 * 60 * 1000; // 1시간 임계값 (60분)

  private constructor() {
    // 인스턴스 생성 시 아무 작업도 하지 않음
  }

  static getInstance(): AIManager {
    if (!AIManager.instance) {
      AIManager.instance = new AIManager();
    }
    return AIManager.instance;
  }

  /**
   * 필요한 경우에만 API 키 상태를 확인합니다.
   * 마지막 확인 시간으로부터 일정 시간이 지났을 때만 실행됩니다.
   */
  private async checkKeyStatusIfNeeded(): Promise<void> {
    // OpenRouter가 아니면 확인하지 않음
    if (this.aiConfig?.provider !== "openrouter") {
      return;
    }

    const now = Date.now();
    // 마지막 확인 시간으로부터 1시간 이상 지났을 때만 확인
    if (
      now - this.lastKeyActivationCheck >
      this.KEY_ACTIVATION_CHECK_THRESHOLD
    ) {
      try {
        log.debug("API 키 상태 주기적 확인 중...");
        await ensureKeyActive().catch(() => {
          // 에러 발생 시 무시하고 계속 진행
        });
      } catch (error) {
        // 에러 로깅 없이 조용히 진행
      }
      this.lastKeyActivationCheck = now;
    }
  }

  async initialize(config: AIConfig): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    if (this.isInitialized) {
      if (JSON.stringify(this.aiConfig) === JSON.stringify(config)) {
        log.debug("AI가 이미 초기화되어 있습니다.");
        return;
      }
      this.reset();
    }

    this.initializationPromise = this._initialize(config);
    return this.initializationPromise;
  }

  private async _initialize(config: AIConfig): Promise<void> {
    try {
      // OpenRouter인 경우 API 키 상태 확인
      if (config.provider === "openrouter") {
        await this.checkOpenRouterKeyStatus();
      }

      // 제공자별 초기화 함수 매핑
      const providerInitializers: Record<
        AIProvider,
        (config: AIConfig) => void
      > = {
        openai: this.initializeOpenAI.bind(this),
        openrouter: this.initializeOpenRouter.bind(this),
      };

      const initializer = providerInitializers[config.provider];
      if (!initializer) {
        throw new Error(`지원하지 않는 AI 제공자: ${config.provider}`);
      }

      initializer(config);
      this.aiConfig = config;
      this.isInitialized = true;
      this.initializationPromise = null;
    } catch (error) {
      this.reset();
      log.error(t("ai.initialization.failed"), error);
      throw error;
    }
  }

  private async checkOpenRouterKeyStatus(): Promise<void> {
    try {
      log.debug("OpenRouter API 키 상태 확인 중...");
      await ensureKeyActive().catch(() => {
        // 에러가 발생해도 무시하고 계속 진행
      });
      // 마지막 확인 시간 업데이트
      this.lastKeyActivationCheck = Date.now();
    } catch (error) {
      // 에러 로깅 없이 조용히 진행
    }
  }

  private initializeOpenAI(config: AIConfig): void {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
    });
  }

  private initializeOpenRouter(config: AIConfig): void {
    this.openai = new OpenAI({
      baseURL: OPENROUTER_CONFIG.BASE_URL,
      apiKey: config.apiKey || OPENROUTER_CONFIG.API_KEY,
    });
    config.options = config.options || {};
    config.options.model =
      config.options?.model || OPENROUTER_CONFIG.DEFAULT_MODEL;
  }

  private reset(): void {
    this.openai = null;
    this.aiConfig = null;
    this.isInitialized = false;
    this.initializationPromise = null;
  }

  isEnabled(): boolean {
    return this.isInitialized && !!this.aiConfig;
  }

  getOpenAI(): OpenAI {
    if (!this.openai) {
      throw new Error(t("ai.error.not_initialized"));
    }

    // OpenAI 인스턴스를 가져올 때 필요하면 API 키 상태 확인
    this.checkKeyStatusIfNeeded();

    return this.openai;
  }

  getProvider(): AIProvider | null {
    return this.aiConfig?.provider || null;
  }

  getModel(): string | undefined {
    return this.aiConfig?.options?.model;
  }

  static getDefaultModels(provider: AIProvider): string[] {
    switch (provider) {
      case "openai":
        return ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"];
      case "openrouter":
        return [OPENROUTER_CONFIG.DEFAULT_MODEL];
      default:
        return [];
    }
  }

  static getModelDescription(model: string): string {
    switch (model) {
      case "claude-3-7-sonnet-latest":
        return t("ai.models.anthropic.claude_3_7_sonnet_latest.description");
      case "claude-3-5-sonnet-latest":
        return t("ai.models.anthropic.claude_3_5_sonnet_latest.description");
      case "claude-3-5-haiku-latest":
        return t("ai.models.anthropic.claude_3_5_haiku_latest.description");
      case "claude-3-opus-latest":
        return t("ai.models.anthropic.claude_3_opus_latest.description");
      case "claude-3-haiku-20240307":
        return t("ai.models.anthropic.claude_3_haiku_20240307.description");
      case "gpt-4":
        return t("ai.models.openai.gpt_4.description");
      case "gpt-3.5-turbo":
        return t("ai.models.openai.gpt_3_5_turbo.description");
      case "copilot-chat":
        return t("ai.models.github_copilot.copilot_chat.description");
      default:
        return "";
    }
  }
}
