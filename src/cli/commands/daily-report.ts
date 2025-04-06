import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { log } from "../../utils/logger.js";
import { Octokit } from "octokit";
import { getOctokit } from "../../core/github.js";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile } from "fs/promises";
import path from "path";
import { Command } from "commander";
import { AIFeatures } from "../../core/ai-features.js";

const execAsync = promisify(exec);

interface CommitStats {
  totalCommits: number;
  filesChanged: number;
  additions: number;
  deletions: number;
  branches: Record<string, number>; // 브랜치별 커밋 수
  hourlyCommits: Record<string, number>; // 시간대별 커밋 수
  fileTypes: Record<string, number>; // 파일 유형별 변경 수
}

interface CommitInfo {
  sha: string;
  message: string;
  date: string;
  files?: Array<{
    filename: string;
    additions: number;
    deletions: number;
  }>;
}

interface DailyReportOptions {
  username?: string; // 특정 사용자 지정 (기본: 현재 사용자)
  format?: "console" | "json" | "markdown"; // 출력 형식
  since?: string; // 시작 날짜 (기본: 오늘)
  until?: string; // 종료 날짜 (기본: 오늘)
  output?: string; // 출력 파일 경로
  ai?: boolean; // AI 요약 사용 여부
}

// 날짜 포맷팅 함수
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// 오늘 날짜 가져오기
function getToday(): string {
  return formatDate(new Date());
}

// 현재 Git 사용자 이름 가져오기
async function getCurrentGitUser(): Promise<string> {
  try {
    const { stdout } = await execAsync("git config user.name");
    return stdout.trim();
  } catch (error) {
    throw new Error(t("commands.daily_report.error.user_not_found"));
  }
}

// GitHub 사용자 이름 가져오기
async function getGitHubUsername(octokit: Octokit): Promise<string> {
  const { data } = await octokit.rest.users.getAuthenticated();
  return data.login;
}

// 커밋 통계 초기화
function initCommitStats(): CommitStats {
  return {
    totalCommits: 0,
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    branches: {},
    hourlyCommits: {},
    fileTypes: {},
  };
}

// 일일 커밋 데이터 가져오기
async function getDailyCommits(
  octokit: Octokit,
  owner: string,
  repo: string,
  username: string,
  since: string,
  until: string,
): Promise<{ stats: CommitStats; commits: CommitInfo[] }> {
  const stats = initCommitStats();
  const commits: CommitInfo[] = [];

  log.info(t("commands.daily_report.fetching_commits"));

  // GitHub API로 커밋 조회
  const { data: commitsData } = await octokit.rest.repos.listCommits({
    owner,
    repo,
    author: username,
    since: `${since}T00:00:00Z`,
    until: `${until}T23:59:59Z`,
    per_page: 100,
  });

  stats.totalCommits = commitsData.length;

  if (commitsData.length === 0) {
    log.info(t("commands.daily_report.no_commits"));
    return { stats, commits };
  }

  log.info(
    t("commands.daily_report.analyzing_commits", { count: commitsData.length }),
  );

  // 각 커밋에 대해 상세 정보 조회
  for (const commit of commitsData) {
    const { data: commitData } = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: commit.sha,
    });

    const commitInfo: CommitInfo = {
      sha: commit.sha,
      message: commitData.commit.message,
      date: commitData.commit.author?.date || new Date().toISOString(),
      files: commitData.files?.map((file) => ({
        filename: file.filename,
        additions: file.additions || 0,
        deletions: file.deletions || 0,
      })),
    };

    commits.push(commitInfo);

    const hour = new Date(commitData.commit.author?.date || "")
      .getHours()
      .toString()
      .padStart(2, "0");

    // 시간대별 커밋 수 업데이트
    stats.hourlyCommits[hour] = (stats.hourlyCommits[hour] || 0) + 1;

    // 브랜치 확인 (참고: GitHub API로는 커밋의 브랜치를 직접 얻기 어려움)
    try {
      const { stdout } = await execAsync(
        `git branch --contains ${commit.sha} --format="%(refname:short)"`,
      );
      const branches = stdout.split("\n").filter(Boolean);

      branches.forEach((branch) => {
        stats.branches[branch] = (stats.branches[branch] || 0) + 1;
      });
    } catch (error) {
      // 브랜치 정보를 가져오지 못하면 무시
    }

    // 파일 변경 통계
    stats.filesChanged += commitData.files?.length || 0;

    commitData.files?.forEach((file: any) => {
      stats.additions += file.additions || 0;
      stats.deletions += file.deletions || 0;

      // 파일 확장자 추출
      const fileExt = file.filename.split(".").pop() || "unknown";
      stats.fileTypes[fileExt] = (stats.fileTypes[fileExt] || 0) + 1;
    });
  }

  return { stats, commits };
}

