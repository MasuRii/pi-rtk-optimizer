import { isToolCallEventType, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	ensureConfigExists,
	getRtkIntegrationConfigPath,
	loadRtkIntegrationConfig,
	normalizeRtkIntegrationConfig,
	saveRtkIntegrationConfig,
} from "./config-store.js";
import { computeRewriteDecision } from "./command-rewriter.js";
import { registerRtkIntegrationCommand } from "./config-modal.js";
import { EXTENSION_NAME } from "./constants.js";
import { clearOutputMetrics, getOutputMetricsSummary } from "./output-metrics.js";
import { compactToolResult, type ToolResultCompactionMetadata } from "./output-compactor.js";
import { toRecord } from "./record-utils.js";
import { applyRtkCommandEnvironment } from "./rtk-command-environment.js";
import { applyRewrittenCommandShellSafetyFixups } from "./rewrite-pipeline-safety.js";
import { shouldRequireRtkAvailabilityForCommandHandling, shouldSkipCommandHandlingWhenRtkMissing } from "./runtime-guard.js";
import { sanitizeStreamingBashExecutionResult } from "./tool-execution-sanitizer.js";
import type { RtkIntegrationConfig, RuntimeStatus } from "./types.js";
import { applyWindowsBashCompatibilityFixes } from "./windows-command-helpers.js";

function trimMessage(raw: string, maxLength = 220): string {
	const clean = raw.replace(/\s+/g, " ").trim();
	if (clean.length <= maxLength) {
		return clean;
	}
	return `${clean.slice(0, maxLength - 1)}…`;
}

const SOURCE_FILTER_TROUBLESHOOTING_NOTE =
	"RTK note: If file edits repeatedly fail because old text does not match, ask the user to manually run '/rtk' in the Pi TUI, disable 'Read source filtering enabled', re-read the file, apply the edit, then ask the user to manually re-enable it in the Pi TUI.";

export function shouldInjectSourceFilterTroubleshootingNote(config: RtkIntegrationConfig): boolean {
	const compaction = config.outputCompaction;
	return (
		config.enabled &&
		compaction.enabled &&
		compaction.sourceCodeFilteringEnabled &&
		compaction.sourceCodeFiltering !== "none" &&
		(compaction.smartTruncate.enabled || compaction.truncate.enabled)
	);
}

function mergeCompactionDetails(
	existingDetails: unknown,
	compaction: ToolResultCompactionMetadata,
): Record<string, unknown> {
	const baseDetails = toRecord(existingDetails);
	const baseMetadata = toRecord(baseDetails.metadata);

	const nextDetails: Record<string, unknown> = {
		...baseDetails,
		rtkCompaction: compaction,
		metadata: {
			...baseMetadata,
			rtkCompaction: compaction,
		},
	};

	if (Object.keys(baseDetails).length === 0 && existingDetails !== undefined) {
		nextDetails.rawDetails = existingDetails;
	}

	return nextDetails;
}

export interface BoundedNoticeTracker {
	remember(key: string): boolean;
	reset(): void;
}

export function createBoundedNoticeTracker(maxEntries: number): BoundedNoticeTracker {
	const normalizedLimit = Math.max(1, Math.floor(maxEntries));
	const seen = new Set<string>();
	const order: string[] = [];

	return {
		remember(key: string): boolean {
			if (seen.has(key)) {
				return false;
			}

			seen.add(key);
			order.push(key);
			while (order.length > normalizedLimit) {
				const evicted = order.shift();
				if (evicted !== undefined) {
					seen.delete(evicted);
				}
			}

			return true;
		},
		reset(): void {
			seen.clear();
			order.length = 0;
		},
	};
}

