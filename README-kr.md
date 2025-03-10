# github-autopr-cli

GitHub PR 자동화 CLI 도구입니다. PR 생성, 리뷰, 병합 등의 작업을 자동화하고 AI 기능을 통해 더 효율적인 PR 관리를 지원합니다.

## 주요 기능

- 🚀 PR 자동 생성 및 관리
- 🤖 AI 기반 PR 설명 생성
- 👥 리뷰어 자동 할당
- 🔄 브랜치 패턴 기반 자동화
- 🌍 다국어 지원 (한국어/영어)
- 🔍 AI 코드 리뷰
- 🤝 Collaborator 관리

## 설치 방법

```bash
npm install -g github-autopr-cli
```

## 초기 설정

1. 초기화 명령어 실행:

```bash
autopr init
```

2. 설정 과정:
   - GitHub 인증 (브라우저 인증 또는 토큰 직접 입력)
   - 기본 브랜치 설정
   - 기본 리뷰어 설정
   - AI 기능 설정 (선택사항)
   - Git 훅 설정 (선택사항)

## 기본 사용법

### PR 생성

```bash
# 새로운 PR 생성
autopr new

# 현재 브랜치의 변경사항으로 PR 생성
autopr commit -a

# 커밋 메시지 개선
autopr commit improve

# 대화형으로 변경사항 선택 후 커밋
autopr commit -p

# 변경사항 스테이징, 커밋, 자동 push까지 한번에 실행
autopr commit -a

# 특정 커밋 메시지 개선
autopr commit improve "기존 커밋 메시지"
```

### PR 관리

```bash
# PR 목록 조회
autopr list

# PR 리뷰
autopr review <PR번호>

# PR 업데이트
autopr update <PR번호>

# PR 병합
autopr merge <PR번호>

# PR 병합 (스쿼시 옵션)
autopr merge <PR번호>  # 대화형으로 병합 방법 선택 가능
# - 일반 병합 (merge)
# - 스쿼시 병합 (squash)
# - 리베이스 병합 (rebase)

# 닫힌 PR 다시 열기
autopr reopen <PR번호>
```

### PR 상태 관리

PR은 다음과 같은 상태를 가질 수 있습니다:

- Draft: 초안 상태
- Ready for Review: 리뷰 준비 완료
- Mergeable: 병합 가능
- Conflicting: 충돌 있음
- Checking: 상태 확인 중

충돌이 발생한 경우 `autopr merge` 명령어를 실행하면 자동으로 충돌 해결을 도와주는 기능이 제공됩니다:

- 충돌 파일 자동 감지
- 편집기로 충돌 파일 열기
- AI 기반 충돌 해결 제안
- 단계별 해결 가이드 제공

### Collaborator 관리

```bash
# Collaborator 초대
autopr collaborator invite <사용자명>

# Collaborator 목록 조회
autopr collaborator list

# Collaborator 제거
autopr collaborator remove
```

### 리뷰어 그룹 관리

```bash
# 리뷰어 그룹 추가
autopr reviewer-group add <그룹명> -m "리뷰어1,리뷰어2" -s "round-robin"

# 리뷰어 그룹 목록 조회
autopr reviewer-group list

# 리뷰어 그룹 업데이트
autopr reviewer-group update <그룹명> -m "리뷰어1,리뷰어2"

# 리뷰어 그룹 제거
autopr reviewer-group remove <그룹명>
```

## 설정 파일

### .autopr.json

프로젝트 루트에 위치하며 다음과 같은 설정이 가능합니다:

```json
{
  "defaultBranch": "main",
  "defaultReviewers": ["reviewer1", "reviewer2"],
  "autoPrEnabled": true,
  "defaultLabels": ["label1", "label2"],
  "reviewerGroups": [
    {
      "name": "frontend",
      "members": ["user1", "user2"],
      "rotationStrategy": "round-robin"
    }
  ],
  "branchPatterns": [
    {
      "pattern": "feat/*",
      "type": "feat",
      "draft": true,
      "labels": ["feature"],
      "template": "feature",
      "autoAssignReviewers": true,
      "reviewers": ["reviewer1"],
      "reviewerGroups": ["frontend"]
    }
  ]
}
```

### AI 기능 설정 (.env)

```env
AI_PROVIDER=openai
AI_API_KEY=your-api-key
AI_MODEL=gpt-4
```

## 브랜치 패턴

기본 제공되는 브랜치 패턴:

- `feat/*`: 새로운 기능
- `fix/*`: 버그 수정
- `refactor/*`: 코드 리팩토링
- `docs/*`: 문서 수정
- `chore/*`: 기타 작업
- `test/*`: 테스트 관련

각 패턴별로 다음 설정이 가능합니다:

- 자동 Draft PR 생성
- 라벨 자동 할당
- 리뷰어 자동 할당
- PR 템플릿 적용

## PR 템플릿

기본 제공되는 PR 템플릿:

- feature: 새로운 기능
- bugfix: 버그 수정
- refactor: 리팩토링
- docs: 문서
- chore: 기타 작업
- test: 테스트

커스텀 템플릿은 `.github/PULL_REQUEST_TEMPLATE/` 디렉토리에 추가할 수 있습니다.

## AI 기능

### 지원되는 기능

- PR 설명 자동 생성
- 코드 리뷰 제안
- 커밋 메시지 개선
- 충돌 해결 제안

### 지원되는 AI 제공자

- OpenAI (GPT-4, GPT-3.5-turbo)
- Anthropic Claude (준비 중)
- GitHub Copilot (준비 중)

## 언어 설정

```bash
# 언어 변경
autopr lang set ko  # 한국어
autopr lang set en  # 영어

# 현재 언어 확인
autopr lang current
```

## 고급 기능

### 커밋 관련 기능

- AI 기반 커밋 메시지 자동 생성
- 기존 커밋 메시지 개선
- 대화형 변경사항 선택 (`-p` 옵션)
- 자동 push 및 PR 생성 (`-a` 옵션)

### 병합 관련 기능

- 다양한 병합 방식 지원 (merge, squash, rebase)
- 자동 충돌 감지 및 해결 지원
- 브랜치 자동 정리
- base 브랜치 변경 기능

### 리뷰 관련 기능

- AI 코드 리뷰
- 리뷰 상태 관리 (승인, 변경 요청, 코멘트)
- 파일별 리뷰
- 브라우저에서 PR 열기

### Git 훅 기능

- post-checkout 훅 지원
- 브랜치 전환 시 자동 PR 생성
- 브랜치 패턴 기반 자동화

## 라이선스

MIT

## 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request
