# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### v0.0.12 (2026-03-22)

## What's Changed
* fix(release): update package version before publishing extension by @james-martinez in https://github.com/james-martinez/lemonade-dashboard/pull/19


**Full Changelog**: https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.11...v0.0.12

### [0.0.9](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.8...v0.0.9) (2026-03-12)


### Features

* add GUI to manage server configurations ([68751db](https://github.com/james-martinez/lemonade-dashboard/commit/68751db394a8d84aff54c19e2f287b57d89ac97f))
* add GUI to manage server configurations ([6193538](https://github.com/james-martinez/lemonade-dashboard/commit/6193538f9b33d2abe0465a28f693e86822522720))
* add GUI to manage server configurations ([aebf15b](https://github.com/james-martinez/lemonade-dashboard/commit/aebf15b24dd2152ce2e1ed7a9b623eb49ccdca7e))
* add GUI to manage server configurations ([44b8c40](https://github.com/james-martinez/lemonade-dashboard/commit/44b8c4005081a27f8fe8df6703c3ecac8fc9672f))

### [0.0.8](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.7...v0.0.8) (2026-03-09)


### Features

* support multiple servers configuration and active server selection via dropdown ([175c5bb](https://github.com/james-martinez/lemonade-dashboard/commit/175c5bb8f56870dd58aa1c3c5e8a2d04c79a7386))

### [0.0.7](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.6...v0.0.7) (2026-03-07)

#### Bug Fixes

* **security:** escape GitHub release version and model metadata in webview to prevent XSS ([bcea870](https://github.com/james-martinez/lemonade-dashboard/commit/bcea870))
* Fix XSS vulnerability in extension webview by escaping model properties ([f7e16a2](https://github.com/james-martinez/lemonade-dashboard/commit/f7e16a2))
* Fix chat completions API endpoint path ([b45f257](https://github.com/james-martinez/lemonade-dashboard/commit/b45f257))

#### Features

* Add unit tests for getLemonadeConfig ([b1e7353](https://github.com/james-martinez/lemonade-dashboard/commit/b1e7353))

#### Performance

* Cache redundant GitHub API fetch in polling loop ([856bf27](https://github.com/james-martinez/lemonade-dashboard/commit/856bf27))

#### Chores

* Implement missing client-side validation in webview ([7929361](https://github.com/james-martinez/lemonade-dashboard/commit/7929361))
* Remove empty deactivate function ([9fc3c7f](https://github.com/james-martinez/lemonade-dashboard/commit/9fc3c7f))

### [0.0.6](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.5...v0.0.6) (2026-03-06)


### Features

* add LlamaCpp backend input and refactor saved model options ([f15d12e](https://github.com/james-martinez/lemonade-dashboard/commit/f15d12e72544b2120623a5501609f5ede8fbce33))

### [0.0.5](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.4...v0.0.5) (2026-03-05)


### Features

* add LlamaCpp args input and save options checkbox for model loading ([cc60b1d](https://github.com/james-martinez/lemonade-dashboard/commit/cc60b1ddb51e6e15f625d8634672f51f875a5768))

### [0.0.4](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.3...v0.0.4) (2026-03-04)


### Features

* add pre-configured model selection to pull model view ([e50f0bf](https://github.com/james-martinez/lemonade-dashboard/commit/e50f0bf1c4fe3b0e2bdec33bd5639c493d48320c))

### [0.0.3](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.2...v0.0.3) (2026-03-04)

### Chores

* update versioning ([56a5dab](https://github.com/james-martinez/lemonade-dashboard/commit/56a5dab))

### [0.0.2](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.1...v0.0.2) (2026-03-04)

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

### [0.0.1](https://github.com/james-martinez/lemonade-dashboard/compare/v0.0.0...v0.0.1) (2026-03-03)

- Initial release
