import fs from 'node:fs/promises';
import process from 'node:process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {deleteItems} from '../src/core/delete.js';
import {scanArtifacts} from '../src/core/scanner.js';
import {
	generateFixtures,
	resolveBenchScenario,
	type BenchScenario,
} from './generate-fixtures.js';

export interface BenchmarkSummary {
	samples: number[];
	minMs: number;
	maxMs: number;
	meanMs: number;
	medianMs: number;
	p95Ms: number;
	stdDevMs: number;
}

export interface GateEvaluation {
	passed: boolean;
	baselineMs: number;
	allowedMs: number;
	measuredMs: number;
	threshold: number;
	regressionPercent: number;
}

export type GateMetric = 'scanArtifactsMedianMs';

export const DEFAULT_GATE_METRIC: GateMetric = 'scanArtifactsMedianMs';

export interface BenchmarkMetricRun {
	warmups: number;
	iterations: number;
	summary: BenchmarkSummary;
}

export interface BenchmarkGateReport {
	metric: GateMetric;
	rationale: string;
	evaluation: GateEvaluation;
}

export interface BenchmarkReport {
	scenario: BenchScenario;
	mode: 'run' | 'gate';
	metrics: {
		scanArtifacts: BenchmarkMetricRun;
		cleanup: BenchmarkMetricRun;
	};
	gate?: BenchmarkGateReport;
}

interface BaselineScenario {
	scanArtifactsMedianMs: number;
	gateMetric?: unknown;
}

interface BaselineFile {
	version: number;
	scenarios: Record<string, BaselineScenario | undefined>;
}

interface LoadedBaseline {
	scanArtifactsMedianMs: number;
	gateMetric: GateMetric;
}

interface ScenarioRunDefaults {
	warmups: number;
	iterations: number;
}

export const SCENARIO_RUN_DEFAULTS: Record<BenchScenario, ScenarioRunDefaults> =
	{
		quick: {
			warmups: 1,
			iterations: 4,
		},
		medium: {
			warmups: 2,
			iterations: 8,
		},
		full: {
			warmups: 2,
			iterations: 12,
		},
	};

export const CLEANUP_RUN_DEFAULTS: Record<BenchScenario, ScenarioRunDefaults> =
	{
		quick: {
			warmups: 1,
			iterations: 2,
		},
		medium: {
			warmups: 1,
			iterations: 2,
		},
		full: {
			warmups: 1,
			iterations: 3,
		},
	};

// Cleanup timings are still reported, but the CI gate stays on scan latency to
// avoid flaky failures from filesystem delete variance across runners.
const SCAN_GATE_RATIONALE =
	'Gate evaluates scanArtifacts median only; cleanup (scan + delete) is reported but not gated to keep CI stable.';

export const summarizeSamples = (samples: number[]): BenchmarkSummary => {
	if (samples.length === 0) {
		throw new Error('Expected at least one benchmark sample.');
	}

	const ordered = [...samples].sort((left, right) => left - right);
	const minMs = ordered[0] ?? 0;
	const maxMs = ordered[ordered.length - 1] ?? 0;
	const meanMs =
		ordered.reduce((total, value) => total + value, 0) / ordered.length;
	const midpoint = Math.floor(ordered.length / 2);
	const medianMs =
		ordered.length % 2 === 0
			? ((ordered[midpoint - 1] ?? 0) + (ordered[midpoint] ?? 0)) / 2
			: (ordered[midpoint] ?? 0);
	const p95Index = Math.min(
		ordered.length - 1,
		Math.max(0, Math.ceil(ordered.length * 0.95) - 1),
	);
	const p95Ms = ordered[p95Index] ?? 0;
	const variance =
		ordered.reduce((total, value) => total + (value - meanMs) ** 2, 0) /
		ordered.length;
	const stdDevMs = Math.sqrt(variance);

	return {
		samples: ordered,
		minMs,
		maxMs,
		meanMs,
		medianMs,
		p95Ms,
		stdDevMs,
	};
};

