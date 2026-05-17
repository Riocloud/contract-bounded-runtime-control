#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const METHODS = [
  'raw_prompt_stuffing',
  'raw_prompt_stuffing_lcv_gate',
  'summarized_profile',
  'dense_retrieval_rag',
  'long_context_llm',
  'long_context_lcv_gate',
  'tool_memory_agent',
  'validator_only',
  'runtime_without_cbea',
  'cbea_lcv_runtime',
  'cbea_no_validator',
  'cbea_no_repair_abstain',
  'cbea_no_coverage_tail',
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

function averageRate(values) {
  const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (valid.length === 0) return '';
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10_000) / 10_000;
}

const inputPath = path.resolve(readArg('input', 'data/results/real-pilot-results.csv'));
const outPath = path.resolve(readArg('out', 'runs/automatic-metrics.csv'));
const maxTokensPerAttempt = Math.max(1, Number.parseInt(readArg('max-tokens', '2200'), 10));
const rows = parseCsv(fs.readFileSync(inputPath, 'utf8'));

function isBudgetExhaustedParseFailure(row) {
  if (!bool(row.invalid_run)) return false;
  if (bool(row.budget_exhausted_parse_failure)) return true;
  if (String(row.error || '') !== 'json_parse_failed') return false;
  const attempts = (number(row.parse_retry_count) || 0) + 1;
  const outputTokens = number(row.output_tokens) || 0;
  return outputTokens >= maxTokensPerAttempt * attempts;
}

function isLongOutputBudgetEvent(row) {
  if (bool(row.long_output_budget_event)) return true;
  const outputTokens = number(row.output_tokens) || 0;
  return outputTokens >= maxTokensPerAttempt;
}

