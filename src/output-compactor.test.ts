import assert from "node:assert/strict";
import { join } from "node:path";

import { cloneDefaultConfig, mock, runTest } from "./test-helpers.test.ts";

const TEST_AGENT_DIR = "/tmp/.pi/agent";

mock.module("@earendil-works/pi-coding-agent", {
	namedExports: {
		getAgentDir: () => TEST_AGENT_DIR,
	},
});

const { compactToolResult } = await import("./output-compactor.ts");

function buildReadContent(lineCount: number): string {
	const lines: string[] = [];
	for (let index = 0; index < lineCount; index += 1) {
		if (index % 2 === 0) {
			lines.push(`// comment ${index}`);
		} else {
			lines.push(`const value${index} = ${index};`);
		}
	}
	return `${lines.join("\n")}\n`;
}

function setReadCompaction(config: ReturnType<typeof cloneDefaultConfig>, enabled: boolean): void {
	config.outputCompaction.readCompaction = { enabled };
}

function firstTextBlock(content: unknown[] | undefined): string {
	if (!Array.isArray(content) || content.length === 0) {
		return "";
	}
	const first = content[0] as { type?: string; text?: string };
	if (first?.type !== "text" || typeof first.text !== "string") {
		return "";
	}
	return first.text;
}

const OUTPUT_EMOJI_MARKERS = ["✓", "✔", "❌", "⚠️", "⚠", "📋", "📄", "🔍", "✅", "⏭️", "📌", "📝", "❓", "•"];

function compactBashOutput(command: string, text: string): string {
	const result = compactToolResult(
		{
			toolName: "bash",
			input: { command },
			content: [{ type: "text", text }],
		},
		cloneDefaultConfig(),
	);

	assert.equal(result.changed, true);
	return firstTextBlock(result.content);
}

function compactSearchOutput(text: string): string {
	const result = compactToolResult(
		{
			toolName: "search",
			input: {},
			content: [{ type: "text", text }],
		},
		cloneDefaultConfig(),
	);

	assert.equal(result.changed, true);
	return firstTextBlock(result.content);
}

function compactGrepOutput(text: string): string {
	const result = compactToolResult(
		{
			toolName: "grep",
			input: { pattern: "match" },
			content: [{ type: "text", text }],
		},
		cloneDefaultConfig(),
	);

	assert.equal(result.changed, true);
	return firstTextBlock(result.content);
}

function assertNoOutputEmoji(text: string): void {
	for (const marker of OUTPUT_EMOJI_MARKERS) {
		assert.equal(text.includes(marker), false, `Unexpected output emoji marker: ${marker}`);
	}
}

function assertNoPartialHashlineAnchors(text: string): void {
	for (const line of text.split(/\r?\n/)) {
		if (/^\s*\d+\s*#[A-Za-z0-9_-]{2,32}:/.test(line)) {
			assert.equal(line.endsWith("..."), false, `Anchor line was partially truncated: ${line}`);
		}
	}
}

runTest("precision read with offset keeps exact output (no source/smart/hard truncation)", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 500;
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;

	const content = buildReadContent(220);
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts", offset: 1 },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, false);
	assert.deepEqual(result.techniques, []);
});

runTest("precision read with limit keeps exact output", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 500;
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;

	const content = buildReadContent(220);
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts", limit: 200 },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, false);
	assert.deepEqual(result.techniques, []);
});

runTest("default read output stays exact when read compaction is disabled by default", () => {
	const config = cloneDefaultConfig();
	config.outputCompaction.sourceCodeFilteringEnabled = true;
	config.outputCompaction.sourceCodeFiltering = "aggressive";
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 500;

	const content = buildReadContent(220);
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, false);
	assert.deepEqual(result.techniques, []);
});

runTest("normal read compacts and adds banner when read compaction is enabled", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.sourceCodeFilteringEnabled = true;
	config.outputCompaction.sourceCodeFiltering = "minimal";
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;

	const content = buildReadContent(220);
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, true);
	assert.ok(result.techniques.includes("source:minimal"));

	const compacted = firstTextBlock(result.content);
	assert.ok(compacted.startsWith("[RTK compacted output:"));
	assert.ok(compacted.includes("source:minimal"));
});

