import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { mock } from "bun:test";

import { clearOutputMetrics, getOutputMetricsSummary, trackOutputSavings } from "./output-metrics.ts";
import { runTest } from "./test-helpers.ts";
import { matchesCommandPatterns, normalizeCommandForDetection } from "./techniques/command-detection.ts";
import { compactPath } from "./techniques/path-utils.ts";
import { applyWindowsBashCompatibilityFixes } from "./windows-command-helpers.ts";
import { applyRewrittenCommandShellSafetyFixups } from "./rewrite-pipeline-safety.ts";
import { applyRtkCommandEnvironment } from "./rtk-command-environment.ts";
import { sanitizeStreamingBashExecutionResult } from "./tool-execution-sanitizer.ts";
import { sanitizeRtkEmojiOutput } from "./techniques/emoji.ts";
import { stripRtkHookWarnings } from "./techniques/rtk.ts";

mock.module("@mariozechner/pi-coding-agent", () => ({
	getAgentDir: () => "/tmp/.pi/agent",
}));

const {
	ensureConfigExists,
	getRtkIntegrationConfigPath,
	loadRtkIntegrationConfig,
	normalizeRtkIntegrationConfig,
	saveRtkIntegrationConfig,
} = await import("./config-store.ts");

function makeTempConfigPath(): string {
	return `${getRtkIntegrationConfigPath()}.test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
}

function cleanupFile(path: string): void {
	for (const candidate of [path, `${path}.tmp`]) {
		try {
			if (existsSync(candidate)) {
				unlinkSync(candidate);
			}
		} catch {
			// Ignore cleanup failures in tests.
		}
	}
}

runTest("config-store normalizes invalid values and clamps numeric ranges", () => {
	const normalized = normalizeRtkIntegrationConfig({
		enabled: "yes",
		mode: "invalid",
		rewriteGitGithub: false,
		outputCompaction: {
			stripAnsi: false,
			sourceCodeFilteringEnabled: "sometimes",
			sourceCodeFiltering: "extreme",
			truncate: {
				enabled: true,
				maxChars: 12,
			},
			smartTruncate: {
				enabled: true,
				maxLines: 999_999,
			},
			trackSavings: false,
		},
	});

	assert.equal(normalized.enabled, true);
	assert.equal(normalized.mode, "rewrite");
	assert.equal(Object.hasOwn(normalized, "rewriteGitGithub"), false);
	assert.equal(normalized.outputCompaction.stripAnsi, false);
	assert.equal(normalized.outputCompaction.sourceCodeFilteringEnabled, true);
	assert.equal(normalized.outputCompaction.sourceCodeFiltering, "minimal");
	assert.equal(normalized.outputCompaction.truncate.maxChars, 1_000);
	assert.equal(normalized.outputCompaction.smartTruncate.maxLines, 4_000);
	assert.equal(normalized.outputCompaction.trackSavings, false);
});

runTest("config-store can ensure, save, and reload isolated config files", () => {
	const tempPath = makeTempConfigPath();
	cleanupFile(tempPath);

	try {
		const ensured = ensureConfigExists(tempPath);
		assert.equal(ensured.error, undefined);
		assert.equal(existsSync(tempPath), true);

		const defaultLoad = loadRtkIntegrationConfig(tempPath);
		assert.equal(defaultLoad.warning, undefined);
		assert.equal(defaultLoad.config.mode, "rewrite");

		const saved = saveRtkIntegrationConfig(
			{
				...defaultLoad.config,
				mode: "suggest",
				outputCompaction: {
					...defaultLoad.config.outputCompaction,
					truncate: {
						...defaultLoad.config.outputCompaction.truncate,
						maxChars: 250_000,
					},
				},
			},
			tempPath,
		);
		assert.equal(saved.success, true);

		const reloaded = loadRtkIntegrationConfig(tempPath);
		assert.equal(reloaded.config.mode, "suggest");
		assert.equal(reloaded.config.outputCompaction.truncate.maxChars, 200_000);
		assert.ok(readFileSync(tempPath, "utf-8").endsWith("\n"));
	} finally {
		cleanupFile(tempPath);
	}
});

runTest("config-store falls back to defaults when JSON is invalid", () => {
	const tempPath = makeTempConfigPath();
	cleanupFile(tempPath);

	try {
		writeFileSync(tempPath, "{not valid json", "utf-8");
		const loaded = loadRtkIntegrationConfig(tempPath);
		assert.equal(loaded.config.mode, "rewrite");
		assert.ok((loaded.warning ?? "").includes(tempPath));
		assert.ok((loaded.warning ?? "").includes("Failed to parse"));
	} finally {
		cleanupFile(tempPath);
	}
});

runTest("output metrics summarize tracked savings and clear state", () => {
	clearOutputMetrics();
	assert.equal(getOutputMetricsSummary(), "RTK output compaction metrics: no data yet.");

	const first = trackOutputSavings("1234567890", "12345", "bash", ["ansi", "truncate"]);
	assert.equal(first.tool, "bash");
	assert.equal(first.techniques, "ansi,truncate");
	assert.equal(first.savingsPercent, 50);

	trackOutputSavings("123456", "1234", "read", []);
	const summary = getOutputMetricsSummary();
	assert.ok(summary.includes("calls=2, saved=7 chars (43.8%)"));
	assert.ok(summary.includes("- bash: 1 calls, saved 5 chars (50.0%)"));
	assert.ok(summary.includes("- read: 1 calls, saved 2 chars (33.3%)"));

	clearOutputMetrics();
	assert.equal(getOutputMetricsSummary(), "RTK output compaction metrics: no data yet.");
});

runTest("command detection ignores env prefixes, blank lines, and chained suffixes", () => {
	assert.equal(normalizeCommandForDetection("NODE_ENV=test FOO=bar npm test && echo done"), "npm test");
	assert.equal(normalizeCommandForDetection("\n\n PYTHONPATH=src git status\n echo later"), "git status");
	assert.equal(normalizeCommandForDetection("   "), null);
	assert.equal(matchesCommandPatterns("CI=1 bun test | head -5", [/^bun test/]), true);
	assert.equal(matchesCommandPatterns("echo hello", [/^bun test/]), false);
});

runTest("RTK command environment preserves explicit leading RTK_DB_PATH overrides", () => {
	const command = 'RTK_DB_PATH="/custom/history.db" rtk git diff';
	assert.equal(applyRtkCommandEnvironment(command), command);

	const exportedCommand = 'export RTK_DB_PATH="/custom/history.db"; rtk git diff';
	assert.equal(applyRtkCommandEnvironment(exportedCommand), exportedCommand);
});

runTest("path compaction preserves the tail and handles Windows separators", () => {
	const unixPath = "/Users/example/projects/pi-rtk-optimizer/src/techniques/path-utils.ts";
	const compactUnixPath = compactPath(unixPath, 28);
	assert.ok(compactUnixPath.length <= 28);
	assert.ok(compactUnixPath.endsWith("path-utils.ts"));
	assert.ok(compactUnixPath.includes("/"));

	const windowsPath = "C:\\Users\\Administrator\\Documents\\pi-rtk-optimizer\\src\\windows-command-helpers.ts";
	const compactWindowsPath = compactPath(windowsPath, 30);
	assert.ok(compactWindowsPath.length <= 30);
	assert.equal(compactWindowsPath.includes("\\"), true);
	assert.ok(compactWindowsPath.endsWith("windows-command-helpers.ts"));

	assert.equal(compactPath("src/file.ts", 40), "src/file.ts");
});

runTest("windows bash compatibility rewrites only when the runtime is Windows", () => {
	const command = "cd /d C:\\Users\\Administrator\\project && python script.py";
	const fixed = applyWindowsBashCompatibilityFixes(command);

	if (process.platform === "win32") {
		assert.deepEqual(fixed.applied, ["cd-/d", "python-utf8"]);
		assert.equal(
			fixed.command,
			'PYTHONIOENCODING=utf-8 cd "C:/Users/Administrator/project" && python script.py',
		);

		const alreadyUtf8 = applyWindowsBashCompatibilityFixes("PYTHONIOENCODING=utf-8 python script.py");
		assert.deepEqual(alreadyUtf8.applied, []);
		assert.equal(alreadyUtf8.command, "PYTHONIOENCODING=utf-8 python script.py");
	} else {
		assert.deepEqual(fixed.applied, []);
		assert.equal(fixed.command, command);
	}
});

runTest("rewrite pipeline safety buffers rewritten Windows producer commands", () => {
	const rewritten = applyRewrittenCommandShellSafetyFixups("rtk git diff | grep TODO");

	if (process.platform === "win32") {
		assert.ok(rewritten.includes('mktemp'));
		assert.ok(rewritten.includes('trap'));
		assert.ok(rewritten.includes('rtk git diff > "$__pi_rtk_pipe_tmp"'));
		assert.ok(rewritten.includes('(grep TODO) < "$__pi_rtk_pipe_tmp"'));
	} else {
		assert.equal(rewritten, "rtk git diff | grep TODO");
	}

	assert.equal(applyRewrittenCommandShellSafetyFixups("git diff | grep TODO"), "git diff | grep TODO");
});

runTest("rewrite pipeline safety keeps exported RTK_DB_PATH on rewritten producer commands", () => {
	const rewritten = applyRewrittenCommandShellSafetyFixups(
		applyRtkCommandEnvironment("rtk git diff agent/extensions/pi-multi-auth/account-manager.ts | head -200"),
	);

	if (process.platform === "win32") {
		assert.ok(rewritten.startsWith("export RTK_DB_PATH="));
		assert.equal(rewritten.startsWith("RTK_DB_PATH="), false);
		assert.ok(rewritten.includes("; {"));
		assert.ok(
			rewritten.includes('rtk git diff agent/extensions/pi-multi-auth/account-manager.ts > "$__pi_rtk_pipe_tmp"'),
		);
		assert.ok(rewritten.includes('(head -200) < "$__pi_rtk_pipe_tmp"'));
	} else {
		assert.ok(rewritten.startsWith("export RTK_DB_PATH="));
		assert.equal(
			rewritten,
			applyRtkCommandEnvironment("rtk git diff agent/extensions/pi-multi-auth/account-manager.ts | head -200"),
		);
	}
});

runTest("rewrite pipeline safety buffers explicit RTK_DB_PATH export preludes", () => {
	const command = 'export RTK_DB_PATH="/custom/history.db"; rtk git diff | head -200';
	const rewritten = applyRewrittenCommandShellSafetyFixups(command);

	if (process.platform === "win32") {
		assert.ok(rewritten.startsWith('export RTK_DB_PATH="/custom/history.db"; {'));
		assert.ok(rewritten.includes('rtk git diff > "$__pi_rtk_pipe_tmp"'));
		assert.ok(rewritten.includes('(head -200) < "$__pi_rtk_pipe_tmp"'));
	} else {
		assert.equal(rewritten, command);
	}
});

runTest("RTK command environment uses export prelude for shell compound commands", () => {
	const rewritten = applyRtkCommandEnvironment('for d in a b; do echo "$d"; done');
	assert.ok(/^export RTK_DB_PATH=/.test(rewritten));
	assert.ok(/; for d in a b; do echo "\$d"; done$/.test(rewritten));
});

runTest("stripRtkHookWarnings handles bare, prefixed, and already-sanitized hook notices", () => {
	assert.equal(
		stripRtkHookWarnings("No hook installed — run `rtk init -g` for automatic token savings\n\nready\n", null),
		"ready\n",
	);
	assert.equal(
		stripRtkHookWarnings("[WARN] Hook outdated — run `rtk init -g` to update\n\nready\n", null),
		"ready\n",
	);
	assert.equal(
		stripRtkHookWarnings(
			"?? bun.lock[rtk] /!\\ No hook installed — run `rtk init -g` for automatic token savings\n",
			null,
		),
		"?? bun.lock\n",
	);
	assert.equal(
		stripRtkHookWarnings("[rtk] /!\\ No hook installed — run `rtk init -g` for automatic token savings\n\n", "rtk git status"),
		"",
	);
});

runTest("stripRtkHookWarnings leaves quoted hook text untouched", () => {
	const quoted = 'const warning = "No hook installed — run `rtk init -g` for automatic token savings";\n';
	assert.equal(stripRtkHookWarnings(quoted, null), null);
});

runTest("sanitizeRtkEmojiOutput normalizes RTK-shaped warning output without removing content", () => {
	const sanitized = sanitizeRtkEmojiOutput(
		"⚠️  Warning: --hook-only only makes sense with --global\n    For local projects, use default mode or --claude-md\n",
		"rtk init --hook-only",
	);
	assert.equal(
		sanitized,
		"[WARN]  Warning: --hook-only only makes sense with --global\n    For local projects, use default mode or --claude-md\n",
	);
});

runTest("streaming sanitizer strips hook notices, sanitizes emoji output, and preserves non-text blocks", () => {
	const hookNoticeResult = {
		content: [
			{
				type: "text",
				text: "[rtk] /!\\ No hook installed — run `rtk init -g` for automatic token savings\n\nworking tree clean\n",
			},
		],
	};
	assert.equal(sanitizeStreamingBashExecutionResult(hookNoticeResult, "rtk git status"), true);
	assert.equal(
		(hookNoticeResult.content[0] as { text: string }).text,
		"working tree clean\n",
	);

	const emojiResult = {
		content: [
			{ type: "text", text: "📄 src/file.ts\n✅ Files are identical\n" },
			{ type: "image", url: "ignored" },
		],
	};
	assert.equal(sanitizeStreamingBashExecutionResult(emojiResult, "rtk git diff -- src/file.ts"), true);
	assert.equal((emojiResult.content[0] as { text: string }).text, "> src/file.ts\n[OK] Files are identical\n");
	assert.deepEqual(emojiResult.content[1], { type: "image", url: "ignored" });

	const parseWarningResult = {
		content: [
			{
				type: "text",
				text: "[rtk] warning: builtin filters: parse failure\n\nworking tree clean\n",
			},
		],
	};
	assert.equal(sanitizeStreamingBashExecutionResult(parseWarningResult, "rtk git status"), false);
	assert.equal(
		(parseWarningResult.content[0] as { text: string }).text,
		"[rtk] warning: builtin filters: parse failure\n\nworking tree clean\n",
	);
});

console.log("All additional coverage tests passed.");
