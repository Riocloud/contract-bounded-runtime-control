#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) row.push(field);
  const [headers, ...data] = rows.filter((items) => items.some(Boolean));
  return data.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ''])));
}

const metricsPath = path.resolve(readArg('metrics', 'results/pilot_shadow/scores/covered_and_shadow_metrics.csv'));
const distributionPath = path.resolve(readArg('distribution', 'results/pilot_shadow/scores/shadow_distribution.json'));
const outPath = path.resolve(readArg('out', 'results/pilot_shadow/pilot_summary.md'));

const metrics = parseCsv(fs.readFileSync(metricsPath, 'utf8'));
const distribution = JSON.parse(fs.readFileSync(distributionPath, 'utf8'));
const selected = [
  'raw_prompt_stuffing',
  'raw_prompt_stuffing_lcv_gate',
  'long_context_lcv_gate',
  'validator_only',
  'cbea_lcv_runtime',
];

function row(method) {
  return metrics.find((item) => item.baseline_id === method) || {};
}

const lines = [
  '# Shadow-Oracle Pilot Summary',
  '',
  'Scope: 24 fixtures, one production-compatible generation endpoint, 5 methods, surface-balanced over the investment domain only. This is a design pilot, not paper evidence.',
  '',
  '## Gate Results',
  '',
  '- User-visible text leak check: passed for `shadow_`, `shN`, `oracle_only`, `deferred_`, and `hidden_` markers.',
  '- Run validity: 120/120 generations parsed successfully.',
  '- Shadow fact count: 1-5 per fixture, average 2.67.',
  '- Distribution gate: failed for `cbea_lcv_runtime`; shadow recall has floor effect at 0.0.',
  '',
  '## Method Summary',
  '',
  '| Method | Avail. | Covered HCVR | Covered ECF | Covered Wit. | Covered Cons. | Shadow Recall | Shadow SD | Parse Retries |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...selected.map((method) => {
    const metric = row(method);
    const dist = distribution[method] || {};
    return [
      method,
      metric.structured_commitment_availability_rate || '',
      metric.validator_hard_constraint_violation_rate || '',
      metric.validator_evidence_coverage_failure_rate || '',
      metric.validator_witness_drop_rate || '',
      metric.validator_consequence_continuity_failure_rate || '',
      metric.shadow_oracle_recall_mean || '',
      dist.shadow_sd ?? '',
      dist.parse_retries ?? '',
    ].join(' | ');
  }).map((line) => `| ${line} |`),
  '',
  '## Interpretation',
  '',
  'The shadow layer is not leaking hidden scoring metadata to the runtime. Raw prompt stuffing sees the visible natural-language shadow facts and reaches non-trivial shadow recall, while also showing high covered-boundary failure rates. CBEA+LCV preserves the validator-covered boundary in this pilot, but its shadow recall is zero because the current selector activates fixed covered evidence and does not retrieve the uncompiled natural-language shadow facts scattered through later observations.',
  '',
  'This means the shadow design is useful as a diagnostic, but the current CBEA selector should not be claimed to preserve uncompiled visible facts. The next design choice is either to frame shadow results as a boundary diagnostic or add a retrieval/activation term for natural-language shadow evidence and rerun the pilot.',
  '',
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ out: outPath }, null, 2));