runTest("line-anchor read output compacts without corrupting LINE#HASH anchors", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.sourceCodeFilteringEnabled = true;
	config.outputCompaction.sourceCodeFiltering = "minimal";
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 5000;

	const content = Array.from({ length: 120 }, (_value, index) => {
		const lineNumber = index + 1;
		const sourceLine = lineNumber % 2 === 0 ? `const value${lineNumber} = ${lineNumber};` : `// comment ${lineNumber}`;
		return `${String(lineNumber).padStart(3, " ")}#ZP:${sourceLine}`;
	}).join("\n");
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, true);
	assert.ok(result.techniques.includes("source:minimal"));

	const compacted = firstTextBlock(result.content);
	assert.ok(compacted.startsWith("[RTK compacted output:"));
	assert.ok(compacted.includes("source:minimal"));
	assert.match(compacted, /\n\s*2#ZP:const value2 = 2;/);
	assert.equal(compacted.includes("#ZP:// comment"), false);
	assertNoPartialHashlineAnchors(compacted);
});

runTest("colon-pipe anchor read output compacts without requiring hashline extension", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.sourceCodeFilteringEnabled = true;
	config.outputCompaction.sourceCodeFiltering = "minimal";
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 5000;

	const content = [
		"Read sample.ts: 120 lines",
		"",
		...Array.from({ length: 120 }, (_value, index) => {
			const lineNumber = index + 1;
			const sourceLine = lineNumber % 2 === 0 ? `const value${lineNumber} = ${lineNumber};` : `// comment ${lineNumber}`;
			return `${lineNumber}:${(lineNumber % 256).toString(16).padStart(2, "0")}|${sourceLine}`;
		}),
	].join("\n");
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, true);
	assert.ok(result.techniques.includes("source:minimal"));

	const compacted = firstTextBlock(result.content);
	assert.ok(compacted.includes("Read sample.ts: 120 lines"));
	assert.match(compacted, /\n2:02\|const value2 = 2;/);
	assert.equal(compacted.includes("|// comment"), false);
});

runTest("compact LINEHASH pipe anchors from oh-my-pi style reads", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.sourceCodeFilteringEnabled = true;
	config.outputCompaction.sourceCodeFiltering = "minimal";
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 5000;

	const content = Array.from({ length: 120 }, (_value, index) => {
		const lineNumber = index + 1;
		const hash = lineNumber % 2 === 0 ? "sr" : "ab";
		const sourceLine = lineNumber % 2 === 0 ? `const value${lineNumber} = ${lineNumber};` : `// comment ${lineNumber}`;
		return `${lineNumber}${hash}|${sourceLine}`;
	}).join("\n");
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, true);
	assert.ok(result.techniques.includes("source:minimal"));

	const compacted = firstTextBlock(result.content);
	assert.match(compacted, /\n2sr\|const value2 = 2;/);
	assert.equal(compacted.includes("|// comment"), false);
});

runTest("compact hashline-tools file wrapper while preserving non-anchor wrapper lines", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.sourceCodeFilteringEnabled = true;
	config.outputCompaction.sourceCodeFiltering = "minimal";
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 5000;

	const content = [
		"<file>",
		...Array.from({ length: 120 }, (_value, index) => {
			const lineNumber = index + 1;
			const sourceLine = lineNumber % 2 === 0 ? `const value${lineNumber} = ${lineNumber};` : `// comment ${lineNumber}`;
			return `${lineNumber}#ZM:${sourceLine}`;
		}),
		"",
		"(End of file - 120 total lines)",
		"</file>",
	].join("\n");
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, true);
	assert.ok(result.techniques.includes("source:minimal"));

	const compacted = firstTextBlock(result.content);
	assert.ok(compacted.includes("<file>"));
	assert.ok(compacted.includes("(End of file - 120 total lines)"));
	assert.ok(compacted.includes("</file>"));
	assert.match(compacted, /\n2#ZM:const value2 = 2;/);
	assert.equal(compacted.includes("#ZM:// comment"), false);
});