// AI 요약 생성
async function generateAIReport(
  commits: CommitInfo[],
  stats: CommitStats,
  username: string,
  since: string,
  until: string,
): Promise<string> {
  log.info(t("commands.daily_report.generating_ai_summary"));

  try {
    const aiFeatures = new AIFeatures();
    // AI 기능 초기화
    const initialized = await aiFeatures.initialize();

    if (!initialized) {
      return t("commands.daily_report.error.ai_init_failed");
    }

    // 날짜 포맷
    const dateStr = since === until ? since : `${since} ~ ${until}`;

    // AI를 사용하여 요약 생성
    const summary = await aiFeatures.generateDailyCommitSummary(
      commits,
      username,
      dateStr,
      stats,
    );

    return summary;
  } catch (error) {
    log.error(t("commands.daily_report.error.ai_generation_failed"), error);
    return t("commands.daily_report.error.ai_fallback");
  }
}

// 보고서 콘솔 출력
function printConsoleReport(
  stats: CommitStats,
  options: DailyReportOptions,
  aiSummary?: string,
): void {
  const { since, until, username } = options;

  log.section(t("commands.daily_report.title"));

  if (since === until) {
    log.info(t("commands.daily_report.date_single", { date: since }));
  } else {
    log.info(t("commands.daily_report.date_range", { from: since, to: until }));
  }

  log.info(t("commands.daily_report.user", { username }));

  // AI 요약이 있는 경우 먼저 표시
  if (aiSummary) {
    log.section(t("commands.daily_report.ai_summary"));
    console.log(aiSummary);
    console.log(); // 빈 줄 추가
  }

  // 주요 통계
  log.section(t("commands.daily_report.summary"));
  log.info(
    t("commands.daily_report.total_commits", { count: stats.totalCommits }),
  );
  log.info(
    t("commands.daily_report.files_changed", { count: stats.filesChanged }),
  );
  log.info(t("commands.daily_report.lines_added", { count: stats.additions }));
  log.info(
    t("commands.daily_report.lines_deleted", { count: stats.deletions }),
  );

  // 시간대별 통계
  if (Object.keys(stats.hourlyCommits).length > 0) {
    log.section(t("commands.daily_report.hourly_distribution"));
    Object.entries(stats.hourlyCommits)
      .sort(([hourA], [hourB]) => hourA.localeCompare(hourB))
      .forEach(([hour, count]) => {
        log.info(`${hour}:00 - ${count}`);
      });
  }

  // 브랜치별 통계
  if (Object.keys(stats.branches).length > 0) {
    log.section(t("commands.daily_report.branch_distribution"));
    Object.entries(stats.branches)
      .sort(([, countA], [, countB]) => countB - countA)
      .forEach(([branch, count]) => {
        log.info(`${branch} - ${count}`);
      });
  }

  // 파일 유형별 통계
  if (Object.keys(stats.fileTypes).length > 0) {
    log.section(t("commands.daily_report.file_types"));
    Object.entries(stats.fileTypes)
      .sort(([, countA], [, countB]) => countB - countA)
      .forEach(([fileType, count]) => {
        log.info(`${fileType} - ${count}`);
      });
  }
}

// 마크다운 보고서 생성
function generateMarkdownReport(
  stats: CommitStats,
  options: DailyReportOptions,
  aiSummary?: string,
): string {
  const { since, until, username } = options;

  let md = `# ${t("commands.daily_report.title")}\n\n`;

  if (since === until) {
    md += `**${t("commands.daily_report.date_single", { date: since })}**\n\n`;
  } else {
    md += `**${t("commands.daily_report.date_range", { from: since, to: until })}**\n\n`;
  }

  md += `**${t("commands.daily_report.user", { username })}**\n\n`;

  // AI 요약이 있는 경우 먼저 표시
  if (aiSummary) {
    md += `## ${t("commands.daily_report.ai_summary")}\n\n`;
    md += `${aiSummary}\n\n`;
  }

  // 주요 통계
  md += `## ${t("commands.daily_report.summary")}\n\n`;
  md += `- ${t("commands.daily_report.total_commits", { count: stats.totalCommits })}\n`;
  md += `- ${t("commands.daily_report.files_changed", { count: stats.filesChanged })}\n`;
  md += `- ${t("commands.daily_report.lines_added", { count: stats.additions })}\n`;
  md += `- ${t("commands.daily_report.lines_deleted", { count: stats.deletions })}\n\n`;

  // 시간대별 통계
  if (Object.keys(stats.hourlyCommits).length > 0) {
    md += `## ${t("commands.daily_report.hourly_distribution")}\n\n`;
    md += "| 시간 | 커밋 수 |\n|------|--------|\n";
    Object.entries(stats.hourlyCommits)
      .sort(([hourA], [hourB]) => hourA.localeCompare(hourB))
      .forEach(([hour, count]) => {
        md += `| ${hour}:00 | ${count} |\n`;
      });
    md += "\n";
  }

  // 브랜치별 통계
  if (Object.keys(stats.branches).length > 0) {
    md += `## ${t("commands.daily_report.branch_distribution")}\n\n`;
    md += "| 브랜치 | 커밋 수 |\n|--------|--------|\n";
    Object.entries(stats.branches)
      .sort(([, countA], [, countB]) => countB - countA)
      .forEach(([branch, count]) => {
        md += `| ${branch} | ${count} |\n`;
      });
    md += "\n";
  }

  // 파일 유형별 통계
  if (Object.keys(stats.fileTypes).length > 0) {
    md += `## ${t("commands.daily_report.file_types")}\n\n`;
    md += "| 파일 유형 | 변경 수 |\n|-----------|--------|\n";
    Object.entries(stats.fileTypes)
      .sort(([, countA], [, countB]) => countB - countA)
      .forEach(([fileType, count]) => {
        md += `| ${fileType} | ${count} |\n`;
      });
  }

  return md;
}