export default function rtkIntegrationExtension(pi: ExtensionAPI): void {
	const initialLoad = loadRtkIntegrationConfig();
	let config: RtkIntegrationConfig = initialLoad.config;
	let pendingLoadWarning = initialLoad.warning;
	let runtimeStatus: RuntimeStatus = { rtkAvailable: false };
	const warnedMessages = createBoundedNoticeTracker(100);
	const suggestionNotices = createBoundedNoticeTracker(200);
	const activeBashCommands = new Map<string, string>();
	let missingRtkWarningShown = false;

	const formatRewriteNotice = (originalCommand: string, rewrittenCommand: string): string => {
		const original = trimMessage(originalCommand, 100);
		const rewritten = trimMessage(rewrittenCommand, 120);
		return `RTK rewrite: ${original} -> ${rewritten}`;
	};

	const warnOnce = (
		ctx: ExtensionContext | ExtensionCommandContext,
		message: string,
		level: "warning" | "error" = "warning",
	): void => {
		if (!warnedMessages.remember(message)) {
			return;
		}

		console.warn(`[${EXTENSION_NAME}] ${message}`);
		if (ctx.hasUI) {
			ctx.ui.notify(message, level);
		}
	};

	const clearTrackedBashCommands = (): void => {
		activeBashCommands.clear();
	};

	const trackBashCommand = (toolCallId: unknown, args: unknown): void => {
		if (typeof toolCallId !== "string") {
			return;
		}

		const argsRecord = toRecord(args);
		const command = typeof argsRecord.command === "string" ? argsRecord.command.trim() : "";
		if (!command) {
			activeBashCommands.delete(toolCallId);
			return;
		}

		activeBashCommands.set(toolCallId, command);
	};

	const getTrackedBashCommand = (toolCallId: unknown): string | undefined => {
		if (typeof toolCallId !== "string") {
			return undefined;
		}

		return activeBashCommands.get(toolCallId);
	};

	const forgetTrackedBashCommand = (toolCallId: unknown): void => {
		if (typeof toolCallId !== "string") {
			return;
		}

		activeBashCommands.delete(toolCallId);
	};

	const refreshConfig = async (ctx?: ExtensionContext | ExtensionCommandContext): Promise<void> => {
		const ensured = ensureConfigExists();
		if (ensured.error && ctx) {
			warnOnce(ctx, ensured.error);
		}

		const loaded = loadRtkIntegrationConfig();
		config = loaded.config;
		pendingLoadWarning = loaded.warning;
		await refreshRuntimeStatus();

		if (pendingLoadWarning && ctx) {
			warnOnce(ctx, pendingLoadWarning);
			pendingLoadWarning = undefined;
		}
	};

	const setConfig = (next: RtkIntegrationConfig, ctx: ExtensionCommandContext): void => {
		config = normalizeRtkIntegrationConfig(next);
		const saved = saveRtkIntegrationConfig(config);
		if (!saved.success && saved.error) {
			ctx.ui.notify(saved.error, "error");
		}
	};

	const refreshRuntimeStatus = async (): Promise<RuntimeStatus> => {
		try {
			const result = await pi.exec("rtk", ["--version"], { timeout: 5000 });
			if (result.code === 0) {
				runtimeStatus = {
					rtkAvailable: true,
					lastCheckedAt: Date.now(),
				};
				missingRtkWarningShown = false;
				return runtimeStatus;
			}

			const detail = trimMessage(
				`${result.stderr || ""} ${result.stdout || ""} ${result.code ? `(exit ${result.code})` : ""}`,
			);
			runtimeStatus = {
				rtkAvailable: false,
				lastCheckedAt: Date.now(),
				lastError: detail || `exit ${result.code}`,
			};
			return runtimeStatus;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			runtimeStatus = {
				rtkAvailable: false,
				lastCheckedAt: Date.now(),
				lastError: trimMessage(message),
			};
			return runtimeStatus;
		}
	};

	const maybeWarnRtkMissing = (ctx: ExtensionContext): void => {
		if (!config.enabled || config.mode !== "rewrite" || !config.guardWhenRtkMissing) {
			return;
		}

		if (runtimeStatus.rtkAvailable) {
			missingRtkWarningShown = false;
			return;
		}

		if (missingRtkWarningShown) {
			return;
		}

		missingRtkWarningShown = true;
		const reason = runtimeStatus.lastError ? ` (${runtimeStatus.lastError})` : "";
		warnOnce(ctx, `${EXTENSION_NAME}: rtk binary unavailable, command rewrite bypassed${reason}.`);
	};

	const ensureRuntimeStatusFresh = async (): Promise<void> => {
		if (!shouldRequireRtkAvailabilityForCommandHandling(config)) {
			return;
		}

		const now = Date.now();
		const isStale = !runtimeStatus.lastCheckedAt || now - runtimeStatus.lastCheckedAt > 30_000;
		if (isStale) {
			await refreshRuntimeStatus();
		}
	};

	const controller = {
		getConfig: () => config,
		setConfig,
		getConfigPath: getRtkIntegrationConfigPath,
		getRuntimeStatus: () => runtimeStatus,
		refreshRuntimeStatus,
		getMetricsSummary: getOutputMetricsSummary,
		clearMetrics: clearOutputMetrics,
	};

	registerRtkIntegrationCommand(pi, controller);

	pi.on("session_start", async (_event, ctx) => {
		warnedMessages.reset();
		suggestionNotices.reset();
		clearTrackedBashCommands();
		missingRtkWarningShown = false;
		await refreshConfig(ctx);
		maybeWarnRtkMissing(ctx);
	});


	pi.on("agent_end", async () => {
		clearTrackedBashCommands();
	});

	pi.on("tool_execution_start", async (event) => {
		if (!config.enabled || !config.outputCompaction.enabled) {
			return;
		}

		const eventRecord = toRecord(event);
		if (eventRecord.toolName !== "bash") {
			return;
		}

		trackBashCommand(eventRecord.toolCallId, eventRecord.args);
	});

	pi.on("tool_execution_update", async (event) => {
		if (!config.enabled || !config.outputCompaction.enabled) {
			return;
		}

		const eventRecord = toRecord(event);
		if (eventRecord.toolName !== "bash") {
			return;
		}

		trackBashCommand(eventRecord.toolCallId, eventRecord.args);
		sanitizeStreamingBashExecutionResult(
			eventRecord.partialResult,
			getTrackedBashCommand(eventRecord.toolCallId),
		);
	});

	pi.on("tool_execution_end", async (event) => {
		const eventRecord = toRecord(event);
		if (eventRecord.toolName !== "bash") {
			return;
		}

		try {
			if (config.enabled && config.outputCompaction.enabled) {
				sanitizeStreamingBashExecutionResult(eventRecord.result, getTrackedBashCommand(eventRecord.toolCallId));
			}
		} finally {
			forgetTrackedBashCommand(eventRecord.toolCallId);
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		await ensureRuntimeStatusFresh();
		maybeWarnRtkMissing(ctx);

		if (!shouldInjectSourceFilterTroubleshootingNote(config)) {
			return {};
		}

		if (event.systemPrompt.includes(SOURCE_FILTER_TROUBLESHOOTING_NOTE)) {
			return {};
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n${SOURCE_FILTER_TROUBLESHOOTING_NOTE}`,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!config.enabled) {
			return {};
		}

		if (!isToolCallEventType("bash", event)) {
			return {};
		}

		if (config.mode === "rewrite") {
			const compatibility = applyWindowsBashCompatibilityFixes(event.input.command);
			if (compatibility.command !== event.input.command) {
				event.input.command = compatibility.command;
			}
		}

		await ensureRuntimeStatusFresh();
		if (shouldSkipCommandHandlingWhenRtkMissing(config, runtimeStatus)) {
			return {};
		}

		const decision = computeRewriteDecision(event.input.command, config);
		if (!decision.changed || !decision.rule) {
			return {};
		}

		if (config.mode === "rewrite") {
			if (config.showRewriteNotifications && ctx.hasUI) {
				ctx.ui.notify(formatRewriteNotice(decision.originalCommand, decision.rewrittenCommand), "info");
			}
			const envScopedRewrittenCommand = applyRtkCommandEnvironment(decision.rewrittenCommand);
			event.input.command = applyRewrittenCommandShellSafetyFixups(envScopedRewrittenCommand);
			return {};
		}

		if (config.mode === "suggest") {
			const suggestionKey = `${decision.rule.id}:${decision.rewrittenCommand}`;
			if (suggestionNotices.remember(suggestionKey) && ctx.hasUI) {
				ctx.ui.notify(`RTK suggestion: ${decision.rewrittenCommand}`, "info");
			}
		}

		return {};
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!config.enabled || !config.outputCompaction.enabled) {
			return {};
		}

		try {
			const outcome = compactToolResult(
				{
					toolName: event.toolName,
					input: event.input,
					content: event.content,
				},
				config,
			);

			if (!outcome.changed || !outcome.content) {
				return {};
			}

			return {
				content: outcome.content,
				details: outcome.metadata ? mergeCompactionDetails(event.details, outcome.metadata) : undefined,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnOnce(ctx, `${EXTENSION_NAME}: output compaction failed, using raw output (${trimMessage(message)}).`);
			return {};
		}
	});
}
