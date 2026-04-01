# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.3] - 2026-04-01

### Changed
- Updated README.md with new background image source URL
- Aligned npm keywords for better package discoverability
- Added Related Pi Extensions cross-linking section to README

## [0.5.2] - 2026-04-01

### Changed
- Updated `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` peer dependencies to ^0.64.0
- Improved RTK note message to guide users through '/rtk' toggle in Pi TUI

## [0.5.1] - 2026-03-24

### Fixed
- RTK_DB_PATH environment variable now correctly scoped to rewritten producer commands only — Windows commands now use subshell scoping `{ RTK_DB_PATH=...; ... }` instead of leaking the prefix into the rewritten command
- Command rewrite pipeline now applies environment scoping BEFORE shell safety fixups to prevent env prefix stripping

### Added
- `shell-env-prefix.ts` module for splitting leading environment variable assignments from commands
- `splitLeadingEnvAssignments()` function to properly extract `ENV=value` prefixes before command analysis

### Changed
- Refactored `rtk-command-environment.ts` to use the new `splitLeadingEnvAssignments` utility
- Refactored `rewrite-pipeline-safety.ts` to preserve env prefixes when analyzing and rewriting rtk commands

### Tests
- Added test coverage for RTK_DB_PATH scoping on Windows vs Unix platforms
- Verified env prefix is preserved through the rewrite pipeline

## [0.5.0] - 2026-03-23

### Added
- RTK_DB_PATH environment variable support for rewritten commands — enables RTK history database isolation per session
- Tool execution sanitizer to strip RTK self-diagnostics from streamed bash results before TUI rendering
- Tracking of active bash commands by tool call ID for output sanitization
- `rtk-command-environment.ts` module for platform-specific temp directory resolution and shell-safe quoting

### Changed
- Updated `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` peer dependencies to ^0.62.0
- Simplified RTK hook warning detection — removed unused command-specific patterns and consolidated detection logic
- Focus on canonical hook warning messages that RTK emits
- Updated tests to verify simplified behavior and ensure non-hook RTK output is preserved verbatim

### Tests
- Added additional coverage tests for edge cases
- Added tests for output compactor behavior with RTK diagnostics
- Added tests for emoji stripping in RTK output

## [0.4.0] - 2026-03-12

### Added
- Command rewrite bypass system with safety patterns for dangerous operations
- `shouldBypassWholeCommandRewrite` to prevent rewriting of unsafe compound commands
- Bypass patterns for `find`, `grep`, `rg`, `ls` with action detection
- Inline command flag detection for `bash`, `powershell`, and `cmd` shells
- `path-utils` module for cross-technique path handling
- Comprehensive test coverage with shared test helpers
- Additional coverage tests for edge cases

### Changed
- Extended `rewrite-bypass` with bypass patterns for interactive container shells
- Improved command rewriter test coverage
- Removed deprecated `compat-commands` module

## [0.3.3] - 2026-03-07

### Added
- Added rewrite bypass rules for structured `gh` output commands and non-interactive container shell sessions.
- Added dedicated runtime guard helpers and test coverage for rewrite-mode availability behavior.
- Added repository lockfile plus additional command rewriter and runtime guard tests.

### Changed
- Updated README documentation to reflect rewrite bypass behavior, runtime guard semantics, source filtering details, and expanded development verification commands.
- Added a dedicated `typecheck` script and expanded `check` to run typecheck plus the full test suite.
- Routed `pnpm dlx` commands through the RTK proxy path instead of the generic pnpm wrapper.

### Fixed
- Improved command tokenization so `sed` scripts, shell separators, redirects, and background operators do not break later rewrites.
- Preserved exact `read` output at the 80-line smart-truncation threshold instead of compacting boundary-sized results.
- Preserved userscript metadata blocks during source filtering.
- Limited RTK-missing command suppression to rewrite mode so suggest mode still produces guidance.

## [0.3.2] - 2026-03-04

### Fixed
- Use absolute GitHub raw URL for README image to fix npm display

## [0.3.1] - 2026-03-04

### Changed
- Rewrote README.md with professional documentation standards
- Added comprehensive feature documentation, configuration reference, and usage examples

## [0.3.0] - 2026-03-02

### Changed
- Renamed extension/package from `rtk-integration` to `pi-rtk-optimizer` to better reflect its full purpose: RTK command rewrite plus tool-output compaction optimization.
- Updated extension identity references across config path resolution, modal UI labeling, installation commands, package metadata, and build check artifact naming.

## [0.2.0] - 2026-03-02

### Changed
- Reorganized extension into a publish-ready package layout:
  - moved implementation modules into `src/`
  - kept root `index.ts` as stable Pi auto-discovery entrypoint
  - added `config/config.example.json` for distributable config starter
- Vendored modal UI dependency as `src/zellij-modal.ts` so the package no longer depends on sibling extension paths.
- Updated TypeScript project includes for the new modular layout.

### Added
- Public repository scaffolding:
  - `README.md`
  - `CHANGELOG.md`
  - `LICENSE`
  - `.gitignore`
  - `.npmignore`
- Distribution metadata in `package.json`:
  - `description`, `keywords`, `files`, `engines`, `publishConfig`, repository links
  - standard `build`, `lint`, `test`, and `check` scripts
- Credits section referencing upstream inspiration projects:
  - `mcowger/pi-rtk`
  - `rtk-ai/rtk`
