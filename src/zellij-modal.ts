// Vendored from ../zellij-modal/index.ts to keep pi-rtk-optimizer standalone.
// Keep this module in sync when upstream zellij-modal primitives change.
import { getSettingsListTheme, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Box,
	Container,
	matchesKey,
	SettingsList,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
	type SettingItem,
} from "@earendil-works/pi-tui";

const ANSI_RESET = "\x1b[0m";

/**
 * Border character set used to render a modal frame.
 */
export interface BorderCharacters {
	/** Top-left corner. */
	topLeft: string;
	/** Top-right corner. */
	topRight: string;
	/** Bottom-left corner. */
	bottomLeft: string;
	/** Bottom-right corner. */
	bottomRight: string;
	/** Horizontal line character. */
	horizontal: string;
	/** Vertical line character. */
	vertical: string;
	/** Optional left tee junction. */
	verticalLeft?: string;
	/** Optional right tee junction. */
	verticalRight?: string;
}

/**
 * Predefined border character sets aligned with Zellij styles.
 */
export const BORDER_STYLES = {
	rounded: {
		topLeft: "╭",
		topRight: "╮",
		bottomLeft: "╰",
		bottomRight: "╯",
		horizontal: "─",
		vertical: "│",
		verticalLeft: "├",
		verticalRight: "┤",
	},
	square: {
		topLeft: "┌",
		topRight: "┐",
		bottomLeft: "└",
		bottomRight: "┘",
		horizontal: "─",
		vertical: "│",
		verticalLeft: "├",
		verticalRight: "┤",
	},
	double: {
		topLeft: "╔",
		topRight: "╗",
		bottomLeft: "╚",
		bottomRight: "╝",
		horizontal: "═",
		vertical: "║",
	},
	none: {
		topLeft: " ",
		topRight: " ",
		bottomLeft: " ",
		bottomRight: " ",
		horizontal: " ",
		vertical: " ",
	},
} as const satisfies Record<string, BorderCharacters>;

/**
 * Name of a supported border style.
 */
export type BorderStyle = keyof typeof BORDER_STYLES;

/**
 * Supported palette color formats.
 */
export type PaletteColor =
	| { type: "rgb"; r: number; g: number; b: number }
	| { type: "8bit"; code: number }
	| { type: "named"; name: string };

/**
 * Semantic color slots for a Zellij-style modal.
 */
export interface ZellijColorPalette {
	/** Primary foreground text. */
	fg: PaletteColor;
	/** Modal background. */
	bg: PaletteColor;
	/** Accent / selection color. */
	accent: PaletteColor;
	/** Secondary text color. */
	muted: PaletteColor;
	/** Tertiary text color. */
	dim: PaletteColor;
	/** Success state color. */
	success: PaletteColor;
	/** Error state color. */
	error: PaletteColor;
	/** Warning state color. */
	warning: PaletteColor;
	/** Default border color. */
	border: PaletteColor;
	/** Border color when focused. */
	borderFocused: PaletteColor;
	/** Border color when unfocused. */
	borderUnfocused: PaletteColor;
}

/**
 * Default Zellij-inspired palette.
 */
export const DEFAULT_ZELLIJ_PALETTE: ZellijColorPalette = {
	fg: { type: "named", name: "white" },
	bg: { type: "named", name: "black" },
	accent: { type: "8bit", code: 36 },
	muted: { type: "8bit", code: 245 },
	dim: { type: "8bit", code: 238 },
	success: { type: "8bit", code: 154 },
	error: { type: "8bit", code: 124 },
	warning: { type: "8bit", code: 166 },
	border: { type: "8bit", code: 238 },
	borderFocused: { type: "8bit", code: 154 },
	borderUnfocused: { type: "8bit", code: 238 },
};

/**
 * A title segment in the top border.
 */
export interface TitleSegment {
	/** Segment text. */
	text: string;
	/** Segment foreground color slot or explicit color. */
	color: keyof ZellijColorPalette | PaletteColor;
	/** Optional segment background color. */
	bgColor?: PaletteColor;
	/** Enables bold style. */
	bold?: boolean;
	/** Truncation strategy when segment text is too long. */
	truncate?: "start" | "middle" | "end" | "none";
	/** Maximum visible width for text content (0 means unlimited). */
	maxWidth?: number;
}

/**
 * Three-part title bar configuration.
 */
