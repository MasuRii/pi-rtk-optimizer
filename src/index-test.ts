import assert from "node:assert/strict";
import { mock } from "bun:test";

import { runTest } from "./test-helpers.ts";

mock.module("@mariozechner/pi-coding-agent", () => ({
	getAgentDir: () => "/tmp/.pi/agent",
	getSettingsListTheme: () => ({}),
	isToolCallEventType: (toolName: string, event: Record<string, unknown>) => event.toolName === toolName,
}));

mock.module("@mariozechner/pi-tui", () => ({
	Box: class {},
	Container: class {
		addChild(): void {}
		render(): string[] {
			return [];
		}
		invalidate(): void {}
	},
	SettingsList: class {
		handleInput(): void {}
		updateValue(): void {}
	},
	Spacer: class {},
	Text: class {},
	truncateToWidth: (text: string) => text,
	visibleWidth: (text: string) => text.length,
}));

const indexModule = await import("./index.ts");
const { createBoundedNoticeTracker, shouldInjectSourceFilterTroubleshootingNote } = indexModule;
const rtkIntegrationExtension = indexModule.default;
const { DEFAULT_RTK_INTEGRATION_CONFIG } = await import("./types.ts");

type Notification = { message: string; level: "info" | "warning" | "error" };
type ExtensionHandler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<Record<string, unknown> | void>;

function createNotificationContext(notifications: Notification[]): Record<string, unknown> {
	return {
		hasUI: true,
		ui: {
			notify(message: string, level: "info" | "warning" | "error") {
				notifications.push({ message, level });
			},
		},
	};
}

function firstText(content: unknown): string {
	if (!Array.isArray(content) || content.length === 0) {
		return "";
	}
	const block = content[0] as { type?: string; text?: string };
	return block.type === "text" && typeof block.text === "string" ? block.text : "";
}

function configWith(overrides: {
	enabled?: boolean;
	compactionEnabled?: boolean;
	readCompactionEnabled?: boolean;
	sourceFilteringEnabled?: boolean;
	sourceFilteringLevel?: "none" | "minimal" | "aggressive";
	smartTruncateEnabled?: boolean;
	truncateEnabled?: boolean;
}): typeof DEFAULT_RTK_INTEGRATION_CONFIG {
	const base = DEFAULT_RTK_INTEGRATION_CONFIG;
	return {
		...base,
		enabled: overrides.enabled ?? base.enabled,
		outputCompaction: {
			...base.outputCompaction,
			enabled: overrides.compactionEnabled ?? base.outputCompaction.enabled,
			readCompaction: {
				...base.outputCompaction.readCompaction,
				enabled: overrides.readCompactionEnabled ?? base.outputCompaction.readCompaction.enabled,
			},
			sourceCodeFilteringEnabled:
				overrides.sourceFilteringEnabled ?? base.outputCompaction.sourceCodeFilteringEnabled,
			sourceCodeFiltering: overrides.sourceFilteringLevel ?? base.outputCompaction.sourceCodeFiltering,
			smartTruncate: {
				...base.outputCompaction.smartTruncate,
				enabled: overrides.smartTruncateEnabled ?? base.outputCompaction.smartTruncate.enabled,
			},
			truncate: {
				...base.outputCompaction.truncate,
				enabled: overrides.truncateEnabled ?? base.outputCompaction.truncate.enabled,
			},
		},
	};
}

runTest("bounded notice tracker evicts old entries and supports reset", () => {
	const tracker = createBoundedNoticeTracker(2);

	assert.equal(tracker.remember("first"), true);
	assert.equal(tracker.remember("second"), true);
	assert.equal(tracker.remember("first"), false);

	assert.equal(tracker.remember("third"), true);
	assert.equal(tracker.remember("second"), false);
	assert.equal(tracker.remember("first"), true);

	tracker.reset();
	assert.equal(tracker.remember("third"), true);
});

runTest("bounded notice tracker coerces invalid limits to a safe minimum", () => {
	const tracker = createBoundedNoticeTracker(0);
	assert.equal(tracker.remember("alpha"), true);
	assert.equal(tracker.remember("beta"), true);
	assert.equal(tracker.remember("alpha"), true);
});

