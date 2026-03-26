declare module "@mariozechner/pi-tui" {
	export interface SettingItem {
		id: string;
		label: string;
		description: string;
		currentValue: string;
		values: string[];
	}

	export interface AutocompleteItem {
		value: string;
		label: string;
		description?: string;
	}

	export class Box {
		constructor(...args: unknown[]);
		addChild(child: unknown): void;
	}

	export class Container {
		constructor(...args: unknown[]);
		addChild(child: unknown): void;
		render(width: number): string[];
		invalidate(): void;
	}

	export class SettingsList {
		constructor(...args: unknown[]);
		handleInput(data: string): void;
		updateValue(id: string, value: string): void;
	}

	export class Spacer {
		constructor(...args: unknown[]);
	}

	export class Text {
		constructor(...args: unknown[]);
	}

	export function truncateToWidth(text: string, width: number, suffix?: string, pad?: boolean): string;
	export function visibleWidth(text: string): number;
}

declare module "@mariozechner/pi-coding-agent" {
	interface UiLike {
		notify(message: string, level: "info" | "warning" | "error"): void;
		custom<T>(
			renderer: (
				tui: { requestRender(): void },
				theme: Theme,
				keybindings: unknown,
				done: () => void,
			) => {
				render(width: number): string[];
				invalidate?(): void;
				handleInput(data: string): void;
			},
			options?: Record<string, unknown>,
		): Promise<T>;
	}

	export interface ExtensionContext {
		hasUI: boolean;
		cwd?: string;
		ui: UiLike;
	}

	export interface ExtensionCommandContext extends ExtensionContext {}

	export interface ToolResultEvent {
		toolName: string;
		input: Record<string, unknown>;
		content: Array<Record<string, unknown>>;
		details?: unknown;
	}

	export interface BashToolCallEvent {
		toolName: "bash";
		input: { command: string } & Record<string, unknown>;
	}

	type MaybePromise<T> = T | Promise<T>;

	export interface Theme {
		fg(color: string, text: string): string;
		bold(text: string): string;
		getFgAnsi?(name: string): string;
	}

	export function getSettingsListTheme(): unknown;

	export interface ExtensionAPI {
		exec(
			command: string,
			args: string[],
			options?: { timeout?: number },
		): Promise<{ code: number; stdout: string; stderr: string }>;

		on(
			eventName: "tool_call",
			handler: (
				event: Record<string, unknown>,
				ctx: ExtensionContext,
			) => MaybePromise<Record<string, unknown> | void>,
		): void;

		on(
			eventName: "tool_result",
			handler: (
				event: ToolResultEvent,
				ctx: ExtensionContext,
			) => MaybePromise<Record<string, unknown> | void>,
		): void;

		on(
			eventName: "before_agent_start",
			handler: (
				event: { systemPrompt: string },
				ctx: ExtensionContext,
			) => MaybePromise<{ systemPrompt: string } | Record<string, unknown> | void>,
		): void;

		on(
			eventName: string,
			handler: (event: Record<string, unknown>, ctx: ExtensionContext) => MaybePromise<Record<string, unknown> | void>,
		): void;

		registerCommand(
			name: string,
			definition: {
				description: string;
				getArgumentCompletions?: (argumentPrefix: string) => Array<{ value: string; label: string; description?: string }> | null;
				handler: (args: string, ctx: ExtensionCommandContext) => MaybePromise<void>;
			},
		): void;
	}

	export function isToolCallEventType(
		toolName: "bash",
		event: Record<string, unknown>,
	): event is BashToolCallEvent;

	export function isToolCallEventType(
		toolName: string,
		event: Record<string, unknown>,
	): boolean;
}


declare module "node:assert/strict" {
	const assert: {
		equal(actual: unknown, expected: unknown, message?: string): void;
		deepEqual(actual: unknown, expected: unknown, message?: string): void;
		ok(value: unknown, message?: string): void;
	};

	export default assert;
}

declare module "bun:test" {
	export const mock: {
		module(specifier: string, factory: () => Record<string, unknown>): void;
	};
}

declare const process: {
	platform: string;
	env: Record<string, string | undefined>;
	cwd(): string;
};

declare module "node:os" {
	export function homedir(): string;
}

declare module "node:path" {
	export function join(...segments: string[]): string;
	export function dirname(path: string): string;
	export function resolve(...segments: string[]): string;
	export const sep: string;
}

declare module "node:process" {
	export const env: string[];
}

declare module "node:fs" {
	export function existsSync(path: string): boolean;
	export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
	export function readFileSync(path: string, encoding: "utf-8"): string;
	export function renameSync(oldPath: string, newPath: string): void;
	export function unlinkSync(path: string): void;
	export function writeFileSync(path: string, data: string, encoding: "utf-8"): void;
}
