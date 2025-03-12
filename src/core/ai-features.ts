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
  // OpenAI 기본 토큰 제한
  private readonly OPENAI_MAX_CHUNK_TOKENS = 1500;
  private readonly OPENAI_MAX_SUMMARY_TOKENS = 1000;
  // OpenRouter 토큰 제한 (Gemini Flash 2.0 기준)
  private readonly OPENROUTER_MAX_CHUNK_TOKENS = 4000;
  private readonly OPENROUTER_MAX_SUMMARY_TOKENS = 2000;

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

  private getMaxTokens(type: "chunk" | "summary"): number {
    const provider = this.aiManager.getProvider();
    if (provider === "openrouter") {
      return type === "chunk"
        ? this.OPENROUTER_MAX_CHUNK_TOKENS
        : this.OPENROUTER_MAX_SUMMARY_TOKENS;
    }
    return type === "chunk"
      ? this.OPENAI_MAX_CHUNK_TOKENS
      : this.OPENAI_MAX_SUMMARY_TOKENS;
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
    const maxChunkTokens = this.getMaxTokens("chunk");

    for (const line of diffLines) {
      if (line.startsWith("diff --git")) {
        // 새로운 파일의 diff 시작
        if (currentTokenCount > maxChunkTokens) {
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
      if (currentTokenCount + lineTokens > maxChunkTokens) {
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
    options: {
      temperature?: number;
      top_p?: number;
      presence_penalty?: number;
      frequency_penalty?: number;
      response_format?: { type: "json_object" } | { type: "text" };
      seed?: number;
      stream?: boolean;
      stop?: string[];
      systemPrompt?: string;
    } = {},
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
      const openai = this.aiManager.getOpenAI();

      const messages = [];

      // 시스템 프롬프트 추가 (있는 경우)
      if (options.systemPrompt) {
        messages.push({
          role: "system" as const,
          content: options.systemPrompt,
        });
      }

      // 사용자 프롬프트 추가
      messages.push({
        role: "user" as const,
        content: prompt,
      });

      const completion = await openai.chat.completions.create({
        model: model as any,
        messages,
        max_tokens: maxTokens,
        temperature: options.temperature ?? 0.7,
        top_p: options.top_p ?? 1,
        presence_penalty: options.presence_penalty ?? 0,
        frequency_penalty: options.frequency_penalty ?? 0,
        response_format: options.response_format ?? { type: "text" },
        seed: options.seed,
        stream: false, // 스트림 모드는 비활성화
        stop: options.stop,
      });

      return completion.choices[0]?.message?.content || "";
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
      const descriptions: string[] = [];

      const systemPrompt = `You are an expert code reviewer and technical writer. Your task is to analyze code changes and generate clear, comprehensive PR descriptions that:
1. Focus on the actual changes and their impact
2. Use professional and technical language
3. Organize information logically
4. Highlight important implementation details
5. Consider security and performance implications`;

      // 각 청크에 대한 설명 생성
      for (const chunk of chunks) {
        const prompt = t("ai.prompts.pr_description.analyze", {
          files: chunk.files.join(", "),
          diffContent: chunk.diff,
          template: options?.template || "",
        });

        const chunkDescription = await this.processWithAI(
          prompt,
          this.getMaxTokens("chunk"),
          {
            temperature: 0.7, // 적당한 창의성
            presence_penalty: 0.1, // 새로운 주제 언급 장려
            frequency_penalty: 0.1, // 반복 감소
            systemPrompt,
          },
        );
        descriptions.push(chunkDescription);
      }

      // 여러 청크가 있는 경우 최종 요약 생성
      if (chunks.length > 1) {
        const summarySystemPrompt = `You are a technical documentation expert. Your task is to:
1. Combine multiple descriptions into a cohesive summary
2. Remove redundant information
3. Maintain technical accuracy
4. Ensure logical flow
5. Preserve all important implementation details`;

        const summaryPrompt = t("ai.prompts.pr_description.summarize", {
          descriptions: descriptions.join("\n\n"),
        });
        return await this.processWithAI(
          summaryPrompt,
          this.getMaxTokens("summary"),
          {
            temperature: 0.5, // 더 집중된 요약
            presence_penalty: 0.2, // 다양한 관점 포함
            systemPrompt: summarySystemPrompt,
          },
        );
      }

      return descriptions[0];
    } catch (error) {
      log.error(t("ai.error.pr_description_failed"), error);
      throw error;
    }
  }

  async generatePRTitle(
    files: string[],
    diffContent: string,
    pattern: { type: string },
  ): Promise<string> {
    try {
      const systemPrompt = `You are a PR title generator. Your task is to:
1. Create concise and descriptive titles under 50 characters
2. Focus on the main change or feature
3. Use clear and professional language
4. Avoid generic descriptions
5. Follow the conventional commit format`;

      const prompt = t("ai.prompts.pr_title.analyze", {
        files: files.join(", "),
        diffContent: diffContent,
        type: pattern.type,
      });

      const generatedTitle = await this.processWithAI(prompt, 100, {
        temperature: 0.3, // 더 집중적이고 일관된 제목
        presence_penalty: 0, // 제목은 간단해야 함
        frequency_penalty: 0.2, // 중복 단어 방지
        systemPrompt,
      });
      return `[${pattern.type.toUpperCase()}] ${generatedTitle}`;
    } catch (error) {
      log.error(t("ai.error.pr_title_failed"), error);
      throw error;
    }
  }

  async reviewCode(
    files: Array<{ path: string; content: string }>,
  ): Promise<string> {
    const systemPrompt = `You are an expert code reviewer with deep knowledge of software development best practices. Your task is to:
1. Identify potential bugs and edge cases
2. Evaluate code quality and readability
3. Check for security vulnerabilities
4. Assess performance implications
5. Verify proper error handling
6. Suggest specific improvements
7. Consider test coverage
8. Look for architectural issues`;

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
      return await this.processWithAI(prompt, this.getMaxTokens("chunk"), {
        temperature: 0.6, // 균형잡힌 리뷰
        presence_penalty: 0.1, // 다양한 관점
        frequency_penalty: 0.1, // 반복 감소
        stop: ["```"], // 코드 블록 끝에서 중지
        systemPrompt,
      });
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
    const systemPrompt = `You are a merge conflict resolution expert. Your task is to:
1. Analyze conflicts carefully
2. Consider the context and purpose of changes
3. Suggest the most appropriate resolution
4. Explain the reasoning behind suggestions
5. Highlight potential risks
6. Consider code functionality and integrity
7. Maintain consistent code style`;

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
      return await this.processWithAI(prompt, this.getMaxTokens("chunk"), {
        temperature: 0.4, // 더 신중한 결정
        presence_penalty: 0, // 정확한 해결책 필요
        frequency_penalty: 0.1, // 약간의 다양성
        systemPrompt,
      });
    } catch (error) {
      log.error(t("ai.error.conflict_resolution_failed"), error);
      throw error;
    }
  }

  async improveCommitMessage(message: string, diff: string): Promise<string> {
    const systemPrompt = `You are a commit message improvement expert. Your task is to:
1. Create concise and impactful commit messages
2. Follow conventional commit format strictly
3. Maintain consistent terminology throughout the message
4. Focus on actual changes visible in the diff
5. Avoid redundancy and unnecessary details
6. Use appropriate language based on the user's locale
7. Prioritize user-facing changes
8. Keep technical details clear but brief
9. Include ALL changed files without exception

Format Guidelines:
- Follow the format specified in the prompt
- Keep subject line under 50 characters
- Use consistent terminology
- Focus on actual changes
- Avoid redundancy
- Include file names for specific changes`;

    const prompt = t("ai.prompts.commit_message.analyze", {
      message,
      diff,
    });

    try {
      return await this.processWithAI(prompt, this.getMaxTokens("chunk"), {
        temperature: 0.4, // 더 일관된 출력을 위해 낮춤
        presence_penalty: 0.1,
        frequency_penalty: 0.3, // 중복 방지를 위해 높임
        systemPrompt,
      });
    } catch (error) {
      log.error(t("ai.error.commit_message_failed"), error);
      throw error;
    }
  }
}