export interface TitleBarConfig {
	/** Left segment (usually title). */
	left?: TitleSegment | string;
	/** Center segment (usually status). */
	center?: TitleSegment | string;
	/** Right segment (usually counters/actions). */
	right?: TitleSegment | string;
	/** Optional textual separator (reserved for custom renderers). */
	separator?: string;
}

/**
 * Help text line rendered in the bottom border.
 */
export interface HelpUndertitleConfig {
	/** Static help text. */
	text?: string;
	/** Dynamic help text generator. */
	textGenerator?: (width: number) => string;
	/** Progressive truncation variants from longest to shortest. */
	variants?: string[];
	/** Structured key hints for help text generation. */
	keyHints?: Array<{
		key: string;
		description: string;
	}>;
	/** Separator between key hints. */
	keyHintSeparator?: string;
	/** Palette slot for help text color. */
	color?: keyof ZellijColorPalette;
}

/**
 * Full modal configuration.
 */
export interface ZellijModalConfig {
	/** Border style preset. */
	borderStyle: BorderStyle;
	/** Active color palette. */
	palette: ZellijColorPalette;
	/** Focus state for frame highlighting. */
	focused: boolean;
	/** Internal content padding. */
	padding: number;
	/** Top title bar config. */
	titleBar: TitleBarConfig;
	/** Optional bottom help line config. */
	helpUndertitle?: HelpUndertitleConfig;
	/** Minimum preferred modal width. */
	minWidth: number;
	/** Maximum modal width (0 means no explicit max). */
	maxWidth: number;
	/** Overlay options for `ctx.ui.custom()`. */
	overlay: {
		anchor: "center" | "top" | "bottom";
		width: number | string;
		maxHeight: number | string;
		margin: number;
	};
}

/**
 * Partial modal configuration used by consumers.
 */
export type ZellijModalConfigPartial = Partial<ZellijModalConfig> & {
	/** Shorthand for `titleBar.left`. */
	title?: string;
	/** Shorthand for help text. */
	helpText?: string | HelpUndertitleConfig;
};

/**
 * Modal rendering metadata.
 */
export interface ZellijModalRenderOutput {
	/** Fully rendered lines. */
	lines: string[];
	/** Visible frame width. */
	visibleWidth: number;
	/** Width of content area inside borders and padding. */
	contentWidth: number;
	/** Inclusive index of first content line. */
	contentStartLine: number;
	/** Inclusive index of last content line. */
	contentEndLine: number;
}

/**
 * Minimal content renderer contract for modal content.
 */
export interface ZellijModalContentRenderer {
	/** Render content into lines for the given width. */
	render(width: number): string[];
	/** Invalidate internal caches. */
	invalidate(): void;
	/** Optional input handler. */
	handleInput?(data: string): void;
}

/**
 * Full modal component contract.
 */
export interface ZellijModalComponent extends ZellijModalContentRenderer {
	/** Effective modal configuration. */
	config: ZellijModalConfig;
	/** Wrapped content renderer. */
	content: ZellijModalContentRenderer;
	/** Render complete modal output. */
	renderModal(width: number): ZellijModalRenderOutput;
	/** Release resources. */
	dispose(): void;
}

/**
 * Theme helper for modal-specific color resolution and ANSI formatting.
 */
export interface ZellijModalTheme {
	/** Active palette used by this theme helper. */
	palette: ZellijColorPalette;
	/** Resolve color slot or explicit color into ANSI foreground/background codes. */
	resolveColor: (color: PaletteColor | keyof ZellijColorPalette) => { fg: string; bg: string };
	/** Apply foreground color to text. */
	colorizeForeground: (color: PaletteColor | keyof ZellijColorPalette, text: string) => string;
	/** Apply background color to text. */
	colorizeBackground: (color: PaletteColor | keyof ZellijColorPalette, text: string) => string;
}

/**
 * Resolve a `PaletteColor` into ANSI foreground/background escape codes.
 */
export function resolveColor(color: PaletteColor): { fg: string; bg: string } {
	if (color.type === "rgb") {
		const r = clampInt(color.r, 0, 255);
		const g = clampInt(color.g, 0, 255);
		const b = clampInt(color.b, 0, 255);
		return {
			fg: `\x1b[38;2;${r};${g};${b}m`,
			bg: `\x1b[48;2;${r};${g};${b}m`,
		};
	}

	if (color.type === "8bit") {
		const code = clampInt(color.code, 0, 255);
		return {
			fg: `\x1b[38;5;${code}m`,
			bg: `\x1b[48;5;${code}m`,
		};
	}

	const namedMap: Record<string, number> = {
		black: 16,
		white: 255,
		red: 196,
		green: 46,
		blue: 45,
		yellow: 226,
		cyan: 51,
		magenta: 201,
		gray: 245,
		grey: 245,
		orange: 166,
	};
	const code = namedMap[color.name.toLowerCase()] ?? 255;
	return {
		fg: `\x1b[38;5;${code}m`,
		bg: `\x1b[48;5;${code}m`,
	};
}

