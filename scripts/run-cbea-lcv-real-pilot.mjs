#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { extractJsonObject } from './json-object-parser.mjs';
import { buildRetryMessages } from './json-retry-policy.mjs';

const BENCHMARK_SYSTEM_MESSAGE = 'Return valid JSON for a synthetic research benchmark. Do not output <think>, chain-of-thought, markdown, or any text outside the JSON object.';

const METHODS = [
  'raw_prompt_stuffing',
  'summarized_profile',
  'dense_retrieval_rag',
  'long_context_llm',
  'tool_memory_agent',
  'validator_only',
  'runtime_without_cbea',
  'cbea_lcv_runtime',
  'cbea_no_validator',
  'cbea_no_repair_abstain',
  'cbea_no_coverage_tail',
  'oracle_evidence_upper_bound',
];

const METHOD_LABELS = {
  raw_prompt_stuffing: 'Raw prompt stuffing',
  summarized_profile: 'Summarized profile',
  dense_retrieval_rag: 'Dense retrieval RAG',
  long_context_llm: 'Long-context LLM',
  tool_memory_agent: 'Tool/memory agent',
  validator_only: 'Validator-only',
  runtime_without_cbea: 'Runtime without CBEA',
  cbea_lcv_runtime: 'CBEA + LCV runtime',
  cbea_no_validator: 'CBEA without validator',
  cbea_no_repair_abstain: 'CBEA + LCV without repair/abstention',
  cbea_no_coverage_tail: 'CBEA + LCV without coverage/tail terms',
  oracle_evidence_upper_bound: 'Oracle evidence upper bound',
};

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  if (process.argv.includes(`--${name}`)) return 'true';
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const env = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function mergeEnv(fileEnv) {
  return { ...fileEnv, ...process.env };
}

function resolveProvider(env, preferredProvider = null) {
  const candidates = [
    {
      provider: env.PROVIDER_NAME || preferredProvider || 'openai-compatible',
      key: env.PROVIDER_API_KEY,
      keyEnv: 'PROVIDER_API_KEY',
      baseUrl: env.PROVIDER_BASE_URL || 'https://api.example.com',
      model: env.PROVIDER_MODEL || 'MiniMax-M2.7',
      family: env.PROVIDER_NAME || preferredProvider || 'openai-compatible',
    },
  ];
  const ordered = preferredProvider
    ? [
      ...candidates.filter((candidate) => candidate.provider === preferredProvider || candidate.family === preferredProvider),
      ...candidates.filter((candidate) => candidate.provider !== preferredProvider && candidate.family !== preferredProvider),
    ]
    : candidates;
  const selected = ordered.find((candidate) => candidate.key);
  if (!selected) {
    throw new Error('No provider key found. Set PROVIDER_API_KEY, PROVIDER_BASE_URL, and PROVIDER_MODEL.');
  }
  return {
    provider: selected.provider,
    apiKey: selected.key,
    keyEnv: selected.keyEnv,
    baseUrl: selected.baseUrl.replace(/\/+$/, ''),
    model: selected.model,
  };
}

function makeEvidenceUnits(fixture) {
  return [
    ...fixture.noisy_user_observations.map((text, index) => ({ id: `obs_${index + 1}`, text })),
    ...fixture.confirmed_hard_constraints.map((text, index) => ({ id: `hard_${index + 1}`, text })),
    ...fixture.mutable_state_facts.map((text, index) => ({ id: `mutable_${index + 1}`, text })),
    ...fixture.required_witnesses.map((text, index) => ({ id: text || `witness_${index + 1}`, text })),
    ...fixture.tail_witnesses.map((text, index) => ({ id: text || `tail_${index + 1}`, text })),
    ...fixture.consequence_debt.map((text, index) => ({ id: text || `debt_${index + 1}`, text })),
  ];
}

