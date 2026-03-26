import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { env } from "node:process";
import {
	aggregateLinterOutput,
	aggregateTestOutput,
	compactGitOutput,
	detectLanguage,
	filterBuildOutput,
	filterSourceCode,
	groupSearchResults,
	sanitizeRtkEmojiOutput,
	smartTruncate,
	stripAnsiFast,
	stripRtkHookWarnings,
	truncate,
} from "./techniques/index.js";
import { trackOutputSavings } from "./output-metrics.js";
import { toRecord } from "./record-utils.js";
import type { RtkIntegrationConfig } from "./types.js";

interface ContentBlock {
	type: string;
	text?: string;
	[key: string]: unknown;
}

interface ToolResultLikeEvent {
	toolName: string;
	input?: unknown;
	content?: unknown;
}

export interface ToolResultCompactionMetadata {
	applied: boolean;
	techniques: string[];
	truncated: boolean;
	originalCharCount: number;
	compactedCharCount: number;
	originalLineCount: number;
	compactedLineCount: number;
}

export interface ToolResultCompactionOutcome {
	changed: boolean;
	content?: unknown[];
	techniques: string[];
	metadata?: ToolResultCompactionMetadata;
}

const LOSSY_TECHNIQUE_PREFIXES = [
	"build",
	"test",
	"git",
	"linter",
	"search",
	"truncate",
	"smart-truncate",
	"source:",
] as const;

const READ_EXACT_OUTPUT_LINE_THRESHOLD = 80;
const READ_COMPACTION_BANNER_PREFIX = "[RTK compacted output:";
const USER_SKILL_ROOTS = [
	join(
		...(env["PI_CODING_AGENT_DIR"]
			? [env["PI_CODING_AGENT_DIR"]]
			: [homedir(), ".pi", "agent"]),
		"skills",
	),
	join(homedir(), ".agents", "skills"),
];