runTest("anchor-safe read hard truncation preserves whole hashline anchors", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.sourceCodeFilteringEnabled = false;
	config.outputCompaction.smartTruncate.enabled = false;
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 350;

	const content = Array.from({ length: 120 }, (_value, index) => {
		const lineNumber = index + 1;
		return `${lineNumber}#ZP:const value${lineNumber} = "${"x".repeat(40)}";`;
	}).join("\n");
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, true);
	assert.ok(result.techniques.includes("truncate"));

	const compacted = firstTextBlock(result.content);
	assert.ok(compacted.includes("anchor-safe truncate"));
	assertNoPartialHashlineAnchors(compacted);
});

runTest("incidental single anchor-like line does not disable normal read compaction", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.sourceCodeFilteringEnabled = true;
	config.outputCompaction.sourceCodeFiltering = "minimal";
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;

	const content = [`1#ZP:not an anchored read`, buildReadContent(120)].join("\n");
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, true);
	assert.ok(result.techniques.includes("source:minimal") || result.techniques.includes("smart-truncate"));
});

runTest("short read output stays exact below threshold", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	const content = buildReadContent(40);

	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, false);
	assert.deepEqual(result.techniques, []);
});

runTest("read output stays exact at the 80-line boundary with trailing newline", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;

	const content = buildReadContent(80);
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, false);
	assert.deepEqual(result.techniques, []);
});

runTest("read output compacts once the content exceeds the 80-line exactness threshold when read compaction is enabled", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.sourceCodeFilteringEnabled = true;
	config.outputCompaction.sourceCodeFiltering = "minimal";
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;

	const content = buildReadContent(81);
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, true);
	assert.ok(result.techniques.includes("source:minimal") || result.techniques.includes("smart-truncate"));
});

runTest("source file reads skip lossy source filtering when truncation safeguards are not needed", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.sourceCodeFilteringEnabled = true;
	config.outputCompaction.sourceCodeFiltering = "minimal";
	config.outputCompaction.smartTruncate.enabled = false;
	config.outputCompaction.truncate.enabled = false;

	const content = buildReadContent(120);
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "sample.ts" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, false);
	assert.deepEqual(result.techniques, []);
	assert.equal(firstTextBlock(result.content), "");
});

runTest("skill reads stay exact when preserveExactSkillReads is enabled for user skills", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.preserveExactSkillReads = true;
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 500;
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;

	const content = buildReadContent(220);
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: join(TEST_AGENT_DIR, "skills", "example", "SKILL.md") },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, false);
	assert.deepEqual(result.techniques, []);
});

runTest("project .pi skill reads stay exact when preserveExactSkillReads is enabled", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.preserveExactSkillReads = true;
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 500;
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;

	const content = buildReadContent(220);
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: ".pi/skills/example/SKILL.md" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, false);
	assert.deepEqual(result.techniques, []);
});

