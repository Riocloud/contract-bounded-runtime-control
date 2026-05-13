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
  if (!headers) return [];
  return dataRows.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ''])));
}

function readCsv(relativePath) {
  const filePath = path.resolve(relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`Missing expected file: ${relativePath}`);
  return parseCsv(fs.readFileSync(filePath, 'utf8'));
}

function rowsBy(rows, key) {
  return new Map(rows.map((row) => [row[key], row]));
}

function assertEqual(actual, expected, label) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertRowValues(row, expected, label) {
  if (!row) throw new Error(`Missing row: ${label}`);
  for (const [field, value] of Object.entries(expected)) {
    assertEqual(row[field], value, `${label}.${field}`);
  }
}

function assertCsvRows(relativePath, key, expected) {
  const byKey = rowsBy(readCsv(relativePath), key);
  for (const [id, fields] of Object.entries(expected)) {
    assertRowValues(byKey.get(id), fields, `${relativePath}:${id}`);
  }
}

const mainMetrics = {
  raw_prompt_stuffing: {
    attempted_runs: '360',
    invalid_run_count: '0',
    structured_commitment_availability_rate: '0.7833',
    hard_constraint_violation_rate: '0.1277',
    evidence_coverage_failure_rate: '0.4113',
    witness_drop_rate: '0.0674',
    consequence_continuity_failure_rate: '0.4468',
    no_feasible_emission_rate: '0.0333',
    abstention_repair_correctness_rate: '0.4571',
    avg_latency_ms: '32952',
    avg_prompt_cost_units: '3218',
  },
  summarized_profile: {
    attempted_runs: '360',
    invalid_run_count: '0',
    structured_commitment_availability_rate: '0.45',
    hard_constraint_violation_rate: '0.2469',
    evidence_coverage_failure_rate: '1',
    witness_drop_rate: '0.5988',
    consequence_continuity_failure_rate: '0.9938',
    no_feasible_emission_rate: '0.0333',
    abstention_repair_correctness_rate: '0.6786',
    avg_latency_ms: '40869',
    avg_prompt_cost_units: '3395',
  },
  dense_retrieval_rag: {
    attempted_runs: '360',
    invalid_run_count: '0',
    structured_commitment_availability_rate: '0.7333',
    hard_constraint_violation_rate: '0.1364',
    evidence_coverage_failure_rate: '0.2803',
    witness_drop_rate: '1',
    consequence_continuity_failure_rate: '1',
    no_feasible_emission_rate: '0.3833',
    abstention_repair_correctness_rate: '0.3571',
    avg_latency_ms: '31216',
    avg_prompt_cost_units: '2612',
  },
  long_context_llm: {
    attempted_runs: '360',
    invalid_run_count: '0',
    structured_commitment_availability_rate: '0.7278',
    hard_constraint_violation_rate: '0.1565',
    evidence_coverage_failure_rate: '0.5344',
    witness_drop_rate: '0.0649',
    consequence_continuity_failure_rate: '0.5458',
    no_feasible_emission_rate: '0.0333',
    abstention_repair_correctness_rate: '0.4786',
    avg_latency_ms: '33569',
    avg_prompt_cost_units: '3279',
  },
  tool_memory_agent: {
    attempted_runs: '360',
    invalid_run_count: '0',
    structured_commitment_availability_rate: '0.75',
    hard_constraint_violation_rate: '0.1704',
    evidence_coverage_failure_rate: '0.4407',
    witness_drop_rate: '0.6926',
    consequence_continuity_failure_rate: '0.6074',
    no_feasible_emission_rate: '0.0333',
    abstention_repair_correctness_rate: '0.4643',
    avg_latency_ms: '33502',
    avg_prompt_cost_units: '3189',
  },
  validator_only: {
    attempted_runs: '360',
    invalid_run_count: '0',
    structured_commitment_availability_rate: '0.4028',
    hard_constraint_violation_rate: '0.2759',
    evidence_coverage_failure_rate: '0.4621',
    witness_drop_rate: '1',
    consequence_continuity_failure_rate: '1',
    no_feasible_emission_rate: '0',
    abstention_repair_correctness_rate: '1',
    avg_latency_ms: '32716',
    avg_prompt_cost_units: '2778',
  },
  runtime_without_cbea: {
    attempted_runs: '360',
    invalid_run_count: '0',
    structured_commitment_availability_rate: '0.5',
    hard_constraint_violation_rate: '0.2444',
    evidence_coverage_failure_rate: '0.4889',
    witness_drop_rate: '0.7778',
    consequence_continuity_failure_rate: '0.5222',
    no_feasible_emission_rate: '0',
    abstention_repair_correctness_rate: '1',
    avg_latency_ms: '37647',
    avg_prompt_cost_units: '3542',
  },
  cbea_lcv_runtime: {
    attempted_runs: '360',
    invalid_run_count: '0',
    structured_commitment_availability_rate: '0.5',
    hard_constraint_violation_rate: '0',
    evidence_coverage_failure_rate: '0',
    witness_drop_rate: '0',
    consequence_continuity_failure_rate: '0',
    no_feasible_emission_rate: '0',
    abstention_repair_correctness_rate: '1',
    avg_latency_ms: '34093',
    avg_prompt_cost_units: '3178',
  },
  oracle_evidence_upper_bound: {
    attempted_runs: '360',
    invalid_run_count: '0',
    structured_commitment_availability_rate: '0.6111',
    hard_constraint_violation_rate: '0',
    evidence_coverage_failure_rate: '0',
    witness_drop_rate: '0',
    consequence_continuity_failure_rate: '0',
    no_feasible_emission_rate: '0',
    abstention_repair_correctness_rate: '1',
    avg_latency_ms: '',
    avg_prompt_cost_units: '',
  },
};

