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
  type: z.enum(["feat", "fix", "refactor", "docs", "chore", "test", "release"]),
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
  privateKey: z.string(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  webhookSecret: z.string().optional(),
  installationId: z.number().optional(),
});

export type GitHubAppConfig = z.infer<typeof GitHubAppConfigSchema>;

export const GlobalConfigSchema = z.object({
  // 언어 설정
  language: z.enum(supportedLanguages).default("en"),

  // GitHub App 설정
  githubApp: GitHubAppConfigSchema.optional(),

  // 인증 모드 (github-app만 지원)
  authMode: z.literal("github-app"),
});

export const BranchStrategySchema = z.object({
  developmentBranch: z.string().default("dev"),
  releasePRTitle: z.string().default("Release: {development} to {production}"),
  releasePRBody: z
    .string()
    .default("Merge {development} branch into {production} for release"),
});

export const ProjectConfigSchema = z.object({
  owner: z.string().optional(),
  repo: z.string().optional(),
  defaultBranch: z.string().default("main"),
  developmentBranch: z.string().default("dev"),
  releasePRTitle: z.string().optional(),
  releasePRBody: z.string().optional(),
  defaultReviewers: z.array(z.string()).default([]),
  autoPrEnabled: z.boolean().default(true),
  defaultLabels: z.array(z.string()).default([]),
  reviewerGroups: z.array(ReviewerGroupSchema).default([]),
  filePatterns: z.array(FilePatternSchema).default([]),
  branchPatterns: z.array(BranchPatternSchema).default([]),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// 통합 Config 스키마
export const ConfigSchema = GlobalConfigSchema.merge(ProjectConfigSchema);
export type Config = z.infer<typeof ConfigSchema>;
