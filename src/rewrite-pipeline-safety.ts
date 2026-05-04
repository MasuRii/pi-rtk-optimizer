import { splitLeadingEnvAssignments } from "./shell-env-prefix.js";

interface ParsedPipeline {
	segments: string[];
	separators: string[];
	suffix: string;
}

interface ProducerRewritePlan {
	command: string;
	captureStderr: boolean;
}

interface ShellSafetyTarget {
	environmentPrelude: string;
	command: string;
}

const SINGLE_QUOTED_SHELL_VALUE_PATTERN = "'(?:'\\\\''|[^'])*'";
const SHELL_ENV_VALUE_PATTERN = `(?:"(?:\\\\.|[^"])*"|${SINGLE_QUOTED_SHELL_VALUE_PATTERN}|[^\\s;]+)`;
const LEADING_RTK_DB_PATH_EXPORT_PRELUDE_PATTERN = new RegExp(
	`^(\\s*export\\s+RTK_DB_PATH=${SHELL_ENV_VALUE_PATTERN}\\s*;\\s*)([\\s\\S]*)$`,
	"u",
);

function splitLeadingRtkDbPathExportPrelude(command: string): ShellSafetyTarget {
	const match = command.match(LEADING_RTK_DB_PATH_EXPORT_PRELUDE_PATTERN);
	if (!match) {
		return { environmentPrelude: "", command };
	}

	return {
		environmentPrelude: match[1] ?? "",
		command: match[2] ?? "",
	};
}

function isTopLevelQuoteCharacter(character: string): character is '"' | "'" | "`" {
	return character === '"' || character === "'" || character === "`";
}

function parseSimpleTopLevelPipeline(command: string): ParsedPipeline | null {
	const segments: string[] = [];
	const separators: string[] = [];
	let quote: '"' | "'" | "`" | null = null;
	let escaped = false;
	let segmentStart = 0;
	let suffix = "";

	for (let index = 0; index < command.length; index += 1) {
		const character = command[index] ?? "";
		const nextCharacter = command[index + 1] ?? "";
		const previousCharacter = index > 0 ? (command[index - 1] ?? "") : "";

		if (escaped) {
			escaped = false;
			continue;
		}

		if (quote !== null) {
			if (character === "\\" && quote !== "'") {
				escaped = true;
				continue;
			}
			if (character === quote) {
				quote = null;
			}
			continue;
		}

		if (character === "\\") {
			escaped = true;
			continue;
		}

		if (isTopLevelQuoteCharacter(character)) {
			quote = character;
			continue;
		}

		if (character === "|" && nextCharacter === "|") {
			if (separators.length === 0) {
				return null;
			}
			segments.push(command.slice(segmentStart, index));
			suffix = command.slice(index);
			break;
		}

		if (character === "|" && previousCharacter !== ">") {
			const separatorLength = nextCharacter === "&" ? 2 : 1;
			segments.push(command.slice(segmentStart, index));
			separators.push(command.slice(index, index + separatorLength));
			segmentStart = index + separatorLength;
			if (separatorLength === 2) {
				index += 1;
			}
			continue;
		}

		if (character === "&" && nextCharacter === "&") {
			if (separators.length === 0) {
				return null;
			}
			segments.push(command.slice(segmentStart, index));
			suffix = command.slice(index);
			break;
		}

		if (character === "&" && nextCharacter !== ">" && previousCharacter !== ">" && previousCharacter !== "<") {
			return null;
		}

		if (character === ";") {
			if (separators.length === 0) {
				return null;
			}
			segments.push(command.slice(segmentStart, index));
			suffix = command.slice(index);
			break;
		}
	}

	if (separators.length === 0) {
		return null;
	}

	if (!suffix) {
		segments.push(command.slice(segmentStart));
	}

	return { segments, separators, suffix };
}

function extractProducerRewritePlan(segment: string, firstSeparator: string): ProducerRewritePlan | null {
	const trimmed = segment.trim();
	const { envPrefix, command: commandWithOptionalRedirect } = splitLeadingEnvAssignments(trimmed);
	if (!/^rtk\s+/i.test(commandWithOptionalRedirect)) {
		return null;
	}

	const stderrMergeMatch = commandWithOptionalRedirect.match(/^(.*?)(?:\s+)?2>\s*&1\s*$/u);
	if (stderrMergeMatch) {
		const command = stderrMergeMatch[1]?.trimEnd() ?? "";
		return command ? { command: `${envPrefix}${command}`.trim(), captureStderr: true } : null;
	}

	return {
		command: `${envPrefix}${commandWithOptionalRedirect}`.trim(),
		captureStderr: firstSeparator === "|&",
	};
}

function buildBufferedPipelineCommand(
	producer: ProducerRewritePlan,
	remainder: string,
): string {
	const tempFileVariable = "__pi_rtk_pipe_tmp";
	const statusVariable = "__pi_rtk_pipe_status";
	const producerRedirect = producer.captureStderr ? `> "$${tempFileVariable}" 2>&1` : `> "$${tempFileVariable}"`;
	const cleanupTrap = `rm -f "$${tempFileVariable}"`;

	return [
		"{",
		`${tempFileVariable}="$(mktemp)" || exit $?;`,
		`${statusVariable}=0;`,
		`trap '${cleanupTrap}' EXIT HUP INT TERM;`,
		`${producer.command} ${producerRedirect};`,
		`${statusVariable}=$?;`,
		`if [ $${statusVariable} -eq 0 ]; then (${remainder}) < "$${tempFileVariable}"; ${statusVariable}=$?; fi;`,
		`exit $${statusVariable};`,
		"}",
	].join(" ");
}

export function applyRewrittenCommandShellSafetyFixups(command: string, platform: string = process.platform): string {
	if (platform !== "win32") {
		return command;
	}

	const target = splitLeadingRtkDbPathExportPrelude(command);
	const parsedPipeline = parseSimpleTopLevelPipeline(target.command);
	if (!parsedPipeline) {
		return command;
	}

	const producer = extractProducerRewritePlan(parsedPipeline.segments[0] ?? "", parsedPipeline.separators[0] ?? "");
	if (!producer) {
		return command;
	}

	const remainder = parsedPipeline.segments
		.slice(1)
		.map((segment, index) => `${index === 0 ? "" : (parsedPipeline.separators[index] ?? "")}${segment}`)
		.join("")
		.trim();
	if (!remainder) {
		return command;
	}

	const suffix = parsedPipeline.suffix ? ` ${parsedPipeline.suffix.trimStart()}` : "";
	return `${target.environmentPrelude}${buildBufferedPipelineCommand(producer, remainder)}${suffix}`;
}