export const evaluateGate = (
	baselineMs: number,
	measuredMs: number,
	threshold: number,
): GateEvaluation => {
	if (baselineMs <= 0) {
		throw new Error('Baseline must be greater than zero.');
	}

	if (threshold < 0) {
		throw new Error('Threshold cannot be negative.');
	}

	const allowedMs = baselineMs * (1 + threshold);
	const regressionPercent = ((measuredMs - baselineMs) / baselineMs) * 100;

	return {
		passed: measuredMs <= allowedMs,
		baselineMs,
		allowedMs,
		measuredMs,
		threshold,
		regressionPercent,
	};
};

export const resolveGateMetric = (value: unknown): GateMetric => {
	if (value === undefined || value === DEFAULT_GATE_METRIC) {
		return DEFAULT_GATE_METRIC;
	}

	throw new Error(
		`Unsupported gate metric \"${String(value)}\". Expected \"${DEFAULT_GATE_METRIC}\".`,
	);
};

export const gateMetricRationale = (_metric: GateMetric): string =>
	SCAN_GATE_RATIONALE;

interface ParsedOptions {
	mode: 'run' | 'gate';
	scenario: BenchScenario;
	warmups: number;
	iterations: number;
	cleanupWarmups: number;
	cleanupIterations: number;
	threshold: number;
	baselinePath: string;
	json: boolean;
}

const parseIntegerFlag = (value: string, flagName: string): number => {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${flagName} must be a positive integer.`);
	}

	return parsed;
};

const parseNumberFlag = (value: string, flagName: string): number => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`${flagName} must be a finite number.`);
	}

	return parsed;
};

const parseBenchmarkCliArgs = (argv: string[]): ParsedOptions => {
	let mode: 'run' | 'gate' = 'run';
	let scenario: BenchScenario = 'quick';
	let warmupsOverride: number | undefined;
	let iterationsOverride: number | undefined;
	let threshold = 0.1;
	let baselinePath = fileURLToPath(
		new URL('./baselines.json', import.meta.url),
	);
	let json = false;

	const takeNextValue = (index: number, flag: string): string => {
		const value = argv[index + 1];
		if (!value) {
			throw new Error(`Missing value for ${flag}.`);
		}

		return value;
	};

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];

		if (argument === '--json') {
			json = true;
			continue;
		}

		if (argument === '--mode') {
			const value = takeNextValue(index, '--mode');
			if (value !== 'run' && value !== 'gate') {
				throw new Error('Invalid mode. Expected "run" or "gate".');
			}
			mode = value;
			index += 1;
			continue;
		}

		if (argument.startsWith('--mode=')) {
			const value = argument.slice('--mode='.length);
			if (value !== 'run' && value !== 'gate') {
				throw new Error('Invalid mode. Expected "run" or "gate".');
			}
			mode = value;
			continue;
		}

		if (argument === '--scenario') {
			scenario = resolveBenchScenario(takeNextValue(index, '--scenario'));
			index += 1;
			continue;
		}

		if (argument.startsWith('--scenario=')) {
			scenario = resolveBenchScenario(argument.slice('--scenario='.length));
			continue;
		}

		if (argument === '--warmups') {
			warmupsOverride = parseIntegerFlag(
				takeNextValue(index, '--warmups'),
				'--warmups',
			);
			index += 1;
			continue;
		}

		if (argument.startsWith('--warmups=')) {
			warmupsOverride = parseIntegerFlag(
				argument.slice('--warmups='.length),
				'--warmups',
			);
			continue;
		}

		if (argument === '--iterations') {
			iterationsOverride = parseIntegerFlag(
				takeNextValue(index, '--iterations'),
				'--iterations',
			);
			index += 1;
			continue;
		}

		if (argument.startsWith('--iterations=')) {
			iterationsOverride = parseIntegerFlag(
				argument.slice('--iterations='.length),
				'--iterations',
			);
			continue;
		}

		if (argument === '--threshold') {
			threshold = parseNumberFlag(
				takeNextValue(index, '--threshold'),
				'--threshold',
			);
			index += 1;
			continue;
		}

		if (argument.startsWith('--threshold=')) {
			threshold = parseNumberFlag(
				argument.slice('--threshold='.length),
				'--threshold',
			);
			continue;
		}

		if (argument === '--baseline') {
			baselinePath = takeNextValue(index, '--baseline');
			index += 1;
			continue;
		}

		if (argument.startsWith('--baseline=')) {
			baselinePath = argument.slice('--baseline='.length);
			continue;
		}

		throw new Error(`Unknown argument: ${argument}`);
	}

	if (threshold < 0) {
		throw new Error('--threshold cannot be negative.');
	}

	const scenarioDefaults = SCENARIO_RUN_DEFAULTS[scenario];
	const cleanupDefaults = CLEANUP_RUN_DEFAULTS[scenario];

	return {
		mode,
		scenario,
		warmups: warmupsOverride ?? scenarioDefaults.warmups,
		iterations: iterationsOverride ?? scenarioDefaults.iterations,
		cleanupWarmups: cleanupDefaults.warmups,
		cleanupIterations: cleanupDefaults.iterations,
		threshold,
		baselinePath,
		json,
	};
};

const loadScenarioBaseline = async (
	baselinePath: string,
	scenario: BenchScenario,
): Promise<LoadedBaseline> => {
	const fileContent = await fs.readFile(baselinePath, 'utf8');
	const data = JSON.parse(fileContent) as BaselineFile;
	const scenarioBaseline = data.scenarios?.[scenario];
	const baselineValue = scenarioBaseline?.scanArtifactsMedianMs;

	if (
		typeof baselineValue !== 'number' ||
		!Number.isFinite(baselineValue) ||
		baselineValue <= 0
	) {
		throw new Error(
			`Missing valid baseline for scenario \"${scenario}\" in ${baselinePath}.`,
		);
	}

	return {
		scanArtifactsMedianMs: baselineValue,
		gateMetric: resolveGateMetric(scenarioBaseline?.gateMetric),
	};
};