/**
 * Build a `ZellijModalTheme` helper from a palette.
 */
export function createZellijModalTheme(palette: ZellijColorPalette): ZellijModalTheme {
	return {
		palette,
		resolveColor: (color) => resolveColor(resolvePaletteColor(color, palette)),
		colorizeForeground: (color, text) => `${resolveColor(resolvePaletteColor(color, palette)).fg}${text}${ANSI_RESET}`,
		colorizeBackground: (color, text) => `${resolveColor(resolvePaletteColor(color, palette)).bg}${text}${ANSI_RESET}`,
	};
}

/**
 * Convert Pi `Theme` values to a Zellij modal palette.
 */
export function themeToZellijPalette(theme: Theme): ZellijColorPalette {
	const extract = (colorName: string, fallback: PaletteColor): PaletteColor => {
		const provider = theme as unknown as {
			getFgAnsi?: (name: string) => string;
		};
		if (!provider.getFgAnsi) {
			return fallback;
		}

		try {
			const ansi = provider.getFgAnsi(colorName);
			const parsed = parseAnsiForegroundColor(ansi);
			return parsed ?? fallback;
		} catch {
			return fallback;
		}
	};

	return {
		fg: extract("fg", DEFAULT_ZELLIJ_PALETTE.fg),
		bg: extract("bg", DEFAULT_ZELLIJ_PALETTE.bg),
		accent: extract("accent", DEFAULT_ZELLIJ_PALETTE.accent),
		muted: extract("muted", DEFAULT_ZELLIJ_PALETTE.muted),
		dim: extract("dim", DEFAULT_ZELLIJ_PALETTE.dim),
		success: extract("success", DEFAULT_ZELLIJ_PALETTE.success),
		error: extract("error", DEFAULT_ZELLIJ_PALETTE.error),
		warning: extract("warning", DEFAULT_ZELLIJ_PALETTE.warning),
		border: extract("borderMuted", DEFAULT_ZELLIJ_PALETTE.border),
		borderFocused: extract("accent", DEFAULT_ZELLIJ_PALETTE.borderFocused),
		borderUnfocused: extract("borderMuted", DEFAULT_ZELLIJ_PALETTE.borderUnfocused),
	};
}

interface PositionedTitleSegment {
	start: number;
	end: number;
	text: string;
	color: keyof ZellijColorPalette | PaletteColor;
	bold: boolean;
}

/**
 * Core frame renderer for Zellij-style borders, title bar, and undertitle.
 */
export class ZellijModalFrame {
	private config: ZellijModalConfig;
	private borders: BorderCharacters;
	private theme: ZellijModalTheme;

	constructor(config: ZellijModalConfig, modalTheme?: ZellijModalTheme) {
		this.config = config;
		this.borders = BORDER_STYLES[config.borderStyle] ?? BORDER_STYLES.rounded;
		this.theme = modalTheme ?? createZellijModalTheme(config.palette);
	}

	/**
	 * Update frame configuration (used when modal config changes).
	 */
	setConfig(config: ZellijModalConfig): void {
		this.config = config;
		this.borders = BORDER_STYLES[config.borderStyle] ?? BORDER_STYLES.rounded;
		this.theme = createZellijModalTheme(config.palette);
	}

	/**
	 * Render one content line with left/right borders.
	 */
	renderContentLine(content: string, width: number, palette: ZellijColorPalette): string {
		const frameWidth = Math.max(2, width);
		const innerWidth = Math.max(0, frameWidth - 2);
		const borderColor = this.config.focused ? palette.borderFocused : palette.borderUnfocused;
		const vertical = this.theme.colorizeForeground(borderColor, this.borders.vertical);
		const paddedContent = truncateToWidth(content, innerWidth, "", true);
		return `${vertical}${paddedContent}${vertical}`;
	}

