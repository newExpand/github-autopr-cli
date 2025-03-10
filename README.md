# NewExpand AutoPR

A powerful CLI tool for GitHub PR automation. Streamlines PR creation, review, and merging processes while enhancing PR management through AI capabilities.

## Key Features

- 🤖 AI-powered PR description generation and code review
- 🔄 Automated PR creation and management
- 👥 Automatic reviewer assignment and group management
- 🌍 Multi-language support (English/Korean)
- 🔍 Conflict resolution assistant
- 📝 Commit message enhancement
- 🤝 Collaborator management
- 🪝 Git hooks automation

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

# List PRs
autopr list

# Review PR
autopr review <pr-number>
# Available review actions:
# - View PR content
# - Run AI code review
# - Approve/Request changes/Comment
# - Checkout branch
# - Open PR in GitHub

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

### Commit Management

```bash
# Commit changes (with AI suggestions)
autopr commit

# Commit all changes and push
autopr commit -a

# Interactively stage changes before commit
autopr commit -p

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

- `feat/*`: New feature development
- `fix/*`: Bug fixes
- `refactor/*`: Code refactoring
- `docs/*`: Documentation changes
- `chore/*`: Maintenance tasks
- `test/*`: Test-related changes
- `release/*`: Release-related changes

Each pattern can be configured with:

- Draft PR status
- Automatic label assignment
- PR template selection
- Automatic reviewer assignment
- Reviewer group assignment
- Target branch configuration (development/production)

## AI Features

Supports the following AI providers:

- OpenAI (GPT-4, GPT-3.5-turbo)
- GitHub Copilot
- Anthropic (Claude)

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
      "model": "gpt-4"
    }
  }
}
```

### .env

Manages AI settings:

```env
AI_PROVIDER=openai
AI_API_KEY=your-api-key
AI_MODEL=gpt-4
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

- Node.js 16 or higher
- Git 2.0 or higher
- GitHub repository

## License

MIT License
