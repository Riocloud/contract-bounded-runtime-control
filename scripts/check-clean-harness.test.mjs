import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function runNode(args, envOverrides = {}) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PROVIDER_API_KEY: '',
      PROVIDER_BASE_URL: '',
      PROVIDER_MODEL: '',
      ...envOverrides,
    },
  });
}

function runPrivacyCheckIn(cwd) {
  return spawnSync(process.execPath, [path.join(repoRoot, 'scripts/check-privacy-boundary.mjs')], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PROVIDER_API_KEY: '',
      PROVIDER_BASE_URL: '',
      PROVIDER_MODEL: '',
    },
  });
}

function syntheticEmailLeak() {
  return ['released-leak', 'example.invalid'].join(String.fromCharCode(64));
}

function runNodeAsync(args, envOverrides = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        PROVIDER_API_KEY: '',
        PROVIDER_BASE_URL: '',
        PROVIDER_MODEL: '',
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
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
  if (row.length > 0) rows.push(row);
  const [headers, ...dataRows] = rows;
  return dataRows.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ''])));
}

test('dumped generation prompts do not expose oracle no-feasible or repair labels', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-clean-prompt-'));
  const result = runNode([
    'scripts/run-cbea-lcv-real-pilot.mjs',
    '--fixtures=data/fixtures/cbea-lcv.expanded360.synthetic.json',
    '--limit=1',
    '--methods=cbea_lcv_runtime',
    '--dump-prompts',
    `--out=${outDir}`,
  ]);

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const promptDump = fs.readFileSync(path.join(outDir, 'prompt-dump.jsonl'), 'utf8');
  assert.doesNotMatch(promptDump, /Oracle no-feasible flag|Expected repair or abstain/);
  assert.doesNotMatch(promptDump, /oracle_feasible_set_empty|expected_repair_or_abstain/);
  assert.doesNotMatch(promptDump, /\nRequired witnesses:\n|\nTail witnesses:\n|\nConsequence debt:\n/);
  assert.match(promptDump, /Confirmed hard constraints/);
});

test('automatic summary computes NFER over D0 rather than structured commitments', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-clean-metrics-'));
  const inputPath = path.join(outDir, 'results.csv');
  const outputPath = path.join(outDir, 'metrics.csv');
  const headers = [
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
  ];
  const rows = [
    ['f1', 'raw_prompt_stuffing', 'test', true, false, true, true, true, true, false, false, false, false, true, false, false, false, false, false, 10, 1, 1, 2, 'test', 'model', 'commit', 0],
    ['f2', 'raw_prompt_stuffing', 'test', true, false, true, false, true, true, false, false, false, false, false, true, true, true, false, false, 10, 1, 1, 2, 'test', 'model', 'abstain', 0],
    ['f3', 'raw_prompt_stuffing', 'test', true, false, true, false, true, false, false, false, false, false, false, false, true, true, false, false, 10, 1, 1, 2, 'test', 'model', 'repair', 0],
    ['f4', 'raw_prompt_stuffing', 'test', true, false, true, true, false, false, false, false, false, false, false, false, false, false, true, false, false, 10, 1, 1, 2, 'test', 'model', 'commit', 0],
  ];
  fs.writeFileSync(inputPath, `${headers.join(',')}\n${rows.map((row) => row.join(',')).join('\n')}\n`);

  const result = runNode([
    'scripts/summarize-automatic-metrics.mjs',
    `--input=${inputPath}`,
    `--out=${outputPath}`,
  ]);

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const [raw] = parseCsv(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(raw.structured_commitment_denominator, '2');
  assert.equal(raw.no_feasible_denominator, '2');
  assert.equal(raw.repair_denominator, '3');
  assert.equal(raw.no_feasible_emission_rate, '0.5');
  assert.equal(raw.abstention_repair_correctness_rate, '0.6667');
});

test('provider latency is measured after the full response body is consumed', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts/run-cbea-lcv-real-pilot.mjs'), 'utf8');
  const bodyReadIndex = source.indexOf('const bodyText = await response.text();');
  const latencyIndex = source.indexOf('const latencyMs = Math.round(performance.now() - started);');

  assert.ok(bodyReadIndex > 0, 'response body read must be present');
  assert.ok(latencyIndex > 0, 'latency measurement must be present');
  assert.ok(bodyReadIndex < latencyIndex, 'latency must be recorded after response.text() resolves');
});

