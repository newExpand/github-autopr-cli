import { readFile } from "fs/promises";
import { join } from "path";
import { loadConfig } from "../core/config.js";

const TEMPLATE_DIR = ".github/PULL_REQUEST_TEMPLATE";

const DEFAULT_TEMPLATES: Record<string, Record<string, string>> = {
  en: {
    feature: `## Feature Description
What new feature did you add?

## Implementation Details
- [ ] New Feature 1
- [ ] New Feature 2

## Testing
- [ ] Unit Tests Added
- [ ] Integration Tests Performed
- [ ] E2E Tests (if needed)

## Screenshots (if UI changes)
Please attach screenshots if there are UI changes.

## Related Issues
- Related Issue Number: #

## Checklist
- [ ] Does the code follow conventions?
- [ ] Were new dependencies added?
- [ ] Are there performance impacts?
- [ ] Is documentation needed?`,

    bugfix: `## Bug Description
What bug did you fix?

## Root Cause
What was causing the bug?

## Solution
How did you fix it?

## Testing
- [ ] Bug reproduction case added
- [ ] Fix verified
- [ ] Regression tests

## Related Issues
- Bug Report: #

## Checklist
- [ ] No impact on other features?
- [ ] Logging or monitoring needed?
- [ ] Performance impact considered?`,

    refactor: `## Refactoring Description
What did you refactor?

## Reason for Change
Why was this refactoring needed?

## Major Changes
- [ ] Change 1
- [ ] Change 2

## Testing
- [ ] Existing tests pass
- [ ] New tests added (if needed)

## Performance Impact
Is there any impact on performance?

## Checklist
- [ ] All existing features work correctly?
- [ ] Code complexity reduced?
- [ ] Maintainability improved?`,

    docs: `## Documentation Changes
What documentation did you change?

## Reason for Change
Why was this change needed?

## Major Changes
- [ ] Change 1
- [ ] Change 2

## Checklist
- [ ] Spell-checked?
- [ ] All links work?
- [ ] Proper formatting?`,

    chore: `## Changes
What maintenance work was performed?

## Reason for Change
Why was this change needed?

## Scope
- [ ] Build System
- [ ] Dependencies
- [ ] Configuration Files
- [ ] Other

## Checklist
- [ ] No impact on existing features?
- [ ] CI/CD impact considered?`,

    test: `## Test Changes
What tests did you add/modify?

## Test Coverage
- [ ] Unit Tests
- [ ] Integration Tests
- [ ] E2E Tests

## Test Cases
- [ ] Test Case 1
- [ ] Test Case 2

## Checklist
- [ ] Test coverage improved?
- [ ] No conflicts with existing tests?
- [ ] Reasonable test execution time?`,
  },
  ko: {
    feature: `## 기능 설명
어떤 새로운 기능을 추가했나요?

## 구현 내용
- [ ] 새로운 기능 1
- [ ] 새로운 기능 2

## 테스트
- [ ] 단위 테스트 추가
- [ ] 통합 테스트 수행
- [ ] E2E 테스트 (필요한 경우)

## 스크린샷 (UI 변경시)
변경된 UI가 있다면 스크린샷을 첨부해주세요.

## 관련 이슈
- 관련된 이슈 번호: #

## 체크리스트
- [ ] 코드가 컨벤션을 준수하나요?
- [ ] 새로운 의존성이 추가되었나요?
- [ ] 성능에 영향을 주는 변경사항인가요?
- [ ] 문서화가 필요한 부분이 있나요?`,

    bugfix: `## 버그 설명
어떤 버그를 수정했나요?

## 원인
버그의 원인은 무엇이었나요?

## 해결 방법
어떻게 해결했나요?

## 테스트
- [ ] 버그 재현 케이스 추가
- [ ] 수정 사항 테스트
- [ ] 회귀 테스트

## 관련 이슈
- 버그 리포트: #

## 체크리스트
- [ ] 다른 기능에 영향을 주지 않나요?
- [ ] 로깅이나 모니터링이 필요한가요?
- [ ] 성능에 영향을 주는 변경사항인가요?`,

    refactor: `## 리팩토링 설명
어떤 부분을 리팩토링했나요?

## 변경 이유
왜 이 리팩토링이 필요했나요?

## 주요 변경 사항
- [ ] 변경 사항 1
- [ ] 변경 사항 2

## 테스트
- [ ] 기존 테스트 통과 확인
- [ ] 새로운 테스트 추가 (필요시)

## 성능 영향
성능에 미치는 영향이 있나요?

## 체크리스트
- [ ] 기존 기능이 모두 정상 동작하나요?
- [ ] 코드 복잡도가 감소했나요?
- [ ] 유지보수성이 향상되었나요?`,

    docs: `## 문서 변경 사항
어떤 문서를 변경했나요?

## 변경 이유
왜 이 변경이 필요했나요?

## 주요 변경 내용
- [ ] 변경 내용 1
- [ ] 변경 내용 2

## 체크리스트
- [ ] 맞춤법 검사를 했나요?
- [ ] 링크가 모두 정상 작동하나요?
- [ ] 포맷팅이 올바른가요?`,

    chore: `## 변경 사항
어떤 유지보수 작업을 수행했나요?

## 변경 이유
왜 이 변경이 필요했나요?

## 영향 범위
- [ ] 빌드 시스템
- [ ] 의존성
- [ ] 설정 파일
- [ ] 기타

## 체크리스트
- [ ] 기존 기능에 영향이 없나요?
- [ ] CI/CD에 영향이 있나요?`,

    test: `## 테스트 추가/수정 사항
어떤 테스트를 추가/수정했나요?

## 테스트 범위
- [ ] 단위 테스트
- [ ] 통합 테스트
- [ ] E2E 테스트

## 테스트 케이스
- [ ] 테스트 케이스 1
- [ ] 테스트 케이스 2

## 체크리스트
- [ ] 테스트 커버리지가 향상되었나요?
- [ ] 기존 테스트와 충돌이 없나요?
- [ ] 테스트 실행 시간이 적절한가요?`,
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
