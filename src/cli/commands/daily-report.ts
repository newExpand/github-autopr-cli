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
import inquirer from "inquirer";

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
  date?: string; // 특정 날짜 지정 (기본: 오늘)
  output?: string; // 출력 파일 경로
}

// 날짜 포맷팅 함수
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// 오늘 날짜 가져오기
function getToday(): string {
  return formatDate(new Date());
}

// 모든 브랜치에서 사용자의 커밋 날짜 목록 가져오기 (최근 3개월)
async function getCommitDates(username: string): Promise<string[]> {
  try {
    // git log 명령어를 직접 실행하여 전체 커밋 로그를 가져옴 (날짜 포맷 포함)
    const { stdout: gitLogOutput } = await execAsync(
      `git log --all --format="%ad %an" --date=iso-strict | head -200`,
    );

    const lines = gitLogOutput.trim().split("\n").filter(Boolean);

    // 날짜 추출 및 사용자 이름 대소문자 무시하여 비교
    const allDates = new Set<string>();
    const lowercaseUsername = username.toLowerCase();

    for (const line of lines) {
      const parts = line.split(" ");
      if (parts.length < 2) continue;

      // ISO 날짜 형식(2025-04-06T19:31:48+09:00)에서 날짜 부분만 추출
      const dateStr = parts[0].split("T")[0];
      // 마지막 부분이 사용자 이름
      const author = parts.slice(1).join(" ");

      // 사용자 이름 대소문자 무시하여 비교
      if (author.toLowerCase() === lowercaseUsername) {
        allDates.add(dateStr);
      }
    }

    // 날짜 목록을 배열로 변환하고 정렬
    const dateArray = Array.from(allDates);

    // 날짜 정렬 (최신 날짜가 먼저 오도록)
    dateArray.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    return dateArray.length > 0 ? dateArray : [getToday()];
  } catch (error) {
    log.debug(t("commands.daily_report.error.commit_dates_failed"), error);
    // 오류 발생 시 오늘 날짜만 반환
    return [getToday()];
  }
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

// 로컬 커밋 데이터 가져오기
async function getLocalCommits(
  username: string,
  since: string,
  until: string,
): Promise<CommitInfo[]> {
  const localCommits: CommitInfo[] = [];

  try {
    // 시간 범위를 넓게 설정하여 모든 커밋 포함
    const sinceDate = `${since}T00:00:00`;
    const untilDate = `${until}T23:59:59`;

    const lowercaseUsername = username.toLowerCase();

    // 해당 날짜의 모든 커밋 로그를 직접 가져오기
    const { stdout: commitLogs } = await execAsync(
      `git log --all --format="%H|%ad|%an|%s" --date=iso-strict --since="${sinceDate}" --until="${untilDate}" | sort -u`,
    );

    const commitLines = commitLogs.trim().split("\n").filter(Boolean);

    if (commitLines.length === 0) {
      return localCommits;
    }

    // 커밋 로그 파싱
    for (const line of commitLines) {
      const [sha, dateTime, author, ...messageParts] = line.split("|");
      const message = messageParts.join("|"); // 메시지에 |가 포함될 수 있음

      // 사용자 이름 대소문자 무시하여 비교
      if (author.toLowerCase() === lowercaseUsername) {
        try {
          // 변경된 파일 정보 가져오기
          const { stdout: filesOutput } = await execAsync(
            `git show --name-status --format="" ${sha}`,
          );

          const filesData = filesOutput.trim().split("\n").filter(Boolean);
          const files = [];

          for (const fileData of filesData) {
            const [status, filename] = fileData.split(/\s+/);

            if (filename) {
              try {
                const { stdout: diffStat } = await execAsync(
                  `git diff --numstat ${sha}^ ${sha} -- "${filename}"`,
                );

                const [additions, deletions] = diffStat.trim().split(/\s+/);

                files.push({
                  filename,
                  additions: parseInt(additions) || 0,
                  deletions: parseInt(deletions) || 0,
                });
              } catch (error) {
                // 첫 커밋인 경우 부모 커밋이 없을 수 있음
                files.push({
                  filename,
                  additions: 0,
                  deletions: 0,
                });
              }
            }
          }

          // ISO 날짜 형식 유지
          const date = dateTime;

          localCommits.push({
            sha,
            message,
            date,
            files,
          });
        } catch (error) {
          log.debug(`커밋 ${sha.substring(0, 7)} 처리 중 오류 발생`, error);
        }
      }
    }

    return localCommits;
  } catch (error) {
    log.debug(t("commands.daily_report.error.local_commits_failed"), error);
    return localCommits;
  }
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

  const localCommits = await getLocalCommits(username, since, until);

  // GitHub API로 커밋 조회
  try {
    const { data: commitsData } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      author: username,
      since: `${since}T00:00:00Z`,
      until: `${until}T23:59:59Z`,
      per_page: 100,
    });

    // 원격 커밋 처리
    const remoteCommits: CommitInfo[] = [];
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

      remoteCommits.push(commitInfo);
    }

    // 로컬 및 원격 커밋 병합 (중복 제거)
    const seenShas = new Set<string>();

    // 원격 커밋 먼저 추가
    for (const commit of remoteCommits) {
      seenShas.add(commit.sha);
      commits.push(commit);
    }

    // 로컬에만 있는 커밋 추가
    for (const commit of localCommits) {
      if (!seenShas.has(commit.sha)) {
        seenShas.add(commit.sha);
        commits.push(commit);
      }
    }
  } catch (error) {
    log.debug("Failed to fetch remote commits", error);
    // GitHub API 요청 실패 시 로컬 커밋만 사용
    commits.push(...localCommits);
  }

  // 날짜순 정렬
  commits.sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  stats.totalCommits = commits.length;

  if (commits.length === 0) {
    return { stats, commits };
  }

  // 각 커밋에 대한 통계 처리
  for (const commit of commits) {
    const hour = new Date(commit.date).getHours().toString().padStart(2, "0");

    // 시간대별 커밋 수 업데이트
    stats.hourlyCommits[hour] = (stats.hourlyCommits[hour] || 0) + 1;

    // 브랜치 확인
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
    if (commit.files && commit.files.length > 0) {
      stats.filesChanged += commit.files.length;

      commit.files.forEach((file) => {
        stats.additions += file.additions || 0;
        stats.deletions += file.deletions || 0;

        // 파일 확장자 추출
        const fileExt = file.filename.split(".").pop() || "unknown";
        stats.fileTypes[fileExt] = (stats.fileTypes[fileExt] || 0) + 1;
      });
    }
  }

  return { stats, commits };
}

