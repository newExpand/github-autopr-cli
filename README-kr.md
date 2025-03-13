# NewExpand AutoPR

GitHub PR 자동화를 위한 강력한 CLI 도구입니다. PR 생성, 리뷰, 병합 등의 작업을 자동화하고 AI 기능을 통해 더 나은 PR 관리를 지원합니다.

## 주요 기능

- 🤖 AI 기반 PR 설명 생성 및 코드 리뷰
  - PR 제목 자동 생성 및 개선
  - PR 설명 자동 생성
  - 코드 리뷰 제안
- 🔄 자동 PR 생성 및 관리
  - 저장소 유형에 따른 Draft PR 가용성 자동 감지
  - 공개/비공개 저장소 지원
- 👥 리뷰어 자동 할당 및 그룹 관리
- 🌍 다국어 지원 (한국어/영어)
- 🔍 충돌 해결 도우미
- 📝 커밋 메시지 개선
- 🤝 Collaborator 관리
- 🪝 Git 훅 자동화

## 설치 방법

```bash
npm install -g newexpand-autopr
```

## 초기 설정

1. 도구 초기화:

```bash
autopr init
```

2. 초기화 과정에서 다음 설정을 진행합니다:
   - GitHub 인증 (OAuth 또는 토큰)
   - 기본 브랜치 설정 (main/dev)
   - 기본 리뷰어 설정
   - AI 기능 설정 (선택사항)
   - Git 훅 설정 (선택사항)
   - 릴리스 PR 템플릿 커스터마이징 (선택사항)

## 주요 명령어

### PR 관리

```bash
# 새로운 PR 생성
autopr new

# PR 목록 조회
autopr list

# PR 리뷰
autopr review <pr-number>
# 리뷰 시 가능한 작업:
# - PR 내용 보기
# - AI 코드 리뷰 실행
# - 승인/변경요청/코멘트 작성
# - 브랜치 체크아웃
# - GitHub에서 PR 열기

# PR 업데이트
autopr update <pr-number>
# 업데이트 가능 항목:
# - 제목
# - 내용
# - 상태 (Draft/Ready for review)

# PR 병합
autopr merge <pr-number>
# 병합 옵션:
# - 병합 방식 선택 (merge/squash/rebase)
# - 대상 브랜치 변경
# - 브랜치 자동 삭제
# - 충돌 해결 도우미

# 닫힌 PR 다시 열기
autopr reopen <pr-number>
```

### 커밋 관리

```bash
# 변경사항 커밋 (AI 제안 사용)
autopr commit

# 모든 변경사항 커밋 및 푸시
autopr commit -a

# 대화형으로 변경사항 선택 후 커밋
autopr commit -p

# 기존 커밋 메시지 개선
autopr commit improve [message]

# 커밋 후 자동으로 PR 생성
# (브랜치 패턴에 따라 자동으로 처리)
```

### 리뷰어 그룹 관리

```bash
# 리뷰어 그룹 추가
autopr reviewer-group add <name> -m "user1,user2" -s "round-robin"
# 순환 전략 옵션:
# - round-robin: 순차적 할당
# - random: 무작위 할당
# - least-busy: 가장 적은 리뷰를 가진 멤버에게 할당

# 리뷰어 그룹 목록
autopr reviewer-group list

# 리뷰어 그룹 업데이트
autopr reviewer-group update <name> -m "user1,user2,user3" -s "random"

# 리뷰어 그룹 제거
autopr reviewer-group remove <name>
```

### Collaborator 관리

```bash
# Collaborator 초대
autopr collaborator invite <username>
# 권한 레벨 선택:
# - pull: 읽기 권한
# - push: 쓰기 권한
# - admin: 관리자 권한

# Collaborator 목록 조회
autopr collaborator list

# Collaborator 제거
autopr collaborator remove

# 초대 상태 확인
autopr collaborator status <username>

# 모든 초대 상태 확인
autopr collaborator status-all
```

### Git 훅 관리

```bash
# Git 훅 이벤트 처리
autopr hook post-checkout <branch>
# 브랜치 체크아웃 시 자동으로:
# - 새 브랜치 감지
# - Draft PR 자동 생성
# - 리뷰어 자동 할당
```

### 기타 설정

```bash
# 언어 설정 변경
autopr lang set <ko|en>

# 현재 언어 확인
autopr lang current
```

## 브랜치 패턴

기본적으로 다음과 같은 브랜치 패턴을 지원합니다:

