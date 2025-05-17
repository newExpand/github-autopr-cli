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
  language: "en",
};

const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  defaultBranch: "main",
  developmentBranch: "dev",
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
      labels: ["feature"],
      template: "feature",
      autoAssignReviewers: true,
      reviewers: [],
      reviewerGroups: [],
    },
    {
      pattern: "fix/*",
      type: "fix" as const,
      draft: true,
      labels: ["bug"],
      template: "bugfix",
      autoAssignReviewers: true,
      reviewers: [],
      reviewerGroups: [],
    },
    {
      pattern: "refactor/*",
      type: "refactor" as const,
      draft: true,
      labels: ["refactor"],
      template: "refactor",
      autoAssignReviewers: true,
      reviewers: [],
      reviewerGroups: [],
    },
    {
      pattern: "docs/*",
      type: "docs" as const,
      draft: false,
      labels: ["documentation"],
      template: "docs",
      autoAssignReviewers: false,
      reviewers: [],
      reviewerGroups: [],
    },
    {
      pattern: "chore/*",
      type: "chore" as const,
      draft: false,
      labels: ["chore"],
      template: "chore",
      autoAssignReviewers: false,
      reviewers: [],
      reviewerGroups: [],
    },
    {
      pattern: "test/*",
      type: "test" as const,
      draft: true,
      labels: ["test"],
      template: "test",
      autoAssignReviewers: true,
      reviewers: [],
      reviewerGroups: [],
    },
    {
      pattern: "release/*",
      type: "release" as const,
      draft: false,
      labels: ["release"],
      template: "release",
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
      t("core.config.error.load_global_failed", { error: String(error) }),
    );
  }
}

export async function loadProjectConfig(): Promise<ProjectConfig> {
  try {
    const configData = await readFile(PROJECT_CONFIG_FILE, "utf-8");
    const config = JSON.parse(configData);

    if (config.reviewerGroups) {
      config.reviewerGroups = config.reviewerGroups.map((group: unknown) =>
        ReviewerGroupSchema.parse(group),
      );
    }

    return ProjectConfigSchema.parse(config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_PROJECT_CONFIG;
    }
    throw new Error(
      t("core.config.error.load_project_failed", { error: String(error) }),
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
      t("core.config.error.save_global_failed", { error: String(error) }),
    );
  }
}

export async function saveProjectConfig(config: ProjectConfig): Promise<void> {
  try {
    await writeFile(PROJECT_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    throw new Error(
      t("core.config.error.save_project_failed", { error: String(error) }),
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

  if (updates.reviewerGroups) {
    newConfig.reviewerGroups = updates.reviewerGroups.map((group: unknown) =>
      ReviewerGroupSchema.parse(group),
    );
  }

  const validatedConfig = ProjectConfigSchema.parse(newConfig);
  await saveProjectConfig(validatedConfig);
  return validatedConfig;
}

// updateConfig
export async function updateConfig(updates: Partial<Config>): Promise<Config> {
  const { language, githubApp, ...projectUpdates } = updates;

  // uc804uc5ed uc124uc815uacfc ud504ub85cuc81dud2b8 uc124uc815uc744 ubd84ub9acud558uc5ec uc5c5ub370uc774ud2b8
  const globalUpdates: Partial<GlobalConfig> = {
    ...(language && { language }),
    ...(githubApp !== undefined && { githubApp }),
  };

  if (Object.keys(globalUpdates).length > 0) {
    await updateGlobalConfig(globalUpdates);
  }

  if (Object.keys(projectUpdates).length > 0) {
    await updateProjectConfig(projectUpdates);
  }

  return loadConfig();
}
