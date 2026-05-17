#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  items: 'data/model_judge/balanced-90/annotation-items.csv',
  key: 'data/model_judge/balanced-90/annotation-key.csv',
  labels: 'data/model_judge/combined-labels.csv',
  pairwise: 'data/model_judge/combined-pairwise.csv',
  results: 'data/results/real-pilot-results.csv',
  out: 'runs/model-output-evidence.csv',
};

const DIMENSIONS = [
  'constraint_fidelity',
  'evidence_coverage',
  'consequence_continuity',
  'no_feasible_handling',
  'appropriate_personalization',
  'surface_coherence',
];

const AUTO_FIELDS = [
  'structured_commitment_available',
  'commitment_type',
  'hard_constraint_violation',
  'evidence_coverage_failure',
  'witness_drop',
  'consequence_continuity_failure',
  'no_feasible_emission',
  'repair_correct',
  'inappropriate_personalization',
  'surface_realization_failure',
];

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const item of argv) {
    if (!item.startsWith('--')) throw new Error(`Unexpected argument: ${item}`);
    const [key, value] = item.slice(2).split('=');
    if (!Object.hasOwn(args, key)) throw new Error(`Unknown option: --${key}`);
    if (!value) throw new Error(`Missing value for --${key}`);
    args[key] = value;
  }
  return args;
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
  const [headers, ...dataRows] = rows.filter((items) => items.some(Boolean));
  if (!headers) return [];
  return dataRows.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ''])));
}

function readCsv(relativePath) {
  return parseCsv(fs.readFileSync(path.resolve(relativePath), 'utf8'));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function writeCsv(filePath, rows, headers) {
  const text = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(path.resolve(filePath), `${text}\n`);
}

function byKey(rows, fields) {
  return new Map(rows.map((row) => [fields.map((field) => row[field]).join('::'), row]));
}

function groupBy(rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

function formatMean(rows, field) {
  if (rows.length === 0) return '';
  const values = rows.map((row) => Number(row[field])).filter((value) => Number.isFinite(value));
  if (values.length !== rows.length) throw new Error(`Non-numeric judge score for ${field}`);
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4);
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/MiniMax-M2\.7-[A-Za-z0-9_-]+/g, 'MiniMax-M2.7')
    .replace(/https?:\/\/[^\s",)]+/gi, '[URL]')
    .replace(/\/Users\/[^\s",)]+/g, '[LOCAL_PATH]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');
}

const args = parseArgs(process.argv.slice(2));
const items = readCsv(args.items);
const keyRows = readCsv(args.key);
const labelRows = readCsv(args.labels);
const pairwiseRows = readCsv(args.pairwise);
const resultRows = readCsv(args.results);

const itemById = byKey(items, ['annotation_id']);
const keyById = byKey(keyRows, ['annotation_id']);
const labelsById = groupBy(labelRows, (row) => row.annotation_id);
const resultsByFixtureBaseline = byKey(resultRows, ['fixture_id', 'baseline_id']);
const pairwiseByCaseSystem = groupBy(pairwiseRows, (row) => `${row.case_id}::${row.best_system_label}`);

if (items.length !== 270) throw new Error(`Expected 270 model-output evidence items, got ${items.length}`);
if (keyRows.length !== 270) throw new Error(`Expected 270 annotation-key rows, got ${keyRows.length}`);

const rows = [];
for (const item of items) {
  const key = keyById.get(item.annotation_id);
  if (!key) throw new Error(`Missing annotation key for ${item.annotation_id}`);
  const keyItem = itemById.get(item.annotation_id);
  if (!keyItem) throw new Error(`Missing annotation item for ${item.annotation_id}`);
  const labels = labelsById.get(item.annotation_id) ?? [];
  if (labels.length !== 2) throw new Error(`Expected 2 judge labels for ${item.annotation_id}, got ${labels.length}`);
  const result = resultsByFixtureBaseline.get(`${key.fixture_id}::${key.baseline_id}`);
  if (!result) throw new Error(`Missing automatic result row for ${key.fixture_id}::${key.baseline_id}`);
  const outputText = sanitizeText(item.output_text);
  if (!outputText.trim()) throw new Error(`Missing output_text for ${item.annotation_id}`);

  const row = {
    evidence_scope: 'model_judge_balanced90',
    annotation_id: item.annotation_id,
    case_id: item.case_id,
    fixture_id: key.fixture_id,
    baseline_id: key.baseline_id,
    scenario_focus: item.scenario_focus,
    system_label: item.system_label,
    output_source: item.output_source,
    provider: sanitizeText(result.provider),
    model: sanitizeText(result.model),
    judge_score_count: String(labels.length),
    judge_winner_votes: String((pairwiseByCaseSystem.get(`${item.case_id}::${item.system_label}`) ?? []).length),
    output_text: outputText,
  };
  for (const field of AUTO_FIELDS) row[field] = result[field] ?? '';
  for (const dimension of DIMENSIONS) row[`${dimension}_mean`] = formatMean(labels, dimension);
  rows.push(row);
}

const headers = [
  'evidence_scope',
  'annotation_id',
  'case_id',
  'fixture_id',
  'baseline_id',
  'scenario_focus',
  'system_label',
  'output_source',
  'provider',
  'model',
  ...AUTO_FIELDS,
  'judge_score_count',
  'judge_winner_votes',
  ...DIMENSIONS.map((dimension) => `${dimension}_mean`),
  'output_text',
];

writeCsv(args.out, rows, headers);
console.log(JSON.stringify({ model_output_evidence_rows: rows.length, out: args.out }, null, 2));
