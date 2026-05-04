import { DEFAULT_RTK_INTEGRATION_CONFIG, type RtkIntegrationConfig } from "./types.ts";

type TestResult = void | Promise<void>;

function isPromiseLike(value: TestResult): value is Promise<void> {
	return Boolean(value && typeof (value as Promise<void>).then === "function");
}

export function runTest(name: string, testFn: () => TestResult): TestResult {
	const result = testFn();
	if (!isPromiseLike(result)) {
		console.log(`[PASS] ${name}`);
		return;
	}

	return result.then(() => {
		console.log(`[PASS] ${name}`);
	});
}

export function cloneDefaultConfig(): RtkIntegrationConfig {
	return structuredClone(DEFAULT_RTK_INTEGRATION_CONFIG);
}
