import assert from "node:assert/strict";

import { cloneDefaultConfig, mock, runTest } from "./test-helpers.test.ts";

mock.module("@earendil-works/pi-coding-agent", {
	namedExports: {
		getAgentDir: () => "/tmp/.pi/agent",
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

runTest("zellij settings modal renders plain rows and handles settings input", () => {
	const changes: Array<{ id: string; value: string }> = [];
	let closed = 0;
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
				{ id: "mode", label: "Mode", description: "Rewrite mode", currentValue: "rewrite", values: ["rewrite", "suggest"] },
			],
			onChange: (id, value) => changes.push({ id, value }),
			onClose: () => {
				closed += 1;
			},
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
	assert.equal(rendered.visibleWidth, 86);
	assert.equal(rendered.contentWidth, 82);
	assert.ok(stripAnsi(rendered.lines[0] ?? "").includes("RTK Integration Settings"));
	assert.ok(stripAnsi(rendered.lines[rendered.lines.length - 1] ?? "").includes("Esc: close"));
	assert.ok(rendered.lines.some((line) => /→ Enabled +on/.test(stripAnsi(line))));
	assert.ok(rendered.lines.some((line) => stripAnsi(line).includes("Enable integration")));
	for (const width of [20, 40, 86, 120]) {
		for (const line of modal.renderModal(width).lines) {
			assert.equal(Bun.stringWidth(line), width, `row width at ${width}: ${JSON.stringify(stripAnsi(line))}`);
		}
	}
	assert.deepEqual(modal.getOverlayOptions(), {
		overlay: true,
		overlayOptions: { anchor: "center", width: 86, maxHeight: "85%", margin: 1 },
	});

	settingsModal.handleInput("\r");
	assert.deepEqual(changes, [], "Enter that opened /rtk must not toggle the first setting");
	settingsModal.handleInput(" ");
	assert.deepEqual(changes, [{ id: "enabled", value: "off" }]);
	settingsModal.handleInput("\x1b[B");
	settingsModal.handleInput("\x1b[32u");
	assert.deepEqual(changes[1], { id: "mode", value: "suggest" });
	settingsModal.updateValue("enabled", "on");
	assert.ok(settingsModal.render(60).some((line) => /Enabled +on/.test(stripAnsi(line))));

	settingsModal.handleInput("m");
	settingsModal.handleInput("d");
	const filtered = settingsModal.render(60).map(stripAnsi);
	assert.ok(filtered.some((line) => line.startsWith("> md")));
	assert.ok(filtered.some((line) => /→ Mode +suggest/.test(line)));
	assert.equal(filtered.some((line) => line.includes("Enabled")), false);
	settingsModal.handleInput("\x7f");
	settingsModal.handleInput("\x7f");
	assert.ok(settingsModal.render(60).some((line) => stripAnsi(line).includes("Enabled")));

	settingsModal.handleInput("\x1b");
	assert.equal(closed, 1);
});

runTest("zellij settings modal switches tabs with left/right", () => {
	const settingsModal = new ZellijSettingsModal(
		{
			title: "Tabs",
			tabs: [
				{ label: "General", settings: [{ id: "a", label: "Alpha", currentValue: "on", values: ["on", "off"] }] },
				{ label: "Other", settings: [{ id: "b", label: "Beta", currentValue: "x", values: ["x", "y"] }] },
			],
			onChange: () => {},
			onClose: () => {},
			helpText: "Config: /tmp/x.json",
		},
		createThemeStub() as never,
	);
	assert.ok(settingsModal.render(60).map(stripAnsi).includes("[ General ]  Other  "));
	settingsModal.handleInput("\x1b[C");
	const lines = settingsModal.render(60).map(stripAnsi);
	assert.ok(lines.includes("  General  [ Other ]"));
	assert.ok(lines.some((line) => /→ Beta +x/.test(line)));
	assert.ok(lines.includes("Config: /tmp/x.json"));
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
