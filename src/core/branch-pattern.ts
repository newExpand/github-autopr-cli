import { minimatch } from "minimatch";
import { BranchPattern, Config } from "../types/config.js";
import { loadConfig } from "../core/config.js";
import { getCurrentRepoInfo } from "../utils/git.js";
import {
  createPullRequest,
  addReviewers,
  getOctokit,
  validateReviewers,
} from "../core/github.js";
import { t } from "../i18n/index.js";
import { loadTemplate } from "../utils/template.js";
import { log } from "../utils/logger.js";
import { join, dirname } from "path";
import { homedir } from "os";
import { readFile, writeFile, mkdir } from "fs/promises";

export function matchBranchPattern(
  branchName: string,
  pattern: string,
): boolean {
  const result = minimatch(branchName, pattern);
  if (result) {
    log.debug(
      t("common.branch_pattern.match_success", {
        branch: branchName,
        pattern: pattern,
      }),
    );
  } else {
    log.debug(
      t("common.branch_pattern.match_fail", {
        branch: branchName,
        pattern: pattern,
      }),
    );
  }
  return result;
}

export async function findMatchingPattern(
  branchName: string,
): Promise<BranchPattern | null> {
  const config = await loadConfig();
  if (!config) {
    log.warn(t("common.branch_pattern.no_config"));
    return null;
  }

  log.debug(t("common.branch_pattern.matching_start"));
  log.debug(t("common.branch_pattern.current_branch", { branch: branchName }));
  log.debug(t("common.branch_pattern.available_patterns"));
  config.branchPatterns.forEach((p) =>
    log.debug(
      t("common.branch_pattern.pattern_item", {
        pattern: p.pattern,
        type: p.type,
      }),
    ),
  );

  const pattern = config.branchPatterns.find((pattern) =>
    matchBranchPattern(branchName, pattern.pattern),
  );

  if (pattern) {
    log.info(t("common.branch_pattern.matched_pattern"));
    log.info(
      t("common.branch_pattern.pattern_info", {
        pattern: pattern.pattern,
        type: pattern.type,
        draft: pattern.draft
          ? t("common.branch_pattern.yes")
          : t("common.branch_pattern.no"),
        labels:
          pattern.labels.length > 0
            ? pattern.labels.join(", ")
            : t("common.branch_pattern.none"),
        template: pattern.template || t("common.branch_pattern.default"),
      }),
    );
  } else {
    log.warn(t("common.branch_pattern.no_match"));
  }

  return pattern || null;
}

