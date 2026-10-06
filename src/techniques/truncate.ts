export function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}

	if (maxLength < 3) {
		return "...";
	}

	const marker = "\n... [RTK truncated middle] ...\n";
	if (maxLength <= marker.length) {
		return `${text.slice(0, maxLength - 3)}...`;
	}

	const contentLength = maxLength - marker.length;
	const headLength = Math.ceil(contentLength / 2);
	const tailLength = Math.floor(contentLength / 2);
	return `${text.slice(0, headLength)}${marker}${text.slice(text.length - tailLength)}`;
}