const observedMethods = METHODS.filter((method) => rows.some((row) => row.baseline_id === method));
const summary = observedMethods.map((method) => {
  const methodRows = rows.filter((row) => row.baseline_id === method);
  const attempted = methodRows.filter((row) => bool(row.attempted));
  const evaluable = attempted.filter((row) => !bool(row.invalid_run));
  const structured = evaluable.filter((row) => bool(row.structured_commitment_available));
  const budgetExhausted = attempted.filter(isBudgetExhaustedParseFailure);
  const longOutputBudgetEvents = attempted.filter(isLongOutputBudgetEvent);
  const noFeasibleRows = evaluable.filter((row) => bool(row.no_feasible_expected));
  const repairRows = evaluable.filter((row) => bool(row.repair_expected));
  const systemPass = evaluable.filter((row) =>
    bool(row.output_available) || bool(row.abstain_triggered) || (bool(row.repair_triggered) && bool(row.repair_correct))
  );
  return {
    baseline_id: method,
    attempted_runs: attempted.length,
    invalid_run_count: attempted.length - evaluable.length,
    invalid_run_rate: rate(attempted.length - evaluable.length, attempted.length),
    budget_exhausted_parse_failure_count: budgetExhausted.length,
    budget_exhausted_parse_failure_rate: rate(budgetExhausted.length, attempted.length),
    long_output_budget_event_count: longOutputBudgetEvents.length,
    long_output_budget_event_rate: rate(longOutputBudgetEvents.length, attempted.length),
    evaluable_runs: evaluable.length,
    system_completion_pass_rate: rate(systemPass.length, evaluable.length),
    output_availability_rate: rate(evaluable.filter((row) => bool(row.output_available)).length, evaluable.length),
    output_availability_attempted_rate: rate(evaluable.filter((row) => bool(row.output_available)).length, attempted.length),
    structured_commitment_availability_rate: rate(structured.length, evaluable.length),
    structured_commitment_availability_attempted_rate: rate(structured.length, attempted.length),
    structured_commitment_denominator: structured.length,
    no_feasible_denominator: noFeasibleRows.length,
    repair_denominator: repairRows.length,
    strict_oracle_boundary_rate: rate(evaluable.filter((row) => bool(row.strict_oracle_boundary)).length, evaluable.length),
    shadow_oracle_boundary_rate: rate(evaluable.filter((row) => bool(row.shadow_oracle_boundary)).length, evaluable.length),
    avg_shadow_fact_count: averageRate(evaluable.map((row) => number(row.shadow_fact_count))),
    shadow_oracle_recall_mean: averageRate(structured.map((row) => number(row.shadow_oracle_recall))),
    shadow_oracle_failure_score_mean: averageRate(structured.map((row) => number(row.shadow_oracle_failure_score))),
    shadow_contradiction_rate_mean: averageRate(structured.map((row) => number(row.shadow_contradiction_rate))),
    shadow_fact_denominator_sum: structured.reduce((sum, row) => sum + (number(row.shadow_fact_denominator) || 0), 0),
    shadow_matched_fact_count_sum: structured.reduce((sum, row) => sum + (number(row.shadow_matched_fact_count) || 0), 0),
    shadow_alias_match_count_sum: structured.reduce((sum, row) => sum + (number(row.shadow_alias_match_count) || 0), 0),
    shadow_regex_match_count_sum: structured.reduce((sum, row) => sum + (number(row.shadow_regex_match_count) || 0), 0),
    shadow_contradiction_denominator_sum: structured.reduce((sum, row) => sum + (number(row.shadow_contradiction_denominator) || 0), 0),
    shadow_contradiction_match_count_sum: structured.reduce((sum, row) => sum + (number(row.shadow_contradiction_match_count) || 0), 0),
    shadow_hard_recall_mean: averageRate(structured.map((row) => number(row.shadow_hard_recall))),
    shadow_witness_recall_mean: averageRate(structured.map((row) => number(row.shadow_witness_recall))),
    shadow_detail_recall_mean: averageRate(structured.map((row) => number(row.shadow_detail_recall))),
    shadow_consequence_recall_mean: averageRate(structured.map((row) => number(row.shadow_consequence_recall))),
    validator_hard_constraint_violation_rate: rate(structured.filter((row) => bool(row.validator_hard_constraint_violation)).length, structured.length),
    validator_evidence_coverage_failure_rate: rate(structured.filter((row) => bool(row.validator_evidence_coverage_failure)).length, structured.length),
    validator_witness_drop_rate: rate(structured.filter((row) => bool(row.validator_witness_drop)).length, structured.length),
    validator_consequence_continuity_failure_rate: rate(structured.filter((row) => bool(row.validator_consequence_continuity_failure)).length, structured.length),
    hard_constraint_violation_rate: rate(structured.filter((row) => bool(row.hard_constraint_violation)).length, structured.length),
    evidence_coverage_failure_rate: rate(structured.filter((row) => bool(row.evidence_coverage_failure)).length, structured.length),
    witness_drop_rate: rate(structured.filter((row) => bool(row.witness_drop)).length, structured.length),
    consequence_continuity_failure_rate: rate(structured.filter((row) => bool(row.consequence_continuity_failure)).length, structured.length),
    no_feasible_emission_rate: rate(noFeasibleRows.filter((row) => bool(row.no_feasible_emission)).length, noFeasibleRows.length),
    abstention_repair_correctness_rate: rate(repairRows.filter((row) => bool(row.repair_correct)).length, repairRows.length),
    inappropriate_personalization_rate: rate(structured.filter((row) => bool(row.inappropriate_personalization)).length, structured.length),
    surface_realization_failure_rate: rate(evaluable.filter((row) => bool(row.surface_realization_failure)).length, evaluable.length),
    avg_latency_ms: average(attempted.map((row) => number(row.latency_ms))),
    avg_prompt_cost_units: average(attempted.map((row) => number(row.prompt_cost_units))),
  };
});

const headers = [
  'baseline_id',
  'attempted_runs',
  'invalid_run_count',
  'invalid_run_rate',
  'budget_exhausted_parse_failure_count',
  'budget_exhausted_parse_failure_rate',
  'long_output_budget_event_count',
  'long_output_budget_event_rate',
  'evaluable_runs',
  'system_completion_pass_rate',
  'output_availability_rate',
  'output_availability_attempted_rate',
  'structured_commitment_availability_rate',
  'structured_commitment_availability_attempted_rate',
  'structured_commitment_denominator',
  'no_feasible_denominator',
  'repair_denominator',
  'strict_oracle_boundary_rate',
  'shadow_oracle_boundary_rate',
  'avg_shadow_fact_count',
  'shadow_oracle_recall_mean',
  'shadow_oracle_failure_score_mean',
  'shadow_contradiction_rate_mean',
  'shadow_fact_denominator_sum',
  'shadow_matched_fact_count_sum',
  'shadow_alias_match_count_sum',
  'shadow_regex_match_count_sum',
  'shadow_contradiction_denominator_sum',
  'shadow_contradiction_match_count_sum',
  'shadow_hard_recall_mean',
  'shadow_witness_recall_mean',
  'shadow_detail_recall_mean',
  'shadow_consequence_recall_mean',
  'validator_hard_constraint_violation_rate',
  'validator_evidence_coverage_failure_rate',
  'validator_witness_drop_rate',
  'validator_consequence_continuity_failure_rate',
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
