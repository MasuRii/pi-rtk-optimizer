import assert from "node:assert/strict";

import { computeRewriteDecision } from "./command-rewriter.ts";
import { resolveRtkRewrite } from "./rtk-rewrite-provider.ts";
import { cloneDefaultConfig, runTest } from "./test-helpers.ts";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function createMockPi(execResult: { code: number; stdout?: string; stderr?: string }): ExtensionAPI {
	return {
		exec: async (command: string) => {
			if (command === "which" || command === "where") {
				return { code: 0, stdout: "/usr/local/bin/rtk\n", stderr: "" };
			}
			return execResult;
		},
	} as unknown as ExtensionAPI;
}

await runTest("rtk rewrite uses resolved POSIX executable path", async () => {
	const calls: Array<{ command: string; args: string[] }> = [];
	const pi = {
		exec: async (command: string, args: string[]) => {
			calls.push({ command, args });
			if (command === "which") {
				return { code: 0, stdout: "/opt/rtk/bin/rtk\n", stderr: "" };
			}
			return { code: 3, stdout: "rtk git status", stderr: "" };
		},
	} as unknown as ExtensionAPI;

	const result = await resolveRtkRewrite(pi, "git status", { platform: "linux" });

	assert.equal(result.changed, true);
	assert.equal(result.rewrittenCommand, "rtk git status");
	assert.equal(result.executableResolution?.resolvedPath, "/opt/rtk/bin/rtk");
	assert.deepEqual(calls.map((call) => call.command), ["which", "/opt/rtk/bin/rtk"]);
});

await runTest("rtk rewrite uses resolved Windows executable path", async () => {
	const calls: Array<{ command: string; args: string[] }> = [];
	const pi = {
		exec: async (command: string, args: string[]) => {
			calls.push({ command, args });
			if (command === "where") {
				return { code: 0, stdout: "C:\\Tools\\rtk.exe\r\nC:\\Other\\rtk.exe\r\n", stderr: "" };
			}
			return { code: 3, stdout: "rtk git status", stderr: "" };
		},
	} as unknown as ExtensionAPI;

	const result = await resolveRtkRewrite(pi, "git status", { platform: "win32" });

	assert.equal(result.changed, true);
	assert.equal(result.executableResolution?.resolvedPath, "C:\\Tools\\rtk.exe");
	assert.deepEqual(calls.map((call) => call.command), ["where", "C:\\Tools\\rtk.exe"]);
});

await runTest("rtk rewrite preserves behavior when executable path resolution fails", async () => {
	const calls: Array<{ command: string; args: string[] }> = [];
	const pi = {
		exec: async (command: string, args: string[]) => {
			calls.push({ command, args });
			if (command === "which") {
				return { code: 1, stdout: "", stderr: "not found" };
			}
			return { code: 3, stdout: "rtk git status", stderr: "" };
		},
	} as unknown as ExtensionAPI;

	const result = await resolveRtkRewrite(pi, "git status", { platform: "linux" });

	assert.equal(result.changed, true);
	assert.equal(result.executableResolution?.command, "rtk");
	assert.ok(result.executableResolution?.warning?.includes("which failed"));
	assert.deepEqual(calls.map((call) => call.command), ["which", "rtk"]);
});

await runTest("empty command unchanged", async () => {
	const config = cloneDefaultConfig();
	const decision = await computeRewriteDecision("", config, createMockPi({ code: 1 }));
	assert.equal(decision.changed, false);
	assert.equal(decision.reason, "empty");
});

await runTest("already rtk unchanged", async () => {
	const config = cloneDefaultConfig();
	const decision = await computeRewriteDecision("rtk status", config, createMockPi({ code: 1 }));
	assert.equal(decision.changed, false);
	assert.equal(decision.reason, "already_rtk");
});

await runTest("rtk unsupported heredoc result leaves command unchanged", async () => {
	const config = cloneDefaultConfig();
	const decision = await computeRewriteDecision("cat <<EOF", config, createMockPi({ code: 1 }));
	assert.equal(decision.changed, false);
	assert.equal(decision.reason, "no_match");
});