runTest("ancestor .agents skill reads stay exact when preserveExactSkillReads is enabled", () => {
	const config = cloneDefaultConfig();
	setReadCompaction(config, true);
	config.outputCompaction.preserveExactSkillReads = true;
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 500;
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;

	const content = buildReadContent(220);
	const result = compactToolResult(
		{
			toolName: "read",
			input: { path: "../.agents/skills/example/SKILL.md" },
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, false);
	assert.deepEqual(result.techniques, []);
});

runTest("build output uses plain-text status markers", () => {
	const compacted = compactBashOutput("npm run build", "Compiling app v0.1.0\n");

	assert.equal(compacted, "[OK] Build successful (1 units compiled)");
	assertNoOutputEmoji(compacted);
});

runTest("git status output uses plain-text labels", () => {
	const compacted = compactBashOutput(
		"git status --short --branch",
		"## main...origin/main\nM  staged.ts\n M modified.ts\n?? new.ts\nUU conflict.ts\n",
	);

	assert.ok(compacted.startsWith("Branch: main\n"));
	assert.ok(compacted.includes("Staged: 1 files\n  staged.ts\n"));
	assert.ok(compacted.includes("Modified: 1 files\n  modified.ts\n"));
	assert.ok(compacted.includes("Untracked: 1 files\n  new.ts\n"));
	assert.ok(compacted.includes("Conflicts: 1 files"));
	assertNoOutputEmoji(compacted);
});

runTest("git diff output uses plain-text file markers", () => {
	const compacted = compactBashOutput(
		"git diff",
		"diff --git a/src/example.ts b/src/example.ts\n@@ -1 +1 @@\n-oldValue\n+newValue\n",
	);

	assert.ok(compacted.includes("\n> src/example.ts\n"));
	assertNoOutputEmoji(compacted);
});

runTest("linter success output uses plain-text status markers", () => {
	const compacted = compactBashOutput("npx eslint .", "");

	assert.equal(compacted, "[OK] ESLint: No issues found");
	assertNoOutputEmoji(compacted);
});

runTest("test output uses plain-text labels and bullets", () => {
	const compacted = compactBashOutput(
		"bun test",
		"3 passed, 1 failed, 2 skipped\nFAIL src/example.test.ts\n  Expected: true\n  Received: false\n\n\n",
	);

	assert.ok(compacted.includes("Test Results:"));
	assert.ok(compacted.includes("PASS: 3 passed"));
	assert.ok(compacted.includes("FAIL: 1 failed"));
	assert.ok(compacted.includes("SKIP: 2 skipped"));
	assert.ok(compacted.includes("   - FAIL src/example.test.ts"));
	assertNoOutputEmoji(compacted);
});

runTest("search output uses plain-text summary and file markers", () => {
	const compacted = compactGrepOutput("src/a.ts:1:const match = true;\nsrc/b.ts:2:return match;\n");

	assert.ok(compacted.startsWith("2 matches in 2 files:\n\n"));
	assert.ok(compacted.includes("> src/a.ts (1 matches):\n"));
	assert.ok(compacted.includes("> src/b.ts (1 matches):\n"));
	assertNoOutputEmoji(compacted);
});

runTest("toolName 'search' (grep alias used by some pi installs) is compacted same as 'grep'", () => {
	// Regression for: a single oversized rg match line (minified HTML/JSON with no
	// line breaks) reached the model uncompacted because this install's grep tool
	// is registered as "search", and the compactor only recognized "grep",
	// silently no-op'ing truncation/groupSearchOutput for every search call.
	const hugeLine = `docs/mockups/huge.html:1: ${"x".repeat(1_200_000)}`;
	const compacted = compactSearchOutput(hugeLine);

	assert.ok(
		compacted.length < hugeLine.length,
		"search tool output must be truncated/compacted, not passed through unchanged",
	);
	assert.ok(compacted.length <= cloneDefaultConfig().outputCompaction.truncate.maxChars + 200);
});

runTest("git diff compaction skips already-compacted RTK-shaped output", () => {
	const result = compactToolResult(
		{
			toolName: "bash",
			input: { command: "git diff -- agent/extensions/pi-mcp-adapter/package.json" },
			content: [{ type: "text", text: "agent/extensions/pi-mcp-adapter/package.json | 2 +-\n\n--- Changes ---\n\n> agent/extensions/pi-mcp-adapter/package.json\n  @@ -38,7 +38,7 @@\n  -    \"@earendil-works/pi-coding-agent\": \"^0.58.1\",\n" }],
		},
		cloneDefaultConfig(),
	);

	assert.equal(result.changed, false);
	assert.equal(result.content, undefined);
	assert.deepEqual(result.techniques, []);
});

runTest("non-hook RTK warnings are preserved verbatim", () => {
	const result = compactToolResult(
		{
			toolName: "bash",
			input: { command: "FOO=1 rtk git status" },
			content: [{ type: "text", text: "[rtk] warning: builtin filters: parse failure\n\nworking tree clean\n" }],
		},
		cloneDefaultConfig(),
	);

	assert.equal(result.changed, false);
	assert.equal(result.content, undefined);
	assert.deepEqual(result.techniques, []);
});

runTest("quoted hook warning text is preserved as payload", () => {
	const quotedHookText = 'const warning = "No hook installed — run `rtk init -g` for automatic token savings";\n';
	const result = compactToolResult(
		{
			toolName: "bash",
			input: { command: "echo probe" },
			content: [{ type: "text", text: quotedHookText }],
		},
		cloneDefaultConfig(),
	);

	assert.equal(result.changed, false);
	assert.equal(result.content, undefined);
	assert.deepEqual(result.techniques, []);
});

console.log("All output-compactor tests passed.");
