import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { SettingItem } from "@mariozechner/pi-tui";
import { toOnOff } from "./boolean-format.js";
import { ZellijModal, ZellijSettingsModal } from "./zellij-modal.js";
import { getRtkArgumentCompletions } from "./command-completions.js";
import {
	DEFAULT_RTK_INTEGRATION_CONFIG,
	RTK_SOURCE_FILTER_LEVELS,
	type RtkIntegrationConfig,
	type RuntimeStatus,
} from "./types.js";

interface RtkIntegrationController {
	getConfig(): RtkIntegrationConfig;
	setConfig(next: RtkIntegrationConfig, ctx: ExtensionCommandContext): void;
	getConfigPath(): string;
	getRuntimeStatus(): RuntimeStatus;
	refreshRuntimeStatus(): Promise<RuntimeStatus>;
	getMetricsSummary(): string;
	clearMetrics(): void;
}

interface SettingValueSyncTarget {
	updateValue(id: string, value: string): void;
}

const ON_OFF = ["on", "off"];
const MODE_VALUES = ["rewrite", "suggest"];
const SOURCE_FILTER_VALUES = [...RTK_SOURCE_FILTER_LEVELS];
const TRUNCATE_MAX_CHAR_VALUES = ["4000", "8000", "12000", "20000", "50000", "100000", "200000"];
const SMART_TRUNCATE_LINE_VALUES = ["40", "80", "120", "160", "220", "320", "500", "1000", "2000", "4000"];
const RTK_USAGE_TEXT =
	"Usage: /rtk [show|path|verify|stats|clear-stats|reset|help] (or run /rtk with no args to open settings modal)";

function parseSourceFilterLevel(
	value: string,
): RtkIntegrationConfig["outputCompaction"]["sourceCodeFiltering"] | undefined {
	return SOURCE_FILTER_VALUES.includes(value as (typeof SOURCE_FILTER_VALUES)[number])
		? (value as RtkIntegrationConfig["outputCompaction"]["sourceCodeFiltering"])
		: undefined;
}

function parseIntegerInRange(value: string, min: number, max: number): number | undefined {
	if (!/^\d+$/.test(value)) {
		return undefined;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
		return undefined;
	}

	return parsed;
}

function summarizeConfig(config: RtkIntegrationConfig, runtimeStatus: RuntimeStatus): string {
	const runtime = runtimeStatus.rtkAvailable
		? "rtk=available"
		: `rtk=missing${runtimeStatus.lastError ? ` (${runtimeStatus.lastError})` : ""}`;

	return `enabled=${config.enabled}, mode=${config.mode}, rewriteSource=rtk, rewriteNotice=${config.showRewriteNotifications}, compaction=${config.outputCompaction.enabled}, readCompaction=${config.outputCompaction.readCompaction.enabled}, sourceFilterEnabled=${config.outputCompaction.sourceCodeFilteringEnabled}, preserveSkillReads=${config.outputCompaction.preserveExactSkillReads}, sourceFilter=${config.outputCompaction.sourceCodeFiltering}, ${runtime}`;
}