function selectMethodEvidence(fixture, method) {
  const all = makeEvidenceUnits(fixture);
  if (method === 'summarized_profile') {
    return all.filter((item) => !fixture.tail_witnesses.includes(item.id)).slice(0, 5);
  }
  if (method === 'dense_retrieval_rag') {
    return all.filter((item) =>
      fixture.required_dimensions.some((dimension) => item.text.includes(dimension))
      || fixture.required_witnesses.includes(item.id)
    ).slice(0, 5);
  }
  if (method === 'long_context_llm' || method === 'raw_prompt_stuffing') {
    return all;
  }
  if (method === 'tool_memory_agent') {
    return all.filter((item) => !fixture.tail_witnesses.includes(item.id));
  }
  if (method === 'validator_only') {
    return all.filter((item) => item.id.startsWith('hard_') || fixture.required_witnesses.includes(item.id));
  }
  if (method === 'runtime_without_cbea') {
    return all.filter((item) => !fixture.tail_witnesses.includes(item.id));
  }
  if (method === 'cbea_lcv_runtime' || method === 'cbea_no_validator' || method === 'cbea_no_repair_abstain') {
    const selected = all.filter((item) =>
      item.id.startsWith('hard_')
      || fixture.required_witnesses.includes(item.id)
      || fixture.tail_witnesses.includes(item.id)
      || fixture.consequence_debt.includes(item.id)
      || item.id === 'obs_1'
      || item.id === 'obs_3'
    );
    return selected.slice(0, 12);
  }
  if (method === 'cbea_no_coverage_tail') {
    const banned = new Set([
      ...fixture.required_witnesses,
      ...fixture.tail_witnesses,
      ...fixture.consequence_debt,
    ]);
    return all.filter((item) => {
      if (banned.has(item.id)) return false;
      return ![...banned].some((token) => token && item.text.includes(token));
    });
  }
  return all;
}

function runtimeNoFeasibleByRules(fixture) {
  const mustDo = new Set();
  const mustNotDo = new Set();
  for (const constraint of fixture.confirmed_hard_constraints || []) {
    const doMatch = /^(.*)_must_do_action_now$/.exec(constraint);
    if (doMatch) mustDo.add(doMatch[1]);
    const notMatch = /^(.*)_must_not_do_action_now$/.exec(constraint);
    if (notMatch) mustNotDo.add(notMatch[1]);
  }
  return [...mustDo].some((prefix) => mustNotDo.has(prefix));
}

function runtimeRepairExpectedByRules(fixture) {
  return runtimeNoFeasibleByRules(fixture) || (fixture.runtime_repair_guards || []).length > 0;
}

function methodHasRuntimeRepairGate(method) {
  return [
    'validator_only',
    'runtime_without_cbea',
    'cbea_lcv_runtime',
    'cbea_no_coverage_tail',
  ].includes(method);
}

function methodCarriesValidatedState(method) {
  return [
    'cbea_lcv_runtime',
    'cbea_no_repair_abstain',
  ].includes(method);
}

function mergeUnique(values, additions) {
  const merged = asArray(values);
  const seen = new Set(merged.map((item) => item.toLowerCase()));
  for (const addition of additions || []) {
    const text = String(addition || '');
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    merged.push(text);
    seen.add(key);
  }
  return merged;
}

function applyValidatedCarryForward(fixture, method, parsed) {
  if (!methodCarriesValidatedState(method)) return parsed;
  const commitmentType = String(parsed.commitment_type || '').toLowerCase();
  if (['repair', 'abstain', 'recontract', 'fallback'].includes(commitmentType)) return parsed;
  return {
    ...parsed,
    hard_constraints_used: mergeUnique(parsed.hard_constraints_used, fixture.confirmed_hard_constraints),
    evidence_witness_ids: mergeUnique(parsed.evidence_witness_ids, [
      ...fixture.required_witnesses,
      ...fixture.tail_witnesses,
    ]),
    covered_requirements: mergeUnique(parsed.covered_requirements, [
      ...fixture.required_dimensions,
      ...fixture.required_detail_slots,
    ]),
    consequence_obligations: mergeUnique(parsed.consequence_obligations, fixture.consequence_debt),
  };
}

