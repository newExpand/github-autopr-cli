import { AIManager } from "./ai-manager.js";
import { log } from "../utils/logger.js";
import { t } from "../i18n/index.js";
import type { AIProvider } from "./ai-manager.js";
import dotenv from "dotenv";
import { OPENROUTER_CONFIG } from "../config/openrouter.js";
import { loadProjectConfig } from "./config.js";
import OpenAI from "openai";

interface PRChunk {
  files: string[];
  diff: string;
}

// PR 리뷰 봇을 위한 인터페이스 추가
interface PRReviewContext {
  prNumber: number;
  title: string;
  description: string;
  author: string;
  changedFiles: Array<{
    path: string;
    additions: number;
    deletions: number;
    content?: string;
  }>;
  diffContent: string;
  conversationHistory?: Array<{
    author: string;
    content: string;
    timestamp: string;
  }>;
}

// 코멘트 응답을 위한 인터페이스 추가
interface CommentResponseContext {
  prNumber: number;
  commentId: number;
  commentBody: string;
  author: string;
  replyTo?: string;
  codeContext?: string;
  conversationHistory: Array<{
    author: string;
    content: string;
    timestamp: string;
  }>;
}

export class AIFeatures {
  private aiManager: AIManager;
  // OpenAI 기본 토큰 제한
  private readonly OPENAI_MAX_CHUNK_TOKENS = 1500;
  private readonly OPENAI_MAX_SUMMARY_TOKENS = 1000;
  // OpenRouter 토큰 제한 (Gemini Flash 2.0 기준)
  private readonly OPENROUTER_MAX_CHUNK_TOKENS = 800000; // 1,048,576 입력 토큰 중 대부분 활용
  private readonly OPENROUTER_MAX_SUMMARY_TOKENS = 8192; // 최대 출력 토큰 전체 활용
  private initialized = false;

  constructor() {
    dotenv.config();
    this.aiManager = AIManager.getInstance();
  }

  /**
   * AI 설정을 로드합니다.
   * @returns AI 설정 객체
   */
  private async loadConfig() {
    try {
      // 1. 프로젝트 설정 파일(.autopr.json)에서 먼저 확인
      const projectConfig = await loadProjectConfig();
      if (
        projectConfig.aiConfig?.enabled &&
        projectConfig.aiConfig.provider &&
        projectConfig.aiConfig.options?.model
      ) {
        log.debug("프로젝트 설정에서 AI 설정을 로드했습니다.");
        return {
          provider: projectConfig.aiConfig.provider as AIProvider,
          apiKey:
            projectConfig.aiConfig.provider === "openrouter"
              ? OPENROUTER_CONFIG.API_KEY
              : process.env.AI_API_KEY || "",
          model: projectConfig.aiConfig.options.model,
        };
      }

      // 2. .env 파일에서 설정 로드
      dotenv.config();
      const provider = process.env.AI_PROVIDER as AIProvider;
      const apiKey = process.env.AI_API_KEY;
      const model = process.env.AI_MODEL;

      // OpenAI인 경우 .env 파일의 값 사용
      if (provider === "openai" && apiKey && model) {
        log.debug(".env 파일에서 OpenAI 설정을 로드했습니다.");
        return {
          provider: "openai" as AIProvider,
          apiKey,
          model,
        };
      }

      // 3. 모든 설정이 없는 경우 OpenRouter 기본값 사용
      log.debug("기본 OpenRouter 설정을 사용합니다.");
      return {
        provider: "openrouter" as AIProvider,
        apiKey: OPENROUTER_CONFIG.API_KEY,
        model: OPENROUTER_CONFIG.DEFAULT_MODEL,
      };
    } catch (error) {
      log.error("AI 설정 로드 중 오류 발생:", error);
      // 오류 발생시 OpenRouter 기본값 반환
      return {
        provider: "openrouter" as AIProvider,
        apiKey: OPENROUTER_CONFIG.API_KEY,
        model: OPENROUTER_CONFIG.DEFAULT_MODEL,
      };
    }
  }