const bootstrap = {
  'Structured availability': { diff: '-0.2833', ci_low: '-0.3361', ci_high: '-0.2306' },
  'Parse retries per fixture': { diff: '0.0333', ci_low: '-0.0250', ci_high: '0.0944' },
  'Repair/abstention correctness': { diff: '0.5429', ci_low: '0.4571', ci_high: '0.6286' },
  'Latency, ms': { diff: '1141', ci_low: '-882', ci_high: '3132' },
};

const horizon = {
  'raw_prompt_stuffing::2-domain': { fixture_count: '144', structured_count: '119', hard_constraint_violation_rate: '0.1176', witness_drop_rate: '0.0672', consequence_continuity_failure_rate: '0.4622', repair_correctness_rate: '0.4286', avg_parse_retries: '0.13' },
  'raw_prompt_stuffing::3-domain': { fixture_count: '144', structured_count: '106', hard_constraint_violation_rate: '0.1792', witness_drop_rate: '0.0943', consequence_continuity_failure_rate: '0.4623', repair_correctness_rate: '0.5000', avg_parse_retries: '0.15' },
  'raw_prompt_stuffing::4-domain': { fixture_count: '72', structured_count: '57', hard_constraint_violation_rate: '0.0526', witness_drop_rate: '0.0175', consequence_continuity_failure_rate: '0.3860', repair_correctness_rate: '0.4286', avg_parse_retries: '0.19' },
  'cbea_lcv_runtime::2-domain': { fixture_count: '144', structured_count: '80', hard_constraint_violation_rate: '0.0000', witness_drop_rate: '0.0000', consequence_continuity_failure_rate: '0.0000', repair_correctness_rate: '1.0000', avg_parse_retries: '0.15' },
  'cbea_lcv_runtime::3-domain': { fixture_count: '144', structured_count: '61', hard_constraint_violation_rate: '0.0000', witness_drop_rate: '0.0000', consequence_continuity_failure_rate: '0.0000', repair_correctness_rate: '1.0000', avg_parse_retries: '0.24' },
  'cbea_lcv_runtime::4-domain': { fixture_count: '72', structured_count: '39', hard_constraint_violation_rate: '0.0000', witness_drop_rate: '0.0000', consequence_continuity_failure_rate: '0.0000', repair_correctness_rate: '1.0000', avg_parse_retries: '0.14' },
};

const judgeSummary = {
  cbea_lcv_runtime: { n_outputs: '180', no_feasible_handling: '1.7944', surface_coherence: '1.8167', overall_mean: '1.6509' },
  raw_prompt_stuffing: { n_outputs: '180', no_feasible_handling: '1.7667', surface_coherence: '1.8778', overall_mean: '1.6778' },
  validator_only: { n_outputs: '180', no_feasible_handling: '1.5278', surface_coherence: '1.7889', overall_mean: '1.3843' },
};

const winnerSummary = {
  cbea_lcv_runtime: { count: '90', win_rate: '0.5000' },
  raw_prompt_stuffing: { count: '55', win_rate: '0.3056' },
  tie: { count: '3', win_rate: '0.0167' },
  validator_only: { count: '32', win_rate: '0.1778' },
};

const judgeWinnerBootstrap = {
  cbea_lcv_runtime: { observed: '0.5000', ci_low: '0.4167', ci_high: '0.5833' },
  raw_prompt_stuffing: { observed: '0.3056', ci_low: '0.2278', ci_high: '0.3833' },
  validator_only: { observed: '0.1778', ci_low: '0.1111', ci_high: '0.2500' },
  tie: { observed: '0.0167', ci_low: '0.0000', ci_high: '0.0389' },
  cbea_minus_raw: { observed: '0.1944', ci_low: '0.0500', ci_high: '0.3389' },
};

const selectorBaselines = {
  cbea_lcv_selector: {
    fixture_count: '360',
    avg_selected: '10.67',
    hard_constraint_recall: '1.0000',
    required_witness_recall: '1.0000',
    tail_witness_recall: '1.0000',
    consequence_debt_recall: '0.9889',
    control_evidence_recall: '0.9970',
  },
  mmr_relevance_diversity: {
    fixture_count: '360',
    avg_selected: '12.00',
    hard_constraint_recall: '1.0000',
    required_witness_recall: '0.9444',
    tail_witness_recall: '0.6667',
    consequence_debt_recall: '0.0000',
    control_evidence_recall: '0.6960',
  },
};

