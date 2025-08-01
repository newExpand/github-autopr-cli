# AutoPR CLI 사용 설명서 (한글)

[➡️ 변경 이력(CHANGELOG-kr.md) 바로가기](https://github.com/newExpand/github-autopr-cli/blob/main/CHANGELOG-kr.md)

## AI 기반 PR/리뷰: 테스트 사례

[v1.0.0 릴리스 Pull Request](https://github.com/newExpand/github-autopr-cli/pull/147)는 **AI 기반 PR 및 리뷰 자동화의 효과를 검증하기 위한 테스트 케이스**로 생성·리뷰되었습니다.

- 실제로 AI 시스템이 크리티컬 버그 및 이슈를 잡을 수 있는지 확인하기 위해 진행된 PR입니다.
- 과거에는 하드코딩 방식이었으나, 현재는 인증 등 민감 로직을 모두 토큰화하여 보안과 유연성을 강화했습니다.
- 해당 PR 및 리뷰 과정을 통해 이 CLI의 AI 통합 실효성을 직접 확인할 수 있습니다.

> [테스트 PR/리뷰 상세 보기](https://github.com/newExpand/github-autopr-cli/pull/147)

## 소개

**AutoPR CLI**는 GitHub Pull Request(PR) 생성, 리뷰, 병합, 커밋, 협업자 관리, 일일 리포트 등 다양한 GitHub 워크플로우를 자동화하는 커맨드라인 툴입니다. AI 기반 커밋 메시지/PR 설명/코드리뷰, 브랜치 패턴, 템플릿, 리뷰어 그룹 등 강력한 기능을 제공합니다.

- **지원 환경:** Node.js 18+ / macOS, Linux, Windows
- **주요 기능:**
  - PR 생성/수정/병합/리뷰/리스트/재오픈/일일리포트
  - AI 기반 커밋 메시지, PR 설명, 코드리뷰, 충돌 해결 제안
  - Collaborator/Reviewer/Reviewer Group/Template 관리
  - GitHub App 및 OAuth 인증 지원

---

## 설치 방법

```bash
npm install -g newexpand-autopr
```

- Node.js 18 이상 필요
- 설치 후 `autopr` 명령어 사용 가능

---

## 기본 사용법

```bash
autopr <명령어> [옵션]
```

예시:
```bash
autopr init
```

---

## 주요 명령어 및 기능

### 1. 초기화 및 인증 (`init`)

```bash
autopr init
```
- 프로젝트 설정 파일(.autopr.json) 생성/초기화
- **OAuth 인증(필수, PR/머지 등 기본 기능용)**
- **GitHub App 인증(선택, AI 리뷰 등 고급 기능용, 언제든 별도 명령어로 인증 가능)**
- AI 토큰 발급(자동)
- 언어, 기본 리뷰어 등 설정

> ⚠️ **중요:**  
> GitHub App 인증 시, 반드시 **본인 또는 조직의 올바른 계정/조직**이 선택되었는지 확인하세요.  
> 잘못된 계정/조직으로 인증하면 PR 자동화, 리뷰, 권한 관리 등 주요 기능이 정상적으로 동작하지 않을 수 있습니다.  
> **초기 설정(init) 및 인증을 마친 후 기능을 사용하려 할 때 '404 not found' 또는 'Resource not accessible by integration' 에러가 발생한다면, 인증한 계정/조직이 올바른지 꼭 다시 확인해보세요.**

> **인증 안내:**  
> GitHub 인증(OAuth, GitHub App)을 진행할 때:
> 1. 터미널에 8자리 인증 코드(예: ABCD-1234)가 표시됩니다
> 2. 함께 표시되는 인증 URL(https://github.com/login/device)도 확인할 수 있습니다
> 3. 브라우저에서 인증 URL에 접속하여 터미널에 표시된 코드를 입력하세요
> 4. GitHub 계정으로 로그인 후 권한을 승인하면 인증이 완료됩니다
> 
> 💡 **팁**: 브라우저가 자동으로 열리지 않으면, 터미널에 표시된 URL을 복사하여 직접 접속하세요.

> **워크플로우:**
> 
> ```text
> autopr init 실행
>    ↓
> 프로젝트 설정 파일 생성/초기화
>    ↓
> OAuth 인증 (필수, PR/머지 등)
>    ↓
> AI 토큰 발급 (자동)
>    ↓
> GitHub App 인증 (선택, AI 리뷰 등 고급 기능)
>    ↓
> 언어/리뷰어 등 환경 설정
>    ↓
> 설정 파일 저장 및 안내 메시지
> ```
> 
> - **GitHub App 인증은 언제든 아래 명령어로 별도 실행 가능:**
>   ```bash
>   autopr auth github-app
>   ```

- **이미 GitHub 사용자 토큰이 등록되어 있으면 재인증 여부만 묻고, No를 선택하면 기존 토큰을 그대로 사용합니다.**

### 1-1. GitHub App 인증만 별도 실행 (`auth github-app`)

```bash
autopr auth github-app
```
- GitHub App 인증만 별도로 실행(언제든 추가 인증/재인증 가능)
- AI 리뷰, 자동 리뷰 코멘트 등 고급 기능을 사용하려면 필요
- 인증 성공/실패 메시지 안내

### 2. PR 생성 (`new`)

```bash
autopr new
```
- 브랜치 패턴/템플릿 기반 PR 생성
- AI가 PR 제목/본문/리뷰 자동 생성
- 관련 이슈 연결, 리뷰어 지정, Draft PR 지원
- PR 생성 후 코드리뷰/라인별 리뷰 자동 실행 가능 (GitHub App 인증 필요)

> **참고:**  
> `autopr new` 명령은 **현재 체크아웃된 브랜치**에서  
> **사용자가 지정하는 타겟(기준) 브랜치**(예: main, develop 등)를 기준으로 PR을 생성합니다.  
> 예를 들어, `feature/login` 브랜치에서 `autopr new`를 실행하고  
> 타겟 브랜치로 `main`을 선택하면  
> `feature/login` → `main` PR이 생성됩니다.

### 3. PR 목록 및 액션 (`list`)

```bash
autopr list
```
- PR 상태(오픈/닫힘/전체)별 목록 조회
- PR 선택 후 병합/업데이트/브라우저 열기 등 액션 지원

### 4. PR 정보 수정 (`update`)

```bash
autopr update <pr-number>
```
- PR 제목/본문/상태(초안/리뷰준비) 수정

### 5. PR 병합 (`merge`)

```bash
autopr merge <pr-number>
```
- 병합 방식(merge/squash/rebase) 선택
- 충돌 발생 시 AI 기반 해결 제안 및 수동 가이드 제공
- 병합 후 브랜치 자동 삭제/정리

### 6. PR 재오픈 (`reopen`)

```bash
autopr reopen <pr-number>
```
- 닫힌 PR을 다시 오픈 (병합된 PR은 불가)

### 7. 커밋 및 AI 메시지 (`commit`)

```bash
autopr commit [improve] [메시지] [옵션]
```

| 옵션/단축키      | 설명                                      |
|------------------|-------------------------------------------|
| `-a, --all`      | 전체 변경사항 커밋 및 push                |
| `-p, --patch`    | 패치 모드(대화형, git add -p)             |
| `-s, --select`   | 파일 선택 커밋                            |
| `-sp, --selectpush` | 파일 선택 + push                        |
| `-f, --force`    | 확인 프롬프트 건너뛰기 (자동화용)         |
| `improve`        | 마지막 커밋 메시지 AI로 개선              |

- 변경사항 스테이징/선택/패치/자동 커밋
- AI가 커밋 메시지 제안/개선
- 커밋 후 자동 push 및 PR 생성 안내
- **Force 옵션 (`-f`)**: AI 메시지 확인 프롬프트를 건너뛰어 AI CLI 도구(Claude Code, Gemini CLI 등)와 함께 자동화 가능

#### Force 옵션 사용 예시

```bash
# AI 메시지 생성 후 확인 없이 커밋
autopr commit -f

# 모든 파일을 스테이징하고 확인 없이 커밋
autopr commit -af

# 메시지 개선 후 확인 없이 커밋
autopr commit improve -f

# 자동화 환경에서 선택적 파일 커밋
git add src/file1.js src/file2.js
autopr commit -f
```

### 8. 일일 커밋 리포트 (`daily-report`)

```bash
autopr daily-report [옵션]
```
- 하루/기간별 커밋 통계, AI 요약, 브랜치/파일유형/시간대별 분석
- 콘솔/JSON/Markdown 출력, 파일 저장 지원

옵션 예시:
- `-u, --username <username>`: 특정 사용자
- `-f, --format <format>`: 출력 형식(console/json/markdown)
- `-d, --date <date>`: 날짜 지정
- `-o, --output <path>`: 파일 저장 경로

### 9. 언어 설정 (`lang`)

```bash
autopr lang set <ko|en>
autopr lang current
```
- CLI 메시지 언어 변경/확인

### 10. Collaborator 관리 (`collaborator`)

```bash
autopr collaborator invite <username>
autopr collaborator list
autopr collaborator remove
autopr collaborator status <username>
autopr collaborator status-all
```
- 협업자 초대/권한설정/목록/제거/초대상태 확인

### 11. Reviewer Group 관리 (`reviewer-group`)

```bash
autopr reviewer-group add <name> -m <id1,id2,...> [-s <strategy>]
autopr reviewer-group remove <name>
autopr reviewer-group update <name> [옵션]
autopr reviewer-group list
```

| 옵션/단축키      | 설명                                      |
|------------------|-------------------------------------------|
| `-m, --members`  | 그룹 멤버 지정(필수, 콤마로 구분)         |
| `-s, --strategy` | 리뷰어 로테이션 전략(round-robin 등)      |

- 리뷰어 그룹 추가/수정/삭제/목록
- 전략(round-robin 등) 지정 가능

### 12. PR 템플릿 관리 (`template`)

```bash
autopr template list
autopr template create [name]
autopr template edit [name]
autopr template delete [name]
autopr template view [name]
```

| 하위 명령어      | 설명                                      |
|------------------|-------------------------------------------|
| `list`           | 템플릿 목록 조회                          |
| `create [name]`  | 새 템플릿 생성(이름 생략 시 대화형 입력)  |
| `edit [name]`    | 템플릿 수정(이름 생략 시 목록에서 선택)   |
| `delete [name]`  | 템플릿 삭제(이름 생략 시 목록에서 선택)   |
| `view [name]`    | 템플릿 내용 보기(이름 생략 시 목록에서 선택)|

- 에디터로 직접 편집 가능

---

## 설정 파일 구조

### 글로벌 설정 (`~/.autopr/config.json`)
사용자별 전역 설정을 저장합니다:
- **githubToken**: GitHub OAuth 인증 토큰 (로컬 저장, 외부 전송 없음)
- **language**: 사용 언어 설정 ("en" 또는 "ko")

### AI 토큰 (`~/.autopr/token.json`)
AI 기능 사용을 위한 인증 토큰:
- **token**: AI 서비스 접근 토큰 (무단 사용 방지용)
- **expiresAt**: 토큰 만료 시간
- ⚠️ 이 토큰은 라이브러리 무단 사용을 방지하기 위한 보안 장치입니다.

### 프로젝트 설정 (`.autopr.json`)
프로젝트별 설정을 저장합니다:

```json
{
  "githubApp": {
    "appId": "...",        // GitHub App ID (로컬 저장)
    "clientId": "...",     // Client ID (로컬 저장)
    "installationId": 123456  // 설치 ID (로컬 저장)
  },
  "owner": "username",     // (선택) 저장소 소유자
  "repo": "repository",    // (선택) 저장소 이름
  "defaultReviewers": ["user1", "user2"],
  "reviewerGroups": [
    { 
      "name": "FE", 
      "members": ["user1", "user2"], 
      "rotationStrategy": "round-robin"  // round-robin, random, least-busy
    }
  ],
  "branchPatterns": [
    {
      "pattern": "feat/*",
      "type": "feat",  // feat, fix, refactor, docs, chore, test
      "draft": true,
      "labels": ["feature"],
      "template": "feature",
      "autoAssignReviewers": true,
      "reviewers": [],
      "reviewerGroups": []
    }
  ]
}
```

> 💡 **보안 안내**: 모든 인증 정보(GitHub OAuth 토큰, GitHub App 정보)는 로컬 파일시스템에만 저장되며, 외부 서버로 전송되거나 수집되지 않습니다.

---

## AI 기능 안내

- **AI 토큰 발급:** 최초 `init` 시 자동으로 발급되며, AI 기능(커밋 메시지, PR 설명, 코드리뷰 등) 사용에 필요합니다. 토큰이 만료되거나 인증 오류가 발생할 경우에도 자동으로 재발급되므로, 사용자는 별도의 추가 조치 없이 AI 기능을 계속 사용할 수 있습니다.
- **지원 기능:**
  - 커밋 메시지 생성/개선
  - PR 제목/본문/리뷰/코드리뷰/충돌 해결 제안/일일 리포트 요약
- **서버와 통신:** 로컬에서 별도 AI 서버와 HTTP 통신
- **언어:** 한글/영어 지원

---

## 인증 흐름

- **GitHub App 인증:** PR/리뷰/자동화 필수, Device Flow로 진행
- **OAuth 인증:** 일부 기능(예: PR 생성) 권장, Device Flow로 진행
- **AI 토큰:** 자동 발급, 만료 시 재발급

---

## 자주 묻는 질문(FAQ)

- **Q. 인증이 안 돼요!**
  - `autopr init`으로 재인증 시도, 브라우저 자동 실행이 안 되면 URL을 직접 복사해 접속
- **Q. AI 기능이 동작하지 않아요!**
  - 토큰 만료/서버 미동작 여부 확인, `autopr init`으로 재발급
- **Q. 커밋/PR/리뷰어 자동화가 안 돼요!**
  - 설정 파일(.autopr.json) 및 인증 상태 확인
- **Q. 브랜치 이동할 때 hooks undefined 에러가 발생해요!**
  - 이전 버전 AutoPR CLI를 사용하셨던 분들은 `.git/hooks/post-checkout` 파일이 남아 있을 수 있습니다. 이 경우 브랜치 이동 시 `hooks undefined` 또는 관련 에러가 발생할 수 있습니다.
  - 아래 명령어로 해당 hook 파일을 삭제하면 정상 동작합니다:
    ```bash
    rm .git/hooks/post-checkout
    ```
  - 삭제해도 Git 기본 동작에는 영향이 없으니 안심하고 실행하셔도 됩니다.

---

## 기여 및 라이선스

- 오픈소스 기여 환영! PR/이슈 등록해주세요.
- 라이선스: MIT

---

## 문의

- GitHub 저장소 이슈 또는 maintainer에게 문의

## 보안 및 개인정보 안내

### AI 기능 및 데이터 처리
- 본 CLI의 AI 기능(커밋 메시지, PR 설명, 코드리뷰 등)을 사용할 때, 관련 데이터(코드, PR, 커밋 등)는 AI 분석을 위해 개발자 개인 서버로 전송됩니다.
- 해당 서버는 오픈되어 있지 않으며, 전송된 데이터(코드, PR, 커밋 등)는 저장하지 않습니다.
- 서버에서는 API 요청이 정상적으로 들어왔는지와 에러 발생 여부만 기록하며, 코드/PR/커밋 등 실제 내용은 로그로도 남기지 않습니다.
- AI 분석 결과는 구글 AI(Gemini 등) 기반으로 생성됩니다.

### 인증 정보 보안
- **GitHub OAuth 토큰**: `~/.autopr/config.json`에 로컬 저장, 외부 전송 없음
- **GitHub App 인증 정보** (appId, clientId, installationId): `.autopr.json`에 로컬 저장, 외부 수집 없음
- **AI 액세스 토큰**: `~/.autopr/token.json`에 로컬 저장, 라이브러리 무단 사용 방지용
- 모든 인증 정보는 사용자의 로컬 파일시스템에만 저장되며, 어떠한 외부 서버로도 전송되거나 수집되지 않습니다.

### 오픈소스 투명성
- 모든 코드는 오픈소스이며, 데이터 흐름 및 보안 정책을 직접 확인할 수 있습니다.
- 의심스러운 부분이 있다면 GitHub 저장소에서 소스코드를 직접 검토하실 수 있습니다.
