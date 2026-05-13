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
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
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

function stableStringify(value) {
  return JSON.stringify(value ?? []);
}

function parseJsonMaybe(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function humanizeIdentifier(value) {
  return String(value ?? '')
    .replace(/^[a-z]+_\d+:\s*/i, '')
    .replace(/_r\d+(?=_|\b)/gi, '')
    .replace(/\br\d+\b/gi, '')
    .replace(/\b(hard|obs)_\d+\b/gi, '')
    .replace(/_/g, ' ')
    .replace(/\btail tail\b/gi, 'tail')
    .replace(/\banchor\b/gi, 'evidence')
    .replace(/\bslot\b/gi, 'detail')
    .replace(/\bfollowup\b/gi, 'follow-up')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceCase(value) {
  const text = humanizeIdentifier(value);
  if (!text) return '';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function summarizeList(values, fallback) {
  const items = asArray(values).map(sentenceCase).filter(Boolean);
  return items.length > 0 ? items.join('; ') : fallback;
}

function sanitizeObservation(text) {
  return humanizeIdentifier(text)
    .replace(/Replicate \d+ varies the witness and follow-up labels while preserving the same oracle stress surface\.?/gi, '')
    .replace(/No raw production history is used;?/gi, 'No raw production history is used;')
    .replace(/\s+/g, ' ')
    .trim();
}

function stressSurfaceDescription(surfaces) {
  const surfaceSet = new Set(asArray(surfaces));
  const descriptions = [];
  if (surfaceSet.has('false_hardening')) {
    descriptions.push('do not convert soft preferences or emotional hints into new hard constraints');
  }
  if (surfaceSet.has('hidden_exception')) {
    descriptions.push('preserve scoped exceptions rather than flattening them into a generic rule');
  }
  if (surfaceSet.has('witness_drop')) {
    descriptions.push('retain low-frequency evidence that materially changes the commitment');
  }
  if (surfaceSet.has('consequence_debt')) {
    descriptions.push('carry forward downstream obligations created by earlier choices');
  }
  if (surfaceSet.has('no_feasible_candidate')) {
    descriptions.push('avoid making a commitment when confirmed constraints are mutually incompatible');
  }
  if (surfaceSet.has('surface_mismatch')) {
    descriptions.push('avoid prose that overstates or changes the validated structured commitment');
  }
  if (surfaceSet.has('over_personalization')) {
    descriptions.push('avoid intrusive or unsupported personalization beyond the confirmed evidence');
  }
  return descriptions.length > 0 ? descriptions.join('; ') : 'preserve the confirmed constraints and evidence without unsupported additions';
}

function buildRuntimeControlReference(fixture) {
  const setup = asArray(fixture.noisy_user_observations)
    .map(sanitizeObservation)
    .filter(Boolean)
    .join(' ');
  const feasible = fixture.oracle_feasible_set_empty
    ? 'The confirmed constraints are mutually incompatible for this turn; a faithful output should repair, abstain, ask for clarification, or request recontract rather than make a commitment.'
    : 'A faithful output may make a commitment only if it preserves the confirmed boundaries and required evidence.';
  return [
    `Case setup: ${setup}`,
    `Confirmed hard boundaries: ${summarizeList(fixture.confirmed_hard_constraints, 'none separately specified')}.`,
    `Required evidence and details: ${summarizeList([
      ...asArray(fixture.required_dimensions),
      ...asArray(fixture.required_detail_slots),
      ...asArray(fixture.required_witnesses),
      ...asArray(fixture.tail_witnesses),
    ], 'none separately specified')}.`,
    `Consequence obligations: ${summarizeList(fixture.consequence_debt, 'none separately specified')}.`,
    `Runtime-control stress: ${stressSurfaceDescription(fixture.failure_surface)}.`,
    feasible,
  ].join('\n');
}

function renderStructuredCommitment(parsed, row) {
  if (!parsed || typeof parsed !== 'object') return '';
  const commitmentType = String(parsed.commitment_type ?? row.commitment_type ?? '').toLowerCase();
  const selectedOption = sentenceCase(parsed.selected_option ?? '');
  const hardConstraints = summarizeList(parsed.hard_constraints_used, 'the confirmed hard boundaries');
  const evidence = summarizeList(parsed.evidence_witness_ids, 'the selected evidence');
  const coverage = summarizeList(parsed.covered_requirements, 'the required details');
  const debt = summarizeList(parsed.consequence_obligations, 'the downstream obligations');
  const reason = sentenceCase(parsed.repair_or_abstain_reason ?? '');

  if (commitmentType.includes('repair') || commitmentType.includes('abstain') || commitmentType.includes('recontract')) {
    return [
      'The system does not issue a final commitment.',
      reason ? `Reason: ${reason}.` : 'Reason: the current evidence or constraints require repair, abstention, clarification, or recontract.',
      `It preserves ${hardConstraints} and keeps ${debt} visible for follow-up.`,
    ].join(' ');
  }

  if (selectedOption || hardConstraints || evidence || coverage || debt) {
    return [
      selectedOption ? `The system selects: ${selectedOption}.` : 'The system emits a structured commitment.',
      `It preserves ${hardConstraints}.`,
      `It uses ${evidence}.`,
      `It covers ${coverage}.`,
      `It carries forward ${debt}.`,
    ].join(' ');
  }

  return '';
}

function resolveAuditOutput(row) {
  const direct = String(row.output_text ?? row.raw_excerpt ?? '').trim();
  if (direct) return { text: direct, source: row.output_text ? 'output_text' : 'raw_excerpt' };

  const parsed = parseJsonMaybe(row.parsed_output);
  if (parsed && typeof parsed === 'object') {
    for (const key of ['output_text', 'text', 'final_text', 'response', 'message']) {
      const value = String(parsed[key] ?? '').trim();
      if (value) return { text: value, source: `parsed_output.${key}` };
    }
    const rendered = renderStructuredCommitment(parsed, row).trim();
    if (rendered) return { text: rendered, source: 'deterministic_structured_renderer' };
  }

  return { text: '', source: 'empty' };
}

function chooseSpreadIndices(length, count) {
  if (count <= 0) return [];
  if (length <= count) return Array.from({ length }, (_, index) => index);
  if (count === 1) return [Math.floor(length / 2)];
  const indices = [];
  for (let index = 0; index < count; index += 1) {
    indices.push(Math.floor((index * (length - 1)) / (count - 1)));
  }
  return [...new Set(indices)];
}

function loadProfile(profilePath) {
  if (!profilePath) return null;
  const text = fs.readFileSync(profilePath, 'utf8');
  return JSON.parse(text);
}

function publicPath(filePath) {
  if (!filePath) return null;
  const relative = path.relative(process.cwd(), filePath);
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? '<external>'
    : relative.split(path.sep).join('/');
}

const fixturesPath = path.resolve(readArg('fixtures', 'data/fixtures/cbea-lcv.expanded360.synthetic.json'));
const resultsPath = path.resolve(readArg('results', 'data/results/real-pilot-results.csv'));
const outDir = path.resolve(readArg('out', 'data/model_judge/balanced-90'));
const casesPerGroup = Number.parseInt(readArg('cases-per-group', '3'), 10);
const profilePath = readArg('profile', '');
const profile = loadProfile(profilePath);

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const results = parseCsv(fs.readFileSync(resultsPath, 'utf8'));
const resultByFixtureAndBaseline = new Map(
  results.map((row) => [`${row.fixture_id}::${row.baseline_id}`, row]),
);

const groupMap = new Map();
for (const fixture of fixtures) {
  const surface = Array.isArray(fixture.failure_surface) ? fixture.failure_surface.join('+') : String(fixture.failure_surface || 'unknown');
  const groupId = `${fixture.scenario_focus}::${surface}`;
  if (!groupMap.has(groupId)) groupMap.set(groupId, []);
  groupMap.get(groupId).push(fixture);
}
for (const fixturesInGroup of groupMap.values()) {
  fixturesInGroup.sort((left, right) => left.fixture_id.localeCompare(right.fixture_id));
}

const groupEntries = [...groupMap.entries()].sort(([left], [right]) => left.localeCompare(right));
const quotas = new Map();

if (profile?.groupQuotas && typeof profile.groupQuotas === 'object') {
  for (const [groupId, quota] of Object.entries(profile.groupQuotas)) {
    const parsed = Number.parseInt(String(quota), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      quotas.set(groupId, parsed);
    }
  }
} else {
  for (const [groupId] of groupEntries) {
    quotas.set(groupId, casesPerGroup);
  }
}

const selectedFixtures = [];
for (const [groupId, fixturesInGroup] of groupEntries) {
  const quota = quotas.get(groupId) ?? 0;
  const picks = chooseSpreadIndices(fixturesInGroup.length, quota);
  for (const index of picks) {
    selectedFixtures.push({
      ...fixturesInGroup[index],
      group_id: groupId,
    });
  }
}

selectedFixtures.sort((left, right) => {
  const leftKey = `${left.scenario_focus}::${left.group_id}::${left.fixture_id}`;
  const rightKey = `${right.scenario_focus}::${right.group_id}::${right.fixture_id}`;
  return leftKey.localeCompare(rightKey);
});

const permutations = [
  ['raw_prompt_stuffing', 'validator_only', 'cbea_lcv_runtime'],
  ['raw_prompt_stuffing', 'cbea_lcv_runtime', 'validator_only'],
  ['cbea_lcv_runtime', 'raw_prompt_stuffing', 'validator_only'],
  ['cbea_lcv_runtime', 'validator_only', 'raw_prompt_stuffing'],
  ['validator_only', 'raw_prompt_stuffing', 'cbea_lcv_runtime'],
  ['validator_only', 'cbea_lcv_runtime', 'raw_prompt_stuffing'],
];

const keyRows = [];
const itemRows = [];
selectedFixtures.forEach((fixture, index) => {
  const caseId = `C${String(index + 1).padStart(3, '0')}`;
  const permutation = permutations[index % permutations.length];
  const labels = ['A', 'B', 'C'];
  const brief = Array.isArray(fixture.noisy_user_observations)
    ? fixture.noisy_user_observations.map(sanitizeObservation).filter(Boolean).join(' ')
    : sanitizeObservation(fixture.noisy_user_observations);
  const runtimeControlReference = buildRuntimeControlReference(fixture);

  permutation.forEach((baselineId, position) => {
    const row = resultByFixtureAndBaseline.get(`${fixture.fixture_id}::${baselineId}`);
    if (!row) {
      throw new Error(`Missing result row for ${fixture.fixture_id}::${baselineId}`);
    }
    const systemLabel = `System ${labels[position]}`;
    keyRows.push({
      annotation_id: `${caseId}-${labels[position]}`,
      case_id: caseId,
      fixture_id: fixture.fixture_id,
      system_label: systemLabel,
      baseline_id: baselineId,
    });
    const auditOutput = resolveAuditOutput(row);
    itemRows.push({
      annotation_id: `${caseId}-${labels[position]}`,
      case_id: caseId,
      system_label: systemLabel,
      scenario_focus: fixture.scenario_focus,
      stress_surfaces: stableStringify(fixture.failure_surface),
      case_brief: brief,
      runtime_control_reference: runtimeControlReference,
      output_text: auditOutput.text,
      output_source: auditOutput.source,
    });
  });
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'annotation-key.csv'), toCsv(keyRows, ['annotation_id', 'case_id', 'fixture_id', 'system_label', 'baseline_id']));
fs.writeFileSync(path.join(outDir, 'annotation-items.csv'), toCsv(itemRows, ['annotation_id', 'case_id', 'system_label', 'scenario_focus', 'stress_surfaces', 'case_brief', 'runtime_control_reference', 'output_text', 'output_source']));
fs.writeFileSync(path.join(outDir, 'selection-manifest.json'), `${JSON.stringify({
  fixtures_path: publicPath(fixturesPath),
  results_path: publicPath(resultsPath),
  profile_source: profilePath ? publicPath(path.resolve(profilePath)) : null,
  group_count: groupEntries.length,
  selected_cases: selectedFixtures.length,
  cases_per_group: profile?.groupQuotas ? null : casesPerGroup,
  reference_mode: 'plain_english_runtime_control_reference',
  output_text_policy: 'direct output_text, parsed output_text/text fields, then deterministic structured renderer fallback',
  permutations,
  manifest_version: 1,
}, null, 2)}\n`);

console.log(JSON.stringify({
  out_dir: outDir,
  selected_cases: selectedFixtures.length,
  annotation_rows: itemRows.length,
  groups: groupEntries.length,
  files: ['annotation-key.csv', 'annotation-items.csv', 'selection-manifest.json'],
}, null, 2));