test('result CSV preserves structured parsed output for rescoring', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-result-csv-'));
  const result = runNode([
    'scripts/run-cbea-lcv-real-pilot.mjs',
    '--fixtures=data/fixtures/cbea-lcv.expanded360.synthetic.json',
    '--limit=1',
    '--methods=oracle_evidence_upper_bound',
    `--out=${outDir}`,
  ]);

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const [row] = parseCsv(fs.readFileSync(path.join(outDir, 'real-pilot-results.csv'), 'utf8'));
  assert.ok(row.parsed_output, 'parsed_output column should be present');
  const parsed = JSON.parse(row.parsed_output);
  assert.deepEqual(parsed.consequence_obligations, [
    'household_liquidity_followup',
    'investment_tail_r01_followup',
  ]);
  assert.match(row.output_text, /Oracle commitment covers/);
});

test('LCV-gated CBEA carries compiled consequence obligations forward structurally', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts/run-cbea-lcv-real-pilot.mjs'), 'utf8');

  assert.match(source, /function applyValidatedCarryForward/);
  assert.match(source, /methodCarriesValidatedState\(method\)/);
  assert.match(source, /consequence_obligations:\s*mergeUnique\(parsed\.consequence_obligations,\s*runtimeConsequenceDebt\(fixture\)\)/);
});

test('v6 shadow fixture generator preserves shape without leaking scoring labels', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-v6-shadow-fixtures-'));
  const outPath = path.join(outDir, 'shadow.json');
  const statsPath = path.join(outDir, 'stats.json');
  const result = runNode([
    'scripts/generate-cbea-lcv-v6-shadow-fixtures.mjs',
    `--out=${outPath}`,
    `--stats=${statsPath}`,
  ]);

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const fixtures = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  assert.equal(fixtures.length, 360);
  assert.equal(fixtures.every((fixture) => Array.isArray(fixture.turns) && fixture.turns.length >= 3), true);
  assert.equal(fixtures.every((fixture) => fixture.shadow_oracle.facts.length >= 1), true);
  assert.equal(fixtures.every((fixture) => fixture.shadow_oracle.facts.length <= 5), true);
  assert.ok(new Set(fixtures.map((fixture) => fixture.shadow_oracle.facts.length)).size > 1);
  assert.equal(stats.min_shadow_facts_per_fixture, 1);
  assert.equal(stats.max_shadow_facts_per_fixture, 5);
  assert.equal(fixtures.every((fixture) => fixture.shadow_oracle.noise_density_score >= 0.3), true);
  assert.equal(new Set(fixtures.map((fixture) => fixture.scenario_focus)).size, 5);

  const [first] = fixtures;
  const [firstFact] = first.shadow_oracle.facts;
  const visibleArchive = first.noisy_user_observations.join('\n');
  assert.ok(firstFact.aliases.some((alias) => visibleArchive.includes(alias)));
  assert.doesNotMatch(visibleArchive, /shadow_oracle|fact_id|sh[0-9]+|oracle_only|deferred_|hidden_/);
  assert.ok(firstFact.aliases.length >= 3);
  assert.ok(firstFact.paraphrase_patterns.length >= 1);

  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-v6-shadow-prompt-'));
  const promptResult = runNode([
    'scripts/run-cbea-lcv-real-pilot.mjs',
    `--fixtures=${outPath}`,
    '--limit=1',
    '--methods=raw_prompt_stuffing',
    '--dump-prompts',
    `--out=${promptDir}`,
  ]);
  assert.equal(promptResult.status, 0, `${promptResult.stderr}\n${promptResult.stdout}`);
  const promptDump = fs.readFileSync(path.join(promptDir, 'prompt-dump.jsonl'), 'utf8');
  assert.ok(firstFact.aliases.some((alias) => promptDump.includes(alias)));
  assert.doesNotMatch(promptDump, /shadow_oracle|fact_id|aliases|weight|turn_due_by|polarity|oracle_only_hard_constraints|deferred_predicates|turn_of_first_violation_check|h_star|E_star|F_star/);
});

