/** The item shape pi's command argument completions return. */
interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}

interface CompletionDefinition {
	name: string;
	description: string;
}

const TOP_LEVEL_SUBCOMMANDS: CompletionDefinition[] = [
	{ name: "show", description: "Show current RTK config + runtime summary" },
	{ name: "path", description: "Show RTK config file path" },
	{ name: "verify", description: "Check whether rtk binary is available" },
	{ name: "stats", description: "Show output compaction metrics" },
	{ name: "clear-stats", description: "Clear output compaction metrics" },
	{ name: "reset", description: "Reset RTK settings to defaults" },
	{ name: "help", description: "Show usage help" },
];

function startsWithFilter(value: string, prefix: string): boolean {
	if (!prefix) {
		return true;
	}
	return value.startsWith(prefix);
}

function mapCompletions(values: CompletionDefinition[]): AutocompleteItem[] {
	return values.map((entry) => ({
		value: entry.name,
		label: entry.name,
		description: entry.description,
	}));
}

export function getRtkArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const normalized = argumentPrefix.trimStart().toLowerCase();
	if (!normalized) {
		return mapCompletions(TOP_LEVEL_SUBCOMMANDS);
	}

	if (normalized.includes(" ")) {
		return null;
	}

	const filtered = TOP_LEVEL_SUBCOMMANDS.filter((entry) => startsWithFilter(entry.name, normalized));
	if (filtered.length === 0) {
		return null;
	}

	return mapCompletions(filtered);
}