function buildSettingItems(config: RtkIntegrationConfig): SettingItem[] {
	return [
		{
			id: "enabled",
			label: "RTK integration enabled",
			description: "Master switch for rewrite, suggestions, and output compaction",
			currentValue: toOnOff(config.enabled),
			values: ON_OFF,
		},
		{
			id: "mode",
			label: "Rewrite mode",
			description: "rewrite = auto-rewrite bash commands, suggest = notify only",
			currentValue: config.mode,
			values: MODE_VALUES,
		},
		{
			id: "showRewriteNotifications",
			label: "Show rewrite notifications",
			description: "Show 'RTK rewrite: old -> new' notice in TUI",
			currentValue: toOnOff(config.showRewriteNotifications),
			values: ON_OFF,
		},
		{
			id: "guardWhenRtkMissing",
			label: "Guard when rtk missing",
			description: "If on, raw commands run unchanged when rtk binary is unavailable",
			currentValue: toOnOff(config.guardWhenRtkMissing),
			values: ON_OFF,
		},
		{
			id: "outputCompactionEnabled",
			label: "Output compaction enabled",
			description: "Compact bash/read/grep tool results to reduce token usage",
			currentValue: toOnOff(config.outputCompaction.enabled),
			values: ON_OFF,
		},
		{
			id: "outputStripAnsi",
			label: "Strip ANSI in output",
			description: "Remove color/control codes from tool output before further compaction",
			currentValue: toOnOff(config.outputCompaction.stripAnsi),
			values: ON_OFF,
		},
		{
			id: "outputReadCompactionEnabled",
			label: "Read compaction enabled",
			description: "If off, read tool output stays exact; build/test/git/grep compaction can still run",
			currentValue: toOnOff(config.outputCompaction.readCompaction.enabled),
			values: ON_OFF,
		},
		{
			id: "outputTruncateEnabled",
			label: "Hard truncation enabled",
			description: "Apply max character cap after other compaction techniques",
			currentValue: toOnOff(config.outputCompaction.truncate.enabled),
			values: ON_OFF,
		},
		{
			id: "outputTruncateMaxChars",
			label: "Hard truncation max chars",
			description: "Maximum characters kept when hard truncation is enabled",
			currentValue: String(config.outputCompaction.truncate.maxChars),
			values: TRUNCATE_MAX_CHAR_VALUES,
		},
		{
			id: "outputSourceFilteringEnabled",
			label: "Read source filtering enabled",
			description: "If off, read output skips source-code filtering regardless of selected level",
			currentValue: toOnOff(config.outputCompaction.sourceCodeFilteringEnabled),
			values: ON_OFF,
		},
		{
			id: "outputPreserveExactSkillReads",
			label: "Preserve exact skill reads",
			description: "If on, read results under the global Pi skills directory (default: ~/.pi/agent/skills, respects PI_CODING_AGENT_DIR), ~/.agents/skills, .pi/skills, and ancestor .agents/skills skip read compaction",
			currentValue: toOnOff(config.outputCompaction.preserveExactSkillReads),
			values: ON_OFF,
		},
		{
			id: "outputSourceFiltering",
			label: "Read source filtering",
			description: "none|minimal|aggressive for read output compaction",
			currentValue: config.outputCompaction.sourceCodeFiltering,
			values: SOURCE_FILTER_VALUES,
		},
		{
			id: "outputSmartTruncate",
			label: "Read smart truncation",
			description: "Keep signatures/imports when read output has many lines",
			currentValue: toOnOff(config.outputCompaction.smartTruncate.enabled),
			values: ON_OFF,
		},
		{
			id: "outputSmartTruncateMaxLines",
			label: "Read smart truncation max lines",
			description: "Target max lines for smart truncation in read outputs",
			currentValue: String(config.outputCompaction.smartTruncate.maxLines),
			values: SMART_TRUNCATE_LINE_VALUES,
		},
		{
			id: "outputAggregateTestOutput",
			label: "Aggregate test output",
			description: "Summarize test command output to failures and key totals",
			currentValue: toOnOff(config.outputCompaction.aggregateTestOutput),
			values: ON_OFF,
		},
		{
			id: "outputFilterBuildOutput",
			label: "Filter build output",
			description: "Reduce build noise and keep key error/warning lines",
			currentValue: toOnOff(config.outputCompaction.filterBuildOutput),
			values: ON_OFF,
		},
		{
			id: "outputCompactGitOutput",
			label: "Compact git output",
			description: "Condense git command output for lower token usage",
			currentValue: toOnOff(config.outputCompaction.compactGitOutput),
			values: ON_OFF,
		},
		{
			id: "outputAggregateLinterOutput",
			label: "Aggregate linter output",
			description: "Summarize linter output by file and issue type",
			currentValue: toOnOff(config.outputCompaction.aggregateLinterOutput),
			values: ON_OFF,
		},
		{
			id: "outputGroupSearchOutput",
			label: "Group search output",
			description: "Group grep/search matches by file with counts",
			currentValue: toOnOff(config.outputCompaction.groupSearchOutput),
			values: ON_OFF,
		},
		{
			id: "outputTrackSavings",
			label: "Track output savings",
			description: "Collect in-session compaction metrics for /rtk stats",
			currentValue: toOnOff(config.outputCompaction.trackSavings),
			values: ON_OFF,
		},
	];
}