// AI 요약 생성
async function generateAIReport(
  commits: CommitInfo[],
  stats: CommitStats,
  username: string,
  date: string,
  until: string,
): Promise<string> {
  try {
    const aiFeatures = new AIFeatures();

    // 날짜 포맷
    const dateStr = date === until ? date : `${date} ~ ${until}`;

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
  const { date, username } = options;

  log.section(t("commands.daily_report.title"));

  if (date === getToday()) {
    log.info(t("commands.daily_report.date_single", { date }));
  } else {
    log.info(t("commands.daily_report.date_range", { from: date, to: date }));
  }

  log.info(t("commands.daily_report.user", { username }));

  // AI 요약 섹션
  log.section(t("commands.daily_report.ai_summary"));

  // AI 요약이 있는 경우 출력
  if (aiSummary && aiSummary.trim().length > 0) {
    // 콘솔 직접 출력 대신 process.stdout.write 사용
    process.stdout.write(aiSummary + "\n");
  } else {
    process.stdout.write(
      t("commands.daily_report.info.ai_not_available") + "\n",
    );
  }

  console.log(); // 빈 줄 추가

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
  const { date, username } = options;

  let md = `# ${t("commands.daily_report.title")}\n\n`;

  if (date === getToday()) {
    md += `**${t("commands.daily_report.date_single", { date })}**\n\n`;
  } else {
    md += `**${t("commands.daily_report.date_range", { from: date, to: date })}**\n\n`;
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
    md += "| branch | commit count |\n|--------|--------|\n";
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
    md += "| file type | change count |\n|-----------|--------|\n";
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
  const { format, date, output } = options;

  // 출력 파일명 결정
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

    // AI 기능 초기화
    let aiFeatures;
    try {
      aiFeatures = new AIFeatures();
      log.info(t("commands.daily_report.info.initialization_success"));
    } catch (error) {
      log.error(t("commands.daily_report.error.ai_init_failed"));
      log.info(t("commands.daily_report.error.ai_required"));
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

    // 사용자 이름이 여전히 없는 경우 오류 처리
    if (!username) {
      log.error(t("commands.daily_report.error.user_not_found"));
      process.exit(1);
    }

    // 날짜 결정 (특정 날짜 옵션 또는 선택 인터페이스)
    let date = options.date;
    if (!date) {
      // 사용자의 커밋이 있는 날짜 목록 가져오기
      log.info(t("commands.daily_report.fetching_commit_dates"));
      const dates = await getCommitDates(username);

      if (dates.length === 0) {
        log.info(t("commands.daily_report.no_commit_dates"));
        process.exit(0);
      }

      // inquirer를 사용하여 날짜 선택 프롬프트 표시
      const dateChoices = dates.map((date) => ({
        name: date,
        value: date,
      }));

      const { selectedDate } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedDate",
          message: t("commands.daily_report.select_date"),
          choices: dateChoices,
          default: dateChoices[0].value,
        },
      ]);

      date = selectedDate;
    }

    // 날짜가 여전히 없는 경우 오늘 날짜로 기본 설정
    if (!date) {
      date = getToday();
    }

    log.info(
      t("commands.daily_report.fetching", {
        username,
        date,
      }),
    );

    // 커밋 데이터와 통계 가져오기 (하루 단위)
    const { stats, commits } = await getDailyCommits(
      octokit,
      repoInfo.owner,
      repoInfo.repo,
      username,
      date, // 시작 날짜와 종료 날짜를 동일하게 설정
      date,
    );

    const reportOptions = { ...options, username, date };

    // AI 요약 생성 (기본적으로 항상 생성)
    let aiSummary: string | undefined;
    if (stats.totalCommits > 0) {
      aiSummary = await generateAIReport(commits, stats, username, date, date);
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
    .option("-d, --date <date>", t("commands.daily_report.options.date"))
    .option("-o, --output <path>", t("commands.daily_report.options.output"))
    .action(dailyReportCommand);

  return command;
}