  /**
   * AI 기능을 초기화합니다.
   * @returns 초기화 성공 여부
   */
  public async initialize(): Promise<boolean> {
    try {
      // 이미 초기화된 경우 중복 초기화 방지
      if (this.initialized) {
        log.debug("AI 기능이 이미 초기화되어 있습니다.");
        return true;
      }

      // 설정 로드
      const config = await this.loadConfig();
      if (!config) {
        log.debug("AI 설정을 찾을 수 없습니다.");
        return false;
      }

      // AI 제공자 설정
      const { provider, apiKey, model } = config;
      if (!provider || !apiKey) {
        log.debug("AI 제공자 또는 API 키가 설정되지 않았습니다.");
        return false;
      }

      // AI 매니저 초기화 (AI 매니저 내부에서 OpenRouter API 키 상태를 확인하므로 여기서는 확인하지 않음)
      await this.aiManager.initialize({
        provider,
        apiKey,
        options: { model },
      });

      // 초기화 완료
      this.initialized = true;
      log.debug("AI 기능이 초기화되었습니다");
      return true;
    } catch (error) {
      log.error("AI 기능 초기화 실패:", error);
      return false;
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
    prompt: string | Array<OpenAI.ChatCompletionContentPart>,
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

      const messages: OpenAI.ChatCompletionMessageParam[] = [];

      // 시스템 프롬프트 추가 (있는 경우)
      if (options.systemPrompt) {
        messages.push({
          role: "system",
          content: options.systemPrompt,
        });
      }

      // 사용자 프롬프트 추가
      messages.push({
        role: "user",
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

  async generatePRTitle(
    files: string[],
    diffContent: string,
    pattern: { type: string },
  ): Promise<string> {
    try {
      // t 함수의 현재 언어 설정대로 출력하도록 명시합니다.
      const systemPrompt = `You are a PR title generator. Your task is to:
1. Create concise and descriptive titles under 50 characters
2. Focus on the main change or feature
3. Use clear and professional language
4. Avoid generic descriptions
5. Follow the conventional commit format
6. Generate output that follows the user's current language setting`;

      const prompt = t("ai.prompts.pr_title.analyze", {
        files: files.join(", "),
        diffContent: diffContent,
        type: pattern.type,
      });

      const generatedTitle = await this.processWithAI(
        prompt,
        this.getMaxTokens("chunk"),
        {
          temperature: 0.3, // 더 집중적이고 일관된 제목
          presence_penalty: 0, // 제목은 간단해야 함
          frequency_penalty: 0.2, // 중복 단어 방지
          systemPrompt,
        },
      );
      return `[${pattern.type.toUpperCase()}] ${generatedTitle}`;
    } catch (error) {
      log.error(t("ai.error.pr_title_failed"), error);
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

      // t 함수의 현재 언어 설정대로 출력하도록 명시합니다.
      const systemPrompt = `You are an expert code reviewer and technical writer. Your task is to analyze code changes and generate clear, comprehensive PR descriptions that:
1. Focus on the actual changes and their impact
2. Use professional and technical language
3. Organize information logically
4. Highlight important implementation details
5. Consider security and performance implications
6. Generate output that follows the user's current language setting`;

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
        // t 함수의 현재 언어 설정대로 출력하도록 명시합니다.
        const summarySystemPrompt = `You are a technical documentation expert. Your task is to:
1. Combine multiple descriptions into a cohesive summary
2. Remove redundant information
3. Maintain technical accuracy
4. Ensure logical flow
5. Preserve all important implementation details
6. Generate output that follows the user's current language setting`;

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

  async improveCommitMessage(
    message: string,
    diff: string,
    changedFiles?: string[],
  ): Promise<string> {
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
      files: changedFiles?.join(", ") || "",
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

  /**
   * 일일 커밋 보고서 요약을 생성합니다.
   * 여러 커밋의 내용을 분석하여 전문적인 일일 보고서 형태로 요약합니다.
   *
   * @param commits 커밋 정보 배열
   * @param username 사용자 이름
   * @param date 보고서 날짜 또는 날짜 범위
   * @param stats 커밋 통계 정보
   * @returns 생성된 보고서 요약
   */
  async generateDailyCommitSummary(
    commits: Array<{
      sha: string;
      message: string;
      date: string;
      files?: Array<{
        filename: string;
        additions: number;
        deletions: number;
      }>;
    }>,
    username: string,
    date: string,
    stats: {
      totalCommits: number;
      filesChanged: number;
      additions: number;
      deletions: number;
      branches?: Record<string, number>;
      fileTypes?: Record<string, number>;
    },
  ): Promise<string> {
    const systemPrompt = t("ai.prompts.daily_report_summary.system");

    // 커밋 메시지와 파일 정보를 문자열로 변환
    const commitsInfo = commits
      .map((commit) => {
        const filesInfo = commit.files
          ? commit.files
              .map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
              .join("\n")
          : "파일 정보 없음";

        return `커밋: ${commit.sha.substring(0, 7)}
시간: ${new Date(commit.date).toLocaleString()}
메시지: ${commit.message}
변경된 파일:
${filesInfo}
`;
      })
      .join("\n---\n");

    // 통계 정보 추가
    const statsInfo = `
커밋 통계:
- 총 커밋 수: ${stats.totalCommits}
- 변경된 파일: ${stats.filesChanged}
- 추가된 라인: ${stats.additions}
- 삭제된 라인: ${stats.deletions}
${
  stats.branches
    ? "\n브랜치별 커밋:" +
      Object.entries(stats.branches)
        .map(([branch, count]) => `\n- ${branch}: ${count}`)
        .join("")
    : ""
}
${
  stats.fileTypes
    ? "\n파일 유형별 변경:" +
      Object.entries(stats.fileTypes)
        .map(([type, count]) => `\n- ${type}: ${count}`)
        .join("")
    : ""
}
`;

    const prompt = t("ai.prompts.daily_report_summary.prompt", {
      username,
      date,
      commitsInfo:
        commits.length > 0 ? commitsInfo : "이 기간에 커밋이 없습니다.",
      statsInfo,
    });

    try {
      return await this.processWithAI(prompt, this.getMaxTokens("summary"), {
        temperature: 0.5, // 적절한 창의성과 정확성의 균형
        presence_penalty: 0.2, // 다양한 측면 포함
        frequency_penalty: 0.3, // 반복 감소
        systemPrompt,
      });
    } catch (error) {
      log.error(t("ai.error.daily_report_failed"), error);
      throw error;
    }
  }

  /**
   * 이미지와 텍스트를 함께 처리하는 멀티모달 질문을 수행합니다.
   * @param text 질문 텍스트
   * @param images 이미지 URL 배열
   * @returns AI 응답
   */
  async processMultiModal(
    text: string,
    images: string[],
    options: {
      temperature?: number;
      maxTokens?: number;
    } = {},
  ): Promise<string> {
    try {
      if (!this.isEnabled()) {
        throw new Error(t("ai.error.not_initialized"));
      }

      const content: OpenAI.ChatCompletionContentPart[] = [
        {
          type: "text",
          text: text,
        },
      ];

      // 이미지 추가
      for (const imageUrl of images) {
        content.push({
          type: "image_url",
          image_url: {
            url: imageUrl,
          },
        });
      }

      return await this.processWithAI(
        content,
        options.maxTokens || this.getMaxTokens("chunk"),
        {
          temperature: options.temperature || 0.7,
        },
      );
    } catch (error) {
      log.error(t("ai.error.multimodal_processing_failed"), error);
      throw error;
    }
  }

  /**
   * PR을 리뷰하여 자세한 코드 리뷰 코멘트를 생성합니다.
   * @param context PR 리뷰 컨텍스트
   * @returns 생성된 리뷰 코멘트
   */
  async reviewPR(context: PRReviewContext): Promise<string> {
    try {
      const systemPrompt = `You are an expert code reviewer who specializes in identifying:
1. Code quality issues
2. Potential bugs
3. Security vulnerabilities
4. Performance problems
5. Architectural considerations
6. Best practices

Your reviews should be:
1. Constructive and helpful
2. Specific with line references
3. Balanced (mention positives and areas for improvement)
4. Actionable with clear suggestions
5. Professional and respectful
6. Written in the user's language setting (use the same language as the user's locale)

IMPORTANT: Generate the review in the user's current language setting. If the user is using Korean locale, the review must be in Korean.`;

      // 파일 내용들을 포맷팅
      const filesContent = context.changedFiles
        .map((file) => {
          if (!file.content) return null;
          return `File: ${file.path} (+${file.additions}/-${file.deletions})
\`\`\`
${file.content}
\`\`\``;
        })
        .filter(Boolean)
        .join("\n\n");

      const prompt = `Please review the following PR and write the response in the user's current language setting (if Korean locale is used, respond in Korean):

PR #${context.prNumber}: ${context.title}
Author: ${context.author}
Description:
${context.description}

Changed Files:
${context.changedFiles.map((f) => `- ${f.path} (+${f.additions}/-${f.deletions})`).join("\n")}

File Contents:
${filesContent}

Diff:
\`\`\`diff
${context.diffContent}
\`\`\`

Please provide a thorough code review with:
1. A summary of the overall changes
2. Specific comments on code quality
3. Potential bugs or issues
4. Suggestions for improvements
5. Any security concerns
6. Performance considerations

Format your review with clear sections and use markdown for readability.
IMPORTANT: Your response must be in the user's current language setting. If the user is using Korean locale, write the entire review in Korean.`;

      const review = await this.processWithAI(
        prompt,
        this.getMaxTokens("chunk"),
        {
          temperature: 0.5,
          presence_penalty: 0.1,
          frequency_penalty: 0.1,
          systemPrompt,
        },
      );

      return review;
    } catch (error) {
      log.error("PR 리뷰 생성 중 오류가 발생했습니다:", error);
      throw new Error(t("ai.error.pr_review_failed"));
    }
  }

  /**
   * PR 코멘트에 대한 응답을 생성합니다.
   * @param context 코멘트 응답 컨텍스트
   * @returns 생성된 응답 코멘트
   */
  async generateCommentResponse(
    context: CommentResponseContext,
  ): Promise<string> {
    try {
      const systemPrompt = `You are a helpful code review assistant who:
1. Responds to user questions and comments thoughtfully
2. Maintains context of the conversation
3. Provides technical explanations when needed
4. Suggests solutions to problems
5. Keeps responses professional and constructive
6. Mentions relevant users when appropriate
7. Always responds in the user's current language setting

IMPORTANT: Generate the response in the user's current language setting. If the user is using Korean locale, the response must be in Korean.`;

      // 대화 히스토리 포맷팅
      const conversationHistory = context.conversationHistory
        .map((msg) => `${msg.author} (${msg.timestamp}): ${msg.content}`)
        .join("\n\n");

      const prompt = `Please respond to the following comment on PR #${context.prNumber} and write the response in the user's current language setting (if Korean locale is used, respond in Korean):

Comment by ${context.author}:
${context.commentBody}

${context.codeContext ? `Related code context:\n${context.codeContext}\n` : ""}

Conversation history:
${conversationHistory}

${context.replyTo ? `You should mention @${context.replyTo} in your response.` : ""}

Please provide a helpful, technical, and constructive response. Be concise but thorough.
IMPORTANT: Your response must be in the user's current language setting. If the user is using Korean locale, write the entire response in Korean.`;

      const response = await this.processWithAI(
        prompt,
        this.getMaxTokens("chunk"),
        {
          temperature: 0.7, // 약간 더 창의적인 응답을 위해
          presence_penalty: 0.2,
          frequency_penalty: 0.2,
          systemPrompt,
        },
      );

      return response;
    } catch (error) {
      log.error("코멘트 응답 생성 중 오류가 발생했습니다:", error);
      throw new Error(t("ai.error.comment_response_failed"));
    }
  }
}
