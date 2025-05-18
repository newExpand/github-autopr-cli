import { readFile } from "fs/promises";
import { join } from "path";
import { loadConfig } from "../core/config.js";

const TEMPLATE_DIR = ".github/PULL_REQUEST_TEMPLATE";

const DEFAULT_TEMPLATES: Record<string, Record<string, string>> = {
  en: {
    feature: `## Feature Description
A brief description of the new feature you're adding.

## Implementation Details
Explain the key implementation details and technical decisions.

## Testing
Describe how this feature was tested.

## Screenshots
If there are UI changes, include screenshots here.

## Related Issues
Related issue numbers: #`,

    bugfix: `## Bug Description
Describe the bug that was fixed.

## Root Cause
Explain what was causing the bug.

## Solution
Describe how you fixed the issue.

## Testing
Explain how you tested the fix.

## Related Issues
Bug report: #`,

    refactor: `## Refactoring Description
Describe what was refactored.

## Reason for Change
Explain why this refactoring was needed.

## Major Changes
List the key changes made during refactoring.

## Testing
Describe how you verified the refactoring doesn't break existing functionality.

## Performance Impact
Note any performance impacts from this change.`,

    docs: `## Documentation Changes
Describe what documentation was changed.

## Reason for Change
Explain why these changes were needed.

## Major Changes
List the key documentation changes.`,

    chore: `## Changes
Describe what maintenance work was performed.

## Reason for Change
Explain why these changes were needed.

## Scope
Indicate the scope of changes (build system, dependencies, configuration files, etc.).`,

    test: `## Test Changes
Describe what tests were added or modified.

## Test Coverage
Explain what types of testing was added (unit, integration, E2E).

## Test Cases
List the key test cases that were implemented.`,
  },
  ko: {
    feature: `## 기능 설명
추가한 새로운 기능에 대한 간략한 설명을 작성하세요.

## 구현 내용
주요 구현 내용과 기술적 결정 사항을 설명하세요.

## 테스트
이 기능을 어떻게 테스트했는지 설명하세요.

## 스크린샷
UI 변경사항이 있는 경우 스크린샷을 첨부하세요.

## 관련 이슈
관련된 이슈 번호: #`,

    bugfix: `## 버그 설명
수정한 버그에 대해 설명하세요.

## 원인
버그의 원인이 무엇이었는지 설명하세요.

## 해결 방법
문제를 어떻게 해결했는지 설명하세요.

## 테스트
수정 사항을 어떻게 테스트했는지 설명하세요.

## 관련 이슈
버그 리포트: #`,

    refactor: `## 리팩토링 설명
어떤 부분을 리팩토링했는지 설명하세요.

## 변경 이유
이 리팩토링이 왜 필요했는지 설명하세요.

## 주요 변경 사항
리팩토링 중 이루어진 주요 변경 사항을 나열하세요.

## 테스트
리팩토링이 기존 기능을 손상시키지 않는지 어떻게 확인했는지 설명하세요.

## 성능 영향
이 변경으로 인한 성능 영향을 설명하세요.`,

    docs: `## 문서 변경 사항
어떤 문서를 변경했는지 설명하세요.

## 변경 이유
이 변경이 왜 필요했는지 설명하세요.

## 주요 변경 내용
주요 문서 변경 사항을 나열하세요.`,

    chore: `## 변경 사항
어떤 유지보수 작업을 수행했는지 설명하세요.

## 변경 이유
이 변경이 왜 필요했는지 설명하세요.

## 영향 범위
변경 사항의 영향 범위를 설명하세요(빌드 시스템, 의존성, 설정 파일 등).`,

    test: `## 테스트 추가/수정 사항
어떤 테스트를 추가하거나 수정했는지 설명하세요.

## 테스트 범위
어떤 유형의 테스트가 추가되었는지 설명하세요(단위, 통합, E2E).

## 테스트 케이스
구현된 주요 테스트 케이스를 나열하세요.`,
  },
};

export async function loadTemplate(templateName: string): Promise<string> {
  try {
    // 먼저 사용자 정의 템플릿을 찾아봅니다
    const templatePath = join(
      process.cwd(),
      TEMPLATE_DIR,
      `${templateName}.md`,
    );
    return await readFile(templatePath, "utf-8");
  } catch (error) {
    // 사용자 정의 템플릿이 없으면 기본 템플릿을 반환합니다
    const config = await loadConfig();
    const language = config?.language || "en";
    return (
      DEFAULT_TEMPLATES[language]?.[templateName] ||
      DEFAULT_TEMPLATES[language].feature
    );
  }
}
