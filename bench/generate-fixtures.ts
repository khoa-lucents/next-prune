import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export type BenchScenario = 'quick' | 'medium' | 'full';

export interface FixtureScenarioConfig {
	projects: number;
	filesPerPrimaryArtifact: number;
	fileSizeBytes: number;
	sourceFilesPerProject: number;
}

export interface GenerateFixturesOptions {
	rootDir?: string;
	keepFixtureDir?: boolean;
}

export interface GeneratedFixtures {
	scenario: BenchScenario;
	config: FixtureScenarioConfig;
	rootDir: string;
	projectDirs: string[];
	cleanup: () => Promise<void>;
}

export const SCENARIO_CONFIGS: Record<BenchScenario, FixtureScenarioConfig> = {
	quick: {
		projects: 3,
		filesPerPrimaryArtifact: 80,
		fileSizeBytes: 1024,
		sourceFilesPerProject: 12,
	},
	medium: {
		projects: 8,
		filesPerPrimaryArtifact: 480,
		fileSizeBytes: 1536,
		sourceFilesPerProject: 24,
	},
	full: {
		projects: 14,
		filesPerPrimaryArtifact: 960,
		fileSizeBytes: 2048,
		sourceFilesPerProject: 32,
	},
};

export const isBenchScenario = (value: string): value is BenchScenario =>
	Object.hasOwn(SCENARIO_CONFIGS, value);

export const resolveBenchScenario = (value: string): BenchScenario => {
	if (!isBenchScenario(value)) {
		throw new Error(
			`Unknown benchmark scenario \"${value}\". Expected one of: quick, medium, full.`,
		);
	}

	return value;
};

export const resolveScenarioConfig = (value: string): FixtureScenarioConfig => {
	const scenario = resolveBenchScenario(value);
	return SCENARIO_CONFIGS[scenario];
};

const buildPayload = (sizeBytes: number, seed: number): Uint8Array => {
	const fillCode = 97 + (seed % 26);
	return Buffer.alloc(sizeBytes, fillCode);
};

const writeBatchedFiles = async (
	directory: string,
	fileCount: number,
	payload: Uint8Array,
	prefix: string,
): Promise<void> => {
	await fs.mkdir(directory, {recursive: true});

	const shardCount = Math.min(16, Math.max(1, Math.ceil(fileCount / 48)));
	const shardNames = Array.from(
		{length: shardCount},
		(_, index) => `chunk-${String(index).padStart(2, '0')}`,
	);

	await Promise.all(
		shardNames.map(async shardName =>
			fs.mkdir(path.join(directory, shardName), {recursive: true}),
		),
	);

	const pendingWrites: Array<Promise<void>> = [];

	for (let index = 0; index < fileCount; index += 1) {
		const shardName = shardNames[index % shardNames.length];
		const targetPath = path.join(
			directory,
			shardName,
			`${prefix}-${index}.bin`,
		);
		pendingWrites.push(fs.writeFile(targetPath, payload));

		if (pendingWrites.length >= 128) {
			await Promise.all(pendingWrites);
			pendingWrites.length = 0;
		}
	}

	if (pendingWrites.length > 0) {
		await Promise.all(pendingWrites);
	}
};

const writeSourceTree = async (
	projectDir: string,
	sourceFilesPerProject: number,
	projectIndex: number,
): Promise<void> => {
	const sourceRoot = path.join(projectDir, 'packages', 'web', 'src');
	await fs.mkdir(sourceRoot, {recursive: true});

	for (let index = 0; index < sourceFilesPerProject; index += 1) {
		const nestedDir = path.join(sourceRoot, `module-${index % 4}`);
		await fs.mkdir(nestedDir, {recursive: true});
		const filePath = path.join(nestedDir, `file-${index}.ts`);
		const source = `export const moduleValue${projectIndex}_${index} = ${index};\n`;
		await fs.writeFile(filePath, source);
	}
};

