import { Octokit } from "octokit";
import { loadConfig } from "./config.js";
import {
  PullRequest,
  PullRequestSchema,
  PullRequestStatus,
  Branch,
  BranchSchema,
} from "../types/github.js";
import { t } from "../i18n/index.js";
import { log } from "../utils/logger.js";

let octokit: Octokit | null = null;
const prStatusCache = new Map<
  string,
  { status: PullRequestStatus; timestamp: number }
>();

// Collaborator 타입 추가
export interface Collaborator {
  login: string;
  permissions: {
    pull: boolean;
    push: boolean;
    admin: boolean;
  };
}

// collaborators 캐시
const collaboratorsCache = new Map<
  string,
  { data: Collaborator[]; timestamp: number }
>();

export async function getOctokit(token?: string): Promise<Octokit> {
  if (token) {
    // 새로운 토큰으로 인스턴스 생성
    octokit = new Octokit({ auth: token });
  } else if (!octokit) {
    // 기존 설정에서 토큰 가져오기
    const config = await loadConfig();
    if (!config?.githubToken) {
      throw new Error(t("common.error.github_token"));
    }
    octokit = new Octokit({ auth: config.githubToken });
  }
  return octokit;
}

export async function validateGitHubToken(token: string): Promise<boolean> {
  try {
    const client = new Octokit({ auth: token });
    await client.rest.users.getAuthenticated();
    return true;
  } catch (error) {
    return false;
  }
}

export async function checkMergeability(params: {
  owner: string;
  repo: string;
  pull_number: number;
}): Promise<{
  mergeable: boolean | null;
  mergeableState: string;
  hasConflicts: boolean;
}> {
  const client = await getOctokit();
  const { data: pr } = await client.rest.pulls.get(params);

  // GitHub API가 mergeability를 계산하는 데 시간이 걸릴 수 있음
  // null인 경우 잠시 기다렸다가 다시 확인
  if (pr.mergeable === null) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const { data: updatedPr } = await client.rest.pulls.get(params);
    return {
      mergeable: updatedPr.mergeable,
      mergeableState: updatedPr.mergeable_state,
      hasConflicts: updatedPr.mergeable_state === "dirty",
    };
  }

  return {
    mergeable: pr.mergeable,
    mergeableState: pr.mergeable_state,
    hasConflicts: pr.mergeable_state === "dirty",
  };
}

export async function getPullRequestStatus(params: {
  owner: string;
  repo: string;
  pull_number: number;
}): Promise<PullRequestStatus> {
  const cacheKey = `${params.owner}/${params.repo}/${params.pull_number}`;
  const cachedStatus = prStatusCache.get(cacheKey);

  // 캐시된 상태가 5분 이내인 경우 재사용
  if (cachedStatus && Date.now() - cachedStatus.timestamp < 5 * 60 * 1000) {
    return cachedStatus.status;
  }

  const mergeability = await checkMergeability(params);
  let status: PullRequestStatus;

  if (mergeability.mergeable === null) {
    status = "CHECKING";
  } else if (mergeability.hasConflicts) {
    status = "CONFLICTING";
  } else if (mergeability.mergeable) {
    status = "MERGEABLE";
  } else {
    status = "UNKNOWN";
  }

  // 상태 캐시 업데이트
  prStatusCache.set(cacheKey, {
    status,
    timestamp: Date.now(),
  });

  return status;
}

export async function updatePullRequestStatus(params: {
  owner: string;
  repo: string;
  pull_number: number;
}): Promise<PullRequestStatus> {
  const cacheKey = `${params.owner}/${params.repo}/${params.pull_number}`;
  prStatusCache.delete(cacheKey); // 캐시 무효화
  return getPullRequestStatus(params);
}

