import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getRtkArgumentCompletions } from "./command-completions.js";
import { createLazyModuleLoader } from "./lazy-module-loader.js";
import type { RtkIntegrationConfig, RuntimeStatus } from "./types.js";

export interface RtkIntegrationController {
	getConfig(): RtkIntegrationConfig;
	setConfig(next: RtkIntegrationConfig, ctx: ExtensionCommandContext): void;
	getConfigPath(): string;
	getRuntimeStatus(): RuntimeStatus;
	refreshRuntimeStatus(): Promise<RuntimeStatus>;
	getMetricsSummary(): string;
	clearMetrics(): void;
}

const loadCommandModalModule = createLazyModuleLoader<typeof import("./config-modal.ts")>("./config-modal.ts");

export function registerRtkIntegrationCommand(pi: ExtensionAPI, controller: RtkIntegrationController): void {
	pi.registerCommand("rtk", {
		description: "Configure RTK rewrite and output compaction integration",
		getArgumentCompletions: getRtkArgumentCompletions,
		handler: async (args, ctx) => {
			const { handleRtkIntegrationCommand } = await loadCommandModalModule();
			await handleRtkIntegrationCommand(args, ctx, controller);
		},
	});
}
