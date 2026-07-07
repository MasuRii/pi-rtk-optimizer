import assert from "node:assert/strict";

import type { SettingItem } from "@earendil-works/pi-tui";
import { cloneDefaultConfig, mock, runTest } from "./test-helpers.test.ts";

mock.module("@earendil-works/pi-coding-agent", {
	namedExports: {
		getAgentDir: () => "/tmp/.pi/agent",
		getSettingsListTheme: () => ({}),
	},
});

const settingsListInputs: string[] = [];
const settingsListUpdates: Array<{ id: string; value: string }> = [];

mock.module("@earendil-works/pi-tui", {
	namedExports: {
		Box: class {
			addChild(): void {}
		},
		Container: class {
			addChild(): void {}
			render(): string[] {
				return ["settings-content"];
			}
			invalidate(): void {}
		},
		SettingsList: class {
			handleInput(data: string): void {
				settingsListInputs.push(data);
			}
			updateValue(id: string, value: string): void {
				settingsListUpdates.push({ id, value });
			}
			render(): string[] {
				return ["settings-content"];
			}
		},
		Spacer: class {},
		Text: class {},
		truncateToWidth: (text: string, width: number) => text.slice(0, width),
		visibleWidth: (text: string) => text.length,
		// Faithful subset of the real pi-tui matchesKey(): recognize both the
		// legacy bare sequence (\x1b[D) and the kitty-keyboard-protocol
		// disambiguated form (\x1b[1;1D) for unmodified left/right arrows.
		// This lets tab-switch tests prove the fix works under kitty protocol.
		matchesKey: (data: string, keyId: string): boolean => {
			if (keyId === "left") {
				return data === "\x1b[D" || data === "\x1b[1;1D";
			}
			if (keyId === "right") {
				return data === "\x1b[C" || data === "\x1b[1;1C";
			}
			return false;
		},
	},
});

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

const { registerRtkIntegrationCommand } = await import("./command-register.ts");
const { ZellijModal, ZellijSettingsModal } = await import("./zellij-modal.ts");
const { getRtkArgumentCompletions } = await import("./command-completions.ts");

type Notification = { message: string; level: "info" | "warning" | "error" };

interface CommandContextStub {
	hasUI: boolean;
	ui: {
		notify(message: string, level: "info" | "warning" | "error"): void;
		custom<T>(): Promise<T>;
	};
}

function createNotifyContext(hasUI: boolean): { ctx: CommandContextStub; notifications: Notification[] } {
	const notifications: Notification[] = [];
	return {
		ctx: {
			hasUI,
			ui: {
				notify(message: string, level: "info" | "warning" | "error") {
					notifications.push({ message, level });
				},
				async custom<T>(): Promise<T> {
					throw new Error("custom UI should not be invoked in config-modal tests");
				},
			},
		},
		notifications,
	};
}

function lastNotification(notifications: Notification[]): Notification {
	return notifications[notifications.length - 1] as Notification;
}

function createThemeStub(): { fg: (_name: string, text: string) => string; bold: (text: string) => string } {
	return {
		fg: (_name: string, text: string) => text,
		bold: (text: string) => text,
	};
}

runTest("zellij settings modal renders overlay frame and delegates non-enter input", () => {
	settingsListInputs.length = 0;
	settingsListUpdates.length = 0;
	const settingsModal = new ZellijSettingsModal(
		{
			title: "RTK Integration Settings",
			settings: [
				{
					id: "enabled",
					label: "Enabled",
					description: "Enable integration",
					currentValue: "on",
					values: ["on", "off"],
				},
			],
			onChange: () => {},
			onClose: () => {},
			helpText: "Esc: close",
		},
		createThemeStub() as never,
	);
	const modal = new ZellijModal(settingsModal, {
		titleBar: {
			left: { text: "RTK Integration Settings", maxWidth: 30, color: "accent" },
			right: { text: "pi-rtk-optimizer", maxWidth: 20, color: "dim" },
		},
		helpUndertitle: { text: "Esc: close", color: "dim" },
		overlay: { anchor: "center", width: 86, maxHeight: "85%", margin: 1 },
	});

	const rendered = modal.renderModal(86);
	settingsModal.handleInput("\r");
	settingsModal.handleInput("j");
	settingsModal.updateValue("enabled", "off");

	assert.equal(rendered.visibleWidth, 86);
	assert.equal(rendered.contentWidth, 82);
	assert.ok(stripAnsi(rendered.lines[0] ?? "").includes("RTK Integration Settings"));
	assert.ok(stripAnsi(rendered.lines[rendered.lines.length - 1] ?? "").includes("Esc: close"));
	assert.deepEqual(modal.getOverlayOptions(), {
		overlay: true,
		overlayOptions: { anchor: "center", width: 86, maxHeight: "85%", margin: 1 },
	});
	assert.deepEqual(settingsListInputs, ["j"]);
	assert.deepEqual(settingsListUpdates, [{ id: "enabled", value: "off" }]);
});

