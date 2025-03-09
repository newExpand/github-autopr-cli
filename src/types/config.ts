import { z } from "zod";
import { supportedLanguages } from "../i18n/index.js";

export const ReviewerGroupSchema = z.object({
  name: z.string(),
  members: z.array(z.string()),
  rotationStrategy: z
    .enum(["round-robin", "random", "least-busy"])
    .default("round-robin"),
});

export const FilePatternSchema = z.object({
  pattern: z.string(),
  reviewers: z.array(z.string()),
});

export const BranchPatternSchema = z.object({
  pattern: z.string(),
  type: z.enum(["feat", "fix", "refactor", "docs", "chore", "test"]),
  draft: z.boolean().default(true),
  labels: z.array(z.string()).default([]),
  template: z.string().optional(),
  autoAssignReviewers: z.boolean().default(true),
  reviewers: z.array(z.string()).default([]),
  reviewerGroups: z.array(z.string()).default([]),
});

export const AIConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(["openai", "github-copilot", "anthropic"]),
  apiKey: z.string().optional(),
  options: z
    .object({
      model: z.string().optional(),
      temperature: z.number().optional(),
      maxTokens: z.number().optional(),
    })
    .optional(),
});

export type BranchPattern = z.infer<typeof BranchPatternSchema>;

export const GlobalConfigSchema = z.object({
  githubToken: z.string().optional(),
  language: z.enum(supportedLanguages).default("en"),
});

export const ProjectConfigSchema = z.object({
  owner: z.string().optional(),
  repo: z.string().optional(),
  defaultBranch: z.string().default("main"),
  defaultReviewers: z.array(z.string()).default([]),
  autoPrEnabled: z.boolean().default(true),
  defaultLabels: z.array(z.string()).default([]),
  reviewerGroups: z.array(ReviewerGroupSchema).default([]),
  filePatterns: z.array(FilePatternSchema).default([]),
  branchPatterns: z.array(BranchPatternSchema).default([]),
  aiConfig: AIConfigSchema.optional(),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// 기존 Config 타입은 호환성을 위해 유지
export const ConfigSchema = GlobalConfigSchema.merge(ProjectConfigSchema);
export type Config = z.infer<typeof ConfigSchema>;
