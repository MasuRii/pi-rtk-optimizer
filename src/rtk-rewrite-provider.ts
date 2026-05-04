import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveRtkExecutable, type RtkExecutableResolution } from "./rtk-executable-resolver.js";

export interface RtkRewriteProviderResult {
	changed: boolean;
	originalCommand: string;
	rewrittenCommand: string;
	exitCode: number;
	error?: string;
	executableResolution?: RtkExecutableResolution;
}

export interface RtkRewriteProviderOptions {
	timeoutMs?: number;
	resolverTimeoutMs?: number;
	platform?: typeof process.platform;
	executableResolution?: RtkExecutableResolution;
}

function isAlreadyRtk(command: string): boolean {
	const trimmed = command.trimStart();
	return trimmed === "rtk" || trimmed.startsWith("rtk ");
}

function normalizeOptions(optionsOrTimeout: number | RtkRewriteProviderOptions): RtkRewriteProviderOptions {
	if (typeof optionsOrTimeout === "number") {
		return { timeoutMs: optionsOrTimeout };
	}
	return optionsOrTimeout;
}

export async function resolveRtkRewrite(
	pi: ExtensionAPI,
	command: string,
	optionsOrTimeout: number | RtkRewriteProviderOptions = {},
): Promise<RtkRewriteProviderResult> {
	const options = normalizeOptions(optionsOrTimeout);
	const timeoutMs = options.timeoutMs ?? 3000;

	if (!command || !command.trim()) {
		return { changed: false, originalCommand: command, rewrittenCommand: command, exitCode: 1 };
	}

	if (isAlreadyRtk(command)) {
		return { changed: false, originalCommand: command, rewrittenCommand: command, exitCode: 1 };
	}

	try {
		const executableResolution =
			options.executableResolution ??
			(await resolveRtkExecutable(pi, {
				platform: options.platform,
				timeoutMs: options.resolverTimeoutMs,
			}));
		const result = await pi.exec(executableResolution.command, ["rewrite", command], { timeout: timeoutMs });

		if (result.code === 1) {
			return {
				changed: false,
				originalCommand: command,
				rewrittenCommand: command,
				exitCode: 1,
				executableResolution,
			};
		}

		if (result.code === 2) {
			return {
				changed: false,
				originalCommand: command,
				rewrittenCommand: command,
				exitCode: 2,
				error: result.stderr?.trim() || "rtk denied rewrite",
				executableResolution,
			};
		}

		if (result.code === 0 || result.code === 3) {
			const rewritten = result.stdout?.trim();
			if (!rewritten) {
				return {
					changed: false,
					originalCommand: command,
					rewrittenCommand: command,
					exitCode: result.code,
					error: "rtk returned empty output",
					executableResolution,
				};
			}
			if (rewritten === command) {
				return {
					changed: false,
					originalCommand: command,
					rewrittenCommand: command,
					exitCode: result.code,
					executableResolution,
				};
			}
			return {
				changed: true,
				originalCommand: command,
				rewrittenCommand: rewritten,
				exitCode: result.code,
				executableResolution,
			};
		}

		return {
			changed: false,
			originalCommand: command,
			rewrittenCommand: command,
			exitCode: result.code,
			error: `unexpected exit code ${result.code}`,
			executableResolution,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			changed: false,
			originalCommand: command,
			rewrittenCommand: command,
			exitCode: -1,
			error: message,
		};
	}
}