	/**
	 * Render complete frame around provided content lines.
	 */
	renderFrame(contentLines: string[], width: number, palette: ZellijColorPalette): ZellijModalRenderOutput {
		const frameWidth = Math.max(4, width);
		const safeContent = contentLines.length > 0 ? contentLines : [""];
		const lines: string[] = [];

		lines.push(this.renderTitleBar(frameWidth, palette));

		const contentStartLine = lines.length;
		for (const line of safeContent) {
			lines.push(this.renderContentLine(line, frameWidth, palette));
		}
		const contentEndLine = lines.length - 1;

		lines.push(this.renderBottomLine(frameWidth, palette));

		return {
			lines,
			visibleWidth: frameWidth,
			contentWidth: Math.max(1, frameWidth - 2 - this.config.padding * 2),
			contentStartLine,
			contentEndLine,
		};
	}

	private renderBorderLine(
		width: number,
		palette: ZellijColorPalette,
		leftCorner: string,
		rightCorner: string,
		renderInner: (innerWidth: number, borderPaint: (text: string) => string) => string,
	): string {
		const innerWidth = Math.max(0, width - 2);
		const borderColor = this.config.focused ? palette.borderFocused : palette.borderUnfocused;
		const borderPaint = (text: string) => this.theme.colorizeForeground(borderColor, text);
		const inner = innerWidth === 0 ? "" : renderInner(innerWidth, borderPaint);
		return `${borderPaint(leftCorner)}${inner}${borderPaint(rightCorner)}`;
	}

	private renderTitleBar(width: number, palette: ZellijColorPalette): string {
		return this.renderBorderLine(width, palette, this.borders.topLeft, this.borders.topRight, (innerWidth, borderPaint) => {
			const segments = this.positionTitleSegments(innerWidth);
			let inner = "";
			let cursor = 0;

			for (const segment of segments) {
				if (segment.start > cursor) {
					inner += borderPaint(this.borders.horizontal.repeat(segment.start - cursor));
				}
				const text = segment.bold ? `\x1b[1m${segment.text}${ANSI_RESET}` : segment.text;
				inner += this.theme.colorizeForeground(segment.color, text);
				cursor = segment.end;
			}

			if (cursor < innerWidth) {
				inner += borderPaint(this.borders.horizontal.repeat(innerWidth - cursor));
			}

			return inner;
		});
	}

	private renderBottomLine(width: number, palette: ZellijColorPalette): string {
		return this.renderBorderLine(width, palette, this.borders.bottomLeft, this.borders.bottomRight, (innerWidth, borderPaint) => {
			const helpText = this.resolveHelpText(Math.max(0, innerWidth - 3));
			if (!helpText) {
				return borderPaint(this.borders.horizontal.repeat(innerWidth));
			}

			const helpSlot = this.config.helpUndertitle?.color ?? "dim";
			const safeHelp = truncateToWidth(helpText, Math.max(0, innerWidth - 3), "…");
			const helpWidth = visibleWidth(safeHelp);
			const rightFill = Math.max(0, innerWidth - helpWidth - 3);

			return `${borderPaint(this.borders.horizontal)} ${this.theme.colorizeForeground(helpSlot, safeHelp)} ${borderPaint(this.borders.horizontal.repeat(rightFill))}`;
		});
	}

	private positionTitleSegments(innerWidth: number): PositionedTitleSegment[] {
		if (innerWidth <= 0) {
			return [];
		}

		const left = this.resolveTitleSegment(this.config.titleBar.left, "left");
		const center = this.resolveTitleSegment(this.config.titleBar.center, "center");
		const right = this.resolveTitleSegment(this.config.titleBar.right, "right");

		const placements: PositionedTitleSegment[] = [];

		if (left) {
			const leftText = this.fitTextToWidth(left.text, Math.min(innerWidth, left.maxWidth ?? innerWidth), left.truncate);
			if (leftText) {
				placements.push({
					start: 0,
					end: Math.min(innerWidth, visibleWidth(leftText)),
					text: leftText,
					color: left.color,
					bold: left.bold ?? false,
				});
			}
		}

		if (right) {
			const reservedLeft = placements[0]?.end ?? 0;
			const available = Math.max(0, innerWidth - reservedLeft);
			const rightText = this.fitTextToWidth(right.text, Math.min(available, right.maxWidth ?? available), right.truncate);
			const rightWidth = visibleWidth(rightText);
			if (rightText && rightWidth > 0) {
				placements.push({
					start: innerWidth - rightWidth,
					end: innerWidth,
					text: rightText,
					color: right.color,
					bold: right.bold ?? false,
				});
			}
		}

		if (center) {
			const leftLimit = placements.find((placement) => placement.start === 0)?.end ?? 0;
			const rightStart = placements.find((placement) => placement.end === innerWidth)?.start ?? innerWidth;
			const freeWidth = Math.max(0, rightStart - leftLimit);
			if (freeWidth > 0) {
				const centerText = this.fitTextToWidth(center.text, Math.min(freeWidth, center.maxWidth ?? freeWidth), center.truncate);
				const centerWidth = visibleWidth(centerText);
				if (centerText && centerWidth > 0) {
					const centeredStart = Math.floor((innerWidth - centerWidth) / 2);
					const start = clampInt(centeredStart, leftLimit, Math.max(leftLimit, rightStart - centerWidth));
					placements.push({
						start,
						end: start + centerWidth,
						text: centerText,
						color: center.color,
						bold: center.bold ?? false,
					});
				}
			}
		}

		return placements.sort((a, b) => a.start - b.start);
	}

