import { matchesCommandPatterns } from "./command-detection.js";

interface TestSummary {
	passed: number;
	failed: number;
	skipped: number;
	failures: string[];
}

const TEST_COMMAND_PATTERNS = [
	/^npm\s+test\b/,
	/^pnpm\s+test\b/,
	/^yarn\s+test\b/,
	/^bun\s+test\b/,
	/^cargo\s+test\b/,
	/^go\s+test\b/,
	/^pytest\b/,
	/^python\s+-m\s+pytest\b/,
	/^(?:pnpm\s+)?(?:npx\s+)?vitest\b/,
	/^(?:npx\s+)?jest\b/,
	/^mocha\b/,
	/^ava\b/,
	/^tap\b/,
] as const;

const TEST_RESULT_PATTERNS = [
	/test result:\s*(\w+)\.\s*(\d+)\s*passed;\s*(\d+)\s*failed;/,
	/(\d+)\s*passed(?:,\s*(\d+)\s*failed)?(?:,\s*(\d+)\s*skipped)?/i,
	/(\d+)\s*pass(?:,\s*(\d+)\s*fail)?(?:,\s*(\d+)\s*skip)?/i,
	/tests?:\s*(\d+)\s*passed(?:,\s*(\d+)\s*failed)?(?:,\s*(\d+)\s*skipped)?/i,
];

const FAILURE_START_PATTERNS = [
	/^FAIL\s+/,
	/^FAILED\s+/,
	/^\s*●\s+/,
	/^\s*✕\s+/,
	/^\s*✖\s+(?!failing tests:)/,
	/test\s+\w+\s+\.\.\.\s*FAILED/,
	/thread\s+'\w+'\s+panicked/,
];
const FALLBACK_PASS_PATTERN = /(?:\b(?:ok|PASS)\b|[✓✔])/;
const FALLBACK_FAIL_PATTERN = /^\s*(?:[✗✖✕❌]|(?:FAIL|FAILED)\b)/;

// node:test prints an authoritative summary block for every reporter: the
// spec and dot reporters prefix it with "ℹ", the TAP reporter with "#". Its
// counts are the ground truth, so the line-scanning fallback must be skipped
// entirely whenever it is present (a green title such as "fails open" must
// never be counted as a failed test).
const NODE_TEST_SUMMARY_LINE = /^\s*(?:ℹ|#)\s*(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/;

function isFailureStart(line: string): boolean {
	return FAILURE_START_PATTERNS.some((pattern) => pattern.test(line));
}

function extractNodeTestSummary(output: string): Partial<TestSummary> | null {
	let passed: number | undefined;
	let failed: number | undefined;
	let skipped: number | undefined;

	for (const line of output.split("\n")) {
		const match = NODE_TEST_SUMMARY_LINE.exec(line);
		if (!match) {
			continue;
		}
		switch (match[1]) {
			case "pass":
				passed = Number.parseInt(match[2] ?? "0", 10);
				break;
			case "fail":
				failed = Number.parseInt(match[2] ?? "0", 10);
				break;
			case "skipped":
				skipped = Number.parseInt(match[2] ?? "0", 10);
				break;
			default:
				break;
		}
	}

	if (passed === undefined && failed === undefined) {
		return null;
	}

	return {
		passed: passed ?? 0,
		failed: failed ?? 0,
		skipped: skipped ?? 0,
	};
}

function extractTestStats(output: string): Partial<TestSummary> | null {
	const nodeSummary = extractNodeTestSummary(output);
	if (nodeSummary) {
		return nodeSummary;
	}

	for (const pattern of TEST_RESULT_PATTERNS) {
		const match = output.match(pattern);
		if (!match) {
			continue;
		}
		return {
			passed: Number.parseInt(match[1] ?? "0", 10) || 0,
			failed: Number.parseInt(match[2] ?? "0", 10) || 0,
			skipped: Number.parseInt(match[3] ?? "0", 10) || 0,
		};
	}
	return null;
}

export function isTestCommand(command: string | undefined | null): boolean {
	return matchesCommandPatterns(command, TEST_COMMAND_PATTERNS);
}

export function aggregateTestOutput(output: string, command: string | undefined | null): string | null {
	if (!isTestCommand(command)) {
		return null;
	}

	const lines = output.split("\n");
	const summary: TestSummary = {
		passed: 0,
		failed: 0,
		skipped: 0,
		failures: [],
	};

	const stats = extractTestStats(output);
	if (stats) {
		summary.passed = stats.passed ?? 0;
		summary.failed = stats.failed ?? 0;
		summary.skipped = stats.skipped ?? 0;
	} else {
		for (const line of lines) {
			if (FALLBACK_PASS_PATTERN.test(line)) {
				summary.passed++;
			}
			if (FALLBACK_FAIL_PATTERN.test(line)) {
				summary.failed++;
			}
		}
	}

	if (summary.failed > 0) {
		let inFailure = false;
		let currentFailure: string[] = [];
		let blankCount = 0;

		for (const line of lines) {
			if (isFailureStart(line)) {
				if (inFailure && currentFailure.length > 0) {
					summary.failures.push(currentFailure.join("\n"));
				}
				inFailure = true;
				currentFailure = [line];
				blankCount = 0;
				continue;
			}

			if (!inFailure) {
				continue;
			}

			if (line.trim() === "") {
				blankCount++;
				if (blankCount >= 2 && currentFailure.length > 3) {
					summary.failures.push(currentFailure.join("\n"));
					inFailure = false;
					currentFailure = [];
				} else {
					currentFailure.push(line);
				}
				continue;
			}

			if (line.match(/^\s/) || line.match(/^-/)) {
				currentFailure.push(line);
				blankCount = 0;
				continue;
			}

			summary.failures.push(currentFailure.join("\n"));
			inFailure = false;
			currentFailure = [];
		}

		if (inFailure && currentFailure.length > 0) {
			summary.failures.push(currentFailure.join("\n"));
		}
	}

	const result: string[] = ["Test Results:"];
	result.push(`   PASS: ${summary.passed} passed`);
	if (summary.failed > 0) {
		result.push(`   FAIL: ${summary.failed} failed`);
	}
	if (summary.skipped > 0) {
		result.push(`   SKIP: ${summary.skipped} skipped`);
	}

	if (summary.failed > 0 && summary.failures.length > 0) {
		result.push("\n   Failures:");
		for (const failure of summary.failures.slice(0, 5)) {
			const failureLines = failure.split("\n");
			const firstLine = failureLines[0] ?? "";
			result.push(`   - ${firstLine.slice(0, 70)}${firstLine.length > 70 ? "..." : ""}`);
			for (const detailLine of failureLines.slice(1, 4)) {
				if (detailLine.trim()) {
					result.push(`     ${detailLine.slice(0, 65)}${detailLine.length > 65 ? "..." : ""}`);
				}
			}
			if (failureLines.length > 4) {
				result.push(`     ... (${failureLines.length - 4} more lines)`);
			}
		}
		if (summary.failures.length > 5) {
			result.push(`   ... and ${summary.failures.length - 5} more failures`);
		}
	}

	return result.join("\n");
}
