# Branch Strategy Guide Based on GitFlow

## Overview

This document explains the branch management strategy based on the GitFlow design pattern. GitFlow is a widely used branch management model in software development projects, introduced by Vincent Driessen in 2010.

The branch strategy of this library is based on "GitFlow", combined with elements of "GitHub Flow" and "Conventional Commits" to create a customized workflow. Managing each branch with PRs allows for clear tracking of project work and enables consistent integration into the `dev` and `main` branches.

### Key Features

- Separate management of main branch (`main`) and development branch (`dev`)
- Creating branches (`feat/*`) for each feature and merging into the development branch after completion
- Merging the content of the development branch into the main branch through release branches (`release/*`)
- Applying branch naming rules according to purpose: bug fixes (`fix/*`), refactoring (`refactor/*`), etc.
- Integration of commit message conventions (feat, fix, docs, etc.) and PR-based workflow
- Automation of workflow through AutoPR tool

## AutoPR Installation and Setup

To use the AutoPR tool, follow these steps for installation and setup:

1. Install globally via NPM:
   ```bash
   npm install -g newexpand-autopr // * Please proceed with npm only.
   ```

2. Run initial setup in your project:
   ```bash
   autopr init
   ```
   Running this command will display an interactive prompt where you can configure the default branches (main, dev, etc.) and branch patterns for your project.

   During the initial setup, you can also choose the following options:
   - GitHub authentication (OAuth or manual token entry)
   - Default branch and development branch configuration
   - AI features setup (OpenAI or OpenRouter)
     - OpenAI: Requires an API key and is a paid service.
     - OpenRouter: Free to use without requiring additional key setup.
   - Automatic GitHub Actions workflow setup (for PR automatic review)
     - Automatically reviews code when PRs are created or updated
     - Analyzes code quality, potential bugs, security vulnerabilities
     - Provides inline comments on specific code lines
     - Delivers reviews in multiple languages matching the user's locale

   ### Initial Setup (init) Example
   
   Below are step-by-step screen examples when running the `autopr init` command:
   
   #### a. GitHub Token Setup
   
   ![GitHub Token Setup](docs/docs-init-1.png)
   *Initial setup start - Configure your GitHub token. You can choose between OAuth authentication or manual token entry.*
   
   #### b. GitHub Authentication 1
   
   ![GitHub Authentication 1](docs/docs-init-2.png)
   *GitHub authentication process*
   
   #### c. GitHub Authentication 2
   
   ![GitHub Authentication 2](docs/docs-init-3.png)
   *Access must be allowed for Organization-related repositories on GitHub (check for the green checkmark). Personal repositories can be used immediately upon clicking.*
   
   #### d. GitHub Authentication 3
   
   ![GitHub Authentication 3](docs/docs-init-4.png)
   *Copy the device code from the terminal*

   #### e. GitHub Authentication 4
   
   ![GitHub Authentication 4](docs/docs-init-5.png)
   *Apply the code copied from the terminal to the authentication code*
   
   #### f. AutoPr Basic Settings
   
   ![AutoPr Basic Settings](docs/docs-init-6.png)
   *Configure the project's default branch (main), development branch (dev), release PR template, default reviewers, etc.*
   
   #### g. Setup Complete
   
   ![Setup Complete](docs/docs-init-7.png)
   *Initial setup has been successfully completed. You are now ready to use AutoPR.*

3. Check version and update:
   ```bash
   # Check currently installed version
   autopr --version
   
   # Check the latest version on npm
   npm view newexpand-autopr version
   
   # Update to the latest version
   npm install -g newexpand-autopr@latest
   ```

> 💡 **Note**: Users of previous versions can also update to the latest version using the commands above.

## Basic Principles

- Always develop and apply changes based on the `dev` branch first
- Integrate into `dev` whenever a branch-level feature is completed
- Integrate into `main` when the entire feature is completed
- Always merge the latest `dev` branch before creating a PR to resolve conflicts in advance
- Delete branches after integration to keep the repository clean

## Branch Naming Conventions

Following the rules in the `.autopr.json` file, use these formats:

- `feat/*`: New feature development
- `fix/*`: Bug fixes
- `refactor/*`: Code refactoring
- `docs/*`: Documentation changes
- `chore/*`: Miscellaneous tasks
- `test/*`: Test-related work
- `release/*`: Release preparation

How to create a branch:
```bash
git checkout -b <branch-name>
# Example: git checkout -b feat/notice-object-a
```

> 💡 **Note**: For longer branch names, use `-` as a separator.

## Usage

### Standard Workflow

1. Create a new feature branch from the `dev` branch
   ```bash
   git checkout dev
   git checkout -b feat/<feature-name>
   ```

2. Commit and push after working
   ```bash
   autopr commit -a  # Performs commit and push to origin together
   ```

3. Synchronize with the latest `dev` branch before creating a PR
   ```bash
   git checkout dev
   git pull origin dev
   git checkout feat/<feature-name>
   git merge dev
   # After resolving any conflicts
   autopr commit -a
   ```

4. Create a PR
   ```bash
   autopr new
   ```

5. Merge PR
   ```bash
   autopr merge <PR-number>  # Use the PR number displayed after running autopr new
   ```

6. Create and merge a release branch
   ```bash
   git checkout -b release/<version>
   autopr new
   autopr merge <PR-number>
   ```

### For Cases Requiring Quick Integration

1. Develop directly on the `dev` branch, then create a release branch
   ```bash
   git checkout dev
   # Perform development work
   git checkout -b release/<version>
   autopr new
   autopr merge <PR-number>
   ```

### When Only Commit Is Needed Without PR

Work directly on the `dev` or `main` branch:
```bash
autopr commit -a  # Commit and push to origin for the current branch
# Or
autopr commit  # Commit locally without pushing to origin
```

## Real Usage Examples

Below are the results of executing commands in an actual terminal.

### Creating and Committing to a Documentation Change Branch

1. Create a docs type branch:
   ```bash
   git checkout -b docs/use
   ```
   
   ![Branch Creation](docs/docs-1.png)
   *Figure 1: New branch creation result - The branch is created and a guidance message for PR creation is displayed.*

2. Commit and push changes:
   ```bash
   autopr commit -a
   ```
   
   ![Commit Changes](docs/docs-2.png)
   *Figure 2: Commit and push result - AI automatically generates a commit message, and after confirmation, changes are pushed to the remote repository.*

### Creating and Merging PR

3. Create PR:
   ```bash
   autopr new
   ```
   
   ![PR Creation](docs/docs-3.png)
   *Figure 3: PR creation result - Branch pattern is matched, AI generates PR description, and PR is created on GitHub.*

4. Merge PR:
   ```bash
   autopr merge 17  # 17 is the PR number created above
   ```
   
   ![PR Merge](docs/docs-4.png)
   *Figure 4: PR merge result - PR information confirmed, conflict check performed, successfully merged, and local branch cleaned up.*

### GitHub PR Automatic Review

If you selected the GitHub Actions workflow setup during initialization, code reviews will be automatically performed when PRs are created or updated. This experimental feature provides the following benefits:

- Delivers comprehensive code review summaries for the entire PR
- Automatically adds inline comments on specific code lines
- Detects code quality issues, bugs, security concerns automatically
- Provides reviews in the user's locale language

The GitHub Actions workflow is automatically created in the `.github/workflows/pr-review.yml` file and works immediately without additional configuration.

### Creating and Merging Release Branch

5. Create release branch:
   ```bash
   git checkout -b release/merge
   ```
   
   ![Release Branch Creation](docs/docs-5.png)
   *Figure 5: Release branch creation result - New release branch is created and guidance for PR creation is displayed.*