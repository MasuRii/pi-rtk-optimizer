import { toRecord } from "./record-utils.js";
import { sanitizeRtkEmojiOutput, stripAnsiFast, stripRtkHookWarnings } from "./techniques/index.js";

interface ToolResultTextBlock {
	type: string;
	text?: string;
	[key: string]: unknown;
}

function sanitizeStreamingBashText(text: string, command: string | undefined | null): string {
	let nextText = stripAnsiFast(text);

	const withoutRtkHookWarnings = stripRtkHookWarnings(nextText, command);
	if (withoutRtkHookWarnings !== null) {
		nextText = withoutRtkHookWarnings;
	}

	const withoutRtkEmoji = sanitizeRtkEmojiOutput(nextText, command);
	if (withoutRtkEmoji !== null) {
		nextText = withoutRtkEmoji;
	}

	return nextText;
}

/**
 * Sanitizes streamed bash result blocks before the TUI renders them so RTK
 * self-diagnostics never flash in partial or final tool output.
 */
export function sanitizeStreamingBashExecutionResult(
	result: unknown,
	command: string | undefined | null,
): boolean {
	const resultRecord = toRecord(result);
	const sourceContent = Array.isArray(resultRecord.content) ? resultRecord.content : null;
	if (!sourceContent || sourceContent.length === 0) {
		return false;
	}

	let changed = false;
	const nextContent = sourceContent.map((block) => {
		if (!block || typeof block !== "object" || Array.isArray(block)) {
			return block;
		}

		const contentBlock = block as ToolResultTextBlock;
		if (contentBlock.type !== "text" || typeof contentBlock.text !== "string") {
			return block;
		}

		const sanitizedText = sanitizeStreamingBashText(contentBlock.text, command);
		if (sanitizedText === contentBlock.text) {
			return block;
		}

		changed = true;
		return {
			...contentBlock,
			text: sanitizedText,
		};
	});

	if (!changed) {
		return false;
	}

	resultRecord.content = nextContent;
	return true;
}
