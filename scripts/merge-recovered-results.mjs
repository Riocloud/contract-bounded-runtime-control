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
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
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

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, headers) {
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`;
}

function boolValue(value) {
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function normalizeRecoveredRow(row, originalRow) {
  return {
    fixture_id: row.fixture_id,
    baseline_id: row.baseline_id,
    scenario_focus: row.scenario_focus,
    attempted: String(boolValue(row.attempted)),
    invalid_run: String(boolValue(row.invalid_run)),
    output_available: String(boolValue(row.output_available)),
    structured_commitment_available: String(boolValue(row.structured_commitment_available)),
    repair_expected: String(boolValue(row.repair_expected)),
    hard_constraint_violation: String(boolValue(row.hard_constraint_violation)),
    evidence_coverage_failure: String(boolValue(row.evidence_coverage_failure)),
    witness_drop: String(boolValue(row.witness_drop)),
    consequence_continuity_failure: String(boolValue(row.consequence_continuity_failure)),
    no_feasible_emission: String(boolValue(row.no_feasible_emission)),
    abstain_triggered: String(boolValue(row.abstain_triggered)),
    repair_triggered: String(boolValue(row.repair_triggered)),
    repair_correct: String(boolValue(row.repair_correct)),
    inappropriate_personalization: String(boolValue(row.inappropriate_personalization)),
    surface_realization_failure: String(boolValue(row.surface_realization_failure)),
    latency_ms: row.latency_ms ?? '',
    input_tokens: row.input_tokens ?? '',
    output_tokens: row.output_tokens ?? '',
    prompt_cost_units: row.prompt_cost_units ?? '',
    provider: originalRow?.provider ?? row.provider ?? '',
    model: originalRow?.model ?? row.model ?? '',
    commitment_type: row.commitment_type ?? '',
    parse_retry_count: row.parse_retry_count ?? '',
  };
}

const originalPath = path.resolve(readArg('original', 'data/results/real-pilot-results.csv'));
const outPath = path.resolve(readArg('out', 'data/results/real-pilot-results-recovered.csv'));
const recoveryPaths = (readArg('recoveries', '') || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => path.resolve(item));

const original = parseCsv(fs.readFileSync(originalPath, 'utf8'));
const replacements = new Map();
for (const recoveryPath of recoveryPaths) {
  const rows = JSON.parse(fs.readFileSync(recoveryPath, 'utf8'));
  for (const row of rows) {
    if (boolValue(row.invalid_run)) continue;
    replacements.set(`${row.fixture_id}\t${row.baseline_id}`, row);
  }
}

let replaced = 0;
const merged = original.map((row) => {
  if (String(row.invalid_run).toLowerCase() !== 'true') return row;
  const recovered = replacements.get(`${row.fixture_id}\t${row.baseline_id}`);
  if (!recovered) return row;
  replaced += 1;
  return normalizeRecoveredRow(recovered, row);
});

const headers = Object.keys(original[0]);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, toCsv(merged, headers));
console.log(JSON.stringify({
  out: outPath,
  original_rows: original.length,
  replacement_candidates: replacements.size,
  replaced_rows: replaced,
  remaining_invalid_rows: merged.filter((row) => String(row.invalid_run).toLowerCase() === 'true').length,
}, null, 2));
