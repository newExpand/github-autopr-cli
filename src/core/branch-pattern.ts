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
import { exec } from "child_process";
import { promisify } from "util";
import inquirer from "inquirer";

// promisify exec
const execAsync = promisify(exec);

export function matchBranchPattern(
  branchName: string,
  pattern: string,
): boolean {
  const result = minimatch(branchName, pattern);

  return result;
}

export async function findMatchingPattern(
  branchName: string,
): Promise<BranchPattern | null> {
  const config = await loadConfig();
  if (!config) {
    log.warn(t("core.branch_pattern.no_config"));
    return null;
  }

  const pattern = config.branchPatterns.find((pattern) =>
    matchBranchPattern(branchName, pattern.pattern),
  );

  if (pattern) {
    log.info(t("core.branch_pattern.matched_pattern"));
    log.info(
      t("core.branch_pattern.pattern_info", {
        pattern: pattern.pattern,
        type: pattern.type,
        draft: pattern.draft
          ? t("core.branch_pattern.yes")
          : t("core.branch_pattern.no"),
        labels:
          pattern.labels.length > 0
            ? pattern.labels.join(", ")
            : t("core.branch_pattern.none"),
        template: pattern.template || t("core.branch_pattern.default"),
      }),
    );
  } else {
    log.warn(t("core.branch_pattern.no_match"));
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
    t("core.branch_pattern.template.default.changes"),
    t("core.branch_pattern.template.default.changes_placeholder"),
    "",
    t("core.branch_pattern.template.default.tests"),
    t("core.branch_pattern.template.default.unit_test"),
    t("core.branch_pattern.template.default.integration_test"),
    "",
    t("core.branch_pattern.template.default.reviewer_checklist"),
    t("core.branch_pattern.template.default.code_clarity"),
    t("core.branch_pattern.template.default.test_coverage"),
    t("core.branch_pattern.template.default.performance"),
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
      t("core.branch_pattern.warning.invalid_reviewers", {
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
    throw new Error(t("core.branch_pattern.error.not_git_repo"));
  }

  const title = await generatePRTitle(branchName, pattern);
  const body = await generatePRBody(pattern);

  // 사용 가능한 브랜치 목록 가져오기
  let availableBranches: string[] = [];
  try {
    const { stdout } = await execAsync("git branch -r");
    availableBranches = stdout
      .split("\n")
      .map((b: string) => b.trim().replace("origin/", ""))
      .filter((b: string) => b && !b.includes("HEAD ->"));

    // 로컬 브랜치도 추가
    const { stdout: localBranches } = await execAsync("git branch");
    const localBranchList = localBranches
      .split("\n")
      .map((b: string) => b.trim().replace("* ", ""))
      .filter((b: string) => b && b !== branchName);

    // 중복 제거하여 병합
    availableBranches = [
      ...new Set([...availableBranches, ...localBranchList]),
    ];
  } catch (error) {
    log.warn(t("core.branch_pattern.warning.branch_list_failed"));
    availableBranches = ["main", "master", "dev", "develop"];
  }

  // 사용자에게 대상 브랜치 선택 요청
  const { baseBranch } = await inquirer.prompt([
    {
      type: "list",
      name: "baseBranch",
      message: t("core.branch_pattern.prompts.select_base_branch"),
      choices: availableBranches,
      default: availableBranches.includes("main")
        ? "main"
        : availableBranches.includes("master")
          ? "master"
          : availableBranches[0],
    },
  ]);

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

  log.info(t("core.branch_pattern.success.pr_created"));
  log.info(`PR URL: ${pr.html_url}`);
}