export async function createPullRequest(params: {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
}): Promise<PullRequest> {
  const client = await getOctokit();
  try {
    const response = await client.rest.pulls.create({
      ...params,
      maintainer_can_modify: true,
    });

    const pr = PullRequestSchema.parse(response.data);

    // PR 상태 초기 확인
    const status = await getPullRequestStatus({
      owner: params.owner,
      repo: params.repo,
      pull_number: pr.number,
    });

    if (status === "CONFLICTING") {
      log.warn(t("common.warning.merge_conflict"));
    } else if (status === "CHECKING") {
      log.warn(t("common.warning.merge_status_unknown"));
    }

    return pr;
  } catch (error: any) {
    if (error.status === 422) {
      if (error.message?.includes("No commits between")) {
        throw new Error(t("common.error.no_commits"));
      } else if (error.message?.includes("A pull request already exists")) {
        throw new Error(t("common.error.pr_exists"));
      } else if (error.message?.includes("Base branch was modified")) {
        throw new Error(t("common.error.base_modified"));
      }
    }
    throw error;
  }
}

export async function listPullRequests(params: {
  owner: string;
  repo: string;
  state?: "open" | "closed" | "all";
}): Promise<PullRequest[]> {
  const client = await getOctokit();
  const response = await client.rest.pulls.list({
    ...params,
    per_page: 100,
  });

  return response.data.map((pr) => PullRequestSchema.parse(pr));
}

export async function getPullRequest(params: {
  owner: string;
  repo: string;
  pull_number: number;
}): Promise<PullRequest> {
  const client = await getOctokit();
  const response = await client.rest.pulls.get(params);

  return PullRequestSchema.parse(response.data);
}

export async function listBranches(params: {
  owner: string;
  repo: string;
}): Promise<Branch[]> {
  const client = await getOctokit();
  const response = await client.rest.repos.listBranches(params);
  return response.data.map((branch) => BranchSchema.parse(branch));
}

export interface UpdatePullRequestParams {
  owner: string;
  repo: string;
  pull_number: number;
  title?: string;
  body?: string;
  state?: "open" | "closed";
  base?: string;
  draft?: boolean;
}

interface GraphQLPullRequestResponse {
  updatePullRequest: {
    pullRequest: {
      number: number;
      title: string;
      body: string | null;
      state: "OPEN" | "CLOSED" | "MERGED";
      isDraft: boolean;
      url: string;
      baseRefName: string;
      headRefName: string;
      author: {
        login: string;
      };
    };
  };
}

interface GraphQLPullRequestIdResponse {
  repository: {
    pullRequest: {
      id: string;
    };
  };
}

export async function updatePullRequestBase({
  owner,
  repo,
  pull_number,
  base,
}: {
  owner: string;
  repo: string;
  pull_number: number;
  base: string;
}): Promise<PullRequest> {
  const client = await getOctokit();

  // 현재 PR 정보 가져오기
  const originalPr = await getPullRequest({ owner, repo, pull_number });

  try {
    // 새로운 base 브랜치의 내용을 head 브랜치에 병합
    await client.rest.repos.merge({
      owner,
      repo,
      base: originalPr.head.ref,
      head: base,
    });

    // base 브랜치 변경
    const response = await client.rest.pulls.update({
      owner,
      repo,
      pull_number,
      base,
    });

    return PullRequestSchema.parse(response.data);
  } catch (error: any) {
    // 병합 또는 base 브랜치 변경 실패 시
    if (error.status === 409) {
      throw new Error(t("commands.merge.error.merge_conflict"));
    } else if (error.status === 422) {
      throw new Error(t("commands.merge.error.base_change_failed"));
    }
    throw error;
  }
}

