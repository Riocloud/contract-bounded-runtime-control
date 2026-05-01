import fs from 'node:fs';
import path from 'node:path';

const DIMENSIONS = [
  'constraint_fidelity',
  'evidence_coverage',
  'consequence_continuity',
  'no_feasible_handling',
  'appropriate_personalization',
  'surface_coherence',
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
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...dataRows] = rows.filter((items) => items.some((item) => item.length > 0));
  if (!headers) return [];
  return dataRows.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ''])));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toCsv(rows, headers) {
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? '')).join(',')),
  ].join('\n') + '\n';
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const labelsPath = path.resolve(readArg('labels'));
const keyPath = path.resolve(readArg('key', 'data/model_judge/annotation-key.csv'));
const pairwisePath = path.resolve(readArg('pairwise', ''));
const outDir = path.resolve(readArg('out', 'runs/llm-judge-summary'));

if (!labelsPath || !fs.existsSync(labelsPath)) {
  console.error('Missing --labels path.');
  process.exit(2);
}

const labels = parseCsv(fs.readFileSync(labelsPath, 'utf8'));
const keyRows = parseCsv(fs.readFileSync(keyPath, 'utf8'));
const keyByAnnotation = new Map(keyRows.map((row) => [row.annotation_id, row]));
const baselineByCaseAndSystem = new Map(keyRows.map((row) => [`${row.case_id}::${row.system_label}`, row.baseline_id]));

const bySystem = new Map();
for (const label of labels) {
  const key = keyByAnnotation.get(label.annotation_id);
  if (!key) continue;
  const bucket = bySystem.get(key.baseline_id) ?? [];
  bucket.push(label);
  bySystem.set(key.baseline_id, bucket);
}

const summaryRows = [...bySystem.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([baselineId, rows]) => {
    const dimensionMeans = Object.fromEntries(
      DIMENSIONS.map((dimension) => [
        dimension,
        mean(rows.map((row) => Number.parseFloat(row[dimension] || '0'))).toFixed(4),
      ]),
    );
    const overallMean = mean(DIMENSIONS.map((dimension) => Number.parseFloat(dimensionMeans[dimension]))).toFixed(4);
    return {
      system: baselineId,
      n_outputs: rows.length,
      ...dimensionMeans,
      overall_mean: overallMean,
    };
  });

let pairwiseRows = [];
let pairwiseSummaryRows = [];
if (pairwisePath && fs.existsSync(pairwisePath)) {
  pairwiseRows = parseCsv(fs.readFileSync(pairwisePath, 'utf8'));
  const wins = new Map();
  let validChoices = 0;
  for (const row of pairwiseRows) {
    const label = row.best_system_label;
    if (label === 'tie' || label === 'none') {
      wins.set(label, (wins.get(label) ?? 0) + 1);
      validChoices += 1;
      continue;
    }
    const baseline = baselineByCaseAndSystem.get(`${row.case_id}::${label}`) ?? 'unknown';
    wins.set(baseline, (wins.get(baseline) ?? 0) + 1);
    validChoices += 1;
  }
  pairwiseSummaryRows = [...wins.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([winner, count]) => ({
      winner,
      count,
      win_rate: validChoices ? (count / validChoices).toFixed(4) : '0.0000',
    }));
}

const summary = {
  label_count: labels.length,
  pairwise_count: pairwiseRows.length,
  by_system: summaryRows,
  pairwise: pairwiseSummaryRows,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'llm-fidelity-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'llm-fidelity-summary.csv'), toCsv(summaryRows, ['system', 'n_outputs', ...DIMENSIONS, 'overall_mean']));
fs.writeFileSync(path.join(outDir, 'llm-fidelity-pairwise-summary.csv'), toCsv(pairwiseSummaryRows, ['winner', 'count', 'win_rate']));

console.log(JSON.stringify({
  out_dir: outDir,
  label_count: labels.length,
  pairwise_count: pairwiseRows.length,
  files: [
    'llm-fidelity-summary.json',
    'llm-fidelity-summary.csv',
    'llm-fidelity-pairwise-summary.csv',
  ],
}, null, 2));
