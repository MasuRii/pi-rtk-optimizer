import { join } from "node:path";

const RTK_DB_PATH_ENV_NAME = "RTK_DB_PATH";
const LEADING_ENV_ASSIGNMENT_PATTERN = /^((?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*)/;
const RTK_DB_PATH_ASSIGNMENT_PATTERN = /(?:^|\s)RTK_DB_PATH=(?:"[^"]*"|'[^']*'|[^\s]+)(?=\s|$)/;

function resolveTemporaryDirectory(): string {
	if (process.platform === "win32") {
		const windowsTempDir = process.env.TEMP ?? process.env.TMP;
		if (windowsTempDir && windowsTempDir.trim()) {
			return windowsTempDir;
		}

		const localAppData = process.env.LOCALAPPDATA;
		if (localAppData && localAppData.trim()) {
			return join(localAppData, "Temp");
		}

		const userProfile = process.env.USERPROFILE;
		if (userProfile && userProfile.trim()) {
			return join(userProfile, "AppData", "Local", "Temp");
		}

		const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
		if (systemRoot && systemRoot.trim()) {
			return join(systemRoot, "Temp");
		}

		return "C:/Windows/Temp";
	}

	const posixTempDir = process.env.TMPDIR ?? process.env.TMP;
	if (posixTempDir && posixTempDir.trim()) {
		return posixTempDir;
	}

	return "/tmp";
}

function getTemporaryRtkHistoryDbPath(): string {
	return join(resolveTemporaryDirectory(), "pi-rtk-optimizer", "history.db");
}

function quoteForShellEnv(value: string): string {
	const normalizedValue = process.platform === "win32" ? value.replace(/\\/g, "/") : value;
	return `"${normalizedValue.replace(/"/g, '\\"')}"`;
}

function hasLeadingRtkDbPathAssignment(command: string): boolean {
	const leadingAssignments = command.match(LEADING_ENV_ASSIGNMENT_PATTERN)?.[1] ?? "";
	return RTK_DB_PATH_ASSIGNMENT_PATTERN.test(leadingAssignments);
}

export function applyRtkCommandEnvironment(command: string): string {
	if (!command.trim()) {
		return command;
	}

	if (hasLeadingRtkDbPathAssignment(command)) {
		return command;
	}

	return `${RTK_DB_PATH_ENV_NAME}=${quoteForShellEnv(getTemporaryRtkHistoryDbPath())} ${command}`;
}