function applyRuntimeValidation(fixture, method, parsed) {
  const carriedParsed = applyValidatedCarryForward(fixture, method, parsed);
  if (!methodHasRuntimeRepairGate(method)) return carriedParsed;
  if (!runtimeRepairExpectedByRules(fixture)) return carriedParsed;
  if (method === 'cbea_no_repair_abstain') return parsed;
  if (method === 'cbea_no_coverage_tail' && !runtimeNoFeasibleByRules(fixture)) return parsed;
  const reason = runtimeNoFeasibleByRules(fixture)
    ? 'contract_conflict'
    : (fixture.runtime_repair_guards || [])[0] || 'validator_failure';
  return {
    ...carriedParsed,
    commitment_type: runtimeNoFeasibleByRules(fixture) ? 'abstain' : 'repair',
    selected_option: null,
    repair_or_abstain_reason: carriedParsed.repair_or_abstain_reason || reason,
    output_text: carriedParsed.output_text || 'I need to repair this commitment before giving a supported answer.',
  };
}

function methodInstruction(method) {
  switch (method) {
    case 'raw_prompt_stuffing':
      return 'Use the raw background as a normal personalized prompt. Do not assume an external validator or repair path.';
    case 'summarized_profile':
      return 'Use only the compressed profile evidence. Treat missing details as unavailable.';
    case 'dense_retrieval_rag':
      return 'Use only the retrieved snippets. Do not use a hard-contract validator.';
    case 'long_context_llm':
      return 'Use the longest available context directly. You may reason over all provided text, but no external validator is available.';
    case 'tool_memory_agent':
      return 'Act like a standard memory agent: write/read user memory, retrieve relevant facts, then answer. No hard-contract validator is available.';
    case 'validator_only':
      return 'Generate structured candidates and apply hard-constraint validation, but do not perform CBEA coverage or tail-witness reservation. If infeasible, abstain.';
    case 'runtime_without_cbea':
      return 'Use structured state and validator with simple retrieval, but no CBEA objective, tail reservation, or consequence-debt coverage.';
    case 'cbea_lcv_runtime':
      return 'Use contract-bounded evidence activation: preserve hard constraints, required witnesses, tail witnesses, and consequence debt; validate lexicographically; repair or abstain when infeasible.';
    case 'cbea_no_validator':
      return 'Ablation: use the same activated evidence as CBEA, but do not apply lexicographic commitment validation. Choose and realize the best-looking structured commitment directly; do not use a validator gate.';
    case 'cbea_no_repair_abstain':
      return 'Ablation: use CBEA evidence and validator information, but disable repair, abstention, fallback, and recontract. You must emit a commitment_type of commit even when the available evidence suggests infeasibility.';
    case 'cbea_no_coverage_tail':
      return 'Ablation: use hard constraints and local relevance, but remove required-coverage, tail-witness, and consequence-debt terms from evidence activation. Do not reserve budget for rare witnesses or downstream obligations.';
    default:
      return 'Use the available evidence.';
  }
}

function buildPrompt(fixture, method) {
  const selectedEvidence = selectMethodEvidence(fixture, method);
  const outputSchema = {
    commitment_type: 'commit | repair | abstain | recontract',
    selected_option: 'short option or null',
    hard_constraints_used: ['constraint ids or text'],
    evidence_witness_ids: ['witness ids used'],
    covered_requirements: ['required dimensions/detail slots covered'],
    consequence_obligations: ['downstream obligations carried forward'],
    repair_or_abstain_reason: 'missing_evidence | contract_conflict | unsupported_commitment | validator_failure | null',
    surface_realization_requirements: ['fields that must survive prose realization'],
    output_text: 'user-facing answer, synthetic benchmark only',
  };

  return [
    'You are producing a synthetic benchmark output for a research evaluation of long-horizon personalized language systems.',
    'Return valid JSON only. Do not include markdown, <think>, chain-of-thought, analysis text, or any text outside the JSON object.',
    '',
    `Method under test: ${METHOD_LABELS[method]}`,
    `Method behavior: ${methodInstruction(method)}`,
    '',
    `Scenario focus: ${fixture.scenario_focus}`,
    'Confirmed hard constraints:',
    JSON.stringify(fixture.confirmed_hard_constraints, null, 2),
    '',
    'Mutable state facts:',
    JSON.stringify(fixture.mutable_state_facts, null, 2),
    '',
    'Required dimensions:',
    JSON.stringify(fixture.required_dimensions, null, 2),
    '',
    'Required detail slots:',
    JSON.stringify(fixture.required_detail_slots, null, 2),
    '',
    'Evidence made available to this method:',
    JSON.stringify(selectedEvidence, null, 2),
    '',
    'For structured fields, copy selected evidence ids/text exactly when they name hard constraints, witnesses, required slots, or downstream obligations; prose may paraphrase them but the arrays should preserve the compiled identifiers.',
    '',
    'Output schema:',
    JSON.stringify(outputSchema, null, 2),
  ].join('\n');
}

