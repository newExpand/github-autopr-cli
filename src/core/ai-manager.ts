import OpenAI from "openai";
import { t } from "../i18n/index.js";
import { log } from "../utils/logger.js";
import { OPENROUTER_CONFIG } from "../config/openrouter.js";

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

  private constructor() {}

  static getInstance(): AIManager {
    if (!AIManager.instance) {
      AIManager.instance = new AIManager();
    }
    return AIManager.instance;
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
      if (config.provider === "openai") {
        this.openai = new OpenAI({
          apiKey: config.apiKey,
        });
      } else if (config.provider === "openrouter") {
        this.openai = new OpenAI({
          baseURL: OPENROUTER_CONFIG.BASE_URL,
          apiKey: config.apiKey || OPENROUTER_CONFIG.API_KEY,
        });
        config.options = config.options || {};
        config.options.model =
          config.options?.model || OPENROUTER_CONFIG.DEFAULT_MODEL;
      }
      this.aiConfig = config;
      this.isInitialized = true;
      this.initializationPromise = null;
      log.info(t("ai.initialization.success"));
    } catch (error) {
      this.reset();
      log.error(t("ai.initialization.failed"), error);
      throw error;
    }
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