	private resolveTitleSegment(
		segment: TitleSegment | string | undefined,
		position: "left" | "center" | "right",
	): (TitleSegment & { text: string }) | null {
		if (!segment) {
			return null;
		}

		if (typeof segment === "string") {
			const color: keyof ZellijColorPalette = position === "left" ? "accent" : position === "center" ? "muted" : "dim";
			return {
				text: ` ${segment} `,
				color,
				bold: position === "left",
				truncate: "end",
				maxWidth: 0,
			};
		}

		const clean = segment.text.trim();
		if (!clean) {
			return null;
		}

		return {
			...segment,
			text: ` ${clean} `,
			truncate: segment.truncate ?? "end",
			bold: segment.bold ?? false,
		};
	}

	private fitTextToWidth(text: string, maxWidth: number, mode: TitleSegment["truncate"]): string {
		if (maxWidth <= 0) {
			return "";
		}
		if (visibleWidth(text) <= maxWidth) {
			return text;
		}

		switch (mode) {
			case "none":
				return truncateToWidth(text, maxWidth, "");
			case "start":
				return truncateStart(text, maxWidth);
			case "middle":
				return truncateMiddle(text, maxWidth);
			case "end":
			default:
				return truncateToWidth(text, maxWidth, "…");
		}
	}

	private resolveHelpText(maxWidth: number): string | null {
		const config = this.config.helpUndertitle;
		if (!config || maxWidth <= 0) {
			return null;
		}

		if (config.textGenerator) {
			try {
				const generated = config.textGenerator(maxWidth);
				if (generated && generated.trim()) {
					return generated;
				}
			} catch {
				return config.text?.trim() ? config.text : null;
			}
		}

		if (config.variants && config.variants.length > 0) {
			for (const variant of config.variants) {
				if (visibleWidth(variant) <= maxWidth) {
					return variant;
				}
			}
			return config.variants[config.variants.length - 1] ?? null;
		}

		if (config.keyHints && config.keyHints.length > 0) {
			const separator = config.keyHintSeparator ?? " • ";
			return config.keyHints
				.map((hint) => `${hint.key} ${hint.description}`)
				.join(separator);
		}

		return config.text?.trim() ? config.text : null;
	}
}

/**
 * Main Zellij-style modal component wrapper.
 */
export class ZellijModal implements ZellijModalComponent {
	config: ZellijModalConfig;
	content: ZellijModalContentRenderer;

	private frame: ZellijModalFrame;
	private palette: ZellijColorPalette;

	constructor(content: ZellijModalContentRenderer, config: ZellijModalConfigPartial = {}, theme?: Theme) {
		if (!content || typeof content.render !== "function") {
			throw new Error("ZellijModal requires a valid content renderer.");
		}

		this.config = this.buildConfig(config);
		this.palette = theme ? themeToZellijPalette(theme) : this.config.palette;
		this.content = content;
		this.frame = new ZellijModalFrame({ ...this.config, palette: this.palette });
	}

	/**
	 * Render content only (without frame).
	 */
	render(width: number): string[] {
		const contentWidth = Math.max(1, width - 2 - this.config.padding * 2);
		const paddedWidth = contentWidth + this.config.padding * 2;
		const sidePadding = " ".repeat(this.config.padding);
		const lines: string[] = [];

		try {
			const rawLines = this.content.render(contentWidth);
			const normalized = rawLines.length > 0 ? rawLines : [""];

			pushVerticalPadding(lines, this.config.padding, paddedWidth);

			for (const line of normalized) {
				const fitted = truncateToWidth(line, contentWidth, "", true);
				lines.push(`${sidePadding}${fitted}${sidePadding}`);
			}

			pushVerticalPadding(lines, this.config.padding, paddedWidth);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const safe = truncateToWidth(` Render error: ${message} `, paddedWidth, "…", true);
			lines.push(safe);
		}

		return lines.length > 0 ? lines : [" ".repeat(paddedWidth)];
	}