function applySetting(config: RtkIntegrationConfig, id: string, value: string): RtkIntegrationConfig {
	switch (id) {
		case "enabled":
			return { ...config, enabled: value === "on" };
		case "mode":
			return { ...config, mode: value === "suggest" ? "suggest" : "rewrite" };
		case "showRewriteNotifications":
			return { ...config, showRewriteNotifications: value === "on" };
		case "guardWhenRtkMissing":
			return { ...config, guardWhenRtkMissing: value === "on" };
		case "outputCompactionEnabled":
			return {
				...config,
				outputCompaction: { ...config.outputCompaction, enabled: value === "on" },
			};
		case "outputStripAnsi":
			return {
				...config,
				outputCompaction: { ...config.outputCompaction, stripAnsi: value === "on" },
			};
		case "outputReadCompactionEnabled":
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					readCompaction: { enabled: value === "on" },
				},
			};
		case "outputTruncateEnabled":
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					truncate: {
						...config.outputCompaction.truncate,
						enabled: value === "on",
					},
				},
			};
		case "outputTruncateMaxChars": {
			const parsed = parseIntegerInRange(value, 1_000, 200_000);
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					truncate: {
						...config.outputCompaction.truncate,
						maxChars: parsed ?? config.outputCompaction.truncate.maxChars,
					},
				},
			};
		}
		case "outputSourceFilteringEnabled":
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					sourceCodeFilteringEnabled: value === "on",
				},
			};
		case "outputPreserveExactSkillReads":
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					preserveExactSkillReads: value === "on",
				},
			};
		case "outputSourceFiltering": {
			const parsedValue = parseSourceFilterLevel(value);
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					sourceCodeFiltering: parsedValue ?? config.outputCompaction.sourceCodeFiltering,
				},
			};
		}
		case "outputSmartTruncate":
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					smartTruncate: {
						...config.outputCompaction.smartTruncate,
						enabled: value === "on",
					},
				},
			};
		case "outputSmartTruncateMaxLines": {
			const parsed = parseIntegerInRange(value, 40, 4_000);
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					smartTruncate: {
						...config.outputCompaction.smartTruncate,
						maxLines: parsed ?? config.outputCompaction.smartTruncate.maxLines,
					},
				},
			};
		}
		case "outputAggregateTestOutput":
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					aggregateTestOutput: value === "on",
				},
			};
		case "outputFilterBuildOutput":
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					filterBuildOutput: value === "on",
				},
			};
		case "outputCompactGitOutput":
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					compactGitOutput: value === "on",
				},
			};
		case "outputAggregateLinterOutput":
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					aggregateLinterOutput: value === "on",
				},
			};
		case "outputGroupSearchOutput":
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					groupSearchOutput: value === "on",
				},
			};
		case "outputTrackSavings":
			return {
				...config,
				outputCompaction: {
					...config.outputCompaction,
					trackSavings: value === "on",
				},
			};
		default:
			return config;
	}
}

function syncSettingValues(settingsList: SettingValueSyncTarget, config: RtkIntegrationConfig): void {
	settingsList.updateValue("enabled", toOnOff(config.enabled));
	settingsList.updateValue("mode", config.mode);
	settingsList.updateValue("showRewriteNotifications", toOnOff(config.showRewriteNotifications));
	settingsList.updateValue("guardWhenRtkMissing", toOnOff(config.guardWhenRtkMissing));
	settingsList.updateValue("outputCompactionEnabled", toOnOff(config.outputCompaction.enabled));
	settingsList.updateValue("outputStripAnsi", toOnOff(config.outputCompaction.stripAnsi));
	settingsList.updateValue("outputReadCompactionEnabled", toOnOff(config.outputCompaction.readCompaction.enabled));
	settingsList.updateValue("outputTruncateEnabled", toOnOff(config.outputCompaction.truncate.enabled));
	settingsList.updateValue("outputTruncateMaxChars", String(config.outputCompaction.truncate.maxChars));
	settingsList.updateValue("outputSourceFilteringEnabled", toOnOff(config.outputCompaction.sourceCodeFilteringEnabled));
	settingsList.updateValue("outputPreserveExactSkillReads", toOnOff(config.outputCompaction.preserveExactSkillReads));
	settingsList.updateValue("outputSourceFiltering", config.outputCompaction.sourceCodeFiltering);
	settingsList.updateValue("outputSmartTruncate", toOnOff(config.outputCompaction.smartTruncate.enabled));
	settingsList.updateValue("outputSmartTruncateMaxLines", String(config.outputCompaction.smartTruncate.maxLines));
	settingsList.updateValue("outputAggregateTestOutput", toOnOff(config.outputCompaction.aggregateTestOutput));
	settingsList.updateValue("outputFilterBuildOutput", toOnOff(config.outputCompaction.filterBuildOutput));
	settingsList.updateValue("outputCompactGitOutput", toOnOff(config.outputCompaction.compactGitOutput));
	settingsList.updateValue("outputAggregateLinterOutput", toOnOff(config.outputCompaction.aggregateLinterOutput));
	settingsList.updateValue("outputGroupSearchOutput", toOnOff(config.outputCompaction.groupSearchOutput));
	settingsList.updateValue("outputTrackSavings", toOnOff(config.outputCompaction.trackSavings));
}

