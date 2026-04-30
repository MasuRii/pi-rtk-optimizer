# pi-rtk-optimizer

[![npm version](https://img.shields.io/npm/v/pi-rtk-optimizer?style=flat-square)](https://www.npmjs.com/package/pi-rtk-optimizer) [![License](https://img.shields.io/github/license/MasuRii/pi-rtk-optimizer?style=flat-square)](LICENSE)

> RTK command rewriting and tool output compaction extension for the Pi coding agent.

<img width="1360" height="752" alt="image" src="https://github.com/user-attachments/assets/f4536889-62ec-429a-984e-dc0de9f1f709" />


**pi-rtk-optimizer** automatically rewrites `bash` tool commands to their `rtk` equivalents and compacts noisy tool output (`bash`, `read`, `grep`) to reduce context window usage while preserving actionable information for the AI agent.

## Features

### Command Rewriting

- **Automatic rewriting** or **suggestion-only** mode for common development workflows
- Delegates bash command rewrite decisions to the installed `rtk rewrite` command, keeping RTK as the source of truth for supported commands, shell parsing, bypasses, and compound-command behavior
- Runtime guard when `rtk` binary is unavailable (raw commands run unchanged and repeated missing-binary rewrite probes are avoided)
- Pi-specific shell safety fixups for rewritten commands on Windows

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

```text
~/.pi/agent/extensions/pi-rtk-optimizer                 # Global default (when PI_CODING_AGENT_DIR is unset)
$PI_CODING_AGENT_DIR/extensions/pi-rtk-optimizer        # Global when PI_CODING_AGENT_DIR is set
.pi/extensions/pi-rtk-optimizer                         # Project-specific
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

```text
Default global path: ~/.pi/agent/extensions/pi-rtk-optimizer/config.json
Actual global path: $PI_CODING_AGENT_DIR/extensions/pi-rtk-optimizer/config.json when PI_CODING_AGENT_DIR is set
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

#### Rewrite Source

Bash command support is intentionally resolved by the installed `rtk` binary through `rtk rewrite`. The extension does not maintain duplicate rewrite rules or category classifiers; update/configure RTK itself for command support policy.

> **Breaking in 0.6.0:** Rewrite category toggles (`rewriteGitGithub`, `rewriteFilesystem`, `rewriteRust`, `rewriteJavaScript`, `rewritePython`, `rewriteGo`, `rewriteContainers`, `rewriteNetwork`, and `rewritePackageManagers`) were removed from the extension config surface. Existing rewrite policy should be configured in RTK because the extension now delegates rewrite ownership to `rtk rewrite`.

#### Output Compaction Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `outputCompaction.enabled` | boolean | `true` | Enable output compaction pipeline |
| `outputCompaction.stripAnsi` | boolean | `true` | Remove ANSI escape codes |
| `outputCompaction.readCompaction.enabled` | boolean | `false` | Enable lossy compaction for `read` output; defaults off so code reads stay exact |
| `outputCompaction.sourceCodeFilteringEnabled` | boolean | `false` | Enable source code filtering for `read` output when read compaction is enabled |
| `outputCompaction.preserveExactSkillReads` | boolean | `false` | Keep reads under configured Pi/global/project skill directories exact, bypassing read compaction |
| `outputCompaction.sourceCodeFiltering` | string | `"none"` | Filter level: `"none"`, `"minimal"`, `"aggressive"` |
| `outputCompaction.aggregateTestOutput` | boolean | `true` | Summarize test runner output |
| `outputCompaction.filterBuildOutput` | boolean | `true` | Filter build/compile output |
| `outputCompaction.compactGitOutput` | boolean | `true` | Compact git command output |
| `outputCompaction.aggregateLinterOutput` | boolean | `true` | Summarize linter output |
| `outputCompaction.groupSearchOutput` | boolean | `true` | Group search results by file |
| `outputCompaction.trackSavings` | boolean | `true` | Track compaction metrics |

Skill-read preservation covers the global Pi skills directory (`~/.pi/agent/skills` by default, or `$PI_CODING_AGENT_DIR/skills` when set), `~/.agents/skills`, project `.pi/skills`, and ancestor `.agents/skills` directories.

#### Truncation Settings

| Option | Type | Default | Range | Description |
|--------|------|---------|-------|-------------|
| `outputCompaction.smartTruncate.enabled` | boolean | `false` | — | Enable smart line-based truncation for read output when read compaction is enabled |
| `outputCompaction.smartTruncate.maxLines` | number | `220` | 40–4000 | Maximum lines after smart truncation |
| `outputCompaction.truncate.enabled` | boolean | `true` | — | Enable hard character truncation |
| `outputCompaction.truncate.maxChars` | number | `12000` | 1000–200000 | Maximum characters in final output |

### Source Code Filtering Levels

| Level | Behavior |
|-------|----------|
| `none` | No filtering applied |
| `minimal` | Removes non-doc comments, collapses blank lines |
| `aggressive` | Also removes imports, keeps only signatures and key logic |

> **Note:** When read compaction, source filtering, and read truncation safeguards are active, Pi injects a troubleshooting note for repeated file-edit mismatches. If edits fail because "old text does not match," disable read compaction via `/rtk`, re-read the file, apply the edit, then re-enable compaction.

### Example Configuration

```json
{
  "enabled": true,
  "mode": "rewrite",
  "guardWhenRtkMissing": true,
  "showRewriteNotifications": true,
  "outputCompaction": {
    "enabled": true,
    "stripAnsi": true,
    "readCompaction": {
      "enabled": false
    },
    "sourceCodeFilteringEnabled": false,
    "preserveExactSkillReads": false,
    "sourceCodeFiltering": "none",
    "aggregateTestOutput": true,
    "filterBuildOutput": true,
    "compactGitOutput": true,
    "aggregateLinterOutput": true,
    "groupSearchOutput": true,
    "trackSavings": true,
    "smartTruncate": {
      "enabled": false,
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
├── command-rewriter.ts         # Command tokenization and rewrite logic
├── rewrite-bypass.ts           # Rewrite safety bypass rules for interactive/structured commands
├── rewrite-rules.ts            # Rewrite rule catalog
├── rewrite-pipeline-safety.ts  # Shell-safety fixups for rewritten commands
├── rtk-command-environment.ts  # RTK_DB_PATH scoping for rewritten commands
├── shell-env-prefix.ts         # Environment assignment parsing helpers
├── runtime-guard.ts            # Runtime availability guard helpers for rewrite mode
├── output-compactor.ts         # Tool result compaction pipeline
├── output-metrics.ts           # Savings tracking and reporting
├── tool-execution-sanitizer.ts # Streaming bash execution output sanitizer
├── command-completions.ts      # /rtk subcommand completions
├── windows-command-helpers.ts  # Windows bash compatibility
└── techniques/                 # Compaction technique implementations
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

- **`tool_call`** — Rewrites bash commands to rtk equivalents or emits suggestions
- **`tool_result`** — Compacts completed tool output before context consumption
- **`tool_execution_start` / `tool_execution_update` / `tool_execution_end`** — Tracks and sanitizes streamed bash output
- **`before_agent_start`** — Conditionally injects source-filter troubleshooting guidance
- **`session_start` / `agent_end`** — Refreshes config and clears in-session tracking state
- **Registered `/rtk` command** — Handles settings, status, verification, stats, and reset subcommands

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
