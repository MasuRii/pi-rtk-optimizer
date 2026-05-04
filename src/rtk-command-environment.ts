import { join } from "node:path";

import { splitLeadingEnvAssignments } from "./shell-env-prefix.js";

const RTK_DB_PATH_ENV_NAME = "RTK_DB_PATH";
const SINGLE_QUOTED_SHELL_VALUE_PATTERN = "'(?:'\\\\''|[^'])*'";
const SHELL_ENV_VALUE_PATTERN = `(?:"[^"]*"|${SINGLE_QUOTED_SHELL_VALUE_PATTERN}|[^\\s;]+)`;
const RTK_DB_PATH_ASSIGNMENT_PATTERN = new RegExp(
	`(?:^|\\s)RTK_DB_PATH=${SHELL_ENV_VALUE_PATTERN}(?=\\s|$)`,
);
const RTK_DB_PATH_EXPORT_PATTERN = new RegExp(`^export\\s+RTK_DB_PATH=${SHELL_ENV_VALUE_PATTERN}(?=\\s*(?:;|$))`);

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
	return `'${normalizedValue.replace(/'/g, `'\\''`)}'`;
}

function hasLeadingRtkDbPathAssignment(command: string): boolean {
	const trimmed = command.trimStart();
	return (
		RTK_DB_PATH_ASSIGNMENT_PATTERN.test(splitLeadingEnvAssignments(trimmed).envPrefix) ||
		RTK_DB_PATH_EXPORT_PATTERN.test(trimmed)
	);
}

export function applyRtkCommandEnvironment(command: string): string {
	if (!command.trim()) {
		return command;
	}

	if (hasLeadingRtkDbPathAssignment(command)) {
		return command;
	}

	return `export ${RTK_DB_PATH_ENV_NAME}=${quoteForShellEnv(getTemporaryRtkHistoryDbPath())}; ${command}`;
}
