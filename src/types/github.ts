import { z } from "zod";

export const PullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean(),
  user: z.object({
    login: z.string(),
  }),
  created_at: z.string(),
  updated_at: z.string(),
  head: z.object({
    ref: z.string(),
    sha: z.string(),
  }),
  base: z.object({
    ref: z.string(),
    sha: z.string(),
  }),
  html_url: z.string(),
  mergeable: z.boolean().nullable().optional(),
  mergeable_state: z.string().optional(),
  merged: z.boolean().optional(),
  merged_at: z.string().nullable(),
});

export type PullRequest = z.infer<typeof PullRequestSchema>;

export const BranchSchema = z.object({
  name: z.string(),
  commit: z.object({
    sha: z.string(),
    url: z.string(),
  }),
});

export type Branch = z.infer<typeof BranchSchema>;

export const PullRequestStatusSchema = z.enum([
  "UNKNOWN",
  "MERGEABLE",
  "CONFLICTING",
  "CHECKING",
]);

export type PullRequestStatus = z.infer<typeof PullRequestStatusSchema>;
