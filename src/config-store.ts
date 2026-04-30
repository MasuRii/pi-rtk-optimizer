import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_PATH } from "./constants.js";
import {
	DEFAULT_RTK_INTEGRATION_CONFIG,
	RTK_MODES,
	RTK_SOURCE_FILTER_LEVELS,
	type ConfigLoadResult,
	type ConfigSaveResult,
	type EnsureConfigResult,
	type RtkIntegrationConfig,
	type RtkSourceFilterLevel,
} from "./types.js";

function toBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function toInteger(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	const rounded = Math.round(value);
	return Math.max(min, Math.min(max, rounded));
}

function toMode(value: unknown): RtkIntegrationConfig["mode"] {
	return RTK_MODES.includes(value as RtkIntegrationConfig["mode"])
		? (value as RtkIntegrationConfig["mode"])
		: DEFAULT_RTK_INTEGRATION_CONFIG.mode;
}

function toSourceFilterLevel(value: unknown, fallback: RtkSourceFilterLevel): RtkSourceFilterLevel {
	return RTK_SOURCE_FILTER_LEVELS.includes(value as RtkSourceFilterLevel)
		? (value as RtkSourceFilterLevel)
		: fallback;
}

function hasOwnProperty(source: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(source, key);
}

function toObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

export function normalizeRtkIntegrationConfig(raw: unknown): RtkIntegrationConfig {
	const source = toObject(raw);
	const outputCompactionSource = toObject(source.outputCompaction);
	const readCompactionSource = toObject(outputCompactionSource.readCompaction);
	const truncateSource = toObject(outputCompactionSource.truncate);
	const smartTruncateSource = toObject(outputCompactionSource.smartTruncate);
	const hasReadCompaction = hasOwnProperty(outputCompactionSource, "readCompaction");
	const legacyReadCompactionFallback = !hasReadCompaction;
	const sourceFilteringFallback = legacyReadCompactionFallback
		? true
		: DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.sourceCodeFilteringEnabled;
	const sourceFilterLevelFallback = legacyReadCompactionFallback
		? "minimal"
		: DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.sourceCodeFiltering;
	const smartTruncateEnabledFallback = legacyReadCompactionFallback
		? true
		: DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.smartTruncate.enabled;

	return {
		enabled: toBoolean(source.enabled, DEFAULT_RTK_INTEGRATION_CONFIG.enabled),
		mode: toMode(source.mode),
		guardWhenRtkMissing: toBoolean(
			source.guardWhenRtkMissing,
			DEFAULT_RTK_INTEGRATION_CONFIG.guardWhenRtkMissing,
		),
		showRewriteNotifications: toBoolean(
			source.showRewriteNotifications,
			DEFAULT_RTK_INTEGRATION_CONFIG.showRewriteNotifications,
		),
		outputCompaction: {
			enabled: toBoolean(
				outputCompactionSource.enabled,
				DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.enabled,
			),
			stripAnsi: toBoolean(
				outputCompactionSource.stripAnsi,
				DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.stripAnsi,
			),
			readCompaction: {
				enabled: hasReadCompaction
					? toBoolean(
							readCompactionSource.enabled,
							DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.readCompaction.enabled,
						)
					: true,
			},
			sourceCodeFilteringEnabled: toBoolean(
				outputCompactionSource.sourceCodeFilteringEnabled,
				sourceFilteringFallback,
			),
			preserveExactSkillReads: toBoolean(
				outputCompactionSource.preserveExactSkillReads,
				DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.preserveExactSkillReads,
			),
			truncate: {
				enabled: toBoolean(
					truncateSource.enabled,
					DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.truncate.enabled,
				),
				maxChars: toInteger(
					truncateSource.maxChars,
					DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.truncate.maxChars,
					1_000,
					200_000,
				),
			},
			sourceCodeFiltering: toSourceFilterLevel(
				outputCompactionSource.sourceCodeFiltering,
				sourceFilterLevelFallback,
			),
			smartTruncate: {
				enabled: toBoolean(
					smartTruncateSource.enabled,
					smartTruncateEnabledFallback,
				),
				maxLines: toInteger(
					smartTruncateSource.maxLines,
					DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.smartTruncate.maxLines,
					40,
					4_000,
				),
			},
			aggregateTestOutput: toBoolean(
				outputCompactionSource.aggregateTestOutput,
				DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.aggregateTestOutput,
			),
			filterBuildOutput: toBoolean(
				outputCompactionSource.filterBuildOutput,
				DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.filterBuildOutput,
			),
			compactGitOutput: toBoolean(
				outputCompactionSource.compactGitOutput,
				DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.compactGitOutput,
			),
			aggregateLinterOutput: toBoolean(
				outputCompactionSource.aggregateLinterOutput,
				DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.aggregateLinterOutput,
			),
			groupSearchOutput: toBoolean(
				outputCompactionSource.groupSearchOutput,
				DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.groupSearchOutput,
			),
			trackSavings: toBoolean(
				outputCompactionSource.trackSavings,
				DEFAULT_RTK_INTEGRATION_CONFIG.outputCompaction.trackSavings,
			),
		},
	};
}

export function ensureConfigExists(configPath = CONFIG_PATH): EnsureConfigResult {
	if (existsSync(configPath)) {
		return { created: false };
	}

	try {
		mkdirSync(dirname(configPath), { recursive: true });
		writeFileSync(configPath, `${JSON.stringify(DEFAULT_RTK_INTEGRATION_CONFIG, null, 2)}\n`, "utf-8");
		return { created: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			created: false,
			error: `Failed to create ${configPath}: ${message}`,
		};
	}
}

export function loadRtkIntegrationConfig(configPath = CONFIG_PATH): ConfigLoadResult {
	if (!existsSync(configPath)) {
		return { config: { ...DEFAULT_RTK_INTEGRATION_CONFIG } };
	}

	try {
		const rawText = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(rawText) as unknown;
		return { config: normalizeRtkIntegrationConfig(parsed) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			config: { ...DEFAULT_RTK_INTEGRATION_CONFIG },
			warning: `Failed to parse ${configPath}: ${message}`,
		};
	}
}

export function saveRtkIntegrationConfig(
	config: RtkIntegrationConfig,
	configPath = CONFIG_PATH,
): ConfigSaveResult {
	const normalized = normalizeRtkIntegrationConfig(config);
	const tmpPath = `${configPath}.tmp`;

	try {
		mkdirSync(dirname(configPath), { recursive: true });
		writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
		renameSync(tmpPath, configPath);
		return { success: true };
	} catch (error) {
		try {
			if (existsSync(tmpPath)) {
				unlinkSync(tmpPath);
			}
		} catch {
			// Ignore cleanup failures.
		}

		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			error: `Failed to save ${configPath}: ${message}`,
		};
	}
}

export function getRtkIntegrationConfigPath(configPath = CONFIG_PATH): string {
	return configPath;
}
