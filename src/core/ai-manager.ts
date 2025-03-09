import OpenAI from "openai";
import { t } from "../i18n/index.js";
import { log } from "../utils/logger.js";

const AI_PROVIDERS = ["openai", "github-copilot", "anthropic"] as const;
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

  private constructor() {}

  static getInstance(): AIManager {
    if (!AIManager.instance) {
      AIManager.instance = new AIManager();
    }
    return AIManager.instance;
  }

  async initialize(config: AIConfig): Promise<void> {
    try {
      if (config.provider === "openai") {
        this.openai = new OpenAI({
          apiKey: config.apiKey,
        });
      }
      this.aiConfig = config;
      this.isInitialized = true;
      log.info(t("ai.initialization.success"));
    } catch (error) {
      log.error(t("ai.initialization.failed"), error);
      throw error;
    }
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
      case "github-copilot":
        return ["copilot-chat"];
      case "anthropic":
        return [
          t("ai.models.anthropic.claude_3_7_sonnet_latest.name"), // claude-3-7-sonnet-latest
          t("ai.models.anthropic.claude_3_5_sonnet_latest.name"), // claude-3-5-sonnet-latest
          t("ai.models.anthropic.claude_3_5_haiku_latest.name"), // claude-3-5-haiku-latest
          t("ai.models.anthropic.claude_3_opus_latest.name"), // claude-3-opus-latest
          t("ai.models.anthropic.claude_3_haiku_20240307.name"), // claude-3-haiku-20240307
        ];
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
