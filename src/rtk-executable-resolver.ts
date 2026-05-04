import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export type RtkExecutableResolverName = "where" | "which";

export interface RtkExecutableResolution {
	command: string;
	resolvedPath?: string;
	resolver: RtkExecutableResolverName;
	warning?: string;
}

interface ResolverCommand {
	command: RtkExecutableResolverName;
	args: string[];
}

export interface ResolveRtkExecutableOptions {
	platform?: typeof process.platform;
	timeoutMs?: number;
}

function trimResolutionDetail(value: string | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function stripWrappingQuotes(value: string): string {
	if (value.length < 2) {
		return value;
	}

	const first = value[0];
	const last = value[value.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return value.slice(1, -1);
	}

	return value;
}

export function parseRtkExecutablePath(stdout: string): string | undefined {
	for (const line of stdout.split(/\r?\n/)) {
		const candidate = stripWrappingQuotes(line.trim());
		if (candidate) {
			return candidate;
		}
	}

	return undefined;
}

function getResolverCommand(platform: typeof process.platform): ResolverCommand {
	if (platform === "win32") {
		return { command: "where", args: ["rtk"] };
	}

	return { command: "which", args: ["rtk"] };
}

function fallbackResolution(resolver: RtkExecutableResolverName, warning: string): RtkExecutableResolution {
	return {
		command: "rtk",
		resolver,
		warning,
	};
}

export async function resolveRtkExecutable(
	pi: ExtensionAPI,
	options: ResolveRtkExecutableOptions = {},
): Promise<RtkExecutableResolution> {
	const resolver = getResolverCommand(options.platform ?? process.platform);
	const timeout = options.timeoutMs ?? 1000;

	try {
		const result = await pi.exec(resolver.command, resolver.args, { timeout });
		const resolvedPath = parseRtkExecutablePath(result.stdout ?? "");
		if (result.code === 0 && resolvedPath) {
			return {
				command: resolvedPath,
				resolvedPath,
				resolver: resolver.command,
			};
		}

		const detail = trimResolutionDetail(result.stderr || result.stdout || `exit ${result.code}`);
		return fallbackResolution(
			resolver.command,
			`rtk executable path resolution via ${resolver.command} failed${detail ? `: ${detail}` : ""}`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return fallbackResolution(
			resolver.command,
			`rtk executable path resolution via ${resolver.command} failed: ${trimResolutionDetail(message)}`,
		);
	}
}