export async function generatePRTitle(
  branchName: string,
  pattern: BranchPattern,
): Promise<string> {
  // 브랜치 이름에서 타입과 설명 부분 추출
  const parts = branchName.split("/");
  if (parts.length < 2) return branchName;

  const description = parts.slice(1).join("/");
  // 설명 부분을 사람이 읽기 쉬운 형태로 변환
  const humanizedDescription = description
    .replace(/-/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return `[${pattern.type.toUpperCase()}] ${humanizedDescription}`;
}

export async function generatePRBody(pattern: BranchPattern): Promise<string> {
  if (pattern.template) {
    return await loadTemplate(pattern.template);
  }

  // 기본 템플릿 (국제화 적용)
  return [
    t("common.template.default.changes"),
    t("common.template.default.changes_placeholder"),
    "",
    t("common.template.default.tests"),
    t("common.template.default.unit_test"),
    t("common.template.default.integration_test"),
    "",
    t("common.template.default.reviewer_checklist"),
    t("common.template.default.code_clarity"),
    t("common.template.default.test_coverage"),
    t("common.template.default.performance"),
  ].join("\n");
}

async function selectReviewers(
  pattern: BranchPattern,
  config: Config,
  repoInfo: { owner: string; repo: string },
): Promise<string[]> {
  const reviewers = new Set<string>();

  // 1. 브랜치 패턴에 직접 지정된 리뷰어 추가
  pattern.reviewers.forEach((reviewer: string) => reviewers.add(reviewer));

  // 2. 리뷰어 그룹에서 리뷰어 선택
  for (const groupName of pattern.reviewerGroups) {
    const group = config.reviewerGroups.find((g) => g.name === groupName);
    if (group) {
      switch (group.rotationStrategy) {
        case "random": {
          const randomIndex = Math.floor(Math.random() * group.members.length);
          reviewers.add(group.members[randomIndex]);
          break;
        }
        case "round-robin": {
          try {
            // 현재 그룹의 마지막 리뷰어 인덱스를 가져옴
            const configPath = join(
              homedir(),
              ".autopr",
              "reviewer-state.json",
            );
            let state: Record<string, number> = {};

            try {
              const stateData = await readFile(configPath, "utf-8");
              state = JSON.parse(stateData);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
              }
            }

            // 다음 리뷰어 선택
            const currentIndex = state[groupName] || -1;
            const nextIndex = (currentIndex + 1) % group.members.length;

            // 상태 업데이트
            state[groupName] = nextIndex;
            await mkdir(dirname(configPath), { recursive: true });
            await writeFile(configPath, JSON.stringify(state, null, 2));

            reviewers.add(group.members[nextIndex]);
          } catch (error) {
            // 상태 저장에 실패하면 랜덤으로 선택
            const randomIndex = Math.floor(
              Math.random() * group.members.length,
            );
            reviewers.add(group.members[randomIndex]);
          }
          break;
        }
        case "least-busy": {
          try {
            const client = await getOctokit();

            // 각 멤버의 현재 리뷰 중인 PR 수를 가져옴
            const reviewCounts = await Promise.all(
              group.members.map(async (member) => {
                const { data: prs } = await client.rest.pulls.list({
                  owner: repoInfo.owner,
                  repo: repoInfo.repo,
                  state: "open",
                  per_page: 100,
                });

                const reviewCount = prs.filter((pr) =>
                  pr.requested_reviewers?.some(
                    (reviewer) => reviewer.login === member,
                  ),
                ).length;

                return { member, reviewCount };
              }),
            );

            // 가장 적은 리뷰를 가진 멤버 선택
            const leastBusyReviewer = reviewCounts.reduce((prev, current) =>
              prev.reviewCount <= current.reviewCount ? prev : current,
            );

            reviewers.add(leastBusyReviewer.member);
          } catch (error) {
            // API 호출 실패 시 랜덤으로 선택
            const randomIndex = Math.floor(
              Math.random() * group.members.length,
            );
            reviewers.add(group.members[randomIndex]);
          }
          break;
        }
      }
    }
  }

  // 3. 기본 리뷰어 추가
  if (pattern.autoAssignReviewers) {
    config.defaultReviewers.forEach((reviewer: string) =>
      reviewers.add(reviewer),
    );
  }

  // 4. collaborator 검증
  const allReviewers = Array.from(reviewers);
  const { valid, invalid } = await validateReviewers({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    reviewers: allReviewers,
  });

  // 유효하지 않은 리뷰어가 있으면 경고 메시지 출력
  if (invalid.length > 0) {
    console.warn(
      t("common.warning.invalid_reviewers", {
        reviewers: invalid.join(", "),
      }),
    );
  }

  return valid;
}

export async function createAutoPR(branchName: string): Promise<void> {
  const config = await loadConfig();
  if (!config || !config.autoPrEnabled) return;

  const pattern = await findMatchingPattern(branchName);
  if (!pattern) return;

  const repoInfo = await getCurrentRepoInfo();
  if (!repoInfo) {
    throw new Error(t("common.error.not_git_repo"));
  }

  const title = await generatePRTitle(branchName, pattern);
  const body = await generatePRBody(pattern);

  // 브랜치 전략에 따라 base 브랜치 결정
  const baseBranch =
    pattern.type === "release"
      ? config.defaultBranch
      : config.developmentBranch || config.defaultBranch;

  const pr = await createPullRequest({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    title,
    body,
    head: branchName,
    base: baseBranch,
    draft: pattern.draft,
  });

  // 라벨 추가
  const labels = [...new Set([...config.defaultLabels, ...pattern.labels])];
  if (labels.length > 0) {
    const client = await getOctokit();
    await client.rest.issues.addLabels({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      issue_number: pr.number,
      labels,
    });
  }

  // 리뷰어 자동 할당
  if (pattern.autoAssignReviewers) {
    const selectedReviewers = await selectReviewers(pattern, config, {
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    });
    if (selectedReviewers.length > 0) {
      await addReviewers({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        pull_number: pr.number,
        reviewers: selectedReviewers,
      });
    }
  }

  log.info(t("common.success.pr_created"));
  log.info(`PR URL: ${pr.html_url}`);
}