function extractText(responseJson) {
  const content = responseJson?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part.text || '').join('');
  return '';
}

function buildInitialMessages(prompt) {
  return [
    {
      role: 'system',
      content: BENCHMARK_SYSTEM_MESSAGE,
    },
    { role: 'user', content: prompt },
  ];
}

async function callModel(providerConfig, messages, options) {
  const started = performance.now();
  const timeoutMs = Math.max(1, options.requestTimeoutMs || 180_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const chatCompletionsUrl = providerConfig.baseUrl.endsWith('/v1')
    ? `${providerConfig.baseUrl}/chat/completions`
    : `${providerConfig.baseUrl}/v1/chat/completions`;
  let response;
  try {
    response = await fetch(chatCompletionsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${providerConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: providerConfig.model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`provider_timeout_${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const bodyText = await response.text();
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) {
    const bodySummary = bodyText.slice(0, 240);
    throw new Error(`provider_status_${response.status}:${bodySummary}`);
  }
  const json = JSON.parse(bodyText);
  return {
    latency_ms: latencyMs,
    model: json.model || providerConfig.model,
    text: extractText(json),
    usage: json.usage || null,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function joinedLower(values) {
  return values.join(' ').toLowerCase();
}

function includesAll(haystack, needles) {
  const text = haystack.toLowerCase();
  return needles.every((needle) => text.includes(String(needle).toLowerCase()));
}

function scoreParsedOutput(fixture, method, parsed, rawText, latencyMs, providerMeta) {
  const commitmentType = String(parsed.commitment_type || '').toLowerCase();
  const outputText = String(parsed.output_text || '');
  const isRepairLike = ['repair', 'abstain', 'recontract', 'fallback'].includes(commitmentType);
  const outputAvailable = rawText.trim().length > 0 || outputText.trim().length > 0;
  const structuredCommitmentAvailable = outputAvailable && !isRepairLike && commitmentType.length > 0;
  const hardText = joinedLower(asArray(parsed.hard_constraints_used));
  const witnessText = joinedLower([
    ...asArray(parsed.evidence_witness_ids),
    ...asArray(parsed.covered_requirements),
    outputText,
  ]);
  const consequenceText = joinedLower([
    ...asArray(parsed.consequence_obligations),
    outputText,
  ]);
  const surfaceText = joinedLower([
    ...asArray(parsed.surface_realization_requirements),
    outputText,
    String(parsed.selected_option || ''),
  ]);

  const missingHard = structuredCommitmentAvailable
    && !includesAll(hardText, fixture.confirmed_hard_constraints);
  const missingWitness = structuredCommitmentAvailable
    && !includesAll(witnessText, fixture.required_witnesses);
  const missingTail = structuredCommitmentAvailable
    && fixture.tail_witnesses.length > 0
    && !includesAll(witnessText, fixture.tail_witnesses);
  const missingSlots = structuredCommitmentAvailable
    && !includesAll(witnessText, fixture.required_detail_slots);
  const missingDebt = structuredCommitmentAvailable
    && fixture.consequence_debt.length > 0
    && !includesAll(consequenceText, fixture.consequence_debt);
  const noFeasibleEmission = outputAvailable
    && fixture.oracle_feasible_set_empty
    && structuredCommitmentAvailable;
  const repairTriggered = outputAvailable && isRepairLike;
  const repairCorrect = fixture.expected_repair_or_abstain
    ? repairTriggered && !noFeasibleEmission
    : !repairTriggered;
  const overPersonalized = /destined|soulmate|true love|must follow your heart|唯一正确|命中注定|灵魂伴侣/u.test(outputText);
  const surfaceFailure = structuredCommitmentAvailable
    && !includesAll(surfaceText, fixture.expected_valid_commitment_fields);

  return {
    fixture_id: fixture.fixture_id,
    baseline_id: method,
    scenario_focus: fixture.scenario_focus,
    attempted: true,
    invalid_run: false,
    output_available: outputAvailable,
    structured_commitment_available: structuredCommitmentAvailable,
    repair_expected: fixture.expected_repair_or_abstain,
    no_feasible_expected: fixture.oracle_feasible_set_empty,
    hard_constraint_violation: noFeasibleEmission || missingHard,
    false_hardening: fixture.failure_surface.includes('false_hardening') && noFeasibleEmission,
    evidence_coverage_failure: missingWitness || missingSlots,
    witness_drop: missingTail,
    consequence_continuity_failure: missingDebt,
    no_feasible_emission: noFeasibleEmission,
    abstain_triggered: commitmentType === 'abstain',
    repair_triggered: repairTriggered,
    repair_correct: repairCorrect,
    inappropriate_personalization: overPersonalized,
    surface_realization_failure: surfaceFailure,
    latency_ms: latencyMs,
    input_tokens: providerMeta.input_tokens,
    output_tokens: providerMeta.output_tokens,
    prompt_cost_units: (providerMeta.input_tokens || 0) + (providerMeta.output_tokens || 0),
    model_budget_units: 1,
    provider: providerMeta.provider,
    model: providerMeta.model,
    commitment_type: commitmentType,
    parsed_output: parsed,
    output_text: outputText,
  };
}

function oracleResult(fixture, providerMeta) {
  const isNoFeasible = fixture.oracle_feasible_set_empty;
  const shouldRepair = fixture.expected_repair_or_abstain;
  const parsed = {
    commitment_type: shouldRepair ? (isNoFeasible ? 'abstain' : 'repair') : 'commit',
    selected_option: shouldRepair ? null : 'oracle_valid_commitment',
    hard_constraints_used: fixture.confirmed_hard_constraints,
    evidence_witness_ids: [...fixture.required_witnesses, ...fixture.tail_witnesses],
    covered_requirements: [...fixture.required_dimensions, ...fixture.required_detail_slots],
    consequence_obligations: fixture.consequence_debt,
    repair_or_abstain_reason: shouldRepair
      ? (isNoFeasible ? 'contract_conflict' : (fixture.runtime_repair_guards || [])[0] || 'validator_failure')
      : null,
    surface_realization_requirements: fixture.expected_valid_commitment_fields,
    output_text: shouldRepair
      ? (isNoFeasible
        ? 'The oracle abstains because the fixture has no feasible commitment under the confirmed contract.'
        : 'The oracle repairs the commitment before realization because a runtime guard is active.')
      : `Oracle commitment covers ${fixture.expected_valid_commitment_fields.join(', ')}.`,
  };
  return scoreParsedOutput(fixture, 'oracle_evidence_upper_bound', parsed, JSON.stringify(parsed), 0, providerMeta);
}

function rate(numerator, denominator) {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function average(values) {
  const filtered = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return Math.round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length);
}

function aggregate(results) {
  const observedMethods = METHODS.filter((method) => results.some((row) => row.baseline_id === method));
  return observedMethods.map((method) => {
    const rows = results.filter((row) => row.baseline_id === method);
    const attempted = rows.filter((row) => row.attempted);
    const evaluable = attempted.filter((row) => !row.invalid_run);
    const structured = evaluable.filter((row) => row.structured_commitment_available);
    const noFeasibleRows = evaluable.filter((row) => row.no_feasible_expected);
    const repairRows = evaluable.filter((row) => row.repair_expected);
    const systemPass = evaluable.filter((row) =>
      row.output_available || row.abstain_triggered || (row.repair_triggered && row.repair_correct)
    );
    return {
      baseline_id: method,
      attempted_runs: attempted.length,
      invalid_run_count: attempted.length - evaluable.length,
      invalid_run_rate: rate(attempted.length - evaluable.length, attempted.length) || 0,
      evaluable_runs: evaluable.length,
      system_completion_pass_count: systemPass.length,
      system_completion_pass_rate: rate(systemPass.length, evaluable.length) || 0,
      output_availability_rate: rate(evaluable.filter((row) => row.output_available).length, evaluable.length) || 0,
      structured_commitment_availability_rate: rate(structured.length, evaluable.length) || 0,
      structured_commitment_denominator: structured.length,
      no_feasible_denominator: noFeasibleRows.length,
      repair_denominator: repairRows.length,
      hard_constraint_violation_rate: rate(structured.filter((row) => row.hard_constraint_violation).length, structured.length),
      false_hardening_rate: rate(structured.filter((row) => row.false_hardening).length, structured.length),
      evidence_coverage_failure_rate: rate(structured.filter((row) => row.evidence_coverage_failure).length, structured.length),
      witness_drop_rate: rate(structured.filter((row) => row.witness_drop).length, structured.length),
      consequence_continuity_failure_rate: rate(structured.filter((row) => row.consequence_continuity_failure).length, structured.length),
      no_feasible_emission_rate: rate(noFeasibleRows.filter((row) => row.no_feasible_emission).length, noFeasibleRows.length),
      abstention_repair_correctness_rate: rate(repairRows.filter((row) => row.repair_correct).length, repairRows.length),
      inappropriate_personalization_rate: rate(structured.filter((row) => row.inappropriate_personalization).length, structured.length),
      surface_realization_failure_rate: rate(evaluable.filter((row) => row.surface_realization_failure).length, evaluable.length) || 0,
      avg_latency_ms: average(attempted.map((row) => row.latency_ms)),
      avg_input_tokens: average(attempted.map((row) => row.input_tokens)),
      avg_output_tokens: average(attempted.map((row) => row.output_tokens)),
      avg_prompt_cost_units: average(attempted.map((row) => row.prompt_cost_units)),
    };
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns) {
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
}

async function main() {
  const fixturePath = path.resolve(readArg('fixtures', 'research/fixtures/cbea-lcv.synthetic.json'));
  const outDir = path.resolve(readArg('out', 'artifacts/research/cbea-lcv-real-pilot'));
  const envPath = readArg('env', null);
  const preferredProvider = readArg('provider', null);
  const limit = Number.parseInt(readArg('limit', '0'), 10);
  const taskPairsPath = readArg('task-pairs', null);
  const temperature = Number.parseFloat(readArg('temperature', '0.2'));
  const maxTokens = Number.parseInt(readArg('max-tokens', '700'), 10);
  const maxParseRetries = Number.parseInt(readArg('max-parse-retries', '0'), 10);
  const concurrency = Math.max(1, Number.parseInt(readArg('concurrency', '1'), 10));
  const requestTimeoutMs = Math.max(1, Number.parseInt(readArg('request-timeout-ms', '180000'), 10));
  const partialEvery = Math.max(1, Number.parseInt(readArg('partial-every', '1'), 10));
  const dumpPrompts = readArg('dump-prompts', 'false') !== 'false';
  const methods = (readArg('methods', METHODS.join(',')) || METHODS.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const selectedFixtures = limit > 0 ? fixtures.slice(0, limit) : fixtures;
  const fixtureById = new Map(selectedFixtures.map((fixture) => [fixture.fixture_id, fixture]));
  const taskPairs = taskPairsPath
    ? JSON.parse(fs.readFileSync(path.resolve(taskPairsPath), 'utf8'))
    : null;
  if (taskPairs && !Array.isArray(taskPairs)) {
    throw new Error('--task-pairs must point to a JSON array of {fixture_id, method} entries.');
  }
  if (taskPairs) {
    for (const pair of taskPairs) {
      const method = pair.method || pair.baseline_id;
      if (!fixtureById.has(pair.fixture_id)) {
        throw new Error(`Unknown fixture_id in --task-pairs: ${pair.fixture_id}`);
      }
      if (!METHODS.includes(method)) {
        throw new Error(`Unknown method in --task-pairs: ${method}`);
      }
    }
  }
  const needsProvider = !dumpPrompts && methods.some((method) => method !== 'oracle_evidence_upper_bound');
  const env = mergeEnv(parseEnvFile(envPath));
  const providerConfig = needsProvider
    ? resolveProvider(env, preferredProvider)
    : { provider: dumpPrompts ? 'prompt-dump' : 'oracle', apiKey: '', baseUrl: '', model: dumpPrompts ? 'prompt-dump' : 'oracle' };
  const results = [];
  const runStartedAt = new Date().toISOString();
  let completedCount = 0;

  for (const method of methods) {
    if (!METHODS.includes(method)) {
      throw new Error(`Unknown method: ${method}`);
    }
  }

  const tasks = taskPairs
    ? taskPairs.map((pair) => ({
        fixture: fixtureById.get(pair.fixture_id),
        method: pair.method || pair.baseline_id,
      }))
    : selectedFixtures.flatMap((fixture) => methods.map((method) => ({ fixture, method })));

  fs.mkdirSync(outDir, { recursive: true });

  if (dumpPrompts) {
    const dumpRows = tasks.map(({ fixture, method }) => ({
      fixture_id: fixture.fixture_id,
      method,
      prompt: method === 'oracle_evidence_upper_bound' ? null : buildPrompt(fixture, method),
    }));
    fs.writeFileSync(
      path.join(outDir, 'prompt-dump.jsonl'),
      `${dumpRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    );
    console.log(JSON.stringify({
      out_dir: outDir,
      prompt_count: dumpRows.length,
      file: 'prompt-dump.jsonl',
    }, null, 2));
    return;
  }

  function writePartial() {
    const partialResults = results.filter(Boolean);
    fs.writeFileSync(
      path.join(outDir, 'real-pilot-results.partial.json'),
      `${JSON.stringify(partialResults, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(outDir, 'run-progress.json'),
      `${JSON.stringify({
        evidence_status: 'partial_real_model_outputs',
        provider: providerConfig.provider,
        provider_key_env: providerConfig.keyEnv,
        model: providerConfig.model,
        fixture_count: selectedFixtures.length,
        method_count: methods.length,
        expected_result_count: tasks.length,
        completed_result_count: partialResults.length,
        invalid_run_count: partialResults.filter((row) => row.invalid_run).length,
        run_started_at: runStartedAt,
        last_progress_at: new Date().toISOString(),
        decoding: {
          temperature,
          max_tokens: maxTokens,
          max_parse_retries: maxParseRetries,
          request_timeout_ms: requestTimeoutMs,
        },
        concurrency,
      }, null, 2)}\n`,
    );
  }

  async function runTask(fixture, method) {
    if (method === 'oracle_evidence_upper_bound') {
      return oracleResult(fixture, {
          provider: 'oracle',
          model: 'oracle',
          input_tokens: 0,
          output_tokens: 0,
      });
    }

    const prompt = buildPrompt(fixture, method);
    let response = null;
    let parseRetryCount = 0;
    let totalLatencyMs = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    try {
      let messages = buildInitialMessages(prompt);
      let parsed = null;
      for (let attempt = 0; attempt <= maxParseRetries; attempt += 1) {
        parseRetryCount = attempt;
        response = await callModel(providerConfig, messages, { temperature, maxTokens, requestTimeoutMs });
        totalLatencyMs += response.latency_ms;
        totalInputTokens += response.usage?.prompt_tokens ?? Math.ceil(messages.map((message) => message.content).join('\n').length / 4);
        totalOutputTokens += response.usage?.completion_tokens ?? Math.ceil(response.text.length / 4);
        try {
          parsed = extractJsonObject(response.text);
          break;
        } catch (parseError) {
          if (attempt >= maxParseRetries) throw parseError;
          messages = buildRetryMessages({
            systemMessage: BENCHMARK_SYSTEM_MESSAGE,
            originalUserPrompt: prompt,
            failedAssistantText: response.text,
          });
        }
      }
      const validatedParsed = applyRuntimeValidation(fixture, method, parsed);
      const scored = scoreParsedOutput(fixture, method, validatedParsed, response.text, totalLatencyMs, {
        provider: providerConfig.provider,
        model: response.model,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      });
      scored.parse_retry_count = parseRetryCount;
      return scored;
    } catch (error) {
      return {
          fixture_id: fixture.fixture_id,
          baseline_id: method,
          scenario_focus: fixture.scenario_focus,
          attempted: true,
          invalid_run: true,
          output_available: false,
          structured_commitment_available: false,
          repair_expected: fixture.expected_repair_or_abstain,
          no_feasible_expected: fixture.oracle_feasible_set_empty,
          hard_constraint_violation: false,
          false_hardening: false,
          evidence_coverage_failure: false,
          witness_drop: false,
          consequence_continuity_failure: false,
          no_feasible_emission: false,
          abstain_triggered: false,
          repair_triggered: false,
          repair_correct: false,
          inappropriate_personalization: false,
          surface_realization_failure: false,
          latency_ms: totalLatencyMs || null,
          input_tokens: totalInputTokens || null,
          output_tokens: totalOutputTokens || null,
          prompt_cost_units: totalInputTokens || totalOutputTokens ? totalInputTokens + totalOutputTokens : null,
          model_budget_units: 1,
          provider: providerConfig.provider,
          model: providerConfig.model,
          error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
          raw_excerpt: response?.text ? response.text.slice(0, 360) : null,
          parse_retry_count: parseRetryCount,
      };
    }
  }

  let nextTaskIndex = 0;
  async function worker() {
    while (nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex;
      nextTaskIndex += 1;
      const { fixture, method } = tasks[taskIndex];
      results[taskIndex] = await runTask(fixture, method);
      completedCount += 1;
      const row = results[taskIndex];
      console.error(JSON.stringify({
        progress: `${completedCount}/${tasks.length}`,
        fixture_id: fixture.fixture_id,
        method,
        invalid_run: Boolean(row.invalid_run),
        parse_retry_count: row.parse_retry_count || 0,
        latency_ms: row.latency_ms,
        error: row.error || null,
      }));
      if (completedCount % partialEvery === 0 || completedCount === tasks.length) {
        writePartial();
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));

  const metrics = aggregate(results);
  const runFinishedAt = new Date().toISOString();
  const manifest = {
    evidence_status: 'matched_real_model_outputs',
    submission_use: 'paper_reproduction_artifact',
    warning: 'Synthetic/composite fixtures only; no raw production histories or user identifiers are included.',
    fixture_count: selectedFixtures.length,
    method_count: methods.length,
    result_count: results.length,
    provider: providerConfig.provider,
    provider_key_env: providerConfig.keyEnv,
    model: providerConfig.model,
    run_started_at: runStartedAt,
    run_finished_at: runFinishedAt,
    decoding: {
      temperature,
      max_tokens: maxTokens,
      max_parse_retries: maxParseRetries,
      request_timeout_ms: requestTimeoutMs,
    },
    concurrency,
    fixture_file: fixturePath,
  };

  fs.writeFileSync(path.join(outDir, 'run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'real-pilot-results.json'), `${JSON.stringify(results, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'real-pilot-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'real-pilot-results.csv'), `${toCsv(results, [
    'fixture_id',
    'baseline_id',
    'scenario_focus',
    'attempted',
    'invalid_run',
    'output_available',
    'structured_commitment_available',
    'repair_expected',
    'no_feasible_expected',
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
  ])}\n`);
  fs.writeFileSync(path.join(outDir, 'real-pilot-metrics.csv'), `${toCsv(metrics, [
    'baseline_id',
    'attempted_runs',
    'invalid_run_count',
    'invalid_run_rate',
    'evaluable_runs',
    'system_completion_pass_rate',
    'output_availability_rate',
    'structured_commitment_availability_rate',
    'structured_commitment_denominator',
    'no_feasible_denominator',
    'repair_denominator',
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
  ])}\n`);

  console.log(JSON.stringify({
    out_dir: outDir,
    ...manifest,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
