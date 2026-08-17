import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
	aggregateLinterOutput,
	aggregateTestOutput,
	compactGitOutput,
	detectLanguage,
	filterBuildOutput,
	filterSourceCode,
	groupSearchResults,
	smartTruncate,
	stripAnsiFast,
	truncate,
} from "./techniques/index.js";
import { trackOutputSavings } from "./output-metrics.js";
import { mapTextContentBlocks, toRecord } from "./record-utils.js";
import type { RtkIntegrationConfig } from "./types.js";

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

interface AnchoredReadLine {
	lineNumber: number;
	content: string;
	originalLine: string;
}

interface AnchorSafeReadLine {
	text: string;
	content: string;
}

interface AnchorSafeReadParts {
	prefixLines: string[];
	anchoredLines: AnchoredReadLine[];
	suffixLines: string[];
	trailingNewline: boolean;
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
const ANCHORED_READ_LINE_MIN_MATCHES = 2;
const ANCHORED_READ_LINE_MIN_RATIO = 0.5;
const ANCHORED_READ_LINE_SAMPLE_LIMIT = 200;
const ANCHORED_READ_LINE_PATTERNS = [
	/^\s*(?:>>>|>>|[>+\-*]+)?\s*(\d+)\s*#\s*[A-Za-z0-9_-]{2,32}:(.*)$/,
	/^\s*(?:>>>|>>|[>+\-*]+)?\s*(\d+)\s*:\s*[A-Za-z0-9_-]{1,32}\|(.*)$/,
	/^\s*(?:>>>|>>|[>+\-*]+)?\s*(\d+)[a-z]{2}\|(.*)$/,
] as const;
const ANCHORED_READ_INFORMATIONAL_LINE_PATTERN = /^\s*(?:$|<\/?file>|\.{3}|\[[^\]]+\]|Read\s+.+:\s+\d+\s+lines\b)/;
const USER_SKILL_ROOTS = [join(getAgentDir(), "skills"), join(homedir(), ".agents", "skills")];

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
	for (const key of ["command", "cmd"] as const) {
		const raw = input[key];
		if (typeof raw === "string" && raw.trim()) {
			return raw;
		}
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

function splitReadLines(text: string): { lines: string[]; trailingNewline: boolean } {
	if (!text) {
		return { lines: [], trailingNewline: false };
	}

	const trailingNewline = text.endsWith("\n");
	const lines = text.split(/\r?\n/);
	if (trailingNewline) {
		lines.pop();
	}

	return { lines, trailingNewline };
}

function joinReadLines(lines: string[], trailingNewline: boolean): string {
	const joined = lines.join("\n");
	return trailingNewline && joined ? `${joined}\n` : joined;
}

function parseAnchoredReadLine(line: string): AnchoredReadLine | undefined {
	for (const pattern of ANCHORED_READ_LINE_PATTERNS) {
		const match = line.match(pattern);
		if (!match) {
			continue;
		}

		const lineNumber = Number.parseInt(match[1] ?? "", 10);
		if (!Number.isSafeInteger(lineNumber) || lineNumber <= 0) {
			continue;
		}

		const content = match[2] ?? "";
		return {
			lineNumber,
			content,
			originalLine: line,
		};
	}

	return undefined;
}

function parseAnchoredReadLineNumber(line: string): number | undefined {
	return parseAnchoredReadLine(line)?.lineNumber;
}

function looksLikeAnchoredLineOutput(text: string, parseLineNumber: (line: string) => number | undefined): boolean {
	let matchCount = 0;
	let relevantLineCount = 0;
	let previousMatchedLineNumber: number | undefined;
	let hasIncreasingAnchors = false;

	for (const line of splitReadLines(text).lines.slice(0, ANCHORED_READ_LINE_SAMPLE_LIMIT)) {
		if (!ANCHORED_READ_INFORMATIONAL_LINE_PATTERN.test(line)) {
			relevantLineCount += 1;
		}

		const lineNumber = parseLineNumber(line);
		if (lineNumber === undefined) {
			continue;
		}

		matchCount += 1;
		if (previousMatchedLineNumber !== undefined && lineNumber > previousMatchedLineNumber) {
			hasIncreasingAnchors = true;
		}
		previousMatchedLineNumber = lineNumber;
	}

	if (matchCount < ANCHORED_READ_LINE_MIN_MATCHES || !hasIncreasingAnchors) {
		return false;
	}

	const ratioBase = Math.max(relevantLineCount, matchCount);
	return matchCount / ratioBase >= ANCHORED_READ_LINE_MIN_RATIO;
}

function looksLikeAnchoredReadOutput(text: string): boolean {
	return looksLikeAnchoredLineOutput(text, parseAnchoredReadLineNumber);
}

function shouldPreserveExactReadOutput(
	text: string,
	input: Record<string, unknown>,
	config: RtkIntegrationConfig,
): boolean {
	if (!config.outputCompaction.readCompaction.enabled) {
		return true;
	}

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

function extractAnchoredReadParts(text: string): AnchorSafeReadParts | undefined {
	if (!looksLikeAnchoredReadOutput(text)) {
		return undefined;
	}

	const { lines, trailingNewline } = splitReadLines(text);
	const parsedLines = lines.map((line) => parseAnchoredReadLine(line));
	const firstAnchorIndex = parsedLines.findIndex((line) => line !== undefined);
	if (firstAnchorIndex === -1) {
		return undefined;
	}

	let lastAnchorIndex = firstAnchorIndex;
	for (let index = parsedLines.length - 1; index >= firstAnchorIndex; index -= 1) {
		if (parsedLines[index] !== undefined) {
			lastAnchorIndex = index;
			break;
		}
	}

	const anchoredLines: AnchoredReadLine[] = [];
	for (let index = firstAnchorIndex; index <= lastAnchorIndex; index += 1) {
		const anchoredLine = parsedLines[index];
		if (!anchoredLine) {
			return undefined;
		}
		anchoredLines.push(anchoredLine);
	}

	return {
		prefixLines: lines.slice(0, firstAnchorIndex),
		anchoredLines,
		suffixLines: lines.slice(lastAnchorIndex + 1),
		trailingNewline,
	};
}

function toAnchorSafeReadLines(anchoredLines: AnchoredReadLine[]): AnchorSafeReadLine[] {
	return anchoredLines.map((line) => ({
		text: line.originalLine,
		content: line.content,
	}));
}

function renderAnchorSafeReadBody(lines: AnchorSafeReadLine[]): string {
	return lines.map((line) => line.text).join("\n");
}

function renderAnchorSafeReadText(parts: AnchorSafeReadParts, lines: AnchorSafeReadLine[]): string {
	return joinReadLines(
		[...parts.prefixLines, ...lines.map((line) => line.text), ...parts.suffixLines],
		parts.trailingNewline,
	);
}

function remapTransformedContentToAnchorSafeLines(
	sourceLines: AnchorSafeReadLine[],
	transformedContent: string,
): AnchorSafeReadLine[] {
	const transformedLines = splitReadLines(transformedContent).lines;
	const remappedLines: AnchorSafeReadLine[] = [];
	let searchStartIndex = 0;

	for (const transformedLine of transformedLines) {
		let matchedIndex = -1;
		for (let index = searchStartIndex; index < sourceLines.length; index += 1) {
			if (sourceLines[index]?.content === transformedLine) {
				matchedIndex = index;
				break;
			}
		}

		if (matchedIndex === -1) {
			remappedLines.push({
				text: transformedLine,
				content: transformedLine,
			});
			continue;
		}

		remappedLines.push(sourceLines[matchedIndex]!);
		searchStartIndex = matchedIndex + 1;
	}

	return remappedLines;
}

function truncateAnchorSafeReadLines(lines: AnchorSafeReadLine[], maxChars: number): AnchorSafeReadLine[] {
	if (renderAnchorSafeReadBody(lines).length <= maxChars) {
		return lines;
	}

	const marker = "[RTK anchor-safe truncate: remaining anchored read lines omitted to preserve complete anchors]";
	const truncatedLines: AnchorSafeReadLine[] = [];
	let charCount = 0;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]!;
		const separatorLength = truncatedLines.length > 0 ? 1 : 0;
		const nextCharCount = charCount + separatorLength + line.text.length;
		const remainingAfter = lines.length - index - 1;
		const markerLength = remainingAfter > 0 ? (nextCharCount > 0 ? 1 : 0) + marker.length : 0;

		if (nextCharCount + markerLength > maxChars) {
			const markerLine = { text: marker, content: marker };
			return truncatedLines.length > 0 ? [...truncatedLines, markerLine] : [markerLine];
		}

		truncatedLines.push(line);
		charCount = nextCharCount;
	}

	return truncatedLines;
}