// 보고서 저장
async function saveReport(
  content: string,
  options: DailyReportOptions,
): Promise<string> {
  const { format, since, until, output } = options;

  // 출력 파일명 결정
  const date = since === until ? since : `${since}_to_${until}`;
  const filename =
    output || `commit_report_${date}.${format === "markdown" ? "md" : "json"}`;

  await writeFile(filename, content);

  return path.resolve(filename);
}

// 일일 보고서 명령어 핸들러
export async function dailyReportCommand(
  options: DailyReportOptions = {},
): Promise<void> {
  try {
    const config = await loadConfig();
    if (!config) {
      log.error(t("common.error.config_load_failed"));
      process.exit(1);
    }

    const repoInfo = await getCurrentRepoInfo();
    if (!repoInfo) {
      log.error(t("common.error.not_git_repo"));
      process.exit(1);
    }

    const octokit = await getOctokit();

    // 기본값 설정
    const format = options.format || "console";
    const since = options.since || getToday();
    const until = options.until || getToday();

    // 사용자 이름 결정
    let username = options.username;
    if (!username) {
      try {
        // GitHub 사용자 이름 가져오기
        username = await getGitHubUsername(octokit);
        log.debug(
          t("commands.daily_report.debug.using_github_user", { username }),
        );
      } catch (error) {
        // GitHub API 요청 실패 시 Git 설정에서 가져오기
        log.debug(t("commands.daily_report.debug.github_user_failed"));
        username = await getCurrentGitUser();
        log.debug(
          t("commands.daily_report.debug.using_git_user", { username }),
        );
      }
    }

    log.info(
      t("commands.daily_report.fetching", {
        username,
        date: since === until ? since : `${since} ~ ${until}`,
      }),
    );

    // 커밋 데이터와 통계 가져오기
    const { stats, commits } = await getDailyCommits(
      octokit,
      repoInfo.owner,
      repoInfo.repo,
      username,
      since,
      until,
    );

    const reportOptions = { ...options, username, since, until };

    // AI 요약 생성 (옵션이 활성화된 경우)
    let aiSummary: string | undefined;
    if (options.ai && stats.totalCommits > 0) {
      aiSummary = await generateAIReport(
        commits,
        stats,
        username,
        since,
        until,
      );
    }

    switch (format) {
      case "json":
        // JSON 형식에서는 AI 요약도 포함
        const jsonOutput = JSON.stringify(
          {
            stats,
            aiSummary: aiSummary || null,
            commits: commits,
          },
          null,
          2,
        );

        if (options.output) {
          const filePath = await saveReport(jsonOutput, reportOptions);
          log.info(t("commands.daily_report.report_saved", { path: filePath }));
        } else {
          console.log(jsonOutput);
        }
        break;

      case "markdown":
        const markdownOutput = generateMarkdownReport(
          stats,
          reportOptions,
          aiSummary,
        );

        if (options.output) {
          const filePath = await saveReport(markdownOutput, reportOptions);
          log.info(t("commands.daily_report.report_saved", { path: filePath }));
        } else {
          console.log(markdownOutput);
        }
        break;

      default:
        printConsoleReport(stats, reportOptions, aiSummary);
        break;
    }
  } catch (error) {
    log.error(t("common.error.unknown"), error);
    process.exit(1);
  }
}

// 명령어 생성 함수
export function createDailyReportCommand() {
  const command = new Command("daily-report")
    .description(t("commands.daily_report.description"))
    .option(
      "-u, --username <username>",
      t("commands.daily_report.options.username"),
    )
    .option(
      "-f, --format <format>",
      t("commands.daily_report.options.format"),
      "console",
    )
    .option(
      "-s, --since <date>",
      t("commands.daily_report.options.since"),
      getToday(),
    )
    .option("-t, --until <date>", t("commands.daily_report.options.until"))
    .option("-o, --output <path>", t("commands.daily_report.options.output"))
    .option("-a, --ai", t("commands.daily_report.options.ai"))
    .action(dailyReportCommand);

  return command;
}
