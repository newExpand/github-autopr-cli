# github-autopr-cli

A CLI tool for GitHub PR automation. Automates PR creation, review, and merge processes while providing efficient PR management through AI features.

## Key Features

- 🚀 Automated PR Creation and Management
- 🤖 AI-powered PR Description Generation
- 👥 Automatic Reviewer Assignment
- 🔄 Branch Pattern-based Automation
- 🌍 Multi-language Support (English/Korean)
- 🔍 AI Code Review
- 🤝 Collaborator Management

## Installation

```bash
npm install -g github-autopr-cli
```

## Initial Setup

1. Run initialization command:

```bash
autopr init
```

2. Setup process:
   - GitHub Authentication (Browser auth or manual token input)
   - Default Branch Configuration
   - Default Reviewers Setup
   - AI Feature Setup (optional)
   - Git Hooks Setup (optional)

## Basic Usage

### Creating PRs

```bash
# Create a new PR
autopr new

# Create PR from current branch changes
autopr commit -a

# Improve commit message
autopr commit improve

# Interactively select changes to commit
autopr commit -p

# Stage changes, commit, and auto-push in one go
autopr commit -a

# Improve specific commit message
autopr commit improve "existing commit message"
```

### Managing PRs

```bash
# List PRs
autopr list

# Review PR
autopr review <PR-number>

# Update PR
autopr update <PR-number>

# Merge PR
autopr merge <PR-number>

# Merge PR (with squash option)
autopr merge <PR-number>  # Interactive merge method selection
# - Regular merge
# - Squash merge
# - Rebase merge

# Reopen closed PR
autopr reopen <PR-number>
```

### PR Status Management

PRs can have the following statuses:

- Draft: Work in progress
- Ready for Review: Ready for review
- Mergeable: Can be merged
- Conflicting: Has conflicts
- Checking: Status being verified

When conflicts occur, running `autopr merge` provides automated conflict resolution assistance:

- Automatic conflict file detection
- Opens conflicting files in editor
- AI-based conflict resolution suggestions
- Step-by-step resolution guide

### Collaborator Management

```bash
# Invite collaborator
autopr collaborator invite <username>

# List collaborators
autopr collaborator list

# Remove collaborator
autopr collaborator remove
```

### Reviewer Group Management

```bash
# Add reviewer group
autopr reviewer-group add <group-name> -m "reviewer1,reviewer2" -s "round-robin"

# List reviewer groups
autopr reviewer-group list

# Update reviewer group
autopr reviewer-group update <group-name> -m "reviewer1,reviewer2"

# Remove reviewer group
autopr reviewer-group remove <group-name>
```

## Configuration Files

### .autopr.json

Located in the project root with the following configuration options:

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

### AI Feature Configuration (.env)

```env
AI_PROVIDER=openai
AI_API_KEY=your-api-key
AI_MODEL=gpt-4
```

## Branch Patterns

Default branch patterns:

- `feat/*`: New features
- `fix/*`: Bug fixes
- `refactor/*`: Code refactoring
- `docs/*`: Documentation changes
- `chore/*`: Miscellaneous tasks
- `test/*`: Test-related changes

Each pattern supports:

- Automatic Draft PR creation
- Label auto-assignment
- Reviewer auto-assignment
- PR template application

## PR Templates

Default PR templates:

- feature: New features
- bugfix: Bug fixes
- refactor: Refactoring
- docs: Documentation
- chore: Miscellaneous
- test: Testing

Custom templates can be added to the `.github/PULL_REQUEST_TEMPLATE/` directory.

## AI Features

### Supported Features

- Automatic PR description generation
- Code review suggestions
- Commit message improvements
- Conflict resolution suggestions

### Supported AI Providers

- OpenAI (GPT-4, GPT-3.5-turbo)
- Anthropic Claude (coming soon)
- GitHub Copilot (coming soon)

## Language Settings

```bash
# Change language
autopr lang set en  # English
autopr lang set ko  # Korean

# Check current language
autopr lang current
```

## Advanced Features

### Commit Features

- AI-based commit message generation
- Existing commit message improvement
- Interactive change selection (`-p` option)
- Automatic push and PR creation (`-a` option)

### Merge Features

- Multiple merge methods (merge, squash, rebase)
- Automatic conflict detection and resolution
- Branch cleanup automation
- Base branch modification

### Review Features

- AI code review
- Review status management (approve, request changes, comment)
- File-by-file review
- Open PR in browser

### Git Hook Features

- post-checkout hook support
- Automatic PR creation on branch switch
- Branch pattern-based automation

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request
