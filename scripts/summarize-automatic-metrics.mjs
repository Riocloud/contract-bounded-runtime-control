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

function bool(value) {
  return String(value).toLowerCase() === 'true';
}

function number(value) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function rate(numerator, denominator) {
  if (denominator <= 0) return '';
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function average(values) {
  const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (valid.length === 0) return '';
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

const inputPath = path.resolve(readArg('input', 'data/results/real-pilot-results.csv'));
const outPath = path.resolve(readArg('out', 'runs/automatic-metrics.csv'));
const rows = parseCsv(fs.readFileSync(inputPath, 'utf8'));

const summary = METHODS.map((method) => {
  const methodRows = rows.filter((row) => row.baseline_id === method);
  const attempted = methodRows.filter((row) => bool(row.attempted));
  const evaluable = attempted.filter((row) => !bool(row.invalid_run));
  const structured = evaluable.filter((row) => bool(row.structured_commitment_available));
  const repairRows = evaluable.filter((row) =>
    bool(row.repair_expected) || bool(row.repair_triggered) || bool(row.abstain_triggered)
  );
  const systemPass = evaluable.filter((row) =>
    bool(row.output_available) || bool(row.abstain_triggered) || (bool(row.repair_triggered) && bool(row.repair_correct))
  );
  return {
    baseline_id: method,
    attempted_runs: attempted.length,
    invalid_run_count: attempted.length - evaluable.length,
    invalid_run_rate: rate(attempted.length - evaluable.length, attempted.length),
    evaluable_runs: evaluable.length,
    system_completion_pass_rate: rate(systemPass.length, evaluable.length),
    output_availability_rate: rate(evaluable.filter((row) => bool(row.output_available)).length, evaluable.length),
    structured_commitment_availability_rate: rate(structured.length, evaluable.length),
    hard_constraint_violation_rate: rate(structured.filter((row) => bool(row.hard_constraint_violation)).length, structured.length),
    evidence_coverage_failure_rate: rate(structured.filter((row) => bool(row.evidence_coverage_failure)).length, structured.length),
    witness_drop_rate: rate(structured.filter((row) => bool(row.witness_drop)).length, structured.length),
    consequence_continuity_failure_rate: rate(structured.filter((row) => bool(row.consequence_continuity_failure)).length, structured.length),
    no_feasible_emission_rate: rate(structured.filter((row) => bool(row.no_feasible_emission)).length, structured.length),
    abstention_repair_correctness_rate: rate(repairRows.filter((row) => bool(row.repair_correct)).length, repairRows.length),
    inappropriate_personalization_rate: rate(structured.filter((row) => bool(row.inappropriate_personalization)).length, structured.length),
    surface_realization_failure_rate: rate(attempted.filter((row) => bool(row.surface_realization_failure)).length, attempted.length),
    avg_latency_ms: average(attempted.map((row) => number(row.latency_ms))),
    avg_prompt_cost_units: average(attempted.map((row) => number(row.prompt_cost_units))),
  };
});

const headers = [
  'baseline_id',
  'attempted_runs',
  'invalid_run_count',
  'invalid_run_rate',
  'evaluable_runs',
  'system_completion_pass_rate',
  'output_availability_rate',
  'structured_commitment_availability_rate',
  'hard_constraint_violation_rate',
  'evidence_coverage_failure_rate',
  'witness_drop_rate',
  'consequence_continuity_failure_rate',
  'no_feasible_emission_rate',
  'abstention_repair_correctness_rate',
  'inappropriate_personalization_rate',
  'surface_realization_failure_rate',
  'avg_latency_ms',
  'avg_prompt_cost_units',
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, toCsv(summary, headers));
console.log(JSON.stringify({ out: outPath, rows: summary.length }, null, 2));