function compactAnchoredReadText(
	text: string,
	filePath: string,
	config: RtkIntegrationConfig,
): { text: string; techniques: string[] } {
	const parts = extractAnchoredReadParts(text);
	if (!parts) {
		return { text, techniques: [] };
	}

	let lines = toAnchorSafeReadLines(parts.anchoredLines);
	const techniques: string[] = [];
	const compaction = config.outputCompaction;
	const language = detectLanguage(filePath);

	if (
		compaction.sourceCodeFilteringEnabled &&
		compaction.sourceCodeFiltering !== "none" &&
		shouldApplyReadSourceFiltering(text, config)
	) {
		const currentSource = lines.map((line) => line.content).join("\n");
		const filtered = normalizeTechniqueResult(
			filterSourceCode(currentSource, language, compaction.sourceCodeFiltering),
			currentSource,
		);
		const filteredLines = remapTransformedContentToAnchorSafeLines(lines, filtered);
		if (renderAnchorSafeReadBody(filteredLines) !== renderAnchorSafeReadBody(lines)) {
			lines = filteredLines;
			techniques.push(`source:${compaction.sourceCodeFiltering}`);
		}
	}

	if (compaction.smartTruncate.enabled && lines.length > compaction.smartTruncate.maxLines) {
		const currentSource = lines.map((line) => line.content).join("\n");
		const compacted = smartTruncate(currentSource, compaction.smartTruncate.maxLines, language);
		const compactedLines = remapTransformedContentToAnchorSafeLines(lines, compacted);
		if (renderAnchorSafeReadBody(compactedLines) !== renderAnchorSafeReadBody(lines)) {
			lines = compactedLines;
			techniques.push("smart-truncate");
		}
	}

	if (compaction.truncate.enabled && renderAnchorSafeReadText(parts, lines).length > compaction.truncate.maxChars) {
		const nonBodyOverhead = renderAnchorSafeReadText(parts, []).length;
		const bodyMaxChars = Math.max(1, compaction.truncate.maxChars - nonBodyOverhead);
		const truncatedLines = truncateAnchorSafeReadLines(lines, bodyMaxChars);
		if (renderAnchorSafeReadBody(truncatedLines) !== renderAnchorSafeReadBody(lines)) {
			lines = truncatedLines;
			techniques.push("truncate");
		}
	}

	return {
		text: renderAnchorSafeReadText(parts, lines),
		techniques,
	};
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

function normalizeTechniqueResult(result: string | null, currentText: string): string {
	return result === null ? currentText : result;
}

interface CompactionState {
	text: string;
	techniques: string[];
}

/** Strips ANSI escape codes when enabled, recording the "ansi" technique on change. */
function applyAnsiStripping(state: CompactionState, compaction: RtkIntegrationConfig["outputCompaction"]): void {
	if (!compaction.stripAnsi) {
		return;
	}
	const stripped = stripAnsiFast(state.text);
	if (stripped !== state.text) {
		state.text = stripped;
		state.techniques.push("ansi");
	}
}

/** Applies hard character truncation when enabled and the threshold is exceeded. */
function applyTruncation(state: CompactionState, compaction: RtkIntegrationConfig["outputCompaction"]): void {
	if (compaction.truncate.enabled && state.text.length > compaction.truncate.maxChars) {
		state.text = truncate(state.text, compaction.truncate.maxChars);
		state.techniques.push("truncate");
	}
}

/**
 * Applies a single nullable-result compaction technique: runs `transform`, keeps
 * its result when it differs from the current text, and records `technique`.
 * Mirrors the `normalizeTechniqueResult(...) !== current → push` idiom shared
 * across the bash/read/grep compactors.
 */
function applyNullableTechnique(
	state: CompactionState,
	transform: (text: string) => string | null,
	technique: string,
): void {
	const compacted = normalizeTechniqueResult(transform(state.text), state.text);
	if (compacted !== state.text) {
		state.text = compacted;
		state.techniques.push(technique);
	}
}

function applyConditionalTechnique(
	state: CompactionState,
	enabled: boolean,
	transform: (text: string) => string | null,
	technique: string,
): void {
	if (enabled) {
		applyNullableTechnique(state, transform, technique);
	}
}

function beginCompaction(
	text: string,
	config: RtkIntegrationConfig,
): { state: CompactionState; compaction: RtkIntegrationConfig["outputCompaction"] } {
	const state: CompactionState = { text, techniques: [] };
	const compaction = config.outputCompaction;
	applyAnsiStripping(state, compaction);
	return { state, compaction };
}

function applyReadCompactionBanner(state: CompactionState): void {
	if (state.techniques.length > 0 && !state.text.startsWith(READ_COMPACTION_BANNER_PREFIX)) {
		state.text = `${formatReadCompactionBanner(state.techniques)}\n${state.text}`;
	}
}

function compactBashText(
	text: string,
	command: string | undefined,
	config: RtkIntegrationConfig,
): { text: string; techniques: string[] } {
	const { state, compaction } = beginCompaction(text, config);

	applyConditionalTechnique(state, compaction.filterBuildOutput, (t) => filterBuildOutput(t, command), "build");
	applyConditionalTechnique(state, compaction.aggregateTestOutput, (t) => aggregateTestOutput(t, command), "test");
	applyConditionalTechnique(state, compaction.compactGitOutput, (t) => compactGitOutput(t, command), "git");
	applyConditionalTechnique(state, compaction.aggregateLinterOutput, (t) => aggregateLinterOutput(t, command), "linter");

	applyTruncation(state, compaction);

	return { text: state.text, techniques: state.techniques };
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

	const { state, compaction } = beginCompaction(text, config);

	if (looksLikeAnchoredReadOutput(state.text)) {
		const anchored = compactAnchoredReadText(state.text, filePath, config);
		state.text = anchored.text;
		state.techniques.push(...anchored.techniques);

		applyReadCompactionBanner(state);

		return { text: state.text, techniques: state.techniques };
	}

	const language = detectLanguage(filePath);
	// Only apply lossy source filtering when a downstream line/char safeguard would otherwise trigger.
	if (
		compaction.sourceCodeFilteringEnabled &&
		compaction.sourceCodeFiltering !== "none" &&
		shouldApplyReadSourceFiltering(text, config)
	) {
		applyNullableTechnique(
			state,
			(t) => filterSourceCode(t, language, compaction.sourceCodeFiltering),
			`source:${compaction.sourceCodeFiltering}`,
		);
	}

	if (compaction.smartTruncate.enabled) {
		const lineCount = state.text.split("\n").length;
		if (lineCount > compaction.smartTruncate.maxLines) {
			const compacted = smartTruncate(state.text, compaction.smartTruncate.maxLines, language);
			if (compacted !== state.text) {
				state.text = compacted;
				state.techniques.push("smart-truncate");
			}
		}
	}

	applyTruncation(state, compaction);

	applyReadCompactionBanner(state);

	return { text: state.text, techniques: state.techniques };
}

function compactGrepText(text: string, config: RtkIntegrationConfig): { text: string; techniques: string[] } {
	const { state, compaction } = beginCompaction(text, config);

	if (compaction.groupSearchOutput) {
		applyNullableTechnique(state, (t) => groupSearchResults(t), "search");
	}

	applyTruncation(state, compaction);

	return { text: state.text, techniques: state.techniques };
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

	const allTechniques = new Set<string>();
	const originalChunks: string[] = [];
	const filteredChunks: string[] = [];

	const { changed, mapped: nextContent } = mapTextContentBlocks(sourceContent, (contentBlock) => {
		let transformed = { text: contentBlock.text, techniques: [] as string[] };
		if (event.toolName === "bash" || event.toolName === "exec_command" || event.toolName === "write_stdin") {
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

		return transformed.text !== contentBlock.text ? transformed.text : null;
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
