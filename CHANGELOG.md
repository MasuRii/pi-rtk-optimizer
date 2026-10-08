# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Tool output compaction no longer silently no-ops on pi installs/forks that expose the built-in grep tool under the alias `search` instead of `grep`. Previously, `compactToolResult` only recognized the literal toolName `"grep"`, so `truncate.maxChars`, `smartTruncate`, and `groupSearchOutput` were never applied to `search` tool calls on affected installs — letting a single oversized ripgrep match line (e.g. a minified HTML/JSON file with no line breaks) reach the model uncompacted and spike context usage by hundreds of thousands of tokens in one turn.

## [0.9.0] - 2026-07-03

### Changed
- Extracted a lazy module loader, shell-quote state machine, compaction state, and content-block helpers. ([4229513](https://github.com/MasuRii/pi-rtk-optimizer/commit/422951343759b47e81443273731469481723365f) [8c39b94](https://github.com/MasuRii/pi-rtk-optimizer/commit/8c39b94965879aef5c39ab74d19c6ff20f437e02))
- Consolidated the config store and extracted border-line rendering in the Zellij modal. ([ccdee3d](https://github.com/MasuRii/pi-rtk-optimizer/commit/ccdee3df3a36246941bace9b138dc93e38a6363b) [762ee6a](https://github.com/MasuRii/pi-rtk-optimizer/commit/762ee6a9ca1e68fc4f705532d87c4130a337985c))
- Renamed inline test files to the `.test.ts` convention. ([25ec5eb](https://github.com/MasuRii/pi-rtk-optimizer/commit/25ec5eb361d9d22404f08f9d6186677fdcbd2c74))
- Added the owned extension directory to `.gitignore`. ([af2e851](https://github.com/MasuRii/pi-rtk-optimizer/commit/af2e85173379fb46e3a2c4ada23bec9de0b47aa0))
- Updated README with badges, a Ko-fi link, and a refreshed file tree. ([e70ca70](https://github.com/MasuRii/pi-rtk-optimizer/commit/e70ca70de7925cc56a02c6d7c43a2065b2ebc74f))
- Widened Pi peer dependency compatibility to include `^0.80.0` and added vulnerability overrides (`protobufjs`, `ws`). ([92137b2](https://github.com/MasuRii/pi-rtk-optimizer/commit/92137b2689988c64922478176ff60396e35efff2))

### Fixed
- Ignored string and comment braces in source filtering. ([85fbd28](https://github.com/MasuRii/pi-rtk-optimizer/commit/85fbd28edceb780d254ea0dc6cb2b31c6f572b37))
- Counted Unicode pass/fail symbols in the test-output fallback. ([b59b18d](https://github.com/MasuRii/pi-rtk-optimizer/commit/b59b18d26d83a016cc2fd04ffab8e80b50540f54))

### Removed
- Removed the emoji and rtk-hook-warning techniques. ([8f07417](https://github.com/MasuRii/pi-rtk-optimizer/commit/8f07417d1d539fd62cb97cd4e30431a45f819642))
- Removed the unused ripgrep rewrite. ([ccdee3d](https://github.com/MasuRii/pi-rtk-optimizer/commit/ccdee3df3a36246941bace9b138dc93e38a6363b))

## [0.8.3] - 2026-06-16

### Fixed
- Added a runtime-agnostic `mock.module` shim so tests using `node:test` module mocking also pass under Bun's `bun:test` compatibility layer.
- Deep-cloned fallback default config objects in `config-store.ts` to prevent caller mutations from leaking into subsequent config loads.

## [0.8.2] - 2026-06-01

### Changed
- Deferred output compactor and configuration modal loading during extension bootstrap.
- Replaced technique barrel imports with direct module imports.
- Kept inline test entrypoints on Bun while using a runtime-agnostic test helper for compatibility.
- Widened Pi peer dependency ranges to include `^0.77.0 || ^0.78.0`.

## [0.8.1] - 2026-05-26

### Changed
- Widened `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` peer dependency ranges to `^0.74.0 || ^0.75.0`.

## [0.8.0] - 2026-05-22

### Added
- Added tabbed `/rtk` settings modal groups with left/right tab navigation and context-aware help for search and value changes.
- Added anchor-safe `read` compaction that detects hashline/anchored read output and preserves complete edit anchors during source filtering, smart truncation, and hard truncation.

### Changed
- Updated package metadata and lockfile version to `0.8.0` and migrated Pi peer dependency metadata to the `@earendil-works` scope.

## [0.7.1] - 2026-05-04

### Changed
- Clarified the README architecture inventory for delegated `rtk rewrite` ownership and documented Bun as a development verification prerequisite.
- Pinned TypeScript and esbuild as dev dependencies so build and bundle checks use locked local tooling.
- Added RTK executable path visibility to runtime verification output and documented audit/debug config expectations.

### Fixed
- Hardened `RTK_DB_PATH` shell quoting against inherited temp paths containing command-substitution syntax.
- Made the custom test helper await async tests before reporting pass.
- Preserved RTK rewrite error details through the extension's existing UI warning path.
- Expanded Windows command and rewritten-pipeline fixups for leading compound-command cases.
- Normalized compaction technique return handling while preserving existing output behavior.
- Added lifecycle and vendored modal regression coverage for high-risk extension event paths.

## [0.7.0] - 2026-04-30

### Added
- Added opt-in `readCompaction` controls for `read` output so lossy source filtering and smart truncation stay disabled unless explicitly enabled.

### Changed
- Updated README and example configuration defaults for safer read-compaction behavior and troubleshooting guidance.
- Updated `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` peer dependencies to ^0.72.0.

## [0.6.0] - 2026-04-27

### Changed
- **Breaking:** Command rewriting now delegates rewrite decisions to the installed `rtk rewrite` command, making RTK the source of truth for command support, shell parsing, bypasses, and compound-command behavior instead of the extension's local rewrite rule tables.

### Removed
- **Breaking:** Removed the rewrite category configuration surface (`rewriteGitGithub`, `rewriteFilesystem`, `rewriteRust`, `rewriteJavaScript`, `rewritePython`, `rewriteGo`, `rewriteContainers`, `rewriteNetwork`, and `rewritePackageManagers`) from configuration normalization, examples, settings UI, and documentation. Configure rewrite policy in RTK itself instead of this extension.

## [0.5.5] - 2026-04-24

### Changed
- Config path resolution now uses Pi's `getAgentDir()` API so `PI_CODING_AGENT_DIR` is respected for extension config paths (thanks to @tynanbe for PR #3).
- Global skill-read preservation paths now resolve through Pi's agent directory so `PI_CODING_AGENT_DIR` is respected (thanks to @tynanbe for PR #3).
- Source-filter troubleshooting note injection now only runs when output compaction, source filtering, and read truncation safeguards are active (thanks to @philipbjorge for PR #4).
- Updated `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` peer dependencies to ^0.70.0.
- Clarified README and settings modal copy for global extension/config paths, skill directory paths, source-filter note behavior, architecture, and event hooks.

### Removed
- Removed the unused local asset directory.
- Removed the `session_switch` event refresh handler.

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
