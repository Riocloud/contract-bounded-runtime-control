#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

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
  if (row.length > 0) rows.push(row);
  const [headers, ...dataRows] = rows.filter((items) => items.some(Boolean));
  return dataRows.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ''])));
}

function readCsv(relativePath) {
  return parseCsv(fs.readFileSync(path.resolve(relativePath), 'utf8'));
}

function number(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected numeric value, got ${value}`);
  return parsed;
}

function round4(value) {
  return Number(value.toFixed(4));
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const group = row[key];
    if (!map.has(group)) map.set(group, []);
    map.get(group).push(row);
  }
  return map;
}

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.split('=');
  return [key.replace(/^--/, ''), value ?? true];
}));
const out = String(args.get('out') || 'runs/boundary-diagnostics-summary.json');

const backendRows = readCsv('data/results/backend-sensitivity-operating-points.csv');
const backendSummary = [];
for (const [backend, rows] of groupBy(backendRows, 'backend')) {
  const cbea = rows.find((row) => row.method === 'cbea_lcv_runtime');
  const strongestBaseline = rows
    .filter((row) => row.method !== 'cbea_lcv_runtime')
    .reduce((best, row) => (
      number(row.structured_commitment_availability_rate) > number(best.structured_commitment_availability_rate)
        ? row
        : best
    ));
  backendSummary.push({
    backend,
    cbea_availability: round4(number(cbea.structured_commitment_availability_rate)),
    strongest_lcv_baseline: strongestBaseline.method,
    strongest_lcv_baseline_availability: round4(number(strongestBaseline.structured_commitment_availability_rate)),
    availability_margin: round4(number(cbea.structured_commitment_availability_rate) - number(strongestBaseline.structured_commitment_availability_rate)),
  });
}

const shadowOverall = readCsv('data/results/shadow-oracle-overall.csv');
const byMethod = new Map(shadowOverall.map((row) => [row.method, row]));
const shadowSummary = {
  raw_uncompiled_fact_recall: round4(number(byMethod.get('raw_prompt_stuffing').uncompiled_fact_recall)),
  cbea_uncompiled_fact_recall: round4(number(byMethod.get('cbea_lcv_runtime').uncompiled_fact_recall)),
  raw_covered_evidence_failure: round4(number(byMethod.get('raw_prompt_stuffing').covered_evidence_coverage_failure_rate)),
  cbea_covered_evidence_failure: round4(number(byMethod.get('cbea_lcv_runtime').covered_evidence_coverage_failure_rate)),
};

const shadowDomain = readCsv('data/results/shadow-oracle-domain.csv').map((row) => ({
  domain: row.domain,
  raw_prompt_stuffing: number(row.raw_prompt_stuffing),
  cbea_lcv_runtime: number(row.cbea_lcv_runtime),
}));

const hy3Rows = readCsv('data/results/hy3-output-budget-diagnostic.csv');
const hy3Summary = {
  matched_budget_parseable_commitments: hy3Rows.find((row) => row.diagnostic === 'matched_budget_stopped').parseable_commitments,
  extended_budget_parseable_commitments: hy3Rows.find((row) => row.diagnostic === 'extended_budget_diagnostic').parseable_commitments,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify({
  backend_sensitivity: backendSummary,
  shadow_oracle: shadowSummary,
  shadow_domain: shadowDomain,
  hy3_output_budget: hy3Summary,
}, null, 2)}\n`);

console.log(JSON.stringify({ boundary_diagnostics_summary: out }, null, 2));