	/**
	 * Render complete frame + content.
	 */
	renderModal(width: number): ZellijModalRenderOutput {
		const frameWidth = this.resolveModalWidth(width);
		const contentLines = this.render(frameWidth);
		return this.frame.renderFrame(contentLines, frameWidth, this.palette);
	}

	/**
	 * Invalidate child renderer state.
	 */
	invalidate(): void {
		this.content.invalidate();
	}

	/**
	 * Delegate input to child renderer.
	 */
	handleInput(data: string): void {
		this.content.handleInput?.(data);
	}

	/**
	 * Get overlay options for `ctx.ui.custom()`.
	 */
	getOverlayOptions(): { overlay: true; overlayOptions: ZellijModalConfig["overlay"] } {
		return {
			overlay: true,
			overlayOptions: this.config.overlay,
		};
	}

	/**
	 * Dispose modal resources.
	 */
	dispose(): void {
		this.content.invalidate();
	}

	private buildConfig(partial: ZellijModalConfigPartial): ZellijModalConfig {
		const borderStyle = partial.borderStyle && BORDER_STYLES[partial.borderStyle] ? partial.borderStyle : "rounded";
		const padding = Math.max(0, partial.padding ?? 1);
		const minWidth = Math.max(4, partial.minWidth ?? 40);
		const maxWidth = Math.max(0, partial.maxWidth ?? 0);
		const helpUndertitle = normalizeHelpUndertitle(partial.helpText, partial.helpUndertitle);

		return {
			borderStyle,
			palette: partial.palette ?? DEFAULT_ZELLIJ_PALETTE,
			focused: partial.focused ?? true,
			padding,
			titleBar: partial.titleBar ?? { left: partial.title ?? "Modal" },
			helpUndertitle,
			minWidth,
			maxWidth,
			overlay: {
				anchor: partial.overlay?.anchor ?? "center",
				width: partial.overlay?.width ?? 70,
				maxHeight: partial.overlay?.maxHeight ?? "80%",
				margin: Math.max(0, partial.overlay?.margin ?? 1),
			},
		};
	}

	private resolveModalWidth(availableWidth: number): number {
		const width = Math.max(4, availableWidth);
		const boundedMax = this.config.maxWidth > 0 ? Math.min(width, this.config.maxWidth) : width;
		if (boundedMax >= this.config.minWidth) {
			return boundedMax;
		}
		return Math.max(4, boundedMax);
	}
}

/**
 * Options for the pre-built settings modal content renderer.
 */
export interface SettingsTab {
	label: string;
	settings: SettingItem[];
}

export interface SettingsModalOptions {
	/** Modal heading. */
	title: string;
	/** Optional descriptive subtitle shown above settings. */
	description?: string;
	/** Settings list items (used when tabs are not provided). */
	settings?: SettingItem[];
	/** Optional tabs for grouped settings. */
	tabs?: SettingsTab[];
	/** Initial active tab index. */
	activeTabIndex?: number;
	/** Called when a setting value changes. */
	onChange: (id: string, value: string) => void;
	/** Called when modal should close. */
	onClose: () => void;
	/** Optional help text shown below settings. */
	helpText?: string;
	/** Enables in-list search (`/` and typing behavior from SettingsList). */
	enableSearch?: boolean;
}

/**
 * Pre-built Zellij content renderer for configuration modals.
 */
export class ZellijSettingsModal implements ZellijModalContentRenderer {
	private container: Container;
	private contentBox: Box;
	private settingsList: SettingsList;
	private options: SettingsModalOptions;
	private theme: Theme;
	private showTabs: boolean;
	private activeTabIndex: number;
	private tabLists: SettingsList[];