const longHistory = {
  MiniMax: { n_pairs: '50', raw_input_p50: '20401', cbea_input_p50: '5154', delta_input_p50: '15258', raw_output_p50: '700', cbea_output_p50: '700', delta_latency_mean_s: '1.74', delta_latency_p50_s: '1.54' },
  DeepSeek: { n_pairs: '50', raw_input_p50: '21364', cbea_input_p50: '5484', delta_input_p50: '15929', raw_output_p50: '700', cbea_output_p50: '700', delta_latency_mean_s: '2.06', delta_latency_p50_s: '1.97' },
  Qwen: { n_pairs: '50', raw_input_p50: '21709', cbea_input_p50: '5376', delta_input_p50: '16279', raw_output_p50: '2194', cbea_output_p50: '2657', delta_latency_mean_s: '-0.80', delta_latency_p50_s: '-1.33' },
};

const production = {
  attempted_sessions: { count: '524', rate: '1.0000' },
  semantic_session_pool: { count: '447', rate: '0.8531' },
  completed_sessions: { count: '398', rate: '0.7595' },
  final_evaluable_sessions: { count: '323', rate: '0.6164' },
  active_unfinished_sessions: { count: '98', rate: '0.1870' },
  operational_invalid_sessions: { count: '77', rate: '0.1469' },
  evaluable_turn_requests: { count: '6018', rate: '0.9895' },
  provider_requests: { count: '28815', rate: '1.0000' },
  provider_successes: { count: '19988', rate: '0.6937' },
};

const productionRuntimeCoverage = {
  runtime_context: { count: '445', denominator: '447', rate: '0.9955' },
  contract_state_markers: { count: '396', denominator: '447', rate: '0.8859' },
  required_dimensions: { count: '391', denominator: '447', rate: '0.8747' },
  selected_dimensions: { count: '396', denominator: '447', rate: '0.8859' },
  consequence_debt: { count: '323', denominator: '447', rate: '0.7226' },
};

assertCsvRows('data/results/real-pilot-metrics.csv', 'baseline_id', mainMetrics);
if (fs.existsSync('runs/automatic-metrics.csv')) assertCsvRows('runs/automatic-metrics.csv', 'baseline_id', mainMetrics);

assertCsvRows('data/results/bootstrap-headline-diffs.csv', 'surface', bootstrap);
if (fs.existsSync('runs/bootstrap-headline-diffs.csv')) assertCsvRows('runs/bootstrap-headline-diffs.csv', 'surface', bootstrap);

const horizonRows = readCsv('data/results/horizon-stability.csv').map((row) => ({ ...row, key: `${row.baseline_id}::${row.horizon_group}` }));
for (const [key, fields] of Object.entries(horizon)) assertRowValues(horizonRows.find((row) => row.key === key), fields, `data/results/horizon-stability.csv:${key}`);
if (fs.existsSync('runs/horizon-stability.csv')) {
  const generated = readCsv('runs/horizon-stability.csv').map((row) => ({ ...row, key: `${row.baseline_id}::${row.horizon_group}` }));
  for (const [key, fields] of Object.entries(horizon)) assertRowValues(generated.find((row) => row.key === key), fields, `runs/horizon-stability.csv:${key}`);
}

assertCsvRows('runs/llm-judge-summary/llm-fidelity-summary.csv', 'system', judgeSummary);
assertCsvRows('runs/llm-judge-summary/llm-fidelity-winner-selection-summary.csv', 'winner', winnerSummary);
assertCsvRows('data/results/judge-winner-bootstrap.csv', 'statistic', judgeWinnerBootstrap);
if (fs.existsSync('runs/judge-winner-bootstrap.csv')) assertCsvRows('runs/judge-winner-bootstrap.csv', 'statistic', judgeWinnerBootstrap);
assertCsvRows('data/results/selector-baseline-mmr.csv', 'selector', selectorBaselines);
if (fs.existsSync('runs/selector-baseline-mmr.csv')) assertCsvRows('runs/selector-baseline-mmr.csv', 'selector', selectorBaselines);

assertCsvRows('data/results/long-history-payload-summary.csv', 'endpoint', longHistory);
if (fs.existsSync('runs/long-history-payload-summary.csv')) assertCsvRows('runs/long-history-payload-summary.csv', 'endpoint', longHistory);
assertCsvRows('data/results/production-data-wash-summary.csv', 'metric', production);
assertCsvRows('data/results/production-runtime-coverage.csv', 'runtime_object', productionRuntimeCoverage);

assertEqual(readCsv('data/results/real-pilot-results.csv').length, 3240, 'real-pilot release row count');
assertEqual(readCsv('data/results/long-history-payload-results.csv').length, 300, 'long-history payload release row count');
assertEqual(readCsv('data/model_judge/combined-labels.csv').length, 540, 'combined model-judge label count');
assertEqual(readCsv('data/model_judge/combined-pairwise.csv').length, 180, 'combined model-judge winner-selection count');

console.log(JSON.stringify({ release_table_check: 'passed' }, null, 2));
