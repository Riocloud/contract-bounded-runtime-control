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

function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function percentile(values, q) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  return clean[Math.min(clean.length - 1, Math.floor(q * (clean.length - 1)))];
}

function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  if (typeof value === 'number') return value.toFixed(4).replace(/0+$/u, '').replace(/\.$/u, '');
  const parsed = Number(value);
  if (Number.isFinite(parsed) && String(value).trim() !== '') return fmt(parsed);
  return String(value);
}

function groupBy(items, keyFn) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
}

function stressSurface(fixtureId) {
  for (const surface of ['tail', 'infeasible', 'falsehard', 'exception', 'surface', 'debt']) {
    if (fixtureId.includes(`_${surface}_`)) return surface;
  }
  return 'unknown';
}

function summarizeRows(rows) {
  const valid = rows.filter((row) => !row.invalid_run);
  const structured = valid.filter((row) => row.structured_commitment_available);
  const budgetExhaustedParseFailures = rows.filter((row) =>
    row.invalid_run
    && (row.budget_exhausted_parse_failure || (row.error === 'json_parse_failed' && (row.output_tokens || 0) >= 2200 * ((row.parse_retry_count || 0) + 1)))
  );
  const longOutputBudgetEvents = rows.filter((row) =>
    row.long_output_budget_event || (row.output_tokens || 0) >= 2200
  );
  return {
    n: rows.length,
    invalid: rows.length - valid.length,
    invalid_rate: rows.length ? (rows.length - valid.length) / rows.length : null,
    budget_exhausted_parse_failure_count: budgetExhaustedParseFailures.length,
    budget_exhausted_parse_failure_rate: rows.length ? budgetExhaustedParseFailures.length / rows.length : null,
    long_output_budget_event_count: longOutputBudgetEvents.length,
    long_output_budget_event_rate: rows.length ? longOutputBudgetEvents.length / rows.length : null,
    availability: valid.length ? structured.length / valid.length : null,
    availability_attempted: rows.length ? structured.length / rows.length : null,
    shadow_recall: mean(valid.map((row) => row.shadow_oracle_recall)),
    shadow_contradiction: mean(valid.map((row) => row.shadow_contradiction_rate)),
    covered_h: mean(structured.map((row) => Number(row.validator_hard_constraint_violation))),
    covered_e: mean(structured.map((row) => Number(row.validator_evidence_coverage_failure))),
    covered_w: mean(structured.map((row) => Number(row.validator_witness_drop))),
    covered_c: mean(structured.map((row) => Number(row.validator_consequence_continuity_failure))),
    retry_sum: rows.reduce((sum, row) => sum + (row.parse_retry_count || 0), 0),
    output_max_count: rows.filter((row) => (row.output_tokens || 0) >= 8800).length,
    p50_output_tokens: percentile(rows.map((row) => row.output_tokens || 0), 0.5),
    p95_output_tokens: percentile(rows.map((row) => row.output_tokens || 0), 0.95),
    p50_latency_ms: percentile(rows.map((row) => row.latency_ms || 0), 0.5),
    p95_latency_ms: percentile(rows.map((row) => row.latency_ms || 0), 0.95),
  };
}

const resultsPath = path.resolve(readArg('results', 'results/shadow360/minimax/real-pilot-results.json'));
const metricsPath = path.resolve(readArg('metrics', 'results/shadow360/minimax/covered_and_shadow_metrics.csv'));
const outJsonPath = path.resolve(readArg('out-json', 'results/shadow360/minimax/shadow360_summary.json'));
const outMdPath = path.resolve(readArg('out-md', 'results/shadow360/minimax/shadow360_summary.md'));

const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const metrics = parseCsv(fs.readFileSync(metricsPath, 'utf8'));
const methods = [
  'raw_prompt_stuffing',
  'raw_prompt_stuffing_lcv_gate',
  'long_context_lcv_gate',
  'validator_only',
  'cbea_lcv_runtime',
];

const byMethod = Object.fromEntries(
  [...groupBy(results, (row) => row.baseline_id)].map(([method, rows]) => [method, summarizeRows(rows)])
);
const byDomain = Object.fromEntries(
  [...groupBy(results, (row) => row.scenario_focus)].map(([domain, rows]) => [
    domain,
    Object.fromEntries([...groupBy(rows, (row) => row.baseline_id)].map(([method, methodRows]) => [method, summarizeRows(methodRows)])),
  ])
);
const bySurface = Object.fromEntries(
  [...groupBy(results, (row) => stressSurface(row.fixture_id))].map(([surface, rows]) => [
    surface,
    Object.fromEntries([...groupBy(rows, (row) => row.baseline_id)].map(([method, methodRows]) => [method, summarizeRows(methodRows)])),
  ])
);
const invalidRuns = results.filter((row) => row.invalid_run).map((row) => ({
  fixture_id: row.fixture_id,
  domain: row.scenario_focus,
  surface: stressSurface(row.fixture_id),
  method: row.baseline_id,
  retries: row.parse_retry_count,
  output_tokens: row.output_tokens,
  latency_ms: row.latency_ms,
  excerpt: String(row.raw_excerpt || '').slice(0, 220),
}));