// Build a tabbed settings modal (3 tabs) for tab-navigation tests.
// With the test theme stub (no color wrapping), the active tab renders as
// `[ Label ]` while inactive tabs render as `  Label  ` (no brackets),
// so the active tab is observable through render() output without ANSI.
function createTabbedSettingsModal(): ZellijSettingsModal {
	const tabSetting = (id: string): SettingItem => ({
		id,
		label: id,
		description: `${id} setting`,
		currentValue: "on",
		values: ["on", "off"],
	});
	return new ZellijSettingsModal(
		{
			title: "RTK Integration Settings",
			tabs: [
				{ label: "General", settings: [tabSetting("general")] },
				{ label: "Compaction", settings: [tabSetting("compaction")] },
				{ label: "Read", settings: [tabSetting("read")] },
			],
			activeTabIndex: 0,
			onChange: () => {},
			onClose: () => {},
			helpText: "Esc: close",
		},
		createThemeStub() as never,
	);
}

// Returns the tab-bar line (with brackets stripped) from a tabbed modal render.
function renderTabBarLine(modal: ZellijSettingsModal): string {
	const lines = modal.render(86);
	// render() layout for tabbed modals: [title, "", tabBar, "", ...].
	return stripAnsi(lines[2] ?? "");
}

runTest("tabbed settings modal switches tabs on legacy left/right arrow keys", () => {
	const modal = createTabbedSettingsModal();

	// Starts on General (index 0).
	assert.ok(renderTabBarLine(modal).includes("[ General ]"));

	// Right arrow advances to Compaction, then Read.
	modal.handleInput("\x1b[C");
	assert.ok(renderTabBarLine(modal).includes("[ Compaction ]"));
	modal.handleInput("\x1b[C");
	assert.ok(renderTabBarLine(modal).includes("[ Read ]"));

	// Right arrow wraps around to General.
	modal.handleInput("\x1b[C");
	assert.ok(renderTabBarLine(modal).includes("[ General ]"));

	// Left arrow wraps backwards to Read.
	modal.handleInput("\x1b[D");
	assert.ok(renderTabBarLine(modal).includes("[ Read ]"));

	// Left arrow goes back to Compaction.
	modal.handleInput("\x1b[D");
	assert.ok(renderTabBarLine(modal).includes("[ Compaction ]"));
});

runTest("tabbed settings modal switches tabs on kitty-protocol encoded arrows", () => {
	// Regression: pi-tui 0.80.x enables kitty keyboard protocol, which re-encodes
	// bare arrows as \x1b[1;1D / \x1b[1;1C. The old strict compare against
	// \x1b[D / \x1b[C silently dropped these, making tabs unswitchable in
	// Ghostty/kitty/WezTerm. matchesKey normalizes both encodings.
	const modal = createTabbedSettingsModal();

	assert.ok(renderTabBarLine(modal).includes("[ General ]"));

	modal.handleInput("\x1b[1;1C");
	assert.ok(renderTabBarLine(modal).includes("[ Compaction ]"));

	modal.handleInput("\x1b[1;1D");
	assert.ok(renderTabBarLine(modal).includes("[ General ]"));
});

runTest("tabbed settings modal does not switch tabs on modified arrows", () => {
	// Modified arrows (Shift/Ctrl/Alt) must not match bare left/right, so they
	// fall through to the settings list instead of switching tabs. This guards
	// against matchesKey over-matching.
	settingsListInputs.length = 0;
	const modal = createTabbedSettingsModal();

	modal.handleInput("\x1b[1;5C"); // Ctrl+Right
	modal.handleInput("\x1b[1;3D"); // Alt+Left
	assert.ok(renderTabBarLine(modal).includes("[ General ]"));
	// Modified arrows forwarded to the active settings list, not swallowed.
	assert.deepEqual(settingsListInputs, ["\x1b[1;5C", "\x1b[1;3D"]);
});