test('oracle upper bound covers shadow oracle facts with continuous recall metrics', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-shadow-oracle-'));
  const fixturesPath = path.join(outDir, 'fixtures.json');
  fs.writeFileSync(fixturesPath, `${JSON.stringify([
    {
      fixture_id: 'shadow_oracle_001',
      scenario_focus: 'investment',
      noisy_user_observations: [
        'Keep emergency cash outside speculative trades, and schedule a family cash review after any rebalance.',
      ],
      confirmed_hard_constraints: ['covered_hard_constraint'],
      validator_covered_hard_constraints: ['covered_hard_constraint'],
      mutable_state_facts: ['mutable_state_fact'],
      required_dimensions: ['finance'],
      required_detail_slots: ['covered_detail_slot'],
      validator_covered_detail_slots: ['covered_detail_slot'],
      required_witnesses: ['covered_witness'],
      validator_covered_required_witnesses: ['covered_witness'],
      tail_witnesses: ['covered_tail_witness'],
      validator_covered_tail_witnesses: ['covered_tail_witness'],
      consequence_debt: ['covered_consequence_debt'],
      validator_covered_consequence_debt: ['covered_consequence_debt'],
      shadow_oracle: {
        facts: [
          {
            id: 'sh1',
            canonical: 'emergency cash outside speculative trades',
            aliases: ['emergency cash outside speculative trades', 'cash outside speculative trades', 'cash reserve separate from speculation'],
            paraphrase_patterns: ['cash\\s+(outside|separate).*speculative'],
            type: 'constraint',
            weight: 1,
            turn_due_by: 2,
            polarity: 'respect',
            embedded_in_turns: [1],
          },
          {
            id: 'sh2',
            canonical: 'family cash review after any rebalance',
            aliases: ['family cash review after any rebalance', 'review cash after rebalance', 'cash review after rebalancing'],
            paraphrase_patterns: ['cash\\s+review.*rebalance'],
            type: 'consequence',
            weight: 1,
            turn_due_by: 3,
            polarity: 'respect',
            embedded_in_turns: [1],
          },
        ],
        noise_density_score: 0.5,
      },
      runtime_repair_guards: [],
      oracle_feasible_set_empty: false,
      expected_repair_or_abstain: false,
      expected_valid_commitment_fields: ['decision'],
      failure_surface: ['hidden_exception'],
    },
  ], null, 2)}\n`);

  const result = runNode([
    'scripts/run-cbea-lcv-real-pilot.mjs',
    `--fixtures=${fixturesPath}`,
    '--methods=oracle_evidence_upper_bound',
    `--out=${outDir}`,
    '--max-parse-retries=0',
  ]);

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const [row] = JSON.parse(fs.readFileSync(path.join(outDir, 'real-pilot-results.json'), 'utf8'));
  assert.equal(row.shadow_oracle_boundary, true);
  assert.equal(row.shadow_fact_count, 2);
  assert.equal(row.shadow_oracle_recall, 1);
  assert.equal(row.shadow_oracle_failure_score, 0);
  assert.equal(row.shadow_hard_recall, 1);
  assert.equal(row.shadow_consequence_recall, 1);
  assert.equal(row.shadow_contradiction_rate, 0);
  assert.equal(row.shadow_fact_denominator, 2);
  assert.equal(row.shadow_matched_fact_count, 2);
  assert.equal(row.shadow_alias_match_count, 2);
  assert.equal(row.shadow_regex_match_count, 0);
});

test('raw and long-context LCV-gated baselines are runnable prompt-dump methods', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-lcv-gate-prompts-'));
  const result = runNode([
    'scripts/run-cbea-lcv-real-pilot.mjs',
    '--fixtures=data/fixtures/cbea-lcv.expanded360.synthetic.json',
    '--limit=1',
    '--methods=raw_prompt_stuffing_lcv_gate,long_context_lcv_gate',
    '--dump-prompts',
    `--out=${outDir}`,
  ]);

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const promptDump = fs.readFileSync(path.join(outDir, 'prompt-dump.jsonl'), 'utf8');
  assert.match(promptDump, /Raw prompt stuffing \+ LCV gate/);
  assert.match(promptDump, /Long-context LLM \+ LCV gate/);
  assert.match(promptDump, /apply the same post-generation structured validator/);
  assert.match(promptDump, /Do not use contract-bounded evidence activation/);
});