	constructor(options: SettingsModalOptions, theme: Theme) {
		if (!options.title || !options.title.trim()) {
			throw new Error("ZellijSettingsModal requires a non-empty title.");
		}

		this.options = options;
		this.theme = theme;
		this.showTabs = options.tabs !== undefined && options.tabs.length > 0;
		this.tabLists = this.showTabs ? options.tabs!.map((tab) => this.createSettingsList(tab.settings, () => this.options.onClose())) : [];
		this.activeTabIndex = this.normalizeActiveTabIndex(options.activeTabIndex ?? 0);
		this.container = new Container();
		this.contentBox = new Box(0, 0);

		if (this.showTabs) {
			this.settingsList = this.tabLists[this.activeTabIndex] ?? this.tabLists[0]!;
		} else {
			this.contentBox.addChild(new Text(this.theme.fg("accent", this.theme.bold(options.title)), 0, 0));

			if (options.description) {
				this.contentBox.addChild(new Spacer(1));
				this.contentBox.addChild(new Text(this.theme.fg("muted", options.description), 0, 0));
			}

			this.contentBox.addChild(new Spacer(1));
			const fallbackSettings = options.settings ?? [];
			this.settingsList = this.createSettingsList(fallbackSettings, () => this.options.onClose());
			this.contentBox.addChild(this.settingsList);

			if (options.helpText) {
				this.contentBox.addChild(new Spacer(1));
				this.contentBox.addChild(new Text(this.theme.fg("dim", options.helpText), 0, 0));
			}

			this.container.addChild(this.contentBox);
		}
	}

	/**
	 * Render settings modal content.
	 */
	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		try {
			if (!this.showTabs) {
				return this.container.render(safeWidth);
			}

			const lines: string[] = [];

			// Title
			lines.push(this.theme.fg("accent", this.theme.bold(this.options.title)));
			lines.push("");

			// Tab bar
			lines.push(this.renderTabBar(safeWidth));
			lines.push("");

			// Active settings list for the selected tab.
			const activeList = this.tabLists[this.activeTabIndex] ?? this.tabLists[0];
			if (activeList) {
				const listRender = activeList.render(safeWidth);
				lines.push(...listRender);
			}

			// Separator + help text
			if (this.options.helpText) {
				lines.push(this.theme.fg("border", "─".repeat(Math.max(0, safeWidth))));
				lines.push(this.theme.fg("dim", this.options.helpText));
			}

			return lines;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return [this.theme.fg("error", truncateToWidth(`Settings render error: ${message}`, safeWidth, "…"))];
		}
	}

	private createSettingsList(settings: SettingItem[], onCancel: () => void): SettingsList {
		return new SettingsList(
			settings,
			Math.min(Math.max(settings.length + 2, 6), 18),
			getSettingsListTheme(),
			(id: string, value: string) => {
				this.options.onChange(id, value);
			},
			onCancel,
			{ enableSearch: this.options.enableSearch ?? true },
		);
	}

	private normalizeActiveTabIndex(index: number): number {
		if (!this.showTabs || this.tabLists.length === 0) {
			return 0;
		}

		const normalized = Number.isFinite(index) ? Math.floor(index) : 0;
		return ((normalized % this.tabLists.length) + this.tabLists.length) % this.tabLists.length;
	}

	private renderTabBar(width: number): string {
		if (!this.showTabs || !this.options.tabs || this.options.tabs.length === 0) {
			return "";
		}

		const parts: string[] = [];
		for (let i = 0; i < this.options.tabs.length; i++) {
			const label = this.options.tabs[i].label;
			if (i === this.activeTabIndex) {
				parts.push(this.theme.fg("accent", `[ ${label} ]`));
			} else {
				parts.push(this.theme.fg("muted", `  ${label}  `));
			}
		}

		return truncateToWidth(parts.join(""), width, "…");
	}

	private switchTab(direction: number): void {
		if (!this.showTabs || this.tabLists.length === 0) {
			return;
		}
		this.activeTabIndex = this.normalizeActiveTabIndex(this.activeTabIndex + direction);
		this.settingsList = this.tabLists[this.activeTabIndex] ?? this.tabLists[0]!;
	}

	/**
	 * Invalidate internal caches.
	 */
	invalidate(): void {
		if (!this.showTabs) {
			this.container.invalidate();
			return;
		}

		for (const list of this.tabLists) {
			list.invalidate();
		}
	}

	/**
	 * Forward key input to SettingsList.
	 */
	handleInput(data: string): void {
		if (isEnterActivationInput(data)) {
			return;
		}
		if (this.showTabs && matchesKey(data, "left")) {
			this.switchTab(-1);
			return;
		}
		if (this.showTabs && matchesKey(data, "right")) {
			this.switchTab(1);
			return;
		}

		this.settingsList.handleInput(data);
	}

	/**
	 * Programmatically update one setting value in the list.
	 */
	updateValue(id: string, value: string): void {
		if (!this.showTabs) {
			this.settingsList.updateValue(id, value);
			return;
		}

		for (const list of this.tabLists) {
			list.updateValue(id, value);
		}
	}
}