export async function updatePullRequest({
  owner,
  repo,
  pull_number,
  title,
  body,
  state,
  base,
  draft,
}: UpdatePullRequestParams): Promise<PullRequest> {
  // base 브랜치 변경이 있는 경우 GraphQL API 사용
  if (base) {
    return updatePullRequestBase({ owner, repo, pull_number, base });
  }

  const client = await getOctokit();

  // draft 상태 변경이 있는 경우 GraphQL API 사용
  if (draft !== undefined) {
    log.info("Updating PR draft status using GraphQL API...");

    // PR의 node ID 가져오기
    const { repository } = await client.graphql<GraphQLPullRequestIdResponse>(
      `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            id
          }
        }
      }
    `,
      {
        owner,
        repo,
        number: pull_number,
      },
    );

    const prId = repository.pullRequest.id;

    // GraphQL mutation으로 draft 상태 변경
    const mutation = draft
      ? "convertPullRequestToDraft"
      : "markPullRequestReadyForReview";

    try {
      const _response = await client.graphql<GraphQLPullRequestResponse>(
        `
        mutation($id: ID!) {
          ${mutation}(input: {pullRequestId: $id}) {
            pullRequest {
              number
              title
              body
              state
              isDraft
              url
              baseRefName
              headRefName
              author {
                login
              }
            }
          }
        }
      `,
        {
          id: prId,
        },
      );

      // 다른 필드 업데이트가 있는 경우
      if (title || body || state) {
        await client.rest.pulls.update({
          owner,
          repo,
          pull_number,
          ...(title && { title }),
          ...(body && { body }),
          ...(state && { state }),
        });
      }

      const updatedPr = await getPullRequest({ owner, repo, pull_number });
      return updatedPr;
    } catch (error: any) {
      log.error("GraphQL Error:", error);
      throw error;
    }
  }

  // draft 상태 변경이 없는 경우 REST API 사용
  const response = await client.rest.pulls.update({
    owner,
    repo,
    pull_number,
    ...(title && { title }),
    ...(body && { body }),
    ...(state && { state }),
  });

  return PullRequestSchema.parse(response.data);
}

export async function addReviewers(params: {
  owner: string;
  repo: string;
  pull_number: number;
  reviewers: string[];
}): Promise<void> {
  const client = await getOctokit();
  await client.rest.pulls.requestReviewers(params);
}

export interface MergePullRequestParams {
  owner: string;
  repo: string;
  pull_number: number;
  merge_method?: "merge" | "squash" | "rebase";
  commit_title?: string;
  commit_message?: string;
  delete_branch?: boolean;
}

export async function mergePullRequest({
  owner,
  repo,
  pull_number,
  merge_method = "merge",
  commit_title,
  commit_message,
  delete_branch = false,
}: MergePullRequestParams): Promise<void> {
  const client = await getOctokit();

  // PR 상태 확인
  log.info(`[DEBUG] PR #${pull_number} 병합 시작`);
  log.info(`[DEBUG] 소유자: ${owner}, 저장소: ${repo}`);
  log.info(`[DEBUG] 병합 방법: ${merge_method}`);

  const pr = await getPullRequest({ owner, repo, pull_number });
  log.info(`[DEBUG] PR 상태: ${pr.state}`);
  log.info(`[DEBUG] PR 제목: ${pr.title}`);
  log.info(`[DEBUG] PR 브랜치: ${pr.head.ref} -> ${pr.base.ref}`);

  if (pr.state !== "open") {
    log.error(`[DEBUG] PR이 열려있지 않음: ${pr.state}`);
    throw new Error(t("commands.merge.error.pr_closed"));
  }

  // 병합 가능 상태 확인
  const status = await getPullRequestStatus({ owner, repo, pull_number });
  log.info(`[DEBUG] 병합 가능 상태: ${status}`);

  if (status !== "MERGEABLE") {
    log.error(`[DEBUG] PR을 병합할 수 없음: ${status}`);
    throw new Error(t("commands.merge.error.not_mergeable"));
  }

  // 병합 실행
  log.info("[DEBUG] 병합 시도 중...");
  try {
    await client.rest.pulls.merge({
      owner,
      repo,
      pull_number,
      merge_method,
      commit_title,
      commit_message,
    });
    log.info("[DEBUG] 병합 성공");
  } catch (error) {
    log.error(
      `[DEBUG] 병합 실패: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }

  // 브랜치 삭제
  if (delete_branch) {
    log.info(`[DEBUG] 브랜치 삭제 시도: ${pr.head.ref}`);
    try {
      await client.rest.git.deleteRef({
        owner,
        repo,
        ref: `heads/${pr.head.ref}`,
      });
      log.info("[DEBUG] 브랜치 삭제 성공");
    } catch (error) {
      log.warn(
        `[DEBUG] 브랜치 삭제 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      log.warn(t("commands.merge.warning.branch_delete_failed"));
    }
  }
}