- `feat/*`: 새로운 기능 개발
- `fix/*`: 버그 수정
- `refactor/*`: 코드 리팩토링
- `docs/*`: 문서 작업
- `chore/*`: 기타 작업
- `test/*`: 테스트 관련 작업
- `release/*`: 릴리스 관련 작업

각 패턴별로 다음 설정이 가능합니다:

- Draft PR 여부
- 자동 라벨 지정
- PR 템플릿 설정
- 리뷰어 자동 할당
- 리뷰어 그룹 지정
- 대상 브랜치 설정 (development/production)

## AI 기능

다음 AI 제공자를 지원합니다:

- OpenAI (GPT-4o, GPT-4o-mini, GPT-3.5-turbo)

AI 기능은 다음 작업을 지원합니다:

- PR 설명 자동 생성
- 코드 리뷰 제안
- 충돌 해결 가이드
- 커밋 메시지 개선
- 변경사항 분석 및 요약

## 설정 파일

### .autopr.json

프로젝트별 설정을 관리합니다:

```json
{
  "defaultBranch": "main",
  "developmentBranch": "dev",
  "defaultReviewers": [],
  "autoPrEnabled": true,
  "defaultLabels": [],
  "reviewerGroups": [],
  "branchPatterns": [],
  "releasePRTitle": "Release: {development} to {production}",
  "releasePRBody": "Merge {development} branch into {production} for release",
  "aiConfig": {
    "enabled": true,
    "provider": "openai",
    "options": {
      "model": "gpt-4o"
    }
  }
}
```

### .env

AI 설정을 관리합니다:

```env
AI_PROVIDER=openai
AI_API_KEY=your-api-key
AI_MODEL=gpt-4o
```

## 커스터마이징

### PR 템플릿

`.github/PULL_REQUEST_TEMPLATE` 디렉토리에 커스텀 템플릿을 추가할 수 있습니다:

- `feature.md`
- `bugfix.md`
- `refactor.md`
- `release.md`
- 등...

각 템플릿은 다음 요소를 포함할 수 있습니다:

- 변경 사항 설명
- 체크리스트
- 테스트 항목
- 리뷰어 체크리스트
- 스크린샷 (UI 변경 시)
- 관련 이슈 링크

## 지원 환경

- Node.js 20 이상
- Git 2.0 이상
- GitHub 저장소

## 라이선스

MIT License

## 변경 이력

### 0.1.8

- AI 초기화 문제 해결
  - AI 초기화 프로세스 개선으로 안정적인 활성화 보장
  - 중복 초기화 방지를 위한 초기화 상태 관리 추가
  - AI 초기화 중 에러 처리 강화
  - OpenRouter 설정 로딩 및 검증 문제 해결
  - AI 초기화 프로세스 디버그 로깅 추가
- AI 기능 안정성 강화
  - AI 초기화 실패 시 적절한 에러 복구 기능 추가
  - AI 기능 상태 관리 개선
  - 경쟁 상태 방지를 위한 초기화 Promise 처리 추가
  - AI 제공자 설정 검증 강화

### 0.1.7

- 커밋 메시지 생성 기능 개선
  - 전체 파일 경로 지원 추가
  - 파일 추적 기능 개선으로 누락 방지
  - 커밋 메시지 형식 일관성 강화
  - 변경된 파일 목록 분석 기능 강화
- i18n 지원 개선
  - 영어/한국어 번역 동기화
  - 에러 메시지 일관성 강화
  - 누락된 번역 키 추가

### 0.1.6

- OpenRouter AI 제공자 지원 추가
  - 무료 Gemini Flash 2.0 모델 통합
  - API 키와 모델 설정 자동화
  - OpenRouter에 최적화된 토큰 제한 설정
- 커밋 메시지 생성 기능 개선
  - 더 명확한 프롬프트 구조로 개선
  - 파일 변경사항 누락 방지를 위한 추적 기능 강화
  - 영어 프롬프트로 한국어 출력을 생성하는 이중 언어 지원
  - 더 일관된 결과를 위한 시스템 프롬프트 최적화
- i18n 지원 개선
  - i18n 파일 추적 기능 강화
  - 언어별 프롬프트 처리 개선
  - 번역 일관성 향상

### 0.1.5

- Draft PR 가용성 체크 기능 개선
  - 저장소 visibility 기반 Draft PR 사용 가능 여부 자동 감지
  - 공개/비공개 저장소 지원 강화
- AI 제목 생성 기능 개선
  - 제목 생성 과정 로깅 추가
  - 생성 실패 시 기본 제목 유지 로직 개선
  - 디버그 정보 강화
