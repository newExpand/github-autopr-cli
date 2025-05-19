# NewExpand AutoPR

A powerful CLI tool for GitHub PR automation. Streamlines PR creation, review, and merging processes while enhancing PR management through AI capabilities.

**Korean documentation:** [README-kr.md](https://github.com/newExpand/github-autopr-cli/blob/main/README-kr.md)

## Key Features

- 🤖 AI-powered PR description generation and code review
  - Automatic PR title generation and enhancement
  - PR description generation
  - Code review suggestions
  - Visually distinguished AI outputs (color-coded)
- 🔄 Automated PR creation and management
  - Automatic Draft PR availability detection based on repository type
  - Support for public/private repositories
  - Automatic push for release/\* branches
- 👥 Automatic reviewer assignment and group management
- 🌍 Multi-language support (English/Korean)
  - Complete Korean documentation available: [README-kr.md](https://github.com/newExpand/github-autopr-cli/blob/main/README-kr.md) and [USAGE-kr.md](https://github.com/newExpand/github-autopr-cli/blob/main/USAGE-kr.md)
- 🔍 Conflict resolution assistant
- 📝 Commit message enhancement
  - Visual distinction for AI suggestions
  - Intuitive message formatting
- 🤝 Collaborator management
- 🪝 Git hooks automation

## Branch Management Workflow

This library provides a customized workflow combining GitFlow, GitHub Flow, and Conventional Commits. For detailed branch strategy guide, workflow examples, and command usage, check out the following document:

👉 [Detailed Branch Strategy Guide](https://github.com/newExpand/github-autopr-cli/blob/main/USAGE.md)
👉 [한국어 브랜치 전략 가이드](https://github.com/newExpand/github-autopr-cli/blob/main/USAGE-kr.md)

In this document, you'll find:
- Detailed explanation of GitFlow-based branch management strategy
- AutoPR installation and initial setup procedures
- Real terminal command execution processes with example screens
- Specific examples of branch creation, commits, PR creation, and merging
- Release branch management and merging methods

## Installation

```bash
npm install -g newexpand-autopr
```

## Initial Setup

1. Initialize the tool:

```bash
autopr init
```

2. The initialization process includes:
   - GitHub authentication (OAuth or token)
   - Default branch configuration (main/dev)
   - Default reviewers setup
   - AI features setup (optional)
   - Git hooks setup (optional)
   - Release PR template customization (optional)

## Main Commands

### PR Management

```bash
# Create a new PR
autopr new

# List PRs (with interactive selection option)
autopr list

# Update PR
autopr update <pr-number>
# Updatable items:
# - Title
# - Body
# - Status (Draft/Ready for review)

# Merge PR
autopr merge <pr-number>
# Merge options:
# - Merge method (merge/squash/rebase)
# - Change target branch
# - Auto-delete branch
# - Conflict resolution assistant

# Reopen closed PR
autopr reopen <pr-number>
```

### Daily Report Management

```bash
# Generate daily commit report
autopr daily-report

# Options:
# -d, --date <date>       Specific date in YYYY-MM-DD format
# -u, --username <name>   Specific GitHub username
# -f, --format <format>   Output format (console, json, markdown)
# -o, --output <path>     Save report to file
```

### Commit Management

```bash
# Commit changes (with AI suggestions)
autopr commit

# Commit all changes and push
autopr commit -a
# Push options:
# - Push to current branch
# - Push to another branch
# - Create and push to new branch

# Interactively stage changes before commit
autopr commit -p

# Select specific files to commit
autopr commit -s

# Select specific files to stage, commit, and automatically push to origin
autopr commit -sp

# Improve existing commit message
autopr commit improve [message]

# Auto-create PR after commit
# (handled automatically based on branch pattern)
```

### Reviewer Group Management

```bash
# Add reviewer group
autopr reviewer-group add <name> -m "user1,user2" -s "round-robin"
# Rotation strategy options:
# - round-robin: Sequential assignment
# - random: Random assignment
# - least-busy: Assign to member with fewest reviews

# List reviewer groups
autopr reviewer-group list

# Update reviewer group
autopr reviewer-group update <name> -m "user1,user2,user3" -s "random"

# Remove reviewer group
autopr reviewer-group remove <name>
```

### Collaborator Management

```bash
# Invite collaborator
autopr collaborator invite <username>
# Permission levels:
# - pull: Read access
# - push: Write access
# - admin: Admin access

# List collaborators
autopr collaborator list

# Remove collaborator
autopr collaborator remove

# Check invitation status
autopr collaborator status <username>

# Check all invitation statuses
autopr collaborator status-all
```

### Git Hook Management

```bash
# Handle Git hook events
autopr hook post-checkout <branch>
# Automatic actions on checkout:
# - New branch detection
# - Draft PR creation
# - Reviewer assignment
```

### Other Settings

```bash
# Change language setting
autopr lang set <ko|en>

# Check current language
autopr lang current
```

## Branch Patterns

Supports the following branch patterns by default:

- `feat/*`: New feature development (base: developmentBranch)
- `fix/*`: Bug fixes (base: developmentBranch)
- `refactor/*`: Code refactoring (base: developmentBranch)
- `docs/*`: Documentation changes (base: developmentBranch)
- `chore/*`: Maintenance tasks (base: developmentBranch)
- `test/*`: Test-related changes (base: developmentBranch)
- `release/*`: Release-related changes (base: defaultBranch/main)

Each pattern can be configured with:

- Draft PR status
- Automatic label assignment
- PR template selection
- Automatic reviewer assignment
- Reviewer group assignment
- Target branch configuration (development/production)

## AI Features

Supports the following AI providers:

- OpenAI (GPT-4o, GPT-4o-mini, GPT-3.5-turbo)

AI capabilities include:

- PR description generation
- Code review suggestions
- Conflict resolution guidance
- Commit message improvement
- Change analysis and summarization

## Configuration Files

### .autopr.json

Manages project-specific settings:

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

Manages AI settings:

```env
AI_PROVIDER=openai
AI_API_KEY=your-api-key
AI_MODEL=gpt-4o
```

## Customization

### PR Templates

Add custom templates in the `.github/PULL_REQUEST_TEMPLATE` directory:

- `feature.md`
- `bugfix.md`
- `refactor.md`
- `release.md`
- etc...

Templates can include:

- Change description
- Checklist
- Test items
- Reviewer checklist
- Screenshots (for UI changes)
- Related issue links

## System Requirements

- Node.js 20 or higher
- Git 2.0 or higher
- GitHub repository

## License

MIT License

## Change Log

For a detailed list of all version changes, please see the [CHANGELOG.md](https://github.com/newExpand/github-autopr-cli/blob/main/CHANGELOG.md) file.
