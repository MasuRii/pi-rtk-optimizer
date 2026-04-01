# pi-rtk-optimizer

> RTK command rewriting and tool output compaction extension for the Pi coding agent.

<img width="1360" height="752" alt="image" src="https://github.com/user-attachments/assets/f4536889-62ec-429a-984e-dc0de9f1f709" />


**pi-rtk-optimizer** automatically rewrites `bash` tool commands to their `rtk` equivalents and compacts noisy tool output (`bash`, `read`, `grep`) to reduce context window usage while preserving actionable information for the AI agent.

## Features

### Command Rewriting

- **Automatic rewriting** or **suggestion-only** mode for common development workflows
- Supported command categories:
  - **Git/GitHub** — `git`, `gh` commands
  - **Filesystem** — `cat`, `head`, `tail`, `grep`, `rg`, `ls`, `tree`, `find`, `diff`, `wc`, `bash`, `cmd`, `powershell`
  - **Rust** — `cargo` commands
  - **JavaScript** — `vitest`, `npm`, `yarn`, `pnpm`, `bun` commands
  - **Python** — `pytest`, `python`, `pip`, `uv` commands
  - **Go** — `go` commands
  - **Containers** — `docker`, `docker-compose`, `podman` commands
  - **Network** — `curl`, `wget` commands
  - **Package Managers** — `apt`, `brew`, `dnf`, `pacman`, `yum` commands
- Runtime guard when `rtk` binary is unavailable (falls back to original commands only in rewrite mode)
- Safe rewrite bypasses for structured `gh` output commands and non-interactive container shell sessions
- Improved command parsing for `sed`, shell separators, and `pnpm dlx` proxy rewrites

### Output Compaction Pipeline

Multi-stage pipeline to reduce token consumption:

| Stage | Description |
|-------|-------------|
| ANSI Stripping | Removes terminal color/formatting codes |
| Test Aggregation | Summarizes test runner output (pass/fail counts) |
| Build Filtering | Extracts errors/warnings from build output |
| Git Compaction | Condenses `git status`, `git log`, `git diff` output |
| Linter Aggregation | Summarizes linting tool output |
| Search Grouping | Groups `grep`/`rg` results by file |
| Source Code Filtering | `none`, `minimal`, or `aggressive` comment/whitespace removal with userscript metadata preservation |
| Smart Truncation | Preserves file boundaries and important lines while keeping 80-line reads exact |
| Hard Truncation | Final character limit enforcement |

### Interactive Settings

- TUI settings modal via `/rtk` command
- Real-time configuration changes without restart
- Command completions for all subcommands

### Session Metrics

- Tracks compaction savings per tool type
- View statistics with `/rtk stats`

## Installation

### Local Extension Folder

Place this folder in one of the following locations:

```
~/.pi/agent/extensions/pi-rtk-optimizer     # Global (all projects)
.pi/extensions/pi-rtk-optimizer              # Project-specific
```

Pi auto-discovers extensions in these paths on startup.

### npm Package

```bash
pi install npm:pi-rtk-optimizer
```

### Git Repository

```bash
pi install git:github.com/MasuRii/pi-rtk-optimizer
```

## Usage

### Settings Modal

Open the interactive settings modal:

```
/rtk
```

Use arrow keys to navigate settings, Enter to cycle values, and Escape to close.

### Subcommands

| Command | Description |
|---------|-------------|
| `/rtk` | Open settings modal |
| `/rtk show` | Display current configuration and runtime status |
| `/rtk path` | Show config file path |
| `/rtk verify` | Check if `rtk` binary is available |
| `/rtk stats` | Show output compaction metrics for current session |
| `/rtk clear-stats` | Reset compaction metrics |
| `/rtk reset` | Reset all settings to defaults |
| `/rtk help` | Display usage help |

## Configuration

Configuration is stored at:

```
~/.pi/agent/extensions/pi-rtk-optimizer/config.json
```

A starter template is included at `config/config.example.json`.

### Configuration Options

#### Top-Level Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch for all extension features |
| `mode` | string | `"rewrite"` | `"rewrite"` (auto-rewrite) or `"suggest"` (notify only) |
| `guardWhenRtkMissing` | boolean | `true` | Run original commands when rtk binary unavailable |
| `showRewriteNotifications` | boolean | `true` | Show rewrite notices in TUI |

#### Rewrite Category Toggles

| Option | Default | Commands Affected |
|--------|---------|-------------------|
| `rewriteGitGithub` | `true` | `git`, `gh` |
| `rewriteFilesystem` | `true` | `cat`, `head`, `tail`, `grep`, `rg`, `ls`, `tree`, `find`, `diff`, `wc` |
| `rewriteRust` | `true` | `cargo` |
| `rewriteJavaScript` | `true` | `vitest`, `npm`, `yarn`, `pnpm`, `bun` |
| `rewritePython` | `true` | `pytest`, `python`, `pip`, `uv` |
| `rewriteGo` | `true` | `go` |
| `rewriteContainers` | `true` | `docker`, `docker-compose`, `podman` |
| `rewriteNetwork` | `true` | `curl`, `wget` |
| `rewritePackageManagers` | `true` | `apt`, `brew`, `dnf`, `pacman`, `yum` |

