#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_TABLES = [
  'table_9_full_automatic_metrics',
  'table_10_paired_bootstrap',
  'table_11_targeted_ablation',
  'table_12_model_judge',
];

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireFields(row, fields, context) {
  for (const field of fields) {
    assert(Object.hasOwn(row, field), `${context} missing field: ${field}`);
  }
}

function walk(value, visit, pathParts = []) {
  visit(value, pathParts);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, [...pathParts, String(index)]));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      walk(child, visit, [...pathParts, key]);
    }
  }
}

const inputPath = path.resolve(readArg(
  'input',
  'data/test_cases/table-09-12-minimal.synthetic.json',
));

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

assert(data.metadata?.artifact_kind === 'public_minimal_table_test_cases', 'unexpected artifact_kind');
assert(data.metadata?.fixture_scope === 'synthetic_minimal', 'unexpected fixture_scope');
assert(data.privacy?.contains_internal_data === false, 'test cases must not contain internal data');
assert(data.privacy?.release_status === 'public_synthetic_shape_only', 'unexpected release_status');

const forbiddenKeys = new Set([
  'email',
  'ip_address',
  'order_id',
  'payment_id',
  'raw_history',
  'raw_model_output',
  'raw_profile',
  'session_id',
  `session_${'token'}`,
  'user_id',
]);

walk(data, (value, pathParts) => {
  const key = pathParts.at(-1);
  if (key) {
    assert(!forbiddenKeys.has(key), `forbidden key present: ${pathParts.join('.')}`);
  }
  if (typeof value !== 'string') {
    return;
  }
  assert(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value), `email-like value at ${pathParts.join('.')}`);
  assert(!/\b(?:\+?\d[\d -]{10,}\d)\b/u.test(value), `long identifier-like value at ${pathParts.join('.')}`);
  assert(!/\bsk-[A-Za-z0-9_-]{8,}\b/u.test(value), `secret-like value at ${pathParts.join('.')}`);
});

for (const table of REQUIRED_TABLES) {
  assert(data.tables?.[table], `missing table test case: ${table}`);
}

const table9 = data.tables.table_9_full_automatic_metrics;
assert(Array.isArray(table9) && table9.length >= 3 && table9.length <= 5, 'table 9 must stay minimal');
for (const row of table9) {
  requireFields(row, [
    'method',
    'attempted_runs',
    'invalid_rows',
    'structured_commitment_availability_rate',
    'ohcvr',
    'ecf',
    'witness_drop',
    'consequence_failure',
    'repair_correctness',
    'surface_failure',
    'latency_ms',
  ], `table 9 row ${row.method ?? ''}`);
}

const table10 = data.tables.table_10_paired_bootstrap;
assert(Array.isArray(table10) && table10.length >= 2 && table10.length <= 4, 'table 10 must stay minimal');
for (const row of table10) {
  requireFields(row, ['surface', 'diff', 'ci_low', 'ci_high', 'interpretation'], `table 10 row ${row.surface ?? ''}`);
}

const table11 = data.tables.table_11_targeted_ablation;
assert(Array.isArray(table11) && table11.length === 4, 'table 11 must include four component rows');
for (const variant of ['cbea_lcv', 'no_validator', 'no_repair_abstain', 'no_coverage_tail']) {
  assert(table11.some((row) => row.variant === variant), `table 11 missing variant: ${variant}`);
}
for (const row of table11) {
  requireFields(row, [
    'variant',
    'invalid_rows',
    'structured_commitment_availability_rate',
    'ohcvr',
    'ecf',
    'witness_drop',
    'consequence_failure',
    'no_feasible_emission',
    'repair_correctness',
  ], `table 11 row ${row.variant ?? ''}`);
}

const table12 = data.tables.table_12_model_judge;
assert(Array.isArray(table12.means) && table12.means.length === 6, 'table 12 must include two judges by three systems');
for (const row of table12.means) {
  requireFields(row, ['judge', 'system', 'overall', 'evidence', 'consequence', 'surface'], `table 12 row ${row.judge ?? ''}/${row.system ?? ''}`);
}
requireFields(table12.agreement ?? {}, [
  'dimension_label_count',
  'exact_agreement_rate',
  'pairwise_case_count',
  'pairwise_agreement_rate',
], 'table 12 agreement');

console.log(JSON.stringify({
  table_case_check: 'passed',
  file: inputPath,
  checked_tables: REQUIRED_TABLES,
}, null, 2));