runTest("source-filter note injected when source filtering is active", () => {
	assert.equal(
		shouldInjectSourceFilterTroubleshootingNote(
			configWith({
				readCompactionEnabled: true,
				sourceFilteringEnabled: true,
				sourceFilteringLevel: "minimal",
				smartTruncateEnabled: true,
			}),
		),
		true,
	);
	assert.equal(
		shouldInjectSourceFilterTroubleshootingNote(
			configWith({
				readCompactionEnabled: true,
				sourceFilteringEnabled: true,
				sourceFilteringLevel: "aggressive",
				smartTruncateEnabled: true,
			}),
		),
		true,
	);
});

runTest("source-filter note skipped when extension is disabled", () => {
	assert.equal(shouldInjectSourceFilterTroubleshootingNote(configWith({ enabled: false })), false);
});

runTest("source-filter note skipped when compaction is disabled", () => {
	assert.equal(shouldInjectSourceFilterTroubleshootingNote(configWith({ compactionEnabled: false })), false);
});

runTest("source-filter note skipped when read compaction is disabled", () => {
	assert.equal(
		shouldInjectSourceFilterTroubleshootingNote(
			configWith({
				readCompactionEnabled: false,
				sourceFilteringEnabled: true,
				sourceFilteringLevel: "minimal",
				smartTruncateEnabled: true,
			}),
		),
		false,
	);
});

runTest("source-filter note skipped when source filtering flag is off", () => {
	assert.equal(
		shouldInjectSourceFilterTroubleshootingNote(configWith({ sourceFilteringEnabled: false })),
		false,
	);
});

runTest("source-filter note skipped when filtering level is 'none'", () => {
	assert.equal(
		shouldInjectSourceFilterTroubleshootingNote(
			configWith({ sourceFilteringEnabled: true, sourceFilteringLevel: "none" }),
		),
		false,
	);
});

runTest("source-filter note skipped when all read filtering safeguards are disabled", () => {
	assert.equal(
		shouldInjectSourceFilterTroubleshootingNote(
			configWith({ smartTruncateEnabled: false, truncateEnabled: false }),
		),
		false,
	);
});

await runTest("session_start refreshes RTK provenance and runtime guard skips missing rewrites", async () => {
	const handlers: Record<string, ExtensionHandler> = {};
	const notifications: Notification[] = [];
	const execCommands: string[] = [];
	let rtkAvailable = false;
	let rewriteCalls = 0;

	rtkIntegrationExtension({
		exec: async (command: string, args: string[]) => {
			execCommands.push(command);
			if (command === "which" || command === "where") {
				return { code: 0, stdout: "/opt/rtk/bin/rtk\n", stderr: "" };
			}
			if (args[0] === "--version") {
				return rtkAvailable
					? { code: 0, stdout: "rtk 1.0.0", stderr: "" }
					: { code: 1, stdout: "", stderr: "missing rtk" };
			}
			if (args[0] === "rewrite") {
				rewriteCalls += 1;
				return { code: 3, stdout: "rtk git status", stderr: "" };
			}
			return { code: 1, stdout: "", stderr: "unexpected" };
		},
		on(eventName: string, handler: ExtensionHandler) {
			handlers[eventName] = handler;
		},
		registerCommand() {},
	} as never);

	const sessionStartHandler = handlers.session_start;
	const toolCallHandler = handlers.tool_call;
	assert.ok(sessionStartHandler);
	assert.ok(toolCallHandler);

	await sessionStartHandler({}, createNotificationContext(notifications));
	const skippedEvent = { toolName: "bash", input: { command: "git status" } };
	await toolCallHandler(skippedEvent, createNotificationContext(notifications));

	assert.equal((skippedEvent.input as { command: string }).command, "git status");
	assert.equal(rewriteCalls, 0);
	assert.ok(notifications.some((notice) => notice.message.includes("rtk binary unavailable")));

	rtkAvailable = true;
	await sessionStartHandler({}, createNotificationContext(notifications));
	const rewrittenEvent = { toolName: "bash", input: { command: "git status" } };
	await toolCallHandler(rewrittenEvent, createNotificationContext(notifications));

	assert.equal(rewriteCalls, 1);
	assert.ok((rewrittenEvent.input as { command: string }).command.includes("rtk git status"));
	assert.ok(execCommands.includes("/opt/rtk/bin/rtk"));
});