test('LCV-gated raw and long-context baselines use full evidence but no CBEA carry-forward', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts/run-cbea-lcv-real-pilot.mjs'), 'utf8');
  const carryForwardFunction = source.match(/function methodCarriesValidatedState\(method\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(source, /raw_prompt_stuffing_lcv_gate/);
  assert.match(source, /long_context_lcv_gate/);
  assert.match(source, /methodHasCoverageValidationGate/);
  assert.doesNotMatch(carryForwardFunction, /raw_prompt_stuffing_lcv_gate/);
  assert.doesNotMatch(carryForwardFunction, /long_context_lcv_gate/);
});

test('result rescore treats normalized consequence obligations as covered', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-rescore-consequence-'));
  const fixturesPath = path.join(outDir, 'fixtures.json');
  const inputPath = path.join(outDir, 'results.csv');
  const outputPath = path.join(outDir, 'rescored.csv');
  fs.writeFileSync(fixturesPath, `${JSON.stringify([
    {
      fixture_id: 'f1',
      oracle_feasible_set_empty: true,
      consequence_debt: ['household_liquidity_followup', 'investment_tail_r02_followup'],
    },
    {
      fixture_id: 'f2',
      oracle_feasible_set_empty: false,
      consequence_debt: ['household_liquidity_followup', 'investment_tail_r02_followup'],
    },
  ])}\n`);
  const headers = ['fixture_id', 'baseline_id', 'consequence_continuity_failure', 'parsed_output', 'output_text'];
  const covered = JSON.stringify({
    consequence_obligations: [
      'Maintain household liquidity buffer for follow-up.',
      'Schedule investment tail r02 follow-up before increasing position size.',
    ],
    output_text: '',
  });
  const missing = JSON.stringify({
    consequence_obligations: ['Maintain household liquidity buffer.'],
    output_text: '',
  });
  const csvRows = [
    ['f1', 'cbea_lcv_runtime', 'true', covered, ''],
    ['f2', 'cbea_lcv_runtime', 'false', missing, ''],
  ].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
  fs.writeFileSync(inputPath, `${headers.join(',')}\n${csvRows.join('\n')}\n`);

  const result = runNode([
    'scripts/rescore-cbea-results.mjs',
    `--fixtures=${fixturesPath}`,
    `--input=${inputPath}`,
    `--out=${outputPath}`,
  ]);

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const rows = parseCsv(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(rows[0].consequence_continuity_failure, 'false');
  assert.equal(rows[1].consequence_continuity_failure, 'true');
  assert.equal(rows[0].no_feasible_expected, 'true');
  assert.equal(rows[1].no_feasible_expected, 'false');
});

test('judge sample builder produces a 90-case balanced audit set', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-judge-sample-'));
  const result = runNode([
    'scripts/build-model-judge-sample.mjs',
    '--fixtures=data/fixtures/cbea-lcv.expanded360.synthetic.json',
    '--results=data/results/real-pilot-results.csv',
    `--out=${outDir}`,
    '--cases-per-group=3',
  ]);

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const keyRows = parseCsv(fs.readFileSync(path.join(outDir, 'annotation-key.csv'), 'utf8'));
  const itemRows = parseCsv(fs.readFileSync(path.join(outDir, 'annotation-items.csv'), 'utf8'));
  const itemHeaders = fs.readFileSync(path.join(outDir, 'annotation-items.csv'), 'utf8').split('\n')[0].split(',');
  assert.equal(keyRows.length, 270);
  assert.equal(itemRows.length, 270);
  assert.equal(new Set(keyRows.map((row) => row.case_id)).size, 90);
  assert.equal(new Set(keyRows.map((row) => row.fixture_id)).size, 90);
  assert.ok(itemHeaders.includes('runtime_control_reference'));
  assert.ok(itemHeaders.includes('output_source'));
  assert.ok(!itemHeaders.includes('confirmed_hard_constraints'));
  assert.ok(!itemHeaders.includes('required_witnesses'));
  assert.ok(!itemHeaders.includes('tail_witnesses'));
  assert.ok(!itemHeaders.includes('consequence_debt'));
  assert.match(itemRows[0].runtime_control_reference, /Confirmed hard boundaries/);
  assert.doesNotMatch(itemRows[0].runtime_control_reference, /oracle_feasible_set_empty|expected_repair_or_abstain/);
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'selection-manifest.json'), 'utf8'));
  assert.equal(manifest.group_count, 30);
  assert.equal(manifest.selected_cases, 90);
  assert.equal(manifest.reference_mode, 'plain_english_runtime_control_reference');
});

