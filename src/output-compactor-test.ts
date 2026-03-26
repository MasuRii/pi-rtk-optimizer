import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

import { compactToolResult } from "./output-compactor.ts";
import { cloneDefaultConfig, runTest } from "./test-helpers.ts";

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

runTest("precision read with offset keeps exact output (no source/smart/hard truncation)", () => {
	const config = cloneDefaultConfig();
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

runTest("normal read compacts and adds banner", () => {
	const config = cloneDefaultConfig();
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

runTest("short read output stays exact below threshold", () => {
	const config = cloneDefaultConfig();
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

runTest("read output compacts once the content exceeds the 80-line exactness threshold", () => {
	const config = cloneDefaultConfig();
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
	config.outputCompaction.preserveExactSkillReads = true;
	config.outputCompaction.truncate.enabled = true;
	config.outputCompaction.truncate.maxChars = 500;
	config.outputCompaction.smartTruncate.enabled = true;
	config.outputCompaction.smartTruncate.maxLines = 40;

	const content = buildReadContent(220);
	const result = compactToolResult(
		{
			toolName: "read",
			input: {
				path: join(
					...(env["PI_CODING_AGENT_DIR"]
						? [env["PI_CODING_AGENT_DIR"]]
						: [homedir(), ".pi", "agent"]),
					"skills",
					"example",
					"SKILL.md",
				)
			},
			content: [{ type: "text", text: content }],
		},
		config,
	);

	assert.equal(result.changed, false);
	assert.deepEqual(result.techniques, []);
});

runTest("project .pi skill reads stay exact when preserveExactSkillReads is enabled", () => {
	const config = cloneDefaultConfig();
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

runTest("rtk env output sanitizes emoji section headers", () => {
	const compacted = compactBashOutput(
		"rtk env",
		"📂 PATH Variables:\n🔧 Language/Runtime:\n☁️  Cloud/Services:\n🛠️  Tools:\n📋 Other:\n📊 Total: 91 vars\n",
	);

	assert.ok(compacted.includes("PATH Variables:"));
	assert.ok(compacted.includes("Language/Runtime:"));
	assert.ok(compacted.includes("Cloud/Services:"));
	assert.ok(compacted.includes("Tools:"));
	assert.ok(compacted.includes("Other:"));
	assert.ok(compacted.includes("Total: 91 vars"));
	assertNoOutputEmoji(compacted);
});

runTest("rtk-shaped env output sanitizes even when command name is not rtk", () => {
	const compacted = compactBashOutput(
		"echo probe",
		"📂 PATH Variables:\n🔧 Language/Runtime:\n📊 Total: 91 vars\n",
	);

	assert.ok(compacted.includes("PATH Variables:"));
	assert.ok(compacted.includes("Language/Runtime:"));
	assert.ok(compacted.includes("Total: 91 vars"));
	assertNoOutputEmoji(compacted);
});

runTest("rtk git-style output sanitizes emoji status markers", () => {
	const compacted = compactBashOutput(
		"rtk git status",
		"📌 main\n✅ Staged: 1 files\n📝 Modified: 2 files\n❓ Untracked: 1 files\n⚠️  Conflicts: 1 files\n",
	);

	assert.ok(compacted.includes("Branch: main"));
	assert.ok(compacted.includes("[OK] Staged: 1 files"));
	assert.ok(compacted.includes("Modified: 2 files"));
	assert.ok(compacted.includes("[INFO] Untracked: 1 files"));
	assert.ok(compacted.includes("[WARN]  Conflicts: 1 files"));
	assertNoOutputEmoji(compacted);
});

runTest("rtk grep-style output sanitizes emoji file markers", () => {
	const compacted = compactBashOutput(
		"rtk grep EXTENSION_NAME agent/extensions/pi-rtk-optimizer/src/constants.ts",
		"🔍 2 in 1F:\n\n📄 agent/extensions/pi-rtk-optimizer/src/constants.ts (2):\n     4: export const EXTENSION_NAME = \"pi-rtk-optimizer\";\n",
	);

	assert.ok(compacted.startsWith("2 in 1F:\n\n> agent/extensions/pi-rtk-optimizer/src/constants.ts (2):"));
	assertNoOutputEmoji(compacted);
});

runTest("rtk git diff verbose summary sanitizes file markers", () => {
	const compacted = compactBashOutput(
		"rtk git diff -- agent/extensions/pi-mcp-adapter/package.json",
		"agent/extensions/pi-mcp-adapter/package.json | 2 +-\n\n--- Changes ---\n\n📄 agent/extensions/pi-mcp-adapter/package.json\n  @@ -38,7 +38,7 @@\n  -    \"@mariozechner/pi-coding-agent\": \"^0.58.1\",\n",
	);

	assert.ok(compacted.includes("--- Changes ---"));
	assert.ok(compacted.includes("> agent/extensions/pi-mcp-adapter/package.json"));
	assertNoOutputEmoji(compacted);
});

runTest("git diff compaction skips already-compacted RTK-shaped output", () => {
	const compacted = compactBashOutput(
		"git diff -- agent/extensions/pi-mcp-adapter/package.json",
		"agent/extensions/pi-mcp-adapter/package.json | 2 +-\n\n--- Changes ---\n\n📄 agent/extensions/pi-mcp-adapter/package.json\n  @@ -38,7 +38,7 @@\n  -    \"@mariozechner/pi-coding-agent\": \"^0.58.1\",\n",
	);

	assert.ok(compacted.includes("--- Changes ---"));
	assert.ok(compacted.includes("> agent/extensions/pi-mcp-adapter/package.json"));
	assertNoOutputEmoji(compacted);
});

runTest("rtk-shaped diff output sanitizes even when command name is not rtk", () => {
	const compacted = compactBashOutput(
		"echo probe",
		"📊 file-a.txt → file-b.txt\n   +1 added, -1 removed, ~0 modified\n\n-   2 beta\n+   2 gamma\n",
	);

	assert.ok(compacted.startsWith("file-a.txt -> file-b.txt"));
	assertNoOutputEmoji(compacted);
});

runTest("rtk-shaped identical diff output sanitizes even when command name is not rtk", () => {
	const compacted = compactBashOutput("echo probe", "✅ Files are identical");

	assert.equal(compacted, "[OK] Files are identical");
	assertNoOutputEmoji(compacted);
});

runTest("hook warning is stripped even when the command label is not rtk", () => {
	const compacted = compactBashOutput(
		"echo probe",
		"[rtk] /!\\ No hook installed — run `rtk init -g` for automatic token savings\n\n4 files changed\n",
	);

	assert.equal(compacted, "4 files changed\n");
});

runTest("hook-only output compacts to an empty text result", () => {
	const result = compactToolResult(
		{
			toolName: "bash",
			input: { command: "rtk git status" },
			content: [{ type: "text", text: "[rtk] /!\\ No hook installed — run `rtk init -g` for automatic token savings\n" }],
		},
		cloneDefaultConfig(),
	);

	assert.equal(result.changed, true);
	assert.ok(result.techniques.includes("rtk-hook-warning"));
	assert.equal(firstTextBlock(result.content), "");
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

runTest("emoji RTK warnings stay visible and are sanitized to plain text", () => {
	const compacted = compactBashOutput(
		"rtk init --hook-only",
		"⚠️  Warning: --hook-only only makes sense with --global\n    For local projects, use default mode or --claude-md\n\nready\n",
	);

	assert.ok(compacted.includes("[WARN]  Warning: --hook-only only makes sense with --global"));
	assert.ok(compacted.includes("For local projects, use default mode or --claude-md"));
	assert.ok(compacted.includes("ready\n"));
	assertNoOutputEmoji(compacted);
});

runTest("outdated hook warning is stripped while preserving the RTK payload", () => {
	const compacted = compactBashOutput(
		"rtk gain",
		"⚠️  Hook outdated — run `rtk init -g` to update\n\nSaved 42 tokens\n",
	);

	assert.equal(compacted, "Saved 42 tokens\n");
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
