/**
 * Terminal rows without any pi-tui package. omp 19.2 replaced `@oh-my-pi/pi-tui`
 * and refuses to load an extension that imports `@earendil-works/pi-tui` (even a
 * type). omp 18.x and 19.2 both accept a plain rows object from `ctx.ui.custom()`
 * -- `{ render(width): string[]; handleInput?(data); invalidate() }` -- so the
 * modal draws its rows with these helpers and works on both.
 * Copied from NSXBet/omp-marketplace `packages/omp-adapter/Rows.ts`.
 */

// oxlint-disable no-control-regex -- terminal input and ANSI escapes are control characters
const segmenter = new Intl.Segmenter();
/** One ANSI escape (CSI, OSC, or a two-byte ESC sequence) at the start of the string. */
const ESCAPE = /^\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/;
const ESCAPES = new RegExp(ESCAPE.source.slice(1), "g");

/** Columns `text` takes in a terminal: ANSI escapes are zero-width, wide graphemes count 2. */
// shortcut: off Bun (pi on Node) every grapheme counts 1 column; add a width library if wide text matters there.
export const visibleWidth =
	typeof Bun !== "undefined"
		? (text: string): number => Bun.stringWidth(text)
		: (text: string): number => [...segmenter.segment(text.replace(ESCAPES, ""))].length;

/** Escapes and graphemes of `text`, in order; escapes have width 0. */
function* pieces(text: string): Generator<{ text: string; width: number }> {
	let rest = text;
	while (rest) {
		const escape = ESCAPE.exec(rest);
		if (escape) {
			yield { text: escape[0], width: 0 };
			rest = rest.slice(escape[0].length);
			continue;
		}
		const next = rest.indexOf("\x1b", 1);
		const plain = next === -1 ? rest : rest.slice(0, next);
		for (const { segment } of segmenter.segment(plain)) yield { text: segment, width: visibleWidth(segment) };
		rest = next === -1 ? "" : rest.slice(next);
	}
}

/**
 * `text` cut to `width` columns, ANSI-aware: escapes are kept, a cut line ends with
 * `ellipsis` and an SGR reset. `pad` fills a shorter result with spaces to `width`.
 */
export function truncate(text: string, width: number, ellipsis = "", pad = false): string {
	const max = Math.max(0, width);
	if (visibleWidth(text) <= max) return pad ? text + " ".repeat(max - visibleWidth(text)) : text;
	const room = Math.max(0, max - visibleWidth(ellipsis));
	let out = "";
	let used = 0;
	for (const piece of pieces(text)) {
		if (used + piece.width > room) break;
		out += piece.text;
		used += piece.width;
	}
	out += `\x1b[0m${ellipsis}`;
	return pad ? out + " ".repeat(Math.max(0, max - used - visibleWidth(ellipsis))) : out;
}