function normalizePathForComparison(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

function isPathUnderRoot(targetPath: string, rootPath: string): boolean {
	const normalizedTarget = normalizePathForComparison(resolve(targetPath));
	const normalizedRoot = normalizePathForComparison(resolve(rootPath));
	if (normalizedTarget === normalizedRoot) {
		return true;
	}

	const rootWithSeparator = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
	return normalizedTarget.startsWith(rootWithSeparator);
}

function isUnderAnyAncestorAgentsSkills(targetPath: string): boolean {
	let currentDir = resolve(process.cwd());
	while (true) {
		if (isPathUnderRoot(targetPath, join(currentDir, ".agents", "skills"))) {
			return true;
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			return false;
		}

		currentDir = parentDir;
	}
}

function isSkillReadPath(filePath: string): boolean {
	if (!filePath.trim()) {
		return false;
	}

	const resolvedPath = resolve(filePath);
	if (USER_SKILL_ROOTS.some((root) => isPathUnderRoot(resolvedPath, root))) {
		return true;
	}

	if (isPathUnderRoot(resolvedPath, join(process.cwd(), ".pi", "skills"))) {
		return true;
	}

	return isUnderAnyAncestorAgentsSkills(resolvedPath);
}

function toArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function normalizeCommand(input: Record<string, unknown>): string | undefined {
	const raw = input.command;
	if (typeof raw === "string" && raw.trim()) {
		return raw;
	}
	return undefined;
}

function normalizePath(input: Record<string, unknown>): string {
	const raw = input.path;
	if (typeof raw === "string") {
		return raw;
	}
	return "";
}

function hasExplicitReadRange(input: Record<string, unknown>): boolean {
	return input.offset !== undefined || input.limit !== undefined;
}

function shouldPreserveExactReadOutput(
	text: string,
	input: Record<string, unknown>,
	config: RtkIntegrationConfig,
): boolean {
	if (hasExplicitReadRange(input)) {
		return true;
	}

	if (config.outputCompaction.preserveExactSkillReads && isSkillReadPath(normalizePath(input))) {
		return true;
	}

	return countLines(text) <= READ_EXACT_OUTPUT_LINE_THRESHOLD;
}

function shouldApplyReadSourceFiltering(text: string, config: RtkIntegrationConfig): boolean {
	const compaction = config.outputCompaction;
	const lineCount = countLines(text);

	return (
		(compaction.smartTruncate.enabled && lineCount > compaction.smartTruncate.maxLines) ||
		(compaction.truncate.enabled && text.length > compaction.truncate.maxChars)
	);
}

function formatReadCompactionBanner(techniques: string[]): string {
	return `${READ_COMPACTION_BANNER_PREFIX} ${techniques.join(", ")}]`;
}

function countLines(text: string): number {
	if (!text) {
		return 0;
	}

	const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
	if (!normalized) {
		return 1;
	}

	return normalized.split("\n").length;
}

function hasLossyCompaction(techniques: string[]): boolean {
	return techniques.some((technique) =>
		LOSSY_TECHNIQUE_PREFIXES.some((prefix) =>
			prefix.endsWith(":") ? technique.startsWith(prefix) : technique === prefix,
		),
	);
}

function compactBashText(
	text: string,
	command: string | undefined,
	config: RtkIntegrationConfig,
): { text: string; techniques: string[] } {
	let nextText = text;
	const techniques: string[] = [];
	const compaction = config.outputCompaction;

	if (compaction.stripAnsi) {
		const stripped = stripAnsiFast(nextText);
		if (stripped !== nextText) {
			nextText = stripped;
			techniques.push("ansi");
		}
	}

	const withoutRtkHookWarnings = stripRtkHookWarnings(nextText, command);
	if (withoutRtkHookWarnings !== null && withoutRtkHookWarnings !== nextText) {
		nextText = withoutRtkHookWarnings;
		techniques.push("rtk-hook-warning");
	}

	const withoutRtkEmoji = sanitizeRtkEmojiOutput(nextText, command);
	if (withoutRtkEmoji !== null && withoutRtkEmoji !== nextText) {
		nextText = withoutRtkEmoji;
		techniques.push("rtk-emoji");
	}

	if (compaction.filterBuildOutput) {
		const compacted = filterBuildOutput(nextText, command);
		if (compacted !== null && compacted !== nextText) {
			nextText = compacted;
			techniques.push("build");
		}
	}

	if (compaction.aggregateTestOutput) {
		const compacted = aggregateTestOutput(nextText, command);
		if (compacted !== null && compacted !== nextText) {
			nextText = compacted;
			techniques.push("test");
		}
	}

	if (compaction.compactGitOutput) {
		const compacted = compactGitOutput(nextText, command);
		if (compacted !== null && compacted !== nextText) {
			nextText = compacted;
			techniques.push("git");
		}
	}

	if (compaction.aggregateLinterOutput) {
		const compacted = aggregateLinterOutput(nextText, command);
		if (compacted !== null && compacted !== nextText) {
			nextText = compacted;
			techniques.push("linter");
		}
	}

	if (compaction.truncate.enabled && nextText.length > compaction.truncate.maxChars) {
		nextText = truncate(nextText, compaction.truncate.maxChars);
		techniques.push("truncate");
	}

	return { text: nextText, techniques };
}

function compactReadText(
	text: string,
	filePath: string,
	config: RtkIntegrationConfig,
	preserveExactReadOutput: boolean,
): { text: string; techniques: string[] } {
	if (preserveExactReadOutput) {
		return { text, techniques: [] };
	}

	let nextText = text;
	const techniques: string[] = [];
	const compaction = config.outputCompaction;

	if (compaction.stripAnsi) {
		const stripped = stripAnsiFast(nextText);
		if (stripped !== nextText) {
			nextText = stripped;
			techniques.push("ansi");
		}
	}

	const language = detectLanguage(filePath);
	// Only apply lossy source filtering when a downstream line/char safeguard would otherwise trigger.
	if (
		compaction.sourceCodeFilteringEnabled &&
		compaction.sourceCodeFiltering !== "none" &&
		shouldApplyReadSourceFiltering(text, config)
	) {
		const filtered = filterSourceCode(nextText, language, compaction.sourceCodeFiltering);
		if (filtered !== nextText) {
			nextText = filtered;
			techniques.push(`source:${compaction.sourceCodeFiltering}`);
		}
	}

	if (compaction.smartTruncate.enabled) {
		const lineCount = nextText.split("\n").length;
		if (lineCount > compaction.smartTruncate.maxLines) {
			const compacted = smartTruncate(nextText, compaction.smartTruncate.maxLines, language);
			if (compacted !== nextText) {
				nextText = compacted;
				techniques.push("smart-truncate");
			}
		}
	}

	if (compaction.truncate.enabled && nextText.length > compaction.truncate.maxChars) {
		nextText = truncate(nextText, compaction.truncate.maxChars);
		techniques.push("truncate");
	}

	if (techniques.length > 0 && !nextText.startsWith(READ_COMPACTION_BANNER_PREFIX)) {
		nextText = `${formatReadCompactionBanner(techniques)}\n${nextText}`;
	}

	return { text: nextText, techniques };
}

function compactGrepText(text: string, config: RtkIntegrationConfig): { text: string; techniques: string[] } {
	let nextText = text;
	const techniques: string[] = [];
	const compaction = config.outputCompaction;

	if (compaction.stripAnsi) {
		const stripped = stripAnsiFast(nextText);
		if (stripped !== nextText) {
			nextText = stripped;
			techniques.push("ansi");
		}
	}

	if (compaction.groupSearchOutput) {
		const grouped = groupSearchResults(nextText);
		if (grouped !== null && grouped !== nextText) {
			nextText = grouped;
			techniques.push("search");
		}
	}

	if (compaction.truncate.enabled && nextText.length > compaction.truncate.maxChars) {
		nextText = truncate(nextText, compaction.truncate.maxChars);
		techniques.push("truncate");
	}

	return { text: nextText, techniques };
}

export function compactToolResult(
	event: ToolResultLikeEvent,
	config: RtkIntegrationConfig,
): ToolResultCompactionOutcome {
	if (!config.outputCompaction.enabled) {
		return { changed: false, techniques: [] };
	}

	const input = toRecord(event.input);
	const sourceContent = toArray(event.content);
	if (sourceContent.length === 0) {
		return { changed: false, techniques: [] };
	}

	let changed = false;
	const allTechniques = new Set<string>();
	const originalChunks: string[] = [];
	const filteredChunks: string[] = [];

	const nextContent = sourceContent.map((block) => {
		if (!block || typeof block !== "object" || Array.isArray(block)) {
			return block;
		}

		const contentBlock = block as ContentBlock;
		if (contentBlock.type !== "text" || typeof contentBlock.text !== "string") {
			return block;
		}

		let transformed = { text: contentBlock.text, techniques: [] as string[] };
		if (event.toolName === "bash") {
			transformed = compactBashText(contentBlock.text, normalizeCommand(input), config);
		} else if (event.toolName === "read") {
			const normalizedPath = normalizePath(input);
			transformed = compactReadText(
				contentBlock.text,
				normalizedPath,
				config,
				shouldPreserveExactReadOutput(contentBlock.text, input, config),
			);
		} else if (event.toolName === "grep") {
			transformed = compactGrepText(contentBlock.text, config);
		}

		for (const technique of transformed.techniques) {
			allTechniques.add(technique);
		}

		originalChunks.push(contentBlock.text);
		filteredChunks.push(transformed.text);

		if (transformed.text !== contentBlock.text) {
			changed = true;
			return { ...contentBlock, text: transformed.text };
		}

		return block;
	});

	if (!changed) {
		return { changed: false, techniques: [] };
	}

	const techniques = Array.from(allTechniques);
	const originalText = originalChunks.join("\n");
	const compactedText = filteredChunks.join("\n");

	if (config.outputCompaction.trackSavings) {
		trackOutputSavings(originalText, compactedText, event.toolName, techniques);
	}

	const metadata: ToolResultCompactionMetadata = {
		applied: true,
		techniques,
		truncated: hasLossyCompaction(techniques),
		originalCharCount: originalText.length,
		compactedCharCount: compactedText.length,
		originalLineCount: countLines(originalText),
		compactedLineCount: countLines(compactedText),
	};

	return {
		changed: true,
		content: nextContent,
		techniques,
		metadata,
	};
}
