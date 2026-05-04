import assert from "node:assert/strict";
import { mock } from "bun:test";

import { cloneDefaultConfig, runTest } from "./test-helpers.ts";

mock.module("@mariozechner/pi-coding-agent", () => ({
	getAgentDir: () => "/tmp/.pi/agent",
	getSettingsListTheme: () => ({}),
}));

const settingsListInputs: string[] = [];
const settingsListUpdates: Array<{ id: string; value: string }> = [];

mock.module("@mariozechner/pi-tui", () => ({
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
	},
	Spacer: class {},
	Text: class {},
	truncateToWidth: (text: string, width: number) => text.slice(0, width),
	visibleWidth: (text: string) => text.length,
}));

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

const { registerRtkIntegrationCommand } = await import("./config-modal.ts");
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
