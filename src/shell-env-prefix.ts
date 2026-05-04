const SINGLE_QUOTED_SHELL_VALUE_PATTERN = "'(?:'\\\\''|[^'])*'";
const ENV_ASSIGNMENT_VALUE_PATTERN = `(?:"[^"]*"|${SINGLE_QUOTED_SHELL_VALUE_PATTERN}|[^\\s]+)`;
const LEADING_ENV_ASSIGNMENT_PATTERN = new RegExp(
	`^((?:[A-Za-z_][A-Za-z0-9_]*=${ENV_ASSIGNMENT_VALUE_PATTERN}\\s+)*)`,
);

export interface LeadingEnvAssignmentSplit {
	envPrefix: string;
	command: string;
}

export function splitLeadingEnvAssignments(input: string): LeadingEnvAssignmentSplit {
	const envPrefix = input.match(LEADING_ENV_ASSIGNMENT_PATTERN)?.[1] ?? "";
	return {
		envPrefix,
		command: input.slice(envPrefix.length),
	};
}
