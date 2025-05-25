# AutoPR CLI User Guide

**한국어 문서:** [README-kr.md](https://github.com/newExpand/github-autopr-cli/blob/main/README-kr.md)

## AI-powered PR & Review: Test Case

The [v1.0.0 Release Pull Request](https://github.com/newExpand/github-autopr-cli/pull/147) was created and reviewed as a **test case** to verify the effectiveness of AI-powered PR and review automation.

- This PR was used to check if the AI system could detect critical bugs and issues in real-world scenarios.
- Earlier versions used hardcoded logic, but now all sensitive operations (such as authentication) are tokenized for improved security and flexibility.
- The PR and its review process demonstrate the practical value of AI integration in this CLI.

> See the [test PR & review details here](https://github.com/newExpand/github-autopr-cli/pull/147).

## Introduction

**AutoPR CLI** is a command-line tool that automates various GitHub workflows such as Pull Request (PR) creation, review, merge, commit, collaborator management, and daily reports. It provides powerful features including AI-based commit messages, PR descriptions, code reviews, branch patterns, templates, and reviewer groups.

- **Supported Environments:** Node.js 18+ / macOS, Linux, Windows
- **Main Features:**
  - Create/update/merge/review/list/reopen PRs, daily commit reports
  - AI-powered commit messages, PR descriptions, code reviews, conflict resolution suggestions
  - Collaborator/Reviewer/Reviewer Group/Template management
  - Supports GitHub App and OAuth authentication

---

## Installation

```bash
npm install -g newexpand-autopr
```

- Requires Node.js 18 or higher
- After installation, use the `autopr` command

---

## Basic Usage

```bash
autopr <command> [options]
```

Example:
```bash
autopr init
```

---

## Main Commands & Features

### 1. Initialization & Authentication (`init`)

```bash
autopr init
```
- Creates/initializes the project config file (.autopr.json)
- **OAuth authentication (required for PR/merge and basic features)**
- **GitHub App authentication (optional, for AI review and advanced features, can be run anytime with a separate command)**
- AI token issuance (automatic)
- Set language, default reviewers, etc.

> ⚠️ **Important:**  
> When authenticating the GitHub App, make sure you select the **correct user or organization** for your project.  
> If you authenticate with the wrong account/organization, key features such as PR automation, review, and permission management may not work as expected.  
> **If you see a '404 not found' or 'Resource not accessible by integration' error after initialization and authentication, please make sure you selected the correct user/organization during GitHub App authentication.**

> **Authentication Notice:**  
When authenticating with GitHub (during init, auth, etc.), an "authentication code" and "authentication URL" will be shown in your terminal.  
Copy the code from the terminal, open the provided URL (Device Flow authentication page) in your browser, and paste the code to complete authentication.  
If your browser does not open automatically, copy and paste the URL from the terminal into your browser manually.

> **Workflow:**
>
> ```text
> Run autopr init
>    ↓
> Create/initialize project config file
>    ↓
> OAuth authentication (required for PR/merge)
>    ↓
> AI token issuance (automatic)
>    ↓
> GitHub App authentication (optional, for AI review/advanced features)
>    ↓
> Set language/reviewers/etc
>    ↓
> Save config file and show guide message
> ```
>
> - **You can always run GitHub App authentication separately with:**
>   ```bash
>   autopr auth github-app
>   ```
>
> - **If a GitHub user token is already registered, you can choose whether to re-authenticate. Selecting 'No' will keep the existing token.**

### 1-1. Run GitHub App Authentication Separately (`auth github-app`)

```bash
autopr auth github-app
```
- Run GitHub App authentication separately (can be run anytime for additional/re-authentication)
- Required for AI review, automatic review comments, and other advanced features
- Shows success/failure messages

### 2. Create PR (`new`)

```bash
autopr new
```
- Create PRs based on branch patterns/templates
- AI automatically generates PR title/body/review
- Link related issues, assign reviewers, support Draft PR
- Optionally run code review/line-by-line review after PR creation (**requires GitHub App authentication**)

> **Note:**  
> The `autopr new` command creates a PR **from the currently checked-out branch**  
> **to the target branch you specify** (e.g., main, develop, etc).  
> For example, if you run `autopr new` on the `feature/login` branch and select `main` as the target,  
> a PR from `feature/login` to `main` will be created.

### 3. List PRs & Actions (`list`)

```bash
autopr list
```
- View PRs by state (open/closed/all)
- Select a PR to merge/update/open in browser/cancel, etc.

### 4. Update PR Info (`update`)

```bash
autopr update <pr-number>
```
- Update PR title/body/status (draft/ready)

### 5. Merge PR (`merge`)

```bash
autopr merge <pr-number>
```
- Choose merge method (merge/squash/rebase)
- If conflicts occur, provides AI-based suggestions and manual guide
- Automatically deletes/cleans up branch after merge

### 6. Reopen PR (`reopen`)

```bash
autopr reopen <pr-number>
```
- Reopen a closed PR (not possible for merged PRs)

### 7. Commit & AI Message (`commit`)

```bash
autopr commit [improve] [message] [options]
```

| Option/Shortcut      | Description                                 |
|---------------------|---------------------------------------------|
| `-a, --all`         | Commit and push all changes                  |
| `-p, --patch`       | Patch mode (interactive, git add -p)         |
| `-s, --select`      | Select files to commit                       |
| `-sp, --selectpush` | Select files + push                          |
| `improve`           | Improve last commit message with AI          |

- Stage/select/patch/auto-commit changes
- AI suggests/improves commit messages
- After commit, auto push and PR creation guide

### 8. Daily Commit Report (`daily-report`)

```bash
autopr daily-report [options]
```
- Daily/periodic commit stats, AI summary, analysis by branch/file type/hour
- Output as console/JSON/Markdown, support for saving to file

Options:
- `-u, --username <username>`: Specific user
- `-f, --format <format>`: Output format (console/json/markdown)
- `-d, --date <date>`: Specify date
- `-o, --output <path>`: Output file path

### 9. Language Setting (`lang`)

```bash
autopr lang set <ko|en>
autopr lang current
```
- Change/check CLI message language

### 10. Collaborator Management (`collaborator`)

```bash
autopr collaborator invite <username>
autopr collaborator list
autopr collaborator remove
autopr collaborator status <username>
autopr collaborator status-all
```
- Invite/set permissions/list/remove collaborators, check invitation status

### 11. Reviewer Group Management (`reviewer-group`)

```bash
autopr reviewer-group add <name> -m <id1,id2,...> [-s <strategy>]
autopr reviewer-group remove <name>
autopr reviewer-group update <name> [options]
autopr reviewer-group list
```

| Option/Shortcut      | Description                                 |
|---------------------|---------------------------------------------|
| `-m, --members`     | Specify group members (required, comma-separated) |
| `-s, --strategy`    | Reviewer rotation strategy (e.g. round-robin)    |

- Add/update/delete/list reviewer groups
- Supports strategies like round-robin

### 12. PR Template Management (`template`)

```bash
autopr template list
autopr template create [name]
autopr template edit [name]
autopr template delete [name]
autopr template view [name]
```

| Subcommand          | Description                                 |
|---------------------|---------------------------------------------|
| `list`              | List templates                              |
| `create [name]`     | Create new template (prompt if name omitted) |
| `edit [name]`       | Edit template (choose from list if omitted)  |
| `delete [name]`     | Delete template (choose from list if omitted)|
| `view [name]`       | View template content (choose from list if omitted)|

- Can edit directly in your editor

---

## Configuration File Structure

- **Global config:** `~/.autopr/config.json`
- **Project config:** `.autopr.json`

Example fields:
```json
{
  "githubApp": {
    "appId": "...",
    "clientId": "...",
    "installationId": 123456
  },
  "defaultReviewers": ["user1", "user2"],
  "reviewerGroups": [
    { "name": "FE", "members": ["user1", "user2"], "rotationStrategy": "round-robin" }
  ],
  "branchPatterns": [
    {
      "pattern": "feat/*",
      "type": "feat",
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

---

## AI Features

- **AI Token Issuance:** Automatically issued on first `init`. Required for AI features (commit message, PR description, code review, etc). If the token expires or an authentication error occurs, it is automatically reissued, so users do not need to take any extra action.
- **Supported Features:**
  - Commit message generation/improvement
  - PR title/body/review/code review/conflict resolution suggestions/daily report summary
- **Server Communication:** Communicates with a separate AI server via HTTP
- **Language:** Supports Korean/English

---

## Security & Privacy Notice

- When using the CLI's AI features (commit message, PR description, code review, etc.), related data (code, PR, commit, etc.) is sent to the developer's private server for AI analysis.
- This server is not open to the public, and the transmitted data (code, PR, commit, etc.) is not stored.
- The server only logs whether the API request was received and if any errors occurred; the actual content of code/PR/commit is not logged.
- AI analysis results are generated based on Google AI (Gemini, etc).
- Sensitive information such as GitHub authentication/tokens is stored only locally and is never sent externally.
- All code is open source, and you can directly check the data flow and security policy.

---

## FAQ

- **Q. Authentication doesn't work!**
  - Try re-authenticating with `autopr init`. If the browser doesn't open automatically, copy and paste the URL manually.
- **Q. AI features don't work!**
  - Check for token expiration or server issues. Reissue the token with `autopr init` if needed.
- **Q. Commit/PR/reviewer automation doesn't work!**
  - Check your config file (.autopr.json) and authentication status.
- **Q. I get a hooks undefined error when switching branches!**
  - If you used a previous version of AutoPR CLI, the `.git/hooks/post-checkout` file may remain. This can cause a `hooks undefined` or related error when switching branches.
  - Remove the hook file with the following command:
    ```bash
    rm .git/hooks/post-checkout
    ```
  - Deleting this file will not affect Git's default behavior, so you can safely remove it.

---

## Contribution & License

- Contributions are welcome! Please submit PRs or issues.
- License: MIT

---

## Contact

- Please contact via GitHub issues or the maintainer.
