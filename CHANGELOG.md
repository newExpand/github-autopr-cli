# Change Log

## 0.1.23

- Updated OpenRouter Free AI Model
  - Changed from Gemini Flash to Qwen 3.0 (30B) model
  - Updated model identifier to "qwen/qwen3-30b-a3b:free"
  - Adjusted model description for improved clarity
  - Maintained all free tier benefits with enhanced capabilities
  - Updated related language strings in localization files
- Enhanced PR Title Generation
  - Changed token limit from 100 to `getMaxTokens("chunk")`
  - Improved title generation stability for large changes
  - Fixed title generation failures due to token limit constraints

## 0.1.22

- Enhanced AI Provider Configuration Priority
  - Modified AI configuration loading logic in `AIFeatures` class
  - Improved configuration priority order: project config (.autopr.json) > .env file > default settings
  - Added comprehensive error handling in configuration loading process
  - Enhanced debugging with detailed log messages for configuration source identification
  - Fixed issue where environment variables would override project configuration settings
  - Added graceful fallback to OpenRouter when configuration errors occur

## 0.1.21

- Improved Daily Commit Report Feature
  - Fixed AI Summary Display Issue
    - Resolved issue where generated AI summaries weren't displaying in console
    - Enhanced standard output mechanism (`console.log` → `process.stdout.write`)
    - Fixed complex markdown rendering issues in console environments
  - Strengthened Commit Analysis Stability
    - Fixed type errors in date sorting functionality
    - Improved commit sorting logic with better code block structure

## 0.1.20

- Package size optimization (0.1.18: 340KB → 0.1.19: 695KB → 0.1.20: 216.8KB)
  - Achieved 36% size reduction from 0.1.19 which had increased package size
  - Applied aggressive tree shaking (preset: 'smallest')
  - Enabled code minification (minify: true)
  - Disabled sourcemaps (sourcemap: false)
  - Enabled code splitting (splitting: true)
  - Eliminated development logs and legal comments
  - Removed duplicate locale files
  - Streamlined i18n file distribution to single path
  - Optimized package file inclusion
- Enhanced i18n module
  - Strengthened multi-path resolution for locales
  - Added fallback translations when locale files not found
  - Added support for global installation environment paths
  - Improved file loading exception handling

## 0.1.19

- Enhanced Build System
  - Introduced tsup bundler for faster build times
  - Applied tree shaking for package optimization
  - Improved ES modules support
  - Optimized i18n file handling
  - Automated build process
  - Eliminated unnecessary duplicate builds

## 0.1.18

- Improved AI Manager Structure
  - Refactored AI provider initialization logic using strategy pattern
  - Separated provider-specific code into dedicated methods for better maintainability
  - Enhanced extensibility for adding new AI providers
  - Introduced mapping structure for initialization logic configuration
  - Strengthened exception handling
  - Isolated OpenRouter key status check logic

## 0.1.17

- Enhanced Initialization Process
  - Automated Git hooks setup during initialization
  - Automated Release PR template configuration
  - Removed manual hook setup and template customization prompts
  - Added automatic setup status notifications
  - Improved user experience with streamlined setup flow
  - Standardized post-checkout hook installation
  - Simplified onboarding with fewer configuration questions

## 0.1.16

- Enhanced Multi-language Documentation
  - Added Korean documentation links to English documents
  - Added Korean README and branch strategy guide links in English README
  - Added detailed description of Korean documentation in multi-language support section
  - Improved documentation accessibility
- Improved Document Structure
  - Moved change log to separate CHANGELOG files
  - Enhanced README file conciseness
  - Standardized documentation

## 0.1.15

- Branch Management Workflow Documentation
  - Added detailed GitFlow-based branch strategy guide (USAGE.md/USAGE-kr.md)
  - Provided standard workflow examples from branch creation to merging
  - Added screenshots of key command execution results
  - Included real PR example links
  - Detailed branch patterns and naming conventions
- README Improvements
  - Added Branch Management Workflow section
  - Added USAGE document links and summary
  - Optimized document structure

## 0.1.14

- Documentation Updates
  - Fixed parameter notation consistency in README files
  - Updated `autopr commit -sp` command documentation
  - Synchronized English and Korean documentation

## 0.1.13

- Added Daily Commit Report Generation
  - Implemented new `autopr daily-report` command
  - Provides AI-generated summaries of daily commit activities
  - Offers date selection from recent commit history
  - Includes detailed statistics (files changed, lines added/deleted)
  - Generates reports in multiple formats (console, JSON, markdown)
  - Supports both local and remote repository commits
- Improved Merge Conflict Resolution Experience
  - Simplified conflict resolution workflow
  - Removed unnecessary automatic file opening logic
  - Enhanced step-by-step guidance with clear Git commands
  - Added better conflict marker explanations
  - Maintained valuable AI-powered conflict resolution suggestions
  - Improved multilingual support for conflict resolution
  - Added helpful documentation links for resolving conflicts
- Added interactive PR selection to list command
  - Select PRs directly from the terminal
  - Quick access to review, merge, update actions
  - Improved workflow efficiency
- Enhanced display of PR information
  - Better formatting of PR list
  - Numbered list for easier reference
- Enhanced PR Pagination
  - Improved page-by-page loading for managing large numbers of PRs
  - Added option to continuously load more PRs as needed
  - Support for loading up to 10 pages of PRs
  - Clear page loading status indicators
- Enhanced Commit Process
  - Fixed interruption handling with Ctrl+C/Command+C to safely cancel commit operations
  - Resolved issue where the commit process would continue after cancellation
  - Added clear cancellation messages for better user feedback
  - Implemented consistent cancellation handling across all prompts
- Enhanced Localization
  - Updated translations for conflict resolution
  - Improved language consistency
  - Added missing translation keys
  - Added comprehensive translations for interactive features
- General Performance Improvements
  - Reduced unnecessary code complexity
  - Enhanced error handling
  - Improved cross-platform compatibility

## 0.1.12

- Re-enabled File Selection with Auto-Push Feature
  - Added functionality to select specific files to stage, commit, and automatically push to origin
  - Updated option: `-sp`, `--selectpush` option provided
  - Improved Commander.js option handling for greater stability
  - Excluded branch selection feature (push only to current branch)
  - Maintained automatic `-u` option for non-existing remote branches

## 0.1.11

- Temporary Disabled Branch Selection Push Feature
  - Implemented to resolve branch conflict issues
  - Changed to push only to current branch
  - Automatically added `-u` option for non-existing remote branches
  - Temporarily removed related options:
    - Disabled `-sp`, `--select-push` option
    - Disabled branch selection prompt
  - Planned future update with improved branch management logic

## 0.1.10

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

## 0.1.9

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

## 0.1.8

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

## 0.1.7

- Enhanced commit message generation
  - Added full file path support in commit messages
  - Improved file tracking to prevent omissions
  - Enhanced commit message format consistency
  - Added comprehensive changed files list in commit analysis
- Improved i18n support
  - Synchronized English and Korean translations
  - Enhanced error message consistency
  - Added missing translation keys

## 0.1.6

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

## 0.1.5

- Enhanced Draft PR availability check
  - Automatic detection of Draft PR availability based on repository visibility
  - Improved support for public/private repositories
- Enhanced AI title generation
  - Added title generation process logging
  - Improved fallback logic for title generation failures
  - Enhanced debugging information 