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

export type BranchPattern = z.infer<typeof BranchPatternSchema>;

// GitHub App 설정 스키마
export const GitHubAppConfigSchema = z.object({
  appId: z.string(),
  clientId: z.string(),
  installationId: z.number(),
  clientSecret: z.string().optional(),
  webhookSecret: z.string().optional(),
});

export type GitHubAppConfig = z.infer<typeof GitHubAppConfigSchema>;

export const GlobalConfigSchema = z.object({
  // GitHub Token 설정
  githubToken: z.string().optional(),

  // 언어 설정
  language: z.enum(supportedLanguages).default("en"),
});

export const ProjectConfigSchema = z.object({
  owner: z.string().optional(),
  repo: z.string().optional(),
  githubApp: GitHubAppConfigSchema,
  defaultReviewers: z.array(z.string()).default([]),
  reviewerGroups: z.array(ReviewerGroupSchema).default([]),
  branchPatterns: z.array(BranchPatternSchema).default([]),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// 통합 Config 스키마
export const ConfigSchema = GlobalConfigSchema.merge(ProjectConfigSchema);
export type Config = z.infer<typeof ConfigSchema>;