// collaborators 목록 가져오기
export async function getCollaborators(params: {
  owner: string;
  repo: string;
}): Promise<Collaborator[]> {
  const cacheKey = `${params.owner}/${params.repo}`;
  const cached = collaboratorsCache.get(cacheKey);

  // 캐시가 15분 이내인 경우 재사용
  if (cached && Date.now() - cached.timestamp < 15 * 60 * 1000) {
    return cached.data;
  }

  const client = await getOctokit();
  const response = await client.rest.repos.listCollaborators({
    ...params,
    affiliation: "all",
  });

  const collaborators = response.data as Collaborator[];

  // 캐시 업데이트
  collaboratorsCache.set(cacheKey, {
    data: collaborators,
    timestamp: Date.now(),
  });

  return collaborators;
}

// 리뷰어가 collaborator인지 확인
export async function validateReviewers(params: {
  owner: string;
  repo: string;
  reviewers: string[];
}): Promise<{ valid: string[]; invalid: string[] }> {
  const collaborators = await getCollaborators({
    owner: params.owner,
    repo: params.repo,
  });

  const collaboratorLogins = new Set(collaborators.map((c) => c.login));

  const valid = params.reviewers.filter((reviewer) =>
    collaboratorLogins.has(reviewer),
  );
  const invalid = params.reviewers.filter(
    (reviewer) => !collaboratorLogins.has(reviewer),
  );

  if (invalid.length > 0) {
    log.warn(
      t("common.warning.invalid_reviewers", {
        reviewers: invalid.join(", "),
      }),
    );
  }

  return { valid, invalid };
}

export interface CollaboratorInviteParams {
  owner: string;
  repo: string;
  username: string;
  permission: "pull" | "push" | "admin";
}

export async function inviteCollaborator({
  owner,
  repo,
  username,
  permission,
}: CollaboratorInviteParams): Promise<void> {
  const client = await getOctokit();
  await client.rest.repos.addCollaborator({
    owner,
    repo,
    username,
    permission,
  });
}

export async function removeCollaborator({
  owner,
  repo,
  username,
}: {
  owner: string;
  repo: string;
  username: string;
}): Promise<void> {
  const client = await getOctokit();
  await client.rest.repos.removeCollaborator({
    owner,
    repo,
    username,
  });
}

export async function getInvitationStatus({
  owner,
  repo,
  username,
}: {
  owner: string;
  repo: string;
  username: string;
}): Promise<{
  status: "pending" | "accepted" | "expired";
  invitedAt: string;
  expiresAt: string;
} | null> {
  try {
    const client = await getOctokit();
    const response = await client.rest.repos.listInvitations({
      owner,
      repo,
      per_page: 100,
    });

    const invitation = response.data.find(
      (inv) => inv.invitee?.login === username,
    );

    if (!invitation) {
      return null;
    }

    // 초대 상태는 created_at을 기준으로 판단
    const invitedAt = new Date(invitation.created_at);
    const now = new Date();
    const sevenDaysLater = new Date(
      invitedAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    );

    let status: "pending" | "accepted" | "expired";
    if (now > sevenDaysLater) {
      status = "expired";
    } else {
      // collaborator 목록에서 사용자 확인
      const collaborators = await getCollaborators({ owner, repo });
      const isCollaborator = collaborators.some((c) => c.login === username);
      status = isCollaborator ? "accepted" : "pending";
    }

    return {
      status,
      invitedAt: invitation.created_at,
      expiresAt: sevenDaysLater.toISOString(),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        t("common.error.get_invitation_status", { error: error.message }),
      );
    }
    throw error;
  }
}

// 모든 초대 상태 확인
export async function getAllInvitationStatuses({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}): Promise<
  Array<{
    username: string;
    status: "pending" | "accepted" | "expired";
    invitedAt: string;
    expiresAt: string;
  }>