await runTest("quoted heredoc marker is delegated to RTK rewrite", async () => {
	const config = cloneDefaultConfig();
	const command = 'echo "<<not heredoc" && git status';
	const decision = await computeRewriteDecision(
		command,
		config,
		createMockPi({ code: 3, stdout: 'echo "<<not heredoc" && rtk git status' }),
	);
	assert.equal(decision.changed, true);
	assert.equal(decision.rewrittenCommand, 'echo "<<not heredoc" && rtk git status');
	assert.equal(decision.reason, "ok");
});

await runTest("legacy category toggles do not pre-filter RTK rewrite source of truth", async () => {
	const config = { ...cloneDefaultConfig(), rewriteGitGithub: false };
	const decision = await computeRewriteDecision("git status", config, createMockPi({ code: 3, stdout: "rtk git status" }));
	assert.equal(decision.changed, true);
	assert.equal(decision.rewrittenCommand, "rtk git status");
	assert.equal(decision.reason, "ok");
});

await runTest("rtk exit 0 rewrites", async () => {
	const config = cloneDefaultConfig();
	const decision = await computeRewriteDecision("git status", config, createMockPi({ code: 0, stdout: "rtk git status" }));
	assert.equal(decision.changed, true);
	assert.equal(decision.rewrittenCommand, "rtk git status");
	assert.equal(decision.reason, "ok");
});

await runTest("rtk exit 3 rewrites", async () => {
	const config = cloneDefaultConfig();
	const decision = await computeRewriteDecision("git status", config, createMockPi({ code: 3, stdout: "rtk git status" }));
	assert.equal(decision.changed, true);
	assert.equal(decision.rewrittenCommand, "rtk git status");
	assert.equal(decision.reason, "ok");
});

await runTest("exit 1 leaves unchanged", async () => {
	const config = cloneDefaultConfig();
	const decision = await computeRewriteDecision("git status", config, createMockPi({ code: 1 }));
	assert.equal(decision.changed, false);
	assert.equal(decision.reason, "no_match");
});

await runTest("exit 2 leaves unchanged and surfaces RTK detail", async () => {
	const config = cloneDefaultConfig();
	const decision = await computeRewriteDecision("git status", config, createMockPi({ code: 2, stderr: "denied" }));
	assert.equal(decision.changed, false);
	assert.equal(decision.reason, "no_match");
	assert.equal(decision.warning, "denied");
});

await runTest("unknown category passes through to RTK", async () => {
	const config = cloneDefaultConfig();
	const pi = createMockPi({ code: 0, stdout: "rtk custom" });
	const decision = await computeRewriteDecision("custom-cmd", config, pi);
	assert.equal(decision.changed, true);
	assert.equal(decision.rewrittenCommand, "rtk custom");
	assert.equal(decision.reason, "ok");
});

await runTest("exec error/timeout leaves unchanged and surfaces error detail", async () => {
	const config = cloneDefaultConfig();
	const pi = {
		exec: async () => {
			throw new Error("timeout");
		},
	} as unknown as ExtensionAPI;
	const decision = await computeRewriteDecision("git status", config, pi);
	assert.equal(decision.changed, false);
	assert.equal(decision.reason, "no_match");
	assert.equal(decision.warning, "timeout");
});

await runTest("compound commands forwarded to RTK", async () => {
	const config = cloneDefaultConfig();
	let capturedArgs: string[] = [];
	const pi = {
		exec: async (_cmd: string, args: string[]) => {
			capturedArgs = args;
			return { code: 0, stdout: "rtk result" };
		},
	} as unknown as ExtensionAPI;
	const decision = await computeRewriteDecision("git status && cargo test", config, pi);
	assert.equal(decision.changed, true);
	assert.deepEqual(capturedArgs, ["rewrite", "git status && cargo test"]);
});

console.log("All command-rewriter tests passed.");
