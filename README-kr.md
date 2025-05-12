# NewExpand AutoPR

GitHub PR 자동화를 위한 강력한 CLI 도구입니다. PR 생성, 리뷰, 병합 등의 작업을 자동화하고 AI 기능을 통해 더 나은 PR 관리를 지원합니다.

## 주요 기능

- 🤖 AI 기반 PR 설명 생성 및 코드 리뷰
  - PR 제목 자동 생성 및 개선
  - PR 설명 자동 생성
  - 코드 리뷰 제안
  - 시각적으로 구분되는 AI 출력 (색상 구분)
- 🔄 자동 PR 생성 및 관리
  - 저장소 유형에 따른 Draft PR 가용성 자동 감지
  - 공개/비공개 저장소 지원
  - release/\* 브랜치 자동 push 기능
- 👥 리뷰어 자동 할당 및 그룹 관리
- 🌍 다국어 지원 (한국어/영어)
- 🔍 충돌 해결 도우미
- 📝 커밋 메시지 개선
  - AI 제안 메시지 시각적 구분
  - 직관적인 메시지 포맷팅
- 🤝 Collaborator 관리
- 🪝 Git 훅 자동화
- 🔎 GitHub PR 자동 리뷰 (실험적)
  - GitHub Actions 기반 자동 코드 리뷰
  - PR 생성/업데이트 시 코드 품질 분석
  - 라인별 인라인 코멘트 제공
  - 다국어 지원으로 로케일에 맞는 리뷰 생성

## 브랜치 관리 워크플로우

해당 라이브러리는 GitFlow, GitHub Flow와 Conventional Commits를 결합한 맞춤형 워크플로우를 제공합니다. 자세한 브랜치 전략 가이드, 워크플로우 예시, 명령어 사용법은 다음 문서에서 확인하세요:

👉 [브랜치 전략 상세 가이드](https://github.com/newExpand/github-autopr-cli/blob/main/USAGE-kr.md)

이 문서에서는 다음 내용을 확인할 수 있습니다:
- GitFlow 기반 브랜치 관리 전략 상세 설명
- AutoPR 설치 및 초기 설정 방법
- 실제 터미널 명령어 실행 과정과 예시 화면
- 브랜치 생성, 커밋, PR 생성, 병합 과정의 구체적인 예시
- 릴리즈 브랜치 관리 및 병합 방법

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
   - GitHub Actions 워크플로우 설정 (PR 자동 리뷰용, 선택사항)

## 주요 명령어

### PR 관리

```bash
# 새 PR 생성하기
autopr new

# PR 목록 조회하기 (대화형 선택 기능 포함)
autopr list

# PR 리뷰하기
autopr review <pr-번호>
# 가능한 리뷰 작업:
# - PR 내용 보기
# - AI 코드 리뷰 실행
# - 승인/변경 요청/코멘트
# - 브랜치 체크아웃
# - GitHub에서 PR 열기

# PR 업데이트하기
autopr update <pr-번호>
# 업데이트 가능 항목:
# - 제목
# - 내용
# - 상태 (초안/리뷰 준비됨)

# PR 병합하기
autopr merge <pr-번호>
# 병합 옵션:
# - 병합 방법 (일반/스쿼시/리베이스)
# - 대상 브랜치 변경
# - 자동 브랜치 삭제
# - 충돌 해결 도우미

# 닫힌 PR 다시 열기
autopr reopen <pr-번호>

# GitHub PR 자동 리뷰 실행 (CI 환경에서 사용)
autopr review-bot
# 옵션:
# -e, --event <event>     GitHub 이벤트 유형
# -p, --payload <payload> GitHub 이벤트 페이로드
```

### 일일 보고서 관리

```bash
# 일일 커밋 보고서 생성
autopr daily-report

# 옵션:
# -d, --date <date>       YYYY-MM-DD 형식의 특정 날짜
# -u, --username <name>   특정 GitHub 사용자명
# -f, --format <format>   출력 형식 (console, json, markdown)
# -o, --output <path>     보고서를 파일로 저장
```

### 커밋 관리

```bash
# 변경사항 커밋 (AI 제안 사용)
autopr commit

# 모든 변경사항 커밋 및 푸시
autopr commit -a
# 푸시 시 브랜치 선택 가능:
# - 현재 브랜치로 푸시
# - 다른 브랜치로 푸시
# - 새 브랜치 생성 및 푸시

# 대화형으로 변경사항 선택 후 커밋
autopr commit -p

# 변경된 파일 중 선택한 파일만 커밋
autopr commit -s

# 변경된 파일 중 선택한 파일만 스테이징하고 커밋 후 자동으로 푸시
autopr commit -sp

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

- `feat/*`: 새로운 기능 개발 (base: developmentBranch)
- `fix/*`: 버그 수정 (base: developmentBranch)
- `refactor/*`: 코드 리팩토링 (base: developmentBranch)
- `docs/*`: 문서 작업 (base: developmentBranch)
- `chore/*`: 기타 작업 (base: developmentBranch)
- `test/*`: 테스트 관련 작업 (base: developmentBranch)
- `release/*`: 릴리스 관련 작업 (base: defaultBranch/main)

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

모든 버전의 상세 변경 이력은 [CHANGELOG-kr.md](https://github.com/newExpand/github-autopr-cli/blob/main/CHANGELOG-kr.md) 파일에서 확인할 수 있습니다.
