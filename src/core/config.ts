import { homedir } from "os";
import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { t } from "../i18n/index.js";
import {
  Config,
  ConfigSchema,
  GlobalConfig,
  GlobalConfigSchema,
  ProjectConfig,
  ProjectConfigSchema,
  ReviewerGroupSchema,
} from "../types/config.js";

const CONFIG_DIR = join(homedir(), ".autopr");
const GLOBAL_CONFIG_FILE = join(CONFIG_DIR, "config.json");
const PROJECT_CONFIG_FILE = ".autopr.json";

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  githubToken: "",
  language: "en",
};

const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  defaultBranch: "main",
  defaultReviewers: [],
  autoPrEnabled: true,
  defaultLabels: [],
  reviewerGroups: [],
  filePatterns: [],
  branchPatterns: [
    {
      pattern: "feat/*",
      type: "feat" as const,
      draft: true,
      labels: [t("config.branch_patterns.labels.feature")],
      template: "feature",
      autoAssignReviewers: true,
      reviewers: [],
      reviewerGroups: [],
    },
    {
      pattern: "fix/*",
      type: "fix" as const,
      draft: true,
      labels: [t("config.branch_patterns.labels.bug")],
      template: "bugfix",
      autoAssignReviewers: true,
      reviewers: [],
      reviewerGroups: [],
    },
    {
      pattern: "refactor/*",
      type: "refactor" as const,
      draft: true,
      labels: [t("config.branch_patterns.labels.refactor")],
      template: "refactor",
      autoAssignReviewers: true,
      reviewers: [],
      reviewerGroups: [],
    },
    {
      pattern: "docs/*",
      type: "docs" as const,
      draft: false,
      labels: [t("config.branch_patterns.labels.documentation")],
      template: "docs",
      autoAssignReviewers: false,
      reviewers: [],
      reviewerGroups: [],
    },
    {
      pattern: "chore/*",
      type: "chore" as const,
      draft: false,
      labels: [t("config.branch_patterns.labels.chore")],
      template: "chore",
      autoAssignReviewers: false,
      reviewers: [],
      reviewerGroups: [],
    },
    {
      pattern: "test/*",
      type: "test" as const,
      draft: true,
      labels: [t("config.branch_patterns.labels.test")],
      template: "test",
      autoAssignReviewers: true,
      reviewers: [],
      reviewerGroups: [],
    },
  ],
};

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  try {
    const configData = await readFile(GLOBAL_CONFIG_FILE, "utf-8");
    const config = JSON.parse(configData);
    return GlobalConfigSchema.parse(config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_GLOBAL_CONFIG;
    }
    throw new Error(
      t("config.error.load_global_failed", { error: String(error) }),
    );
  }
}

export async function loadProjectConfig(): Promise<ProjectConfig> {
  try {
    const configData = await readFile(PROJECT_CONFIG_FILE, "utf-8");
    const config = JSON.parse(configData);
    return ProjectConfigSchema.parse(config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_PROJECT_CONFIG;
    }
    throw new Error(
      t("config.error.load_project_failed", { error: String(error) }),
    );
  }
}

export async function loadConfig(): Promise<Config> {
  const [globalConfig, projectConfig] = await Promise.all([
    loadGlobalConfig(),
    loadProjectConfig(),
  ]);

  return ConfigSchema.parse({
    ...globalConfig,
    ...projectConfig,
  });
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    throw new Error(
      t("config.error.save_global_failed", { error: String(error) }),
    );
  }
}

export async function saveProjectConfig(config: ProjectConfig): Promise<void> {
  try {
    await writeFile(PROJECT_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    throw new Error(
      t("config.error.save_project_failed", { error: String(error) }),
    );
  }
}

export async function updateGlobalConfig(
  updates: Partial<GlobalConfig>,
): Promise<GlobalConfig> {
  const currentConfig = await loadGlobalConfig();
  const newConfig = {
    ...currentConfig,
    ...updates,
  };

  const validatedConfig = GlobalConfigSchema.parse(newConfig);
  await saveGlobalConfig(validatedConfig);
  return validatedConfig;
}

export async function updateProjectConfig(
  updates: Partial<ProjectConfig>,
): Promise<ProjectConfig> {
  const currentConfig = await loadProjectConfig();
  const newConfig = {
    ...currentConfig,
    ...updates,
  };

  const validatedConfig = ProjectConfigSchema.parse(newConfig);
  await saveProjectConfig(validatedConfig);
  return validatedConfig;
}

// 기존 updateConfig는 호환성을 위해 유지
export async function updateConfig(updates: Partial<Config>): Promise<Config> {
  const { githubToken, language, ...projectUpdates } = updates;

  // 전역 설정과 프로젝트 설정을 분리하여 업데이트
  const globalUpdates: Partial<GlobalConfig> = {
    ...(githubToken && { githubToken }),
    ...(language && { language }),
  };

  if (Object.keys(globalUpdates).length > 0) {
    await updateGlobalConfig(globalUpdates);
  }

  if (Object.keys(projectUpdates).length > 0) {
    await updateProjectConfig(projectUpdates);
  }

  return loadConfig();
}
