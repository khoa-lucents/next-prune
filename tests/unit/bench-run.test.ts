import {expect, test} from 'bun:test';
import {
	DEFAULT_GATE_METRIC,
	buildBenchmarkReport,
	evaluateGate,
	gateMetricRationale,
	resolveGateMetric,
	summarizeSamples,
} from '../../bench/run-bench.js';

test('summarizeSamples returns stable aggregate metrics', () => {
	const summary = summarizeSamples([9, 3, 5, 7, 11]);

	expect(summary.samples).toEqual([3, 5, 7, 9, 11]);
	expect(summary.minMs).toBe(3);
	expect(summary.maxMs).toBe(11);
	expect(summary.medianMs).toBe(7);
	expect(summary.meanMs).toBe(7);
	expect(summary.p95Ms).toBe(11);
});

test('evaluateGate allows up to threshold and fails above threshold', () => {
	const passing = evaluateGate(100, 110, 0.1);
	expect(passing.passed).toBe(true);
	expect(passing.allowedMs).toBeCloseTo(110, 8);

	const failing = evaluateGate(100, 111, 0.1);
	expect(failing.passed).toBe(false);
	expect(Math.round(failing.regressionPercent)).toBe(11);
});

test('resolveGateMetric defaults to scanArtifacts median and rejects unknown metrics', () => {
	expect(resolveGateMetric(undefined)).toBe(DEFAULT_GATE_METRIC);
	expect(resolveGateMetric('scanArtifactsMedianMs')).toBe(DEFAULT_GATE_METRIC);
	expect(() => resolveGateMetric('cleanupMedianMs')).toThrow(
		'Unsupported gate metric',
	);
});

test('buildBenchmarkReport includes scan and cleanup metric runs plus gate metadata', () => {
	const scanSummary = summarizeSamples([5, 7, 9]);
	const cleanupSummary = summarizeSamples([12, 14, 16]);
	const gateEvaluation = evaluateGate(8, scanSummary.medianMs, 0.1);

	const report = buildBenchmarkReport({
		scenario: 'quick',
		mode: 'gate',
		scan: {
			warmups: 1,
			iterations: 3,
			summary: scanSummary,
		},
		cleanup: {
			warmups: 1,
			iterations: 2,
			summary: cleanupSummary,
		},
		gate: {
			metric: DEFAULT_GATE_METRIC,
			rationale: gateMetricRationale(DEFAULT_GATE_METRIC),
			evaluation: gateEvaluation,
		},
	});

	expect(report.metrics.scanArtifacts.summary.medianMs).toBe(7);
	expect(report.metrics.cleanup.summary.medianMs).toBe(14);
	expect(report.gate?.metric).toBe(DEFAULT_GATE_METRIC);
	expect(report.gate?.rationale).toContain('not gated');
});
