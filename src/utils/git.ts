import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface RepoInfo {
  owner: string;
  repo: string;
  currentBranch: string;
}

export async function getCurrentRepoInfo(): Promise<RepoInfo | null> {
  try {
    // 현재 브랜치 가져오기
    const { stdout: branch } = await execAsync(
      "git rev-parse --abbrev-ref HEAD",
    );
    const currentBranch = branch.trim();

    // 원격 저장소 URL 가져오기
    const { stdout: remoteUrl } = await execAsync(
      "git config --get remote.origin.url",
    );
    const url = remoteUrl.trim();

    // GitHub URL 파싱
    const match = url.match(/github\.com[:/]([^/]+)\/([^.]+)(?:\.git)?$/);

    process.stdout.write(JSON.stringify(match, null, 2));
    if (!match) {
      return null;
    }

    const [, owner, repo] = match;
    return { owner, repo, currentBranch };
  } catch (error) {
    return null;
  }
}

// 로컬 브랜치 목록 가져오기
export async function getLocalBranches(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      "git branch --format='%(refname:short)'",
    );
    return stdout.split("\n").filter(Boolean);
  } catch (error) {
    return [];
  }
}

// 원격 브랜치 목록 가져오기
export async function getRemoteBranches(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      "git branch -r --format='%(refname:short)'",
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((branch) => branch.replace(/^origin\//, "")) // 'origin/' 접두사 제거
      .filter((branch) => branch !== "HEAD"); // HEAD 제외
  } catch (error) {
    return [];
  }
}

// 모든 브랜치 목록 가져오기 (로컬 + 원격)
export async function getAllBranches(): Promise<{
  local: string[];
  remote: string[];
  all: string[];
}> {
  const local = await getLocalBranches();
  const remote = await getRemoteBranches();

  // 중복 제거된 모든 브랜치 목록
  const all = [...new Set([...local, ...remote])];

  return { local, remote, all };
}