test('judge winner bootstrap reports case-clustered confidence intervals', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-judge-bootstrap-'));
  const pairwisePath = path.join(outDir, 'pairwise.csv');
  const keyPath = path.join(outDir, 'key.csv');
  const outPath = path.join(outDir, 'judge-winner-bootstrap.csv');
  fs.writeFileSync(pairwisePath, [
    'case_id,annotator_id,best_system_label,notes',
    'C001,j1,System A,',
    'C001,j2,System B,',
    'C002,j1,System A,',
    'C002,j2,System A,',
  ].join('\n') + '\n');
  fs.writeFileSync(keyPath, [
    'annotation_id,case_id,fixture_id,system_label,baseline_id',
    'C001-A,C001,f1,System A,cbea_lcv_runtime',
    'C001-B,C001,f1,System B,raw_prompt_stuffing',
    'C002-A,C002,f2,System A,cbea_lcv_runtime',
    'C002-B,C002,f2,System B,raw_prompt_stuffing',
  ].join('\n') + '\n');

  const result = runNode([
    'scripts/bootstrap-judge-wins.mjs',
    `--pairwise=${pairwisePath}`,
    `--key=${keyPath}`,
    `--out=${outPath}`,
    '--iterations=200',
    '--seed=7',
  ]);

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const output = fs.readFileSync(outPath, 'utf8');
  assert.match(output, /cbea_lcv_runtime,0\.7500,/);
  assert.match(output, /cbea_minus_raw,0\.5000,/);
});

test('selector diagnostic compares CBEA against an MMR retrieval baseline', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-selector-baseline-'));
  const outPath = path.join(outDir, 'selector-baseline-mmr.csv');
  const result = runNode([
    'scripts/summarize-selector-baselines.mjs',
    '--fixtures=data/fixtures/cbea-lcv.expanded360.synthetic.json',
    `--out=${outPath}`,
    '--limit=24',
  ]);

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const output = fs.readFileSync(outPath, 'utf8');
  assert.match(output, /^selector,fixture_count,avg_selected,hard_constraint_recall,required_witness_recall,tail_witness_recall,consequence_debt_recall,control_evidence_recall/m);
  assert.match(output, /^cbea_lcv_selector,24,/m);
  assert.match(output, /^mmr_relevance_diversity,24,/m);
});

test('privacy check ignores local raw results workspace', () => {
  const localResultsDir = path.join(repoRoot, 'results', 'privacy-regression');
  const localResultsPath = path.join(localResultsDir, 'raw-local-output.txt');
  fs.mkdirSync(localResultsDir, { recursive: true });
  fs.writeFileSync(localResultsPath, `${syntheticEmailLeak()}\n`);
  try {
    const result = runNode(['scripts/check-privacy-boundary.mjs']);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  } finally {
    fs.rmSync(localResultsDir, { recursive: true, force: true });
  }
});

test('privacy check ignores root results workspace without git metadata', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-privacy-nogit-'));
  const localResultsDir = path.join(tempRoot, 'results', 'privacy-regression');
  const localResultsPath = path.join(localResultsDir, 'raw-local-output.txt');
  fs.mkdirSync(localResultsDir, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), 'temporary artifact root\n');
  fs.writeFileSync(localResultsPath, `${syntheticEmailLeak()}\n`);
  try {
    const result = runPrivacyCheckIn(tempRoot);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('privacy check still scans released data results without git metadata', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-privacy-data-results-'));
  const dataResultsDir = path.join(tempRoot, 'data', 'results');
  const dataResultsPath = path.join(dataResultsDir, 'released.csv');
  fs.mkdirSync(dataResultsDir, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), 'temporary artifact root\n');
  fs.writeFileSync(dataResultsPath, `${syntheticEmailLeak()}\n`);
  try {
    const result = runPrivacyCheckIn(tempRoot);
    assert.notEqual(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.match(result.stderr, /data\/results\/released\.csv/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