async function openSettingsModal(ctx: ExtensionCommandContext, controller: RtkIntegrationController): Promise<void> {
	const overlayOptions = { anchor: "center" as const, width: 86, maxHeight: "85%" as const, margin: 1 };

	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			let current = controller.getConfig();
			let settingsModal: ZellijSettingsModal | null = null;

			settingsModal = new ZellijSettingsModal(
				{
					title: "RTK Integration Settings",
					description: "Bash rewrite + tool output compaction for lower token usage",
					settings: buildSettingItems(current),
					onChange: (id, newValue) => {
						current = applySetting(current, id, newValue);
						controller.setConfig(current, ctx);
						current = controller.getConfig();
						if (settingsModal) {
							syncSettingValues(settingsModal, current);
						}
					},
					onClose: () => done(),
					helpText: `/rtk show • /rtk verify • /rtk stats • /rtk reset • ${controller.getConfigPath()}`,
					enableSearch: true,
				},
				theme,
			);

			const modal = new ZellijModal(
				settingsModal,
				{
					borderStyle: "rounded",
					titleBar: {
						left: "RTK Integration Settings",
						right: "pi-rtk-optimizer",
					},
					helpUndertitle: {
						text: "Esc: close | ↑↓: navigate | Space: toggle",
						color: "dim",
					},
					overlay: overlayOptions,
				},
				theme,
			);

			return {
				render(width: number) {
					return modal.renderModal(width).lines;
				},
				invalidate() {
					modal.invalidate();
				},
				handleInput(data: string) {
					modal.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{ overlay: true, overlayOptions },
	);
}

async function handleArgs(
	args: string,
	ctx: ExtensionCommandContext,
	controller: RtkIntegrationController,
): Promise<boolean> {
	const normalized = (args ?? "").trim().toLowerCase();
	if (!normalized) {
		return false;
	}

	if (normalized === "help") {
		ctx.ui.notify(RTK_USAGE_TEXT, "info");
		return true;
	}

	if (normalized === "show") {
		ctx.ui.notify(`rtk: ${summarizeConfig(controller.getConfig(), controller.getRuntimeStatus())}`, "info");
		return true;
	}

	if (normalized === "path") {
		ctx.ui.notify(`rtk config: ${controller.getConfigPath()}`, "info");
		return true;
	}

	if (normalized === "verify") {
		const runtimeStatus = await controller.refreshRuntimeStatus();
		if (runtimeStatus.rtkAvailable) {
			ctx.ui.notify("RTK binary is available.", "info");
		} else {
			ctx.ui.notify(
				`RTK binary is not available${runtimeStatus.lastError ? `: ${runtimeStatus.lastError}` : ""}.`,
				"warning",
			);
		}
		return true;
	}

	if (normalized === "stats") {
		ctx.ui.notify(controller.getMetricsSummary(), "info");
		return true;
	}

	if (normalized === "clear-stats") {
		controller.clearMetrics();
		ctx.ui.notify("RTK metrics cleared.", "info");
		return true;
	}

	if (normalized === "reset") {
		controller.setConfig({ ...DEFAULT_RTK_INTEGRATION_CONFIG }, ctx);
		ctx.ui.notify("RTK integration settings reset to defaults.", "info");
		return true;
	}

	ctx.ui.notify(RTK_USAGE_TEXT, "warning");
	return true;
}

export function registerRtkIntegrationCommand(pi: ExtensionAPI, controller: RtkIntegrationController): void {
	pi.registerCommand("rtk", {
		description: "Configure RTK rewrite and output compaction integration",
		getArgumentCompletions: getRtkArgumentCompletions,
		handler: async (args, ctx) => {
			if (await handleArgs(args, ctx, controller)) {
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("/rtk requires interactive TUI mode.", "warning");
				return;
			}

			await openSettingsModal(ctx, controller);
		},
	});
}
