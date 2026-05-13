import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PROVIDER_API_KEY: '',
      PROVIDER_BASE_URL: '',
      PROVIDER_MODEL: '',
    },
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
  assert.match(source, /consequence_obligations:\s*mergeUnique\(parsed\.consequence_obligations,\s*fixture\.consequence_debt\)/);
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
