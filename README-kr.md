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

### 0.1.14

- 문서 업데이트
  - README 파일의 파라미터 표기법 일관성 수정
  - `autopr commit -sp` 명령어 문서 추가
  - 영어 및 한국어 문서 동기화

### 0.1.13

- 일일 커밋 보고서 생성 기능 추가
  - 새로운 `autopr daily-report` 명령어 구현
  - AI가 생성한 일일 커밋 활동 요약 제공
  - 최근 커밋 히스토리에서 날짜 선택 기능 제공
  - 상세 통계 포함 (변경된 파일, 추가/삭제된 줄 수)
  - 다양한 형식의 보고서 생성 (콘솔, JSON, 마크다운)
  - 로컬 및 원격 저장소 커밋 모두 지원
- 병합 충돌 해결 경험 개선
  - 충돌 해결 워크플로우 간소화
  - 불필요한 자동 파일 열기 로직 제거
  - 명확한 Git 명령어로 단계별 안내 강화
  - 충돌 마커에 대한 더 자세한 설명 추가
  - 가치 있는 AI 기반 충돌 해결 제안 기능 유지
  - 충돌 해결을 위한 다국어 지원 개선
  - 충돌 해결에 도움이 되는 문서 링크 추가
- list 명령어에 대화형 PR 선택 기능 추가
  - 터미널에서 직접 PR 선택 가능
  - 리뷰, 병합, 업데이트 작업에 빠르게 접근
  - 작업 흐름 효율성 향상
- PR 정보 표시 개선
  - PR 목록 형식 개선
  - 쉬운 참조를 위한 번호 매기기
- PR 페이지네이션 기능 개선
  - 대량의 PR을 관리하기 위한 페이지별 로딩 기능 강화
  - 반복적으로 더 많은 PR을 로드할 수 있는 옵션 제공
  - 최대 10페이지까지 PR 로드 지원
  - 명확한 페이지 로딩 상태 표시
- 커밋 프로세스 개선
  - 사용자가 커밋 중 Ctrl+C나 Command+C로 취소 시 안전하게 프로세스 종료
  - 취소 후 작업이 계속 진행되는 문제 해결
  - 취소 시 명확한 안내 메시지 추가
  - 모든 프롬프트에서 일관된 취소 처리 구현
- 지역화 강화
  - 충돌 해결 관련 번역 업데이트
  - 언어 일관성 개선
  - 누락된 번역 키 추가
  - 대화형 기능에 대한 포괄적인 번역 추가
- 일반 성능 개선
  - 불필요한 코드 복잡성 감소
  - 오류 처리 강화
  - 크로스 플랫폼 호환성 개선

### 0.1.12

- 파일 선택 커밋 후 자동 푸시 기능 재활성화
  - 선택한 파일만 스테이징하고 커밋 후 자동으로 origin push 기능 추가
  - 옵션 수정: `-sp`, `--selectpush` 옵션 제공
  - Commander.js 옵션 처리 개선으로 안정성 확보
  - 브랜치 선택 기능 제외 (현재 브랜치로만 푸시)
  - 기존의 자동 `-u` 옵션 유지 (원격 브랜치가 없는 경우)

### 0.1.11

- 브랜치 선택 푸시 기능 일시 비활성화
  - 브랜치 간 충돌 문제 해결을 위한 조치
  - 현재 브랜치로만 푸시하도록 변경
  - 원격 브랜치가 없는 경우 자동으로 `-u` 옵션 추가
  - 관련 옵션 일시 제거:
    - `-sp`, `--select-push` 옵션 비활성화
    - 브랜치 선택 프롬프트 비활성화
  - 추후 개선된 브랜치 관리 로직으로 업데이트 예정

### 0.1.10

- 커밋 기능 개선
  - 파일 선택 커밋 기능 추가 (`autopr commit -s`)
    - 변경된 파일 중 커밋할 파일만 선택 가능
    - 대화형 인터페이스로 파일 선택 지원
  - 파일 선택 후 자동 푸시 기능 추가 (`autopr commit -sp`)
  - 브랜치 선택 푸시 기능 추가 (`autopr commit -a`)
    - 현재 브랜치가 아닌 다른 브랜치로 푸시 가능
    - 원격/로컬 브랜치 상태 표시 (원격/로컬 전용)
    - 새 브랜치 생성 및 푸시 지원
    - 브랜치 체크아웃 옵션
  - 원격 브랜치 상태 관리 개선
    - 원격에 존재하지 않는 브랜치 자동 감지
    - 새 원격 브랜치를 위한 자동 `-u` 옵션 적용
    - 브랜치 상태 시각적 표시 개선
- OpenRouter API 키 관리 개선
  - API 키 자동 활성화 기능 추가
    - AI 기능 사용 시 자동으로 API 키 상태 확인
    - 비활성화된 API 키 자동 활성화
    - 백그라운드에서 조용히 처리되어 사용자 경험 향상
  - 사용 시점 기반 API 키 상태 확인
    - AI 기능 사용 시 1시간 간격으로 상태 확인
    - 401 에러 방지를 위한 효율적인 활성화
  - 개발 모드에서만 사용 가능한 API 키 관리 명령어
    - API 키 정보 조회 및 상태 관리
    - 민감한 API 키 정보 보호를 위한 보안 강화
- AI 기능 초기화 및 성능 개선
  - AI 인스턴스 생성 및 초기화 최적화
    - 중복 초기화 방지 로직 강화
    - 명령어 내에서 AI 인스턴스 재사용
    - 메모리 사용량 최적화
  - API 키 상태 확인 로직 개선
    - 캐싱을 통한 중복 API 호출 방지
    - 상태 확인 주기 최적화 (5분 캐시)
  - 로그 출력 개선
    - 중복 로그 출력 방지
    - 디버그/정보 레벨 구분 명확화
    - 사용자 경험 향상을 위한 로그 메시지 최적화

### 0.1.9

- 사용자 경험 개선
  - AI 출력 시각화 개선
    - PR 제목/설명 생성 시 색상 구분 적용
    - 커밋 메시지 제안 시 시각적 구분 강화
  - 로그 레벨 구분 개선
    - 일반 메시지: cyan 색상
    - AI 생성 내용: white 색상 (📝 심볼)
    - 섹션 구분: magenta 색상 (=== 심볼)
    - 메시지 포맷팅 개선
    - 구분선을 통한 가독성 향상
    - 중요 정보 강조를 위한 색상 활용
- release/\* 브랜치 자동 push 기능 추가
  - PR 생성 시 자동 push 지원
  - 안전한 에러 처리
- 브랜치 전략 개선
  - release/\* 브랜치를 제외한 모든 브랜치가 developmentBranch를 base로 사용하도록 변경
  - 기존: 모든 브랜치가 main을 base로 사용
  - 변경: release/\* → main, 그 외 브랜치 → developmentBranch

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
