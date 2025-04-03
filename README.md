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
# Push options:
# - Push to current branch
# - Push to another branch
# - Create and push to new branch

# Interactively stage changes before commit
autopr commit -p

# Select specific files to commit
autopr commit -s

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

### 0.1.13

- Improved Merge Conflict Resolution Experience
  - Simplified conflict resolution workflow
  - Removed unnecessary automatic file opening logic
  - Enhanced step-by-step guidance with clear Git commands
  - Added better conflict marker explanations
  - Maintained valuable AI-powered conflict resolution suggestions
  - Improved multilingual support for conflict resolution
  - Added helpful documentation links for resolving conflicts
- Enhanced Localization
  - Updated translations for conflict resolution
  - Improved language consistency
  - Added missing translation keys
- General Performance Improvements
  - Reduced unnecessary code complexity
  - Enhanced error handling
  - Improved cross-platform compatibility

### 0.1.12

- Re-enabled File Selection with Auto-Push Feature
  - Added functionality to select specific files to stage, commit, and automatically push to origin
  - Updated option: `-sp`, `--selectpush` option provided
  - Improved Commander.js option handling for greater stability
  - Excluded branch selection feature (push only to current branch)
  - Maintained automatic `-u` option for non-existing remote branches

### 0.1.11

- Temporary Disabled Branch Selection Push Feature
  - Implemented to resolve branch conflict issues
  - Changed to push only to current branch
  - Automatically added `-u` option for non-existing remote branches
  - Temporarily removed related options:
    - Disabled `-sp`, `--select-push` option
    - Disabled branch selection prompt
  - Planned future update with improved branch management logic

### 0.1.10

- Enhanced Commit Functionality
  - Added File Selection Commit Feature (`autopr commit -s`)
    - Select specific files to commit from changed files
    - Interactive interface for file selection
  - Added File Selection with Auto-Push Feature (`autopr commit -sp`)
  - Added Branch Selection Push Feature (`autopr commit -a`)
    - Push to branches other than the current branch
    - Display remote branch status (remote/local only)
    - Support for creating and pushing new branches
    - Branch checkout options
  - Improved Remote Branch Status Management
    - Automatic detection of branches not existing on remote
    - Automatic `-u` option for new remote branches
    - Enhanced visual indication of branch status
- Improved OpenRouter API Key Management
  - Added Automatic API Key Activation
    - Automatic status check when using AI features
    - Silent activation of disabled API keys
    - Background processing for improved user experience
  - On-demand API Key Status Checking
    - Status check every 60 minutes when using AI features
    - Efficient activation to prevent 401 errors
  - Development-mode API Key Management Commands
    - API key information retrieval and status management
    - Enhanced security for sensitive API key information
- Enhanced AI Initialization and Performance
  - Optimized AI Instance Creation and Initialization
    - Strengthened duplicate initialization prevention
    - AI instance reuse within commands
    - Optimized memory usage
  - Improved API Key Status Check Logic
    - Prevented duplicate API calls through caching
    - Optimized status check frequency (5-minute cache)
  - Enhanced Logging
    - Prevented duplicate log outputs
    - Clarified debug/info level distinction
    - Optimized log messages for better user experience

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

## Commit Management

- `autopr commit`: Analyzes staged changes and suggests a commit message using AI.
- `autopr commit -a`: Stages all changes, commits, and automatically pushes.
- `autopr commit -s`: Selects specific files to stage and commit.
- `autopr commit -sp`: Selects specific files to stage, commits, and automatically pushes.
- `autopr commit -p`: Interactively selects changes to stage.
- `autopr commit improve`: Improves the most recent commit message.
- `autopr commit improve "message"`: Improves the given message.

### OpenRouter API Key Management

```bash
# Get API key information
autopr openrouter get

# List API keys
autopr openrouter list

# Check and update API key status
autopr openrouter status --enable  # Enable
autopr openrouter status --disable  # Disable
```

> Note: OpenRouter API key status is automatically checked and activated when using AI features. This process runs silently in the background, so users don't need to manage it manually.

### PR Creation

- `autopr new`: Creates a new PR based on staged changes.
- `autopr new -d`: Creates a new draft PR.
- `autopr new -t "title"`: Creates a new PR with the specified title.
- `autopr new -b "body"`: Creates a new PR with the specified body.
- `autopr new -r "reviewer1,reviewer2"`: Creates a new PR with the specified reviewers.
- `autopr new -l "label1,label2"`: Creates a new PR with the specified labels.
- `autopr new -a`: Creates a new PR and automatically pushes changes.
- `autopr new -m`: Creates a new PR and automatically merges if possible.