> {
  try {
    const client = await getOctokit();
    const response = await client.rest.repos.listInvitations({
      owner,
      repo,
      per_page: 100,
    });

    // collaborator 목록 가져오기
    const collaborators = await getCollaborators({ owner, repo });

    return response.data.map((invitation) => {
      const invitedAt = new Date(invitation.created_at);
      const now = new Date();
      const sevenDaysLater = new Date(
        invitedAt.getTime() + 7 * 24 * 60 * 60 * 1000,
      );

      let status: "pending" | "accepted" | "expired";
      if (now > sevenDaysLater) {
        status = "expired";
      } else {
        // collaborator 목록에서 사용자 확인
        const isCollaborator = collaborators.some(
          (c) => c.login === invitation.invitee?.login,
        );
        status = isCollaborator ? "accepted" : "pending";
      }

      return {
        username: invitation.invitee?.login || "Unknown",
        status,
        invitedAt: invitation.created_at,
        expiresAt: sevenDaysLater.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        t("common.error.get_invitation_statuses", { error: error.message }),
      );
    }
    throw error;
  }
}

interface ConflictBlock {
  startLine: number;
  middleLine?: number;
  endLine: number;
  baseContent: string;
  headContent: string;
}

interface ConflictInfo {
  filename: string;
  status: "conflicted";
  additions: number;
  deletions: number;
  changes: number;
  conflictBlocks: ConflictBlock[];
}

export async function getPullRequestConflicts(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<{ hasConflicts: boolean; conflicts: ConflictInfo[] }> {
  try {
    const client = await getOctokit();

    // PR 정보 가져오기
    const { data: pullRequest } = await client.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    // PR의 파일 목록 가져오기
    const { data: files } = await client.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
    });

    const conflicts: ConflictInfo[] = [];

    // PR이 충돌 상태인 경우 모든 수정된 파일을 충돌 파일로 표시
    if (pullRequest.mergeable_state === "dirty") {
      for (const file of files) {
        if (file.status === "removed") continue;
        if (file.status === "modified" || file.status === "added") {
          conflicts.push({
            filename: file.filename,
            status: "conflicted",
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            conflictBlocks: [], // 충돌 블록 정보는 현재 필요하지 않음
          });
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        t("common.error.get_conflicts", { error: error.message }),
      );
    }
    throw error;
  }
}

function _findConflictBlocks(
  headText: string,
  _baseText: string,
): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  const lines = headText.split("\n");

  let currentBlock: Partial<ConflictBlock> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("<<<<<<< HEAD")) {
      currentBlock = {
        startLine: i + 1,
        baseContent: "",
        headContent: "",
      };
    } else if (line.startsWith("=======") && currentBlock) {
      currentBlock.middleLine = i + 1;
    } else if (line.startsWith(">>>>>>>") && currentBlock) {
      currentBlock.endLine = i + 1;
      blocks.push(currentBlock as ConflictBlock);
      currentBlock = null;
    } else if (currentBlock) {
      if (!currentBlock.middleLine) {
        currentBlock.headContent += line + "\n";
      } else {
        currentBlock.baseContent += line + "\n";
      }
    }
  }

  return blocks;
}

export async function checkDraftPRAvailability(params: {
  owner: string;
  repo: string;
}): Promise<boolean> {
  try {
    const client = await getOctokit();
    const { data: repository } = await client.rest.repos.get(params);

    // 디버깅을 위해 repository 객체의 모든 속성 출력
    console.log("Repository data (raw):", repository);

    // 주요 속성들 개별적으로 로깅
    log.debug("Repository properties:");
    log.debug(`- Name: ${repository.name}`);
    log.debug(`- Private: ${repository.private}`);
    log.debug(`- Has Issues: ${repository.has_issues}`);
    log.debug(`- Has Projects: ${repository.has_projects}`);
    log.debug(`- Has Wiki: ${repository.has_wiki}`);
    log.debug(`- Has Pages: ${repository.has_pages}`);
    log.debug(`- Has Downloads: ${repository.has_downloads}`);
    log.debug(`- Has Discussions: ${repository.has_discussions}`);
    if (repository.permissions) {
      log.debug("Permissions:");
      log.debug(`- Admin: ${repository.permissions.admin}`);
      log.debug(`- Push: ${repository.permissions.push}`);
      log.debug(`- Pull: ${repository.permissions.pull}`);
    }

    // private 레포의 경우 draft PR 기능은 유료 기능입니다
    // 일단 private 여부로만 판단
    return !repository.private;
  } catch (error) {
    // 에러 발생 시 false를 반환하여 안전하게 처리
    log.error("Failed to check draft PR availability:", error);
    return false;
  }
}
