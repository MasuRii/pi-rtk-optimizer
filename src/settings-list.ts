// Plain-rows replacement for pi-tui's `SettingsList` (same constructor, keys and look),
// so the modal imports nothing from a pi-tui package. See rows.ts for why.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { parseKey, truncate, visibleWidth, wrap } from "./rows.js";

/** One setting row: a label and a value cycled through `values`. */
export interface SettingItem {
	id: string;
	label: string;
	description?: string;
	currentValue: string;
	values?: string[];
}

export interface SettingsListOptions {
	enableSearch?: boolean;
}

export class SettingsList {
	private filteredItems: SettingItem[];
	private selectedIndex = 0;
	private query = "";

	constructor(
		private items: SettingItem[],
		private maxVisible: number,
		private theme: Theme,
		private onChange: (id: string, value: string) => void,
		private onCancel: () => void,
		private options: SettingsListOptions = {},
	) {
		this.filteredItems = items;
	}

	/** Update an item's currentValue. */
	updateValue(id: string, value: string): void {
		const item = this.items.find((entry) => entry.id === id);
		if (item) {
			item.currentValue = value;
		}
	}

	invalidate(): void {}

	render(width: number): string[] {
		const { theme } = this;
		const hint = (text: string) => theme.fg("dim", text);
		const lines: string[] = [];
		if (this.options.enableSearch) {
			lines.push(truncate(`> ${this.query}\x1b[7m \x1b[27m`, width));
			lines.push("");
		}

		const items = this.filteredItems;
		if (items.length === 0) {
			lines.push(truncate(hint(this.items.length === 0 ? "  No settings available" : "  No matching settings"), width));
			this.pushHint(lines, width);
			return lines;
		}

		const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), items.length - this.maxVisible));
		const end = Math.min(start + this.maxVisible, items.length);
		const labelWidth = Math.min(30, Math.max(...this.items.map((item) => visibleWidth(item.label))));
		const cursor = theme.fg("accent", `${(theme as { nav?: { cursor?: string } }).nav?.cursor ?? "→"} `);
		for (let index = start; index < end; index++) {
			const item = items[index]!;
			const selected = index === this.selectedIndex;
			const prefix = selected ? cursor : "  ";
			const label = item.label + " ".repeat(Math.max(0, labelWidth - visibleWidth(item.label)));
			const valueWidth = width - visibleWidth(prefix) - labelWidth - 4;
			const value = truncate(item.currentValue, valueWidth);
			lines.push(
				truncate(
					`${prefix}${selected ? theme.fg("accent", label) : label}  ${theme.fg(selected ? "accent" : "muted", value)}`,
					width,
				),
			);
		}

		if (start > 0 || end < items.length) {
			lines.push(hint(truncate(`  (${this.selectedIndex + 1}/${items.length})`, width - 2)));
		}

		const description = items[this.selectedIndex]?.description;
		if (description) {
			lines.push("");
			for (const line of wrap(description, width - 4)) {
				lines.push(theme.fg("dim", `  ${line}`));
			}
		}

		this.pushHint(lines, width);
		return lines;
	}

	handleInput(data: string): void {
		const key = parseKey(data);
		if (!key) {
			return;
		}
		const count = this.filteredItems.length;
		if (key.id === "up") {
			if (count > 0) this.selectedIndex = this.selectedIndex === 0 ? count - 1 : this.selectedIndex - 1;
		} else if (key.id === "down") {
			if (count > 0) this.selectedIndex = this.selectedIndex === count - 1 ? 0 : this.selectedIndex + 1;
		} else if (key.id === "enter" || key.id === " ") {
			this.activateItem();
		} else if (key.id === "escape" || key.id === "ctrl+c") {
			this.onCancel();
		} else if (this.options.enableSearch) {
			if (key.id === "backspace") {
				this.applyFilter(this.query.slice(0, -1));
			} else if (key.text?.replace(/ /g, "")) {
				this.applyFilter(this.query + key.text.replace(/ /g, ""));
			}
		}
	}

	private activateItem(): void {
		const item = this.filteredItems[this.selectedIndex];
		if (!item?.values || item.values.length === 0) {
			return;
		}
		const next = item.values[(item.values.indexOf(item.currentValue) + 1) % item.values.length]!;
		item.currentValue = next;
		this.onChange(item.id, next);
	}

	private applyFilter(query: string): void {
		this.query = query;
		// shortcut: case-insensitive subsequence match in list order, not pi-tui's ranked fuzzy match; fine for ~20 settings.
		const needle = query.toLowerCase();
		this.filteredItems = this.items.filter((item) => {
			let at = 0;
			for (const char of item.label.toLowerCase()) {
				if (char === needle[at]) at++;
			}
			return at === needle.length;
		});
		this.selectedIndex = 0;
	}

	private pushHint(lines: string[], width: number): void {
		lines.push("");
		lines.push(
			truncate(
				this.theme.fg(
					"dim",
					this.options.enableSearch
						? "  Type to search · Enter/Space to change · Esc to cancel"
						: "  Enter/Space to change · Esc to cancel",
				),
				width,
			),
		);
	}
}
