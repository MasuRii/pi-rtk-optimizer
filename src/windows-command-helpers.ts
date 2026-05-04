interface WindowsBashCompatibilityResult {
	command: string;
	applied: string[];
}

interface LeadingCdSlashDParse {
	rawPath: string;
	operator: string;
	tail: string;
}

const PYTHON_UTF8_ENV_PREFIX = "PYTHONIOENCODING=utf-8";

function normalizeWindowsPathForBash(rawPath: string): string {
	const trimmed = rawPath.trim();
	const unquoted =
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
			? trimmed.slice(1, -1)
			: trimmed;
	return unquoted.replace(/\\/g, "/");
}

function quoteForBash(value: string): string {
	const escaped = value.replace(/"/g, '\\"');
	return `"${escaped}"`;
}

function parseLeadingCdSlashD(command: string): LeadingCdSlashDParse | null {
	const prefixMatch = command.match(/^\s*cd\s+\/d\s+/i);
	if (!prefixMatch) {
		return null;
	}

	const pathStart = prefixMatch[0].length;
	let quote: '"' | "'" | null = null;
	let escaped = false;

	for (let index = pathStart; index < command.length; index += 1) {
		const character = command[index] ?? "";
		const nextCharacter = command[index + 1] ?? "";

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

		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}

		if (character === "&" && nextCharacter === "&") {
			return {
				rawPath: command.slice(pathStart, index),
				operator: "&&",
				tail: command.slice(index + 2),
			};
		}

		if (character === "|" && nextCharacter === "|") {
			return {
				rawPath: command.slice(pathStart, index),
				operator: "||",
				tail: command.slice(index + 2),
			};
		}

		if (character === "|" || character === ";") {
			return {
				rawPath: command.slice(pathStart, index),
				operator: character,
				tail: command.slice(index + 1),
			};
		}
	}

	return {
		rawPath: command.slice(pathStart),
		operator: "",
		tail: "",
	};
}

function rewriteLeadingCdSlashD(command: string): { command: string; changed: boolean } {
	const parsed = parseLeadingCdSlashD(command);
	if (!parsed) {
		return { command, changed: false };
	}

	const normalizedPath = quoteForBash(normalizeWindowsPathForBash(parsed.rawPath));
	if (!parsed.operator) {
		return {
			command: `cd ${normalizedPath}`,
			changed: true,
		};
	}

	return {
		command: `cd ${normalizedPath} ${parsed.operator} ${parsed.tail.trimStart()}`,
		changed: true,
	};
}

function ensurePythonUtf8(command: string): { command: string; changed: boolean } {
	if (/\bPYTHONIOENCODING\s*=/.test(command)) {
		return { command, changed: false };
	}

	if (!/(^|[;&|]\s*|&&\s*|\|\|\s*)python(?:3(?:\.\d+)?)?\b/i.test(command)) {
		return { command, changed: false };
	}

	return {
		command: `${PYTHON_UTF8_ENV_PREFIX} ${command}`,
		changed: true,
	};
}

export function applyWindowsBashCompatibilityFixes(
	command: string,
	platform: string = process.platform,
): WindowsBashCompatibilityResult {
	if (platform !== "win32") {
		return { command, applied: [] };
	}

	let nextCommand = command;
	const applied: string[] = [];

	const cdFix = rewriteLeadingCdSlashD(nextCommand);
	if (cdFix.changed) {
		nextCommand = cdFix.command;
		applied.push("cd-/d");
	}

	const pythonFix = ensurePythonUtf8(nextCommand);
	if (pythonFix.changed) {
		nextCommand = pythonFix.command;
		applied.push("python-utf8");
	}

	return { command: nextCommand, applied };
}
