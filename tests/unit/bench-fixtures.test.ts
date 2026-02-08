import {expect, test} from 'bun:test';
import {
	SCENARIO_CONFIGS,
	resolveBenchScenario,
	resolveScenarioConfig,
} from '../../bench/generate-fixtures.js';

test('resolveScenarioConfig returns matching scenario config', () => {
	const config = resolveScenarioConfig('medium');
	expect(config.projects).toBe(SCENARIO_CONFIGS.medium.projects);
	expect(config.filesPerPrimaryArtifact).toBe(
		SCENARIO_CONFIGS.medium.filesPerPrimaryArtifact,
	);
});

test('resolveBenchScenario throws for invalid scenario value', () => {
	expect(() => resolveBenchScenario('invalid')).toThrow(
		'Unknown benchmark scenario',
	);
});
