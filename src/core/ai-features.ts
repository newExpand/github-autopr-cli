import { AIManager } from "./ai-manager.js";
import { log } from "../utils/logger.js";
import { t } from "../i18n/index.js";
import type { AIProvider } from "./ai-manager.js";
import dotenv from "dotenv";

interface PRChunk {
  files: string[];
  diff: string;
}

export class AIFeatures {
  private aiManager: AIManager;
  private readonly MAX_CHUNK_TOKENS = 1500; // 토큰 여유를 둠
  private readonly MAX_SUMMARY_TOKENS = 1000;

  constructor() {
    dotenv.config();

    this.aiManager = AIManager.getInstance();
    // .env 파일에서 설정 로드
    const provider = process.env.AI_PROVIDER as AIProvider;
    const apiKey = process.env.AI_API_KEY;
    const model = process.env.AI_MODEL;

    if (provider && apiKey && model) {
      this.aiManager
        .initialize({
          provider,
          apiKey,
          options: { model },
        })
        .catch((error) => {
          log.error(t("ai.error.initialization_failed"), error);
        });
    }
  }

  isEnabled(): boolean {
    return this.aiManager.isEnabled();
  }

  private async chunkPRContent(
    files: string[],
    diffContent: string,
  ): Promise<PRChunk[]> {
    const chunks: PRChunk[] = [];
    let currentFiles: string[] = [];
    let currentDiff = "";
    const diffLines = diffContent.split("\n");
    let currentTokenCount = 0;

    for (const line of diffLines) {
      if (line.startsWith("diff --git")) {
        // 새로운 파일의 diff 시작
        if (currentTokenCount > this.MAX_CHUNK_TOKENS) {
          // 현재 청크가 토큰 제한을 초과하면 새로운 청크 시작
          if (currentDiff) {
            chunks.push({
              files: [...currentFiles],
              diff: currentDiff,
            });
            currentFiles = [];
            currentDiff = "";
            currentTokenCount = 0;
          }
        }

        // 파일 경로 추출 및 현재 파일 목록에 추가
        const filePath = line.split(" ")[2].substring(2); // b/파일경로 에서 파일경로만 추출
        if (files.includes(filePath)) {
          currentFiles.push(filePath);
        }
      }

      // 현재 라인의 토큰 수 추정
      const lineTokens = this.getApproximateTokenCount(line);

      // 토큰 제한을 초과하면 새로운 청크 시작
      if (currentTokenCount + lineTokens > this.MAX_CHUNK_TOKENS) {
        if (currentDiff) {
          chunks.push({
            files: [...currentFiles],
            diff: currentDiff,
          });
          currentFiles = [];
          currentDiff = "";
          currentTokenCount = 0;
        }
      }

      currentDiff += line + "\n";
      currentTokenCount += lineTokens;
    }

    // 마지막 청크 추가
    if (currentDiff) {
      chunks.push({
        files: currentFiles,
        diff: currentDiff,
      });
    }

    return chunks;
  }

  private getApproximateTokenCount(text: string): number {
    // 대략적인 토큰 수 계산 (OpenAI의 경우 일반적으로 단어 수의 약 1.3배)
    return Math.ceil(text.split(/\s+/).length * 1.3);
  }

  private async processWithAI(
    prompt: string,
    maxTokens: number,
  ): Promise<string> {
    if (!this.aiManager.isEnabled()) {
      throw new Error(t("ai.error.not_initialized"));
    }

    const provider = this.aiManager.getProvider();
    const model = this.aiManager.getModel();

    if (!provider || !model) {
      throw new Error(t("ai.error.not_initialized"));
    }

    try {
      switch (provider) {
        case "openai": {
          const openai = this.aiManager.getOpenAI();
          const response = await openai.chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: maxTokens,
          });
          return response.choices[0]?.message?.content || "";
        }
        case "anthropic": {
          // Anthropic API 구현
          throw new Error("Anthropic API not implemented yet");
        }
        case "github-copilot": {
          // GitHub Copilot API 구현
          throw new Error("GitHub Copilot API not implemented yet");
        }
        default:
          throw new Error(t("ai.error.invalid_provider"));
      }
    } catch (error) {
      log.error(t("ai.error.processing_failed"), error);
      throw error;
    }
  }

  async generatePRDescription(
    files: string[],
    diffContent: string,
    options?: { template?: string },
  ): Promise<string> {
    try {
      const chunks = await this.chunkPRContent(files, diffContent);
      let descriptions: string[] = [];

      // 각 청크에 대한 설명 생성
      for (const chunk of chunks) {
        const prompt = t("ai.prompts.pr_description.analyze", {
          files: chunk.files.join(", "),
          diffContent: chunk.diff,
          template: options?.template || "",
        });

        const chunkDescription = await this.processWithAI(
          prompt,
          this.MAX_CHUNK_TOKENS,
        );
        descriptions.push(chunkDescription);
      }

      // 여러 청크가 있는 경우 최종 요약 생성
      if (chunks.length > 1) {
        const summaryPrompt = t("ai.prompts.pr_description.summarize", {
          descriptions: descriptions.join("\n\n"),
        });
        return await this.processWithAI(summaryPrompt, this.MAX_SUMMARY_TOKENS);
      }

      return descriptions[0];
    } catch (error) {
      log.error(t("ai.error.pr_description_failed"), error);
      throw error;
    }
  }

  async reviewCode(
    files: Array<{ path: string; content: string }>,
  ): Promise<string> {
    const filesStr = files
      .map((file) => {
        const path = t("ai.format.file.path", { path: file.path });
        const content = t("ai.format.file.content", { content: file.content });
        return `${path}\n${content}`;
      })
      .join("\n\n");

    const prompt = t("ai.prompts.code_review.analyze", {
      files: filesStr,
    });

    try {
      return await this.processWithAI(prompt, this.MAX_CHUNK_TOKENS);
    } catch (error) {
      log.error(t("ai.error.code_review_failed"), error);
      throw error;
    }
  }

  async suggestConflictResolution(
    conflicts: Array<{ file: string; conflict: string }>,
    prContext?: {
      title: string;
      description: string;
      changedFiles: Array<{
        filename: string;
        additions: number;
        deletions: number;
        changes: number;
      }>;
    },
  ): Promise<string> {
    const conflictsStr = conflicts
      .map((c) => {
        const file = t("ai.format.conflict.file", { file: c.file });
        const content = t("ai.format.conflict.content", {
          content: c.conflict,
        });
        return `${file}\n${content}`;
      })
      .join("\n\n");

    const contextStr = prContext
      ? `\nPR Title: ${prContext.title}\nPR Description: ${prContext.description}\nChanged Files:\n${prContext.changedFiles
          .map(
            (f) =>
              `- ${f.filename} (additions: ${f.additions}, deletions: ${f.deletions}, changes: ${f.changes})`,
          )
          .join("\n")}`
      : "";

    const prompt = t("ai.prompts.conflict_resolution.analyze", {
      conflicts: conflictsStr,
      context: contextStr,
    });

    try {
      return await this.processWithAI(prompt, 500);
    } catch (error) {
      log.error(t("ai.error.conflict_resolution_failed"), error);
      throw error;
    }
  }

  async improveCommitMessage(message: string, diff: string): Promise<string> {
    const prompt = t("ai.prompts.commit_message.analyze", {
      message,
      diff,
    });

    try {
      return await this.processWithAI(prompt, 300);
    } catch (error) {
      log.error(t("ai.error.commit_message_failed"), error);
      throw error;
    }
  }
}
