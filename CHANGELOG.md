# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.0.5](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.4...v0.0.5) (2026-03-05)


### Features

* add LlamaCpp args input and save options checkbox for model loading ([cc60b1d](https://github.com/james-martinez/lemonade-dashboard/commit/cc60b1ddb51e6e15f625d8634672f51f875a5768))

### [0.0.4](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.3...v0.0.4) (2026-03-04)


### Features

* add pre-configured model selection to pull model view ([e50f0bf](https://github.com/james-martinez/lemonade-dashboard/commit/e50f0bf1c4fe3b0e2bdec33bd5639c493d48320c))

### [0.0.3](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.2...v0.0.3) (2026-03-04)

### Chores

* update versioning ([56a5dab](https://github.com/james-martinez/lemonade-dashboard/commit/56a5dab))

## [0.0.2] - 2026-03-04

### Added
- GitHub Actions workflow for automated publishing on tags and GitHub Release creation.
- Webview-based management dashboard for Lemonade Server.
- Activity bar icon and explorer view for easy access.
- Commands for opening server settings.
- Configuration options for Server URL, API Token, and default tab.
- Screenshot of the dashboard in documentation.

### Changed
- Major refactoring of [`src/extension.ts`](src/extension.ts) to implement the dashboard logic.
- Updated [`package.json`](package.json) with categories, contributions, and engine requirements.
- Switched to webpack for production builds.

### Removed
- Unused test files and configurations (`eslint.config.mjs`, `.vscode-test.mjs`, `src/test/extension.test.ts`).
- Temporary scripts and assets (`convert_icon.js`, `media/lemon.svg`).

## [0.0.1] - 2026-03-03

- Initial release