await runTest("tool execution lifecycle sanitizes streamed bash output", async () => {
	const handlers: Record<string, ExtensionHandler> = {};

	rtkIntegrationExtension({
		exec: async () => ({ code: 0, stdout: "rtk 1.0.0", stderr: "" }),
		on(eventName: string, handler: ExtensionHandler) {
			handlers[eventName] = handler;
		},
		registerCommand() {},
	} as never);

	const startHandler = handlers.tool_execution_start;
	const updateHandler = handlers.tool_execution_update;
	const endHandler = handlers.tool_execution_end;
	assert.ok(startHandler);
	assert.ok(updateHandler);
	assert.ok(endHandler);

	await startHandler(
		{ toolName: "bash", toolCallId: "bash-1", args: { command: "rtk git status" } },
		{},
	);
	const updateEvent = {
		toolName: "bash",
		toolCallId: "bash-1",
		args: { command: "rtk git status" },
		partialResult: {
			content: [
				{
					type: "text",
					text: "[rtk] /!\\ No hook installed — run `rtk init -g` for automatic token savings\n\nworking tree clean\n",
				},
			],
		},
	};
	await updateHandler(updateEvent, {});
	assert.equal(firstText(updateEvent.partialResult.content), "working tree clean\n");

	const endEvent = {
		toolName: "bash",
		toolCallId: "bash-1",
		result: { content: [{ type: "text", text: "📄 src/file.ts\n✅ Files are identical\n" }] },
	};
	await endHandler(endEvent, {});
	assert.equal(firstText(endEvent.result.content), "> src/file.ts\n[OK] Files are identical\n");
});

await runTest("tool_result lifecycle merges compaction metadata with existing details", async () => {
	const handlers: Record<string, ExtensionHandler> = {};
	const notifications: Notification[] = [];

	rtkIntegrationExtension({
		exec: async () => ({ code: 0, stdout: "rtk 1.0.0", stderr: "" }),
		on(eventName: string, handler: ExtensionHandler) {
			handlers[eventName] = handler;
		},
		registerCommand() {},
	} as never);

	const toolResultHandler = handlers.tool_result;
	assert.ok(toolResultHandler);
	const result = await toolResultHandler(
		{
			toolName: "grep",
			input: { pattern: "TODO" },
			content: [{ type: "text", text: "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\n" }],
			details: { metadata: { requestId: "abc" }, traceId: "trace-1" },
		},
		createNotificationContext(notifications),
	);

	assert.ok(result);
	assert.ok(firstText(result.content).startsWith("2 matches in 2 files:"));
	assert.equal((result.details as { traceId?: string }).traceId, "trace-1");
	const details = result.details as { rtkCompaction?: { applied: boolean }; metadata?: Record<string, unknown> };
	assert.equal(details.rtkCompaction?.applied, true);
	assert.deepEqual(details.metadata?.requestId, "abc");
	assert.equal((details.metadata?.rtkCompaction as { applied?: boolean } | undefined)?.applied, true);
	assert.equal(notifications.length, 0);
});

await runTest("tool_call surfaces RTK rewrite errors through existing UI warning path", async () => {
	const handlers: Record<string, (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<Record<string, unknown> | void>> = {};
	const notifications: Notification[] = [];

	rtkIntegrationExtension({
		exec: async (_command: string, args: string[]) => {
			if (args[0] === "--version") {
				return { code: 0, stdout: "rtk 1.0.0", stderr: "" };
			}

			return { code: 2, stdout: "", stderr: "denied unsafe rewrite" };
		},
		on(eventName: string, handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<Record<string, unknown> | void>) {
			handlers[eventName] = handler;
		},
		registerCommand() {},
	} as never);

	const toolCallHandler = handlers.tool_call;
	assert.ok(toolCallHandler);
	const event = { toolName: "bash", input: { command: "git status" } };
	await toolCallHandler(event, {
		hasUI: true,
		ui: {
			notify(message: string, level: "info" | "warning" | "error") {
				notifications.push({ message, level });
			},
		},
	});

	assert.equal((event.input as { command: string }).command, "git status");
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0]?.level, "warning");
	assert.ok(notifications[0]?.message.includes("rtk rewrite skipped"));
	assert.ok(notifications[0]?.message.includes("denied unsafe rewrite"));
});

console.log("All index tests passed.");