const runSingleScanSample = async (cwd: string): Promise<number> => {
	const startedAt = performance.now();
	await scanArtifacts(cwd);
	return performance.now() - startedAt;
};

const runSingleCleanupSample = async (
	scenario: BenchScenario,
): Promise<number> => {
	const fixtures = await generateFixtures(scenario);
	try {
		const startedAt = performance.now();
		const items = await scanArtifacts(fixtures.rootDir);
		await deleteItems(items);
		return performance.now() - startedAt;
	} finally {
		await fixtures.cleanup();
	}
};

const runMeasuredBenchmark = async (
	iterations: number,
	warmups: number,
	runSample: () => Promise<number>,
): Promise<BenchmarkSummary> => {
	for (let index = 0; index < warmups; index += 1) {
		// Warmups reduce startup noise from initial filesystem caching.
		// eslint-disable-next-line no-await-in-loop
		await runSample();
	}

	const samples: number[] = [];
	for (let index = 0; index < iterations; index += 1) {
		// eslint-disable-next-line no-await-in-loop
		const elapsedMs = await runSample();
		samples.push(elapsedMs);
	}

	return summarizeSamples(samples);
};

export const runBenchmark = async (
	cwd: string,
	iterations: number,
	warmups: number,
): Promise<BenchmarkSummary> =>
	runMeasuredBenchmark(iterations, warmups, async () =>
		runSingleScanSample(cwd),
	);

export const runCleanupBenchmark = async (
	scenario: BenchScenario,
	iterations: number,
	warmups: number,
): Promise<BenchmarkSummary> =>
	runMeasuredBenchmark(iterations, warmups, async () =>
		runSingleCleanupSample(scenario),
	);

export const buildBenchmarkReport = (input: {
	scenario: BenchScenario;
	mode: 'run' | 'gate';
	scan: BenchmarkMetricRun;
	cleanup: BenchmarkMetricRun;
	gate?: BenchmarkGateReport;
}): BenchmarkReport => ({
	scenario: input.scenario,
	mode: input.mode,
	metrics: {
		scanArtifacts: input.scan,
		cleanup: input.cleanup,
	},
	gate: input.gate,
});

