import { minimatch } from "minimatch";
import { BranchPattern } from "../types/config.js";
import { loadConfig } from "../core/config.js";
import { t } from "../i18n/index.js";
import { loadTemplate } from "../utils/template.js";
import { log } from "../utils/logger.js";

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