function isEnterActivationInput(data: string): boolean {
	return data === "\r" || data === "\n" || data === "\r\n";
}

function normalizeHelpUndertitle(
	helpText: ZellijModalConfigPartial["helpText"],
	helpUndertitle: HelpUndertitleConfig | undefined,
): HelpUndertitleConfig | undefined {
	if (helpUndertitle) {
		return helpUndertitle;
	}
	if (typeof helpText === "string") {
		return helpText ? { text: helpText } : undefined;
	}
	return helpText;
}

function resolvePaletteColor(color: PaletteColor | keyof ZellijColorPalette, palette: ZellijColorPalette): PaletteColor {
	if (typeof color === "string") {
		return palette[color];
	}
	return color;
}

function parseAnsiForegroundColor(ansi: string): PaletteColor | null {
	const rgbMatch = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(ansi);
	if (rgbMatch) {
		const [, r, g, b] = rgbMatch;
		return {
			type: "rgb",
			r: clampInt(Number.parseInt(r ?? "0", 10), 0, 255),
			g: clampInt(Number.parseInt(g ?? "0", 10), 0, 255),
			b: clampInt(Number.parseInt(b ?? "0", 10), 0, 255),
		};
	}

	const bit8Match = /\x1b\[38;5;(\d+)m/.exec(ansi);
	if (bit8Match) {
		const [, code] = bit8Match;
		return {
			type: "8bit",
			code: clampInt(Number.parseInt(code ?? "255", 10), 0, 255),
		};
	}

	return null;
}

/**
 * Shared no-op guard for the directional truncators: returns the value to emit
 * immediately when no truncation is required (text fits, or maxWidth is too
 * small to hold anything but an ellipsis fragment), otherwise `null` signals
 * the caller to proceed with directional truncation.
 */
function truncateNoOpGuard(text: string, maxWidth: number): string | null {
	if (visibleWidth(text) <= maxWidth) {
		return text;
	}
	if (maxWidth <= 1) {
		return "…".slice(0, maxWidth);
	}
	return null;
}

function truncateWithNoOpGuard(
	text: string,
	maxWidth: number,
	compute: () => string,
): string {
	const guarded = truncateNoOpGuard(text, maxWidth);
	if (guarded !== null) {
		return guarded;
	}
	return compute();
}

function truncateStart(text: string, maxWidth: number): string {
	return truncateWithNoOpGuard(text, maxWidth, () => {
		const chars = Array.from(text);
		let current = "";
		for (let index = chars.length - 1; index >= 0; index--) {
			const candidate = `${chars[index]}${current}`;
			if (visibleWidth(candidate) >= maxWidth - 1) {
				current = candidate;
				break;
			}
			current = candidate;
		}
		return `…${truncateToWidth(current, Math.max(0, maxWidth - 1), "")}`;
	});
}

function truncateMiddle(text: string, maxWidth: number): string {
	return truncateWithNoOpGuard(text, maxWidth, () => {
		const headTarget = Math.floor((maxWidth - 1) / 2);
		const tailTarget = Math.max(0, maxWidth - 1 - headTarget);
		const head = truncateToWidth(text, headTarget, "");

		const chars = Array.from(text);
		let tail = "";
		for (let index = chars.length - 1; index >= 0; index--) {
			const candidate = `${chars[index]}${tail}`;
			if (visibleWidth(candidate) > tailTarget) {
				continue;
			}
			tail = candidate;
			if (visibleWidth(tail) === tailTarget) {
				break;
			}
		}

		return `${head}…${tail}`;
	});
}

function clampInt(value: number, min: number, max: number): number {
	if (Number.isNaN(value) || !Number.isFinite(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, Math.round(value)));
}

function pushVerticalPadding(lines: string[], count: number, paddedWidth: number): void {
	for (let i = 0; i < count; i++) {
		lines.push(" ".repeat(paddedWidth));
	}
}

/**
 * Extension factory entrypoint for Pi extension loader.
 *
 * This extension intentionally registers no commands/events and only exposes
 * reusable modal primitives for sibling extensions.
 */
export default function zellijModalExtension(_pi: ExtensionAPI): void {
	// no-op
}