const formatMilliseconds = (value: number): string => `${value.toFixed(2)}ms`;

const printRunSummary = (
	scenario: BenchScenario,
	options: ParsedOptions,
	scanSummary: BenchmarkSummary,
	cleanupSummary: BenchmarkSummary,
): void => {
	console.log(`Scenario: ${scenario}`);
	console.log(`Mode: ${options.mode}`);
	console.log(`Scan warmups: ${options.warmups}`);
	console.log(`Scan iterations: ${options.iterations}`);
	console.log(`Scan median: ${formatMilliseconds(scanSummary.medianMs)}`);
	console.log(`Scan mean: ${formatMilliseconds(scanSummary.meanMs)}`);
	console.log(`Scan p95: ${formatMilliseconds(scanSummary.p95Ms)}`);
	console.log(`Scan stdDev: ${formatMilliseconds(scanSummary.stdDevMs)}`);
	console.log(`Cleanup warmups: ${options.cleanupWarmups}`);
	console.log(`Cleanup iterations: ${options.cleanupIterations}`);
	console.log(
		`Cleanup median (scan + delete): ${formatMilliseconds(cleanupSummary.medianMs)}`,
	);
	console.log(
		`Cleanup mean (scan + delete): ${formatMilliseconds(cleanupSummary.meanMs)}`,
	);
	console.log(
		`Cleanup p95 (scan + delete): ${formatMilliseconds(cleanupSummary.p95Ms)}`,
	);
	console.log(
		`Cleanup stdDev (scan + delete): ${formatMilliseconds(cleanupSummary.stdDevMs)}`,
	);
};

const main = async (): Promise<void> => {
	const options = parseBenchmarkCliArgs(process.argv.slice(2));
	const fixtures = await generateFixtures(options.scenario);
	let shouldFailGate = false;

	try {
		const scanSummary = await runBenchmark(
			fixtures.rootDir,
			options.iterations,
			options.warmups,
		);
		const cleanupSummary = await runCleanupBenchmark(
			options.scenario,
			options.cleanupIterations,
			options.cleanupWarmups,
		);

		let gate: BenchmarkGateReport | undefined;
		if (options.mode === 'gate') {
			const baseline = await loadScenarioBaseline(
				options.baselinePath,
				options.scenario,
			);
			const evaluation = evaluateGate(
				baseline.scanArtifactsMedianMs,
				scanSummary.medianMs,
				options.threshold,
			);
			gate = {
				metric: baseline.gateMetric,
				rationale: gateMetricRationale(baseline.gateMetric),
				evaluation,
			};
			shouldFailGate = !evaluation.passed;
		}

		const report = buildBenchmarkReport({
			scenario: options.scenario,
			mode: options.mode,
			scan: {
				warmups: options.warmups,
				iterations: options.iterations,
				summary: scanSummary,
			},
			cleanup: {
				warmups: options.cleanupWarmups,
				iterations: options.cleanupIterations,
				summary: cleanupSummary,
			},
			gate,
		});

		if (options.json) {
			console.log(JSON.stringify(report, null, 2));
		} else {
			printRunSummary(options.scenario, options, scanSummary, cleanupSummary);
			if (gate) {
				console.log(`Gate metric: ${gate.metric}`);
				console.log(`Gate rationale: ${gate.rationale}`);
				console.log(
					`Baseline: ${formatMilliseconds(gate.evaluation.baselineMs)}`,
				);
				console.log(
					`Allowed: ${formatMilliseconds(gate.evaluation.allowedMs)}`,
				);
				console.log(
					`Regression: ${gate.evaluation.regressionPercent.toFixed(2)}%`,
				);
				console.log(`Gate: ${gate.evaluation.passed ? 'PASS' : 'FAIL'}`);
			}
		}
	} finally {
		await fixtures.cleanup();
	}

	if (shouldFailGate) {
		process.exit(1);
	}
};

if (import.meta.main) {
	main().catch(error => {
		console.error(
			error instanceof Error ? error.message : 'Benchmark runner failed.',
		);
		process.exit(1);
	});
}
