# NewExpand AutoPR

A powerful CLI tool for GitHub PR automation. Streamlines PR creation, review, and merging processes while enhancing PR management through AI capabilities.

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
- 🔍 Conflict resolution assistant
- 📝 Commit message enhancement
  - Visual distinction for AI suggestions
  - Intuitive message formatting
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

### 0.1.9

- Enhanced User Experience
  - Improved AI Output Visualization
    - Color-coded PR title/description generation
    - Enhanced visual distinction for commit message suggestions
  - Enhanced Log Level Distinction
    - Regular messages: cyan color
    - AI-generated content: white color (📝 symbol)
    - Section dividers: magenta color (=== symbol)
  - Improved Message Formatting
    - Enhanced readability with divider lines
    - Color emphasis for important information
- Added Automatic Push for release/\* Branches
  - Automatic push support during PR creation
  - Robust error handling
- Improved Branch Strategy
  - Changed base branch configuration to use developmentBranch for all branches except release/\*
  - Before: All branches used main as base
  - After: release/\* → main, other branches → developmentBranch

### 0.1.8

- Fixed AI initialization issues
  - Improved AI initialization process to ensure proper activation
  - Added initialization state management to prevent duplicate initialization
  - Enhanced error handling during AI initialization
  - Fixed OpenRouter configuration loading and validation
  - Added debug logging for AI initialization process
- Enhanced AI feature reliability
  - Added proper error recovery for AI initialization failures
  - Improved state management for AI features
  - Added initialization promise handling to prevent race conditions
  - Enhanced configuration validation for AI providers

### 0.1.7

- Enhanced commit message generation
  - Added full file path support in commit messages
  - Improved file tracking to prevent omissions
  - Enhanced commit message format consistency
  - Added comprehensive changed files list in commit analysis
- Improved i18n support
  - Synchronized English and Korean translations
  - Enhanced error message consistency
  - Added missing translation keys

### 0.1.6

- Added OpenRouter support as AI provider
  - Free Gemini Flash 2.0 model integration
  - Automatic API key and model configuration
  - Optimized token limits for OpenRouter
- Enhanced commit message generation
  - Improved prompt structure for better clarity
  - Enhanced file change tracking to prevent omissions
  - Added bilingual support with English prompts and Korean output
  - Optimized system prompts for more consistent results
- Improved i18n support
  - Added comprehensive i18n file tracking
  - Enhanced language-specific prompt handling
  - Improved translation consistency

### 0.1.5

- Enhanced Draft PR availability check
  - Automatic detection of Draft PR availability based on repository visibility
  - Improved support for public/private repositories
- Enhanced AI title generation
  - Added title generation process logging
  - Improved fallback logic for title generation failures
  - Enhanced debugging information
