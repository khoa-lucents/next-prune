# Benchmark System

This directory contains a Bun-only benchmark harness used to measure:

- scan performance (`scanArtifacts`)
- cleanup performance (`scanArtifacts + deleteItems` on fresh fixtures)

and enforce a CI regression gate.

## Files

- `bench/generate-fixtures.ts`: deterministic fixture generator for `quick`, `medium`, and `full` scenarios.
- `bench/run-bench.ts`: benchmark runner with warmups, repeated samples, summary stats, and gate mode.
- `bench/baselines.json`: checked-in median runtime baselines used by CI gate mode.

## Scenarios

- `quick`: small local smoke benchmark.
- `medium`: CI gate scenario.
- `full`: heavier local stress benchmark.

## Package Scripts

- `bun run bench:quick`: run quick benchmark summary.
- `bun run bench:full`: run full benchmark summary.
- `bun run bench:gate`: run medium benchmark gate against `bench/baselines.json` with a 10% threshold.

## Manual Usage

Run benchmark summary:

```bash
bun run bench/run-bench.ts --scenario=medium --mode=run
```

Run benchmark gate with explicit threshold:

```bash
bun run bench/run-bench.ts --scenario=medium --mode=gate --threshold=0.1
```

Generate persistent fixtures for manual inspection:

```bash
bun run bench/generate-fixtures.ts --scenario=medium --output=./bench/.fixtures/medium
```

## CI Gate Behavior

`bench:gate` compares the measured scan median against the `medium` baseline in `bench/baselines.json`.

Gate condition:

- pass if `scanMedianMs <= baselineScanMedianMs * (1 + threshold)`
- fail otherwise

Notes:

- Cleanup timings are still reported in every run.
- The gate intentionally uses scan latency only to reduce CI flakiness from filesystem delete variance across runners.