runTest("command completions return top-level and filtered RTK subcommands", () => {
	const topLevel = getRtkArgumentCompletions("");
	assert.ok(Array.isArray(topLevel));
	assert.ok(topLevel.some((item) => item.value === "show"));
	assert.ok(topLevel.some((item) => item.value === "clear-stats"));

	const filtered = getRtkArgumentCompletions("st");
	assert.deepEqual(
		filtered?.map((item) => item.value),
		["stats"],
	);
	assert.equal(getRtkArgumentCompletions("show extra"), null);
	assert.equal(getRtkArgumentCompletions("zzz"), null);
});

await runTest("config modal command handlers route RTK subcommands to controller actions", async () => {
	const config = cloneDefaultConfig();
	const controllerState = {
		config,
		cleared: 0,
		refreshed: 0,
		lastSavedMode: "",
	};

	const controller = {
		getConfig: () => controllerState.config,
		setConfig: (next: typeof config, _ctx: unknown) => {
			controllerState.config = next;
			controllerState.lastSavedMode = next.mode;
		},
		getConfigPath: () => "C:/tmp/pi-rtk-optimizer/config.json",
		getRuntimeStatus: () => ({ rtkAvailable: false, lastError: "not found" }),
		refreshRuntimeStatus: async () => {
			controllerState.refreshed += 1;
			return { rtkAvailable: true, rtkExecutablePath: "C:/Tools/rtk.exe" };
		},
		getMetricsSummary: () => "metrics summary",
		clearMetrics: () => {
			controllerState.cleared += 1;
		},
	};

	let registeredName = "";
	type RegisteredCommandDefinition = {
		description: string;
		getArgumentCompletions?: (argumentPrefix: string) => Array<{ value: string; label: string; description?: string }> | null;
		handler: (args: string, ctx: CommandContextStub) => Promise<void>;
	};
	let definition: RegisteredCommandDefinition | undefined;

	registerRtkIntegrationCommand(
		{
			registerCommand(name: string, nextDefinition: RegisteredCommandDefinition) {
				registeredName = name;
				definition = nextDefinition;
			},
		} as never,
		controller as never,
	);

	assert.equal(registeredName, "rtk");
	if (!definition) {
		throw new Error("Expected /rtk command definition to be registered");
	}
	assert.ok(definition.description.includes("Configure RTK rewrite"));
	assert.ok(typeof definition.getArgumentCompletions === "function");

	const infoCtx = createNotifyContext(true);
	await definition.handler("help", infoCtx.ctx);
	assert.ok(lastNotification(infoCtx.notifications).message.includes("Usage: /rtk"));

	await definition.handler("show", infoCtx.ctx);
	assert.ok(lastNotification(infoCtx.notifications).message.includes("mode=rewrite"));
	assert.ok(lastNotification(infoCtx.notifications).message.includes("rewriteSource=rtk"));
	assert.equal(lastNotification(infoCtx.notifications).message.includes("categories="), false);

	await definition.handler("path", infoCtx.ctx);
	assert.equal(lastNotification(infoCtx.notifications).message, "rtk config: C:/tmp/pi-rtk-optimizer/config.json");

	await definition.handler("verify", infoCtx.ctx);
	assert.equal(controllerState.refreshed, 1);
	assert.equal(lastNotification(infoCtx.notifications).level, "info");
	assert.ok(lastNotification(infoCtx.notifications).message.includes("available at C:/Tools/rtk.exe"));

	await definition.handler("stats", infoCtx.ctx);
	assert.equal(lastNotification(infoCtx.notifications).message, "metrics summary");

	await definition.handler("clear-stats", infoCtx.ctx);
	assert.equal(controllerState.cleared, 1);
	assert.equal(lastNotification(infoCtx.notifications).message, "RTK metrics cleared.");

	await definition.handler("reset", infoCtx.ctx);
	assert.equal(controllerState.lastSavedMode, "rewrite");
	assert.equal(lastNotification(infoCtx.notifications).message, "RTK integration settings reset to defaults.");

	await definition.handler("unknown", infoCtx.ctx);
	assert.equal(lastNotification(infoCtx.notifications).level, "warning");
	assert.ok(lastNotification(infoCtx.notifications).message.includes("Usage: /rtk"));

	const headlessCtx = createNotifyContext(false);
	await definition.handler("", headlessCtx.ctx);
	assert.equal(lastNotification(headlessCtx.notifications).message, "/rtk requires interactive TUI mode.");
});

console.log("All config-modal tests passed.");
