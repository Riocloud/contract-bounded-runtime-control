#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function csvEscape(value) {
  const text = typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : String(value ?? '');
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const inputPath = path.resolve(readArg('input'));
const outPath = path.resolve(readArg('out'));
if (!inputPath || !outPath) {
  throw new Error('Usage: node scripts/write-results-csv.mjs --input=results.json --out=results.csv');
}

const rows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const headers = [
  'fixture_id',
  'baseline_id',
  'scenario_focus',
  'attempted',
  'invalid_run',
  'budget_exhausted_parse_failure',
  'long_output_budget_event',
  'generation_attempt_count',
  'max_tokens_per_attempt',
  'output_available',
  'structured_commitment_available',
  'repair_expected',
  'no_feasible_expected',
  'strict_oracle_boundary',
  'shadow_oracle_boundary',
  'shadow_fact_count',
  'shadow_oracle_recall',
  'shadow_oracle_failure_score',
  'shadow_contradiction_rate',
  'shadow_fact_denominator',
  'shadow_matched_fact_count',
  'shadow_alias_match_count',
  'shadow_regex_match_count',
  'shadow_contradiction_denominator',
  'shadow_contradiction_match_count',
  'shadow_hard_recall',
  'shadow_witness_recall',
  'shadow_detail_recall',
  'shadow_consequence_recall',
  'validator_hard_constraint_violation',
  'validator_evidence_coverage_failure',
  'validator_witness_drop',
  'validator_consequence_continuity_failure',
  'hard_constraint_violation',
  'evidence_coverage_failure',
  'witness_drop',
  'consequence_continuity_failure',
  'no_feasible_emission',
  'abstain_triggered',
  'repair_triggered',
  'repair_correct',
  'inappropriate_personalization',
  'surface_realization_failure',
  'latency_ms',
  'input_tokens',
  'output_tokens',
  'prompt_cost_units',
  'provider',
  'model',
  'commitment_type',
  'parse_retry_count',
  'error',
  'raw_excerpt',
  'parsed_output',
  'output_text',
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`,
);
console.log(JSON.stringify({ out: outPath, rows: rows.length }, null, 2));