#### Output Compaction Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `outputCompaction.enabled` | boolean | `true` | Enable output compaction pipeline |
| `outputCompaction.stripAnsi` | boolean | `true` | Remove ANSI escape codes |
| `outputCompaction.sourceCodeFilteringEnabled` | boolean | `true` | Enable source code filtering for `read` output |
| `outputCompaction.preserveExactSkillReads` | boolean | `false` | Keep reads under Pi skill directories exact, bypassing read compaction |
| `outputCompaction.sourceCodeFiltering` | string | `"minimal"` | Filter level: `"none"`, `"minimal"`, `"aggressive"` |
| `outputCompaction.aggregateTestOutput` | boolean | `true` | Summarize test runner output |
| `outputCompaction.filterBuildOutput` | boolean | `true` | Filter build/compile output |
| `outputCompaction.compactGitOutput` | boolean | `true` | Compact git command output |
| `outputCompaction.aggregateLinterOutput` | boolean | `true` | Summarize linter output |
| `outputCompaction.groupSearchOutput` | boolean | `true` | Group search results by file |
| `outputCompaction.trackSavings` | boolean | `true` | Track compaction metrics |

#### Truncation Settings

| Option | Type | Default | Range | Description |
|--------|------|---------|-------|-------------|
| `outputCompaction.smartTruncate.enabled` | boolean | `true` | — | Enable smart line-based truncation |
| `outputCompaction.smartTruncate.maxLines` | number | `220` | 40–4000 | Maximum lines after smart truncation |
| `outputCompaction.truncate.enabled` | boolean | `true` | — | Enable hard character truncation |
| `outputCompaction.truncate.maxChars` | number | `12000` | 1000–200000 | Maximum characters in final output |

### Source Code Filtering Levels

| Level | Behavior |
|-------|----------|
| `none` | No filtering applied |
| `minimal` | Removes non-doc comments, collapses blank lines |
| `aggressive` | Also removes imports, keeps only signatures and key logic |

> **Note:** If file edits fail because "old text does not match," disable source filtering via `/rtk`, re-read the file, apply the edit, then re-enable filtering.

### Example Configuration

```json
{
  "enabled": true,
  "mode": "rewrite",
  "guardWhenRtkMissing": true,
  "showRewriteNotifications": true,
  "rewriteGitGithub": true,
  "rewriteFilesystem": true,
  "rewriteRust": true,
  "rewriteJavaScript": true,
  "rewritePython": true,
  "rewriteGo": true,
  "rewriteContainers": true,
  "rewriteNetwork": true,
  "rewritePackageManagers": true,
  "outputCompaction": {
    "enabled": true,
    "stripAnsi": true,
    "sourceCodeFilteringEnabled": true,
    "preserveExactSkillReads": false,
    "sourceCodeFiltering": "minimal",
    "aggregateTestOutput": true,
    "filterBuildOutput": true,
    "compactGitOutput": true,
    "aggregateLinterOutput": true,
    "groupSearchOutput": true,
    "trackSavings": true,
    "smartTruncate": {
      "enabled": true,
      "maxLines": 220
    },
    "truncate": {
      "enabled": true,
      "maxChars": 12000
    }
  }
}
```

## Technical Details

### Architecture

```
index.ts                    # Pi auto-discovery entrypoint
src/
├── index.ts                # Extension bootstrap and event wiring
├── config-store.ts         # Config load/save with normalization
├── config-modal.ts         # TUI settings modal and /rtk handler
├── command-rewriter.ts     # Command tokenization and rewrite logic
├── rewrite-bypass.ts       # Rewrite safety bypass rules for interactive/structured commands
├── rewrite-rules.ts        # Rewrite rule catalog
├── runtime-guard.ts        # Runtime availability guard helpers for rewrite mode
├── output-compactor.ts     # Tool result compaction pipeline
├── output-metrics.ts       # Savings tracking and reporting
├── command-completions.ts  # /rtk subcommand completions
├── windows-command-helpers.ts  # Windows bash compatibility
└── techniques/             # Compaction technique implementations
    ├── ansi.ts             # ANSI code stripping
    ├── build.ts            # Build output filtering
    ├── test-output.ts      # Test output aggregation
    ├── linter.ts           # Linter output aggregation
    ├── git.ts              # Git output compaction
    ├── search.ts           # Search result grouping
    ├── source.ts           # Source code filtering
    └── truncate.ts         # Smart and hard truncation
```

### Event Hooks

The extension hooks into Pi's event system:

- **`beforeToolCall`** — Rewrites bash commands to rtk equivalents
- **`afterToolResult`** — Compacts tool output before context consumption
- **`command`** — Handles `/rtk` command and subcommands

### Windows Compatibility

Automatic fixes applied on Windows:

- `cd /d <path>` → `cd "<normalized-path>"` (converts backslashes)
- Prepends `PYTHONIOENCODING=utf-8` for Python commands

### Dependencies

- **Peer dependencies:** `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`
- **Runtime:** Node.js ≥20, optional `rtk` binary for command rewriting

## Development

```bash
# Build
npm run build

# Full typecheck
npm run typecheck

# Run tests
npm run test

# Full verification
npm run check

# Bundle sanity check
npm run build:check
```

## Credits

Inspired by:
- [mcowger/pi-rtk](https://github.com/mcowger/pi-rtk)
- [rtk-ai/rtk](https://github.com/rtk-ai/rtk)

## Related Pi Extensions

- [pi-tool-display](https://github.com/MasuRii/pi-tool-display) — Compact tool rendering and diff visualization
- [pi-permission-system](https://github.com/MasuRii/pi-permission-system) — Permission enforcement for tool and command access
- [pi-smart-voice-notify](https://github.com/MasuRii/pi-smart-voice-notify) — Multi-channel TTS and sound notifications
- [pi-image-tools](https://github.com/MasuRii/pi-image-tools) — Image attachment and inline preview

## License

[MIT](LICENSE) © MasuRii