const summary = {
  scope: {
    fixtures: new Set(results.map((row) => row.fixture_id)).size,
    methods: methods.length,
    rows: results.length,
  },
  metrics,
  byMethod,
  byDomain,
  bySurface,
  invalidRuns,
};

const lines = [
  '# Shadow360 Boundary Diagnostic Summary',
  '',
  'Scope: 360 shadow-oracle fixtures, one production-compatible generation endpoint, 5 methods, 1,800 generations. Hidden `shadow_oracle` fields are scoring-only; runtime prompts see only user-visible observations and compiled fixture fields.',
  '',
  '## Overall Method Summary',
  '',
  '| Method | Avail. | Cov. H | Cov. E | Cov. W | Cov. C | Uncompiled Recall | Invalid | Retries |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...methods.map((method) => {
    const row = metrics.find((item) => item.baseline_id === method) || {};
    return `| ${method} | ${fmt(byMethod[method]?.availability_attempted)} | ${fmt(row.validator_hard_constraint_violation_rate)} | ${fmt(row.validator_evidence_coverage_failure_rate)} | ${fmt(row.validator_witness_drop_rate)} | ${fmt(row.validator_consequence_continuity_failure_rate)} | ${fmt(row.shadow_oracle_recall_mean)} | ${row.invalid_run_count || ''} | ${byMethod[method]?.retry_sum ?? ''} |`;
  }),
  '',
  'Availability in this table uses attempted runs as the denominator; budget-exhausted parse failures are reported as systems failures, not validator-covered control failures.',
  '',
  '## Systems Cost Diagnostics',
  '',
  '| Method | Long-output events | Budget-exhausted parse failures | Max-output runs | p50 out tok | p95 out tok | p50 latency ms | p95 latency ms |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...methods.map((method) => {
    const row = byMethod[method] || {};
    return `| ${method} | ${fmt(row.long_output_budget_event_count)} | ${fmt(row.budget_exhausted_parse_failure_count)} | ${fmt(row.output_max_count)} | ${fmt(row.p50_output_tokens)} | ${fmt(row.p95_output_tokens)} | ${fmt(row.p50_latency_ms)} | ${fmt(row.p95_latency_ms)} |`;
  }),
  '',
  '## Uncompiled Recall By Domain',
  '',
  '| Domain | Raw | Raw+LCV | Long+LCV | Validator-only | CBEA+LCV |',
  '|---|---:|---:|---:|---:|---:|',
  ...Object.entries(byDomain).map(([domain, rows]) =>
    `| ${domain} | ${fmt(rows.raw_prompt_stuffing?.shadow_recall)} | ${fmt(rows.raw_prompt_stuffing_lcv_gate?.shadow_recall)} | ${fmt(rows.long_context_lcv_gate?.shadow_recall)} | ${fmt(rows.validator_only?.shadow_recall)} | ${fmt(rows.cbea_lcv_runtime?.shadow_recall)} |`
  ),
  '',
  '## Uncompiled Recall By Stress Surface',
  '',
  '| Surface | Raw | Raw+LCV | Long+LCV | Validator-only | CBEA+LCV |',
  '|---|---:|---:|---:|---:|---:|',
  ...Object.entries(bySurface).map(([surface, rows]) =>
    `| ${surface} | ${fmt(rows.raw_prompt_stuffing?.shadow_recall)} | ${fmt(rows.raw_prompt_stuffing_lcv_gate?.shadow_recall)} | ${fmt(rows.long_context_lcv_gate?.shadow_recall)} | ${fmt(rows.validator_only?.shadow_recall)} | ${fmt(rows.cbea_lcv_runtime?.shadow_recall)} |`
  ),
  '',
  '## Invalid Runs',
  '',
  '| Fixture | Domain | Surface | Method | Retries | Out tok | Latency ms | Excerpt |',
  '|---|---|---|---|---:|---:|---:|---|',
  ...invalidRuns.map((row) =>
    `| ${row.fixture_id} | ${row.domain} | ${row.surface} | ${row.method} | ${row.retries} | ${row.output_tokens} | ${row.latency_ms} | ${row.excerpt.replace(/\s+/gu, ' ').replaceAll('|', '\\|')} |`
  ),
  '',
  '## Interpretation',
  '',
  'CBEA+LCV preserves the validator-covered boundary on emitted commitments, while retaining almost no visible but uncompiled shadow facts. Raw prompt stuffing retains substantially more uncompiled context but has high covered-boundary failure rates and higher retry/output waste. This supports a boundary-diagnostic framing rather than a claim that CBEA dominates raw access on every surface.',
  '',
];

fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
fs.writeFileSync(outJsonPath, `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(outMdPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ outJson: outJsonPath, outMd: outMdPath }, null, 2));