const createProjectFixture = async (
	rootDir: string,
	projectIndex: number,
	config: FixtureScenarioConfig,
): Promise<string> => {
	const projectName = `app-${String(projectIndex + 1).padStart(2, '0')}`;
	const projectDir = path.join(rootDir, 'apps', projectName);
	await fs.mkdir(projectDir, {recursive: true});

	const primaryCount = config.filesPerPrimaryArtifact;
	const secondaryCount = Math.max(8, Math.floor(primaryCount / 3));
	const payload = buildPayload(config.fileSizeBytes, projectIndex);

	await Promise.all([
		writeBatchedFiles(
			path.join(projectDir, '.next', 'static', 'chunks'),
			primaryCount,
			payload,
			'next-static',
		),
		writeBatchedFiles(
			path.join(projectDir, '.next', 'cache'),
			Math.max(12, Math.floor(primaryCount / 2)),
			payload,
			'next-cache',
		),
		writeBatchedFiles(
			path.join(projectDir, 'node_modules', '.cache', 'next'),
			Math.max(12, Math.floor(primaryCount / 2)),
			payload,
			'node-cache',
		),
		writeBatchedFiles(
			path.join(projectDir, '.turbo', 'cache'),
			secondaryCount,
			payload,
			'turbo-cache',
		),
		writeBatchedFiles(
			path.join(projectDir, '.vercel', 'output', 'functions'),
			Math.max(4, Math.floor(secondaryCount / 2)),
			payload,
			'vercel-output',
		),
	]);

	if (projectIndex % 2 === 0) {
		await writeBatchedFiles(
			path.join(projectDir, 'build', 'output'),
			Math.max(8, Math.floor(primaryCount / 4)),
			payload,
			'custom-dist',
		);
		await fs.writeFile(
			path.join(projectDir, 'next.config.js'),
			"module.exports = { distDir: './build/output/' };\n",
		);
	} else {
		await fs.writeFile(
			path.join(projectDir, 'next.config.js'),
			'module.exports = {};\n',
		);
	}

	await writeSourceTree(projectDir, config.sourceFilesPerProject, projectIndex);

	return projectDir;
};

export const generateFixtures = async (
	scenarioValue: string,
	options: GenerateFixturesOptions = {},
): Promise<GeneratedFixtures> => {
	const scenario = resolveBenchScenario(scenarioValue);
	const config = SCENARIO_CONFIGS[scenario];

	const rootDir = options.rootDir
		? path.resolve(options.rootDir)
		: await fs.mkdtemp(path.join(os.tmpdir(), `next-prune-bench-${scenario}-`));

	if (options.rootDir) {
		await fs.rm(rootDir, {recursive: true, force: true});
		await fs.mkdir(rootDir, {recursive: true});
	}

	await fs.mkdir(path.join(rootDir, 'apps'), {recursive: true});

	const projectDirs: string[] = [];
	for (let index = 0; index < config.projects; index += 1) {
		// Sequential generation keeps disk pressure predictable for CI.
		// eslint-disable-next-line no-await-in-loop
		const projectDir = await createProjectFixture(rootDir, index, config);
		projectDirs.push(projectDir);
	}

	const keepFixtureDir =
		options.keepFixtureDir ?? options.rootDir !== undefined;

	return {
		scenario,
		config,
		rootDir,
		projectDirs,
		cleanup: async () => {
			if (keepFixtureDir) return;
			await fs.rm(rootDir, {recursive: true, force: true});
		},
	};
};

interface GenerateCliOptions {
	scenario: BenchScenario;
	outputDir?: string;
}

const parseGenerateCliArgs = (argv: string[]): GenerateCliOptions => {
	let scenario: BenchScenario = 'medium';
	let outputDir: string | undefined;

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];

		if (argument === '--scenario') {
			const value = argv[index + 1];
			if (!value) {
				throw new Error('Missing value for --scenario.');
			}
			scenario = resolveBenchScenario(value);
			index += 1;
			continue;
		}

		if (argument.startsWith('--scenario=')) {
			scenario = resolveBenchScenario(argument.slice('--scenario='.length));
			continue;
		}

		if (argument === '--output') {
			const value = argv[index + 1];
			if (!value) {
				throw new Error('Missing value for --output.');
			}
			outputDir = value;
			index += 1;
			continue;
		}

		if (argument.startsWith('--output=')) {
			outputDir = argument.slice('--output='.length);
			continue;
		}

		throw new Error(`Unknown argument: ${argument}`);
	}

	return {scenario, outputDir};
};

const main = async (): Promise<void> => {
	const options = parseGenerateCliArgs(process.argv.slice(2));
	const fixtures = await generateFixtures(options.scenario, {
		rootDir: options.outputDir,
		keepFixtureDir: true,
	});

	const summary = {
		scenario: fixtures.scenario,
		rootDir: fixtures.rootDir,
		projectCount: fixtures.projectDirs.length,
		filesPerPrimaryArtifact: fixtures.config.filesPerPrimaryArtifact,
	};

	console.log(JSON.stringify(summary, null, 2));
};

if (import.meta.main) {
	main().catch(error => {
		console.error(
			error instanceof Error ? error.message : 'Failed to generate fixtures.',
		);
		process.exit(1);
	});
}
