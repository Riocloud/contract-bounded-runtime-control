#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const METHODS = [
  'raw_prompt_stuffing',
  'summarized_profile',
  'dense_retrieval_rag',
  'long_context_llm',
  'tool_memory_agent',
  'validator_only',
  'runtime_without_cbea',
  'cbea_lcv_runtime',
  'oracle_evidence_upper_bound',
];

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const fixturesPath = path.resolve(readArg('fixtures', 'data/fixtures/cbea-lcv.expanded360.synthetic.json'));
const outDir = path.resolve(readArg('out', 'runs/task-shards'));
const shardCount = Math.max(1, Number.parseInt(readArg('shards', '1'), 10));
const weights = (readArg('weights', '') || '')
  .split(',')
  .map((item) => Number.parseInt(item.trim(), 10))
  .filter((item) => Number.isFinite(item) && item > 0);
const methods = (readArg('methods', METHODS.join(',')) || METHODS.join(','))
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const tasks = fixtures.flatMap((fixture) => methods.map((method) => ({
  fixture_id: fixture.fixture_id,
  method,
})));

const effectiveWeights = weights.length > 0 ? weights : Array.from({ length: shardCount }, () => 1);
const effectiveShardCount = effectiveWeights.length;
const shards = Array.from({ length: effectiveShardCount }, () => []);
const schedule = effectiveWeights.flatMap((weight, shardIndex) =>
  Array.from({ length: weight }, () => shardIndex)
);
tasks.forEach((task, index) => {
  shards[schedule[index % schedule.length]].push(task);
});

fs.mkdirSync(outDir, { recursive: true });
for (let index = 0; index < effectiveShardCount; index += 1) {
  fs.writeFileSync(
    path.join(outDir, `task-shard-${String(index).padStart(2, '0')}.json`),
    `${JSON.stringify(shards[index], null, 2)}\n`,
  );
}

console.log(JSON.stringify({
  out_dir: outDir,
  fixture_count: fixtures.length,
  method_count: methods.length,
  task_count: tasks.length,
  shard_count: effectiveShardCount,
  weights: effectiveWeights,
  shard_sizes: shards.map((shard) => shard.length),
}, null, 2));
