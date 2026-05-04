export const RTK_MODES = ["rewrite", "suggest"] as const;
export const RTK_SOURCE_FILTER_LEVELS = ["none", "minimal", "aggressive"] as const;

export type RtkMode = (typeof RTK_MODES)[number];
export type RtkSourceFilterLevel = (typeof RTK_SOURCE_FILTER_LEVELS)[number];

export interface RtkOutputCompactionConfig {
	enabled: boolean;
	stripAnsi: boolean;
	readCompaction: {
		enabled: boolean;
	};
	truncate: {
		enabled: boolean;
		maxChars: number;
	};
	sourceCodeFilteringEnabled: boolean;
	preserveExactSkillReads: boolean;
	sourceCodeFiltering: RtkSourceFilterLevel;
	smartTruncate: {
		enabled: boolean;
		maxLines: number;
	};
	aggregateTestOutput: boolean;
	filterBuildOutput: boolean;
	compactGitOutput: boolean;
	aggregateLinterOutput: boolean;
	groupSearchOutput: boolean;
	trackSavings: boolean;
}

export interface RtkIntegrationConfig {
	enabled: boolean;
	mode: RtkMode;
	guardWhenRtkMissing: boolean;
	showRewriteNotifications: boolean;
	outputCompaction: RtkOutputCompactionConfig;
}

export const DEFAULT_RTK_INTEGRATION_CONFIG: RtkIntegrationConfig = {
	enabled: true,
	mode: "rewrite",
	guardWhenRtkMissing: true,
	showRewriteNotifications: true,
	outputCompaction: {
		enabled: true,
		stripAnsi: true,
		readCompaction: {
			enabled: false,
		},
		truncate: {
			enabled: true,
			maxChars: 12_000,
		},
		sourceCodeFilteringEnabled: false,
		preserveExactSkillReads: false,
		sourceCodeFiltering: "none",
		smartTruncate: {
			enabled: false,
			maxLines: 220,
		},
		aggregateTestOutput: true,
		filterBuildOutput: true,
		compactGitOutput: true,
		aggregateLinterOutput: true,
		groupSearchOutput: true,
		trackSavings: true,
	},
};

export interface ConfigLoadResult {
	config: RtkIntegrationConfig;
	warning?: string;
}

export interface ConfigSaveResult {
	success: boolean;
	error?: string;
}

export interface EnsureConfigResult {
	created: boolean;
	error?: string;
}

export interface RuntimeStatus {
	rtkAvailable: boolean;
	lastCheckedAt?: number;
	lastError?: string;
	rtkExecutablePath?: string;
	rtkExecutableCommand?: string;
	rtkExecutableResolver?: string;
	rtkExecutableResolutionWarning?: string;
}

