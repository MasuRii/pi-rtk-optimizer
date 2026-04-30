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

const { createBoundedNoticeTracker, shouldInjectSourceFilterTroubleshootingNote } = await import("./index.ts");
const { DEFAULT_RTK_INTEGRATION_CONFIG } = await import("./types.ts");

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

console.log("All index tests passed.");