/** The SGR state after `text`, given the state before: the SGR escapes since the last reset. */
function sgrAfter(state: string, text: string): string {
	for (const piece of pieces(text)) {
		if (!/^\x1b\[[\d;:]*m$/.test(piece.text)) continue;
		state = piece.text === "\x1b[m" || piece.text === "\x1b[0m" ? "" : state + piece.text;
	}
	return state;
}

/**
 * `text` word-wrapped to `width` columns, ANSI-aware: each "\n" starts a row, words
 * longer than a row are split, and a style open at a row break carries to the next row.
 */
export function wrap(text: string, width: number): string[] {
	const max = Math.max(1, width);
	const rows: string[] = [];
	let style = "";
	let row = "";
	let used = 0;
	const breakRow = () => {
		rows.push(row.trimEnd() + (style ? "\x1b[0m" : ""));
		row = style;
		used = 0;
	};
	for (const [index, line] of text.split("\n").entries()) {
		if (index > 0) breakRow();
		for (const word of line.split(/(?<= )/)) {
			if (used > 0 && used + visibleWidth(word.trimEnd()) > max) breakRow();
			if (used + visibleWidth(word.trimEnd()) <= max) {
				row += word;
				used += visibleWidth(word);
				style = sgrAfter(style, word);
				continue;
			}
			for (const piece of pieces(word)) {
				if (used > 0 && used + piece.width > max) breakRow();
				row += piece.text;
				used += piece.width;
				style = sgrAfter(style, piece.text);
			}
		}
	}
	rows.push(row.trimEnd());
	return rows;
}

/**
 * One key a view received. `id` is the chord in omp's keybinding format
 * (`escape`, `enter`, `shift+tab`, `ctrl+s`, `pageDown`, `a`, …), or `paste`;
 * `text` is what the key types (or the pasted text), when it types anything.
 */
export type Key = { id: string; text?: string };

const LEGACY: Record<string, string> = {
	"\x1b": "escape",
	"\r": "enter",
	"\n": "enter",
	"\x1bOM": "enter",
	"\t": "tab",
	"\x1b[Z": "shift+tab",
	"\x7f": "backspace",
	"\x08": "backspace",
	"\x1b[3~": "delete",
	"\x1b[A": "up",
	"\x1bOA": "up",
	"\x1b[B": "down",
	"\x1bOB": "down",
	"\x1b[C": "right",
	"\x1bOC": "right",
	"\x1b[D": "left",
	"\x1bOD": "left",
	"\x1b[H": "home",
	"\x1bOH": "home",
	"\x1b[1~": "home",
	"\x1b[7~": "home",
	"\x1b[F": "end",
	"\x1bOF": "end",
	"\x1b[4~": "end",
	"\x1b[8~": "end",
	"\x1b[5~": "pageUp",
	"\x1b[6~": "pageDown",
};
const CSI_LETTER: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end" };
const CSI_TILDE: Record<string, string> = {
	"1": "home",
	"2": "insert",
	"3": "delete",
	"4": "end",
	"5": "pageUp",
	"6": "pageDown",
	"7": "home",
	"8": "end",
};
const CODEPOINT: Record<number, string> = { 27: "escape", 13: "enter", 9: "tab", 127: "backspace", 8: "backspace", 57414: "enter" };

/** `key` with the kitty/xterm modifier parameter (1 + shift·1 + alt·2 + ctrl·4 + super·8) applied. */
function chord(key: string, modifiers: number): string {
	const mask = Math.max(0, modifiers - 1);
	return `${mask & 4 ? "ctrl+" : ""}${mask & 2 ? "alt+" : ""}${mask & 1 ? "shift+" : ""}${mask & 8 ? "super+" : ""}${key}`;
}

/** A kitty `CSI u` or xterm modifyOtherKeys codepoint key. */
function codepointKey(codepoint: number, shifted: number | undefined, modifiers: number): Key {
	const named = CODEPOINT[codepoint];
	if (named) return { id: chord(named, modifiers) };
	const mask = Math.max(0, modifiers - 1);
	const char = String.fromCodePoint(codepoint).toLowerCase();
	if (mask & (2 | 4 | 8)) return { id: chord(char, modifiers) };
	const typed = mask & 1 ? (shifted ? String.fromCodePoint(shifted) : char.toUpperCase()) : char;
	// An uppercase letter is `shift+<letter>`; other shifted symbols are the symbol (`!`).
	return { id: mask & 1 && /^[a-z]$/.test(char) ? `shift+${char}` : typed, text: typed };
}

/**
 * The key in one chunk of raw terminal input, as a view's `handleInput(data)` gets
 * it: legacy bytes, xterm modifier CSI, modifyOtherKeys, the kitty keyboard
 * protocol, and bracketed paste. null for a key release or anything else.
 */
export function parseKey(data: string): Key | null {
	if (data.startsWith("\x1b[200~")) return { id: "paste", text: data.slice(6).replace(/\x1b\[201~$/, "") };
	const legacy = LEGACY[data];
	if (legacy) return { id: legacy };
	if (data.length === 1 && data.charCodeAt(0) >= 1 && data.charCodeAt(0) <= 26) {
		return { id: `ctrl+${String.fromCharCode(data.charCodeAt(0) + 96)}` };
	}
	if (data.length === 2 && data[0] === "\x1b" && data[1]! >= " ") return { id: `alt+${data[1]!.toLowerCase()}` };
	let match = /^\x1b\[(\d+)(?::(\d*))?(?::\d*)?(?:;(\d*)(?::(\d+))?)?(?:;[\d:]*)?u$/.exec(data);
	if (match) {
		if (match[4] === "3") return null;
		return codepointKey(Number(match[1]), match[2] ? Number(match[2]) : undefined, Number(match[3] || 1));
	}
	match = /^\x1b\[27;(\d+);(\d+)~$/.exec(data);
	if (match) return codepointKey(Number(match[2]), undefined, Number(match[1]));
	match = /^\x1b\[(?:1)?;?(\d+)?(?::(\d+))?([A-DFH])$/.exec(data);
	if (match) return match[2] === "3" ? null : { id: chord(CSI_LETTER[match[3]!]!, Number(match[1] || 1)) };
	match = /^\x1b\[(\d+)(?:;(\d+)(?::(\d+))?)?~$/.exec(data);
	if (match && CSI_TILDE[match[1]!]) return match[3] === "3" ? null : { id: chord(CSI_TILDE[match[1]!]!, Number(match[2] || 1)) };
	if (!/[\x00-\x1f\x7f]/.test(data)) return { id: data.length === 1 ? data : "text", text: data };
	return null;
}
