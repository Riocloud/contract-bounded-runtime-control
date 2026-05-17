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

function judgeShortName(annotatorId) {
  const normalized = String(annotatorId || '').toLowerCase();
  if (normalized.includes('deepseek')) return 'DS';
  if (normalized.includes('qwen')) return 'QW';
  return annotatorId;
}

function comparePair(values, comparator) {
  if (values.length !== 2) return null;
  return comparator(Number.parseFloat(values[0]), Number.parseFloat(values[1])) ? 1 : 0;
}

const labelsPath = path.resolve(readArg('labels'));
const keyPath = path.resolve(readArg('key', 'data/model_judge/annotation-key.csv'));
const winnerSelectionPath = path.resolve(readArg('winner-selection', readArg('pairwise', '')));
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

const byJudgeAndSystem = new Map();
for (const label of labels) {
  const key = keyByAnnotation.get(label.annotation_id);
  if (!key) continue;
  const groupKey = `${label.annotator_id}::${key.baseline_id}`;
  const bucket = byJudgeAndSystem.get(groupKey) ?? [];
  bucket.push(label);
  byJudgeAndSystem.set(groupKey, bucket);
}

const perJudgeRows = [...byJudgeAndSystem.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([groupKey, rows]) => {
    const [annotatorId, baselineId] = groupKey.split('::');
    const dimensionMeans = Object.fromEntries(
      DIMENSIONS.map((dimension) => [
        dimension,
        mean(rows.map((row) => Number.parseFloat(row[dimension] || '0'))).toFixed(4),
      ]),
    );
    const overallMean = mean(DIMENSIONS.map((dimension) => Number.parseFloat(dimensionMeans[dimension]))).toFixed(4);
    return {
      judge: judgeShortName(annotatorId),
      annotator_id: annotatorId,
      system: baselineId,
      n_outputs: rows.length,
      overall_mean: overallMean,
      ...dimensionMeans,
    };
  });

const labelsByAnnotation = new Map();
for (const label of labels) {
  const bucket = labelsByAnnotation.get(label.annotation_id) ?? [];
  bucket.push(label);
  labelsByAnnotation.set(label.annotation_id, bucket);
}

const agreementRows = DIMENSIONS.map((dimension) => {
  const exact = [];
  const withinOne = [];
  for (const rows of labelsByAnnotation.values()) {
    const values = rows.map((row) => row[dimension]);
    const exactMatch = comparePair(values, (left, right) => left === right);
    const withinOneMatch = comparePair(values, (left, right) => Math.abs(left - right) <= 1);
    if (exactMatch !== null) exact.push(exactMatch);
    if (withinOneMatch !== null) withinOne.push(withinOneMatch);
  }
  return {
    dimension,
    n: exact.length,
    exact_agreement_rate: mean(exact).toFixed(4),
    within_1_agreement_rate: mean(withinOne).toFixed(4),
  };
});

const allExact = [];
const allWithinOne = [];
for (const rows of labelsByAnnotation.values()) {
  for (const dimension of DIMENSIONS) {
    const values = rows.map((row) => row[dimension]);
    const exactMatch = comparePair(values, (left, right) => left === right);
    const withinOneMatch = comparePair(values, (left, right) => Math.abs(left - right) <= 1);
    if (exactMatch !== null) allExact.push(exactMatch);
    if (withinOneMatch !== null) allWithinOne.push(withinOneMatch);
  }
}
agreementRows.push({
  dimension: 'all_dimension_labels',
  n: allExact.length,
  exact_agreement_rate: mean(allExact).toFixed(4),
  within_1_agreement_rate: mean(allWithinOne).toFixed(4),
});

let winnerSelectionRows = [];
let winnerSelectionSummaryRows = [];
let winnerAgreementRow = null;
if (winnerSelectionPath && fs.existsSync(winnerSelectionPath)) {
  winnerSelectionRows = parseCsv(fs.readFileSync(winnerSelectionPath, 'utf8'));
  const wins = new Map();
  let validChoices = 0;
  for (const row of winnerSelectionRows) {
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
  winnerSelectionSummaryRows = [...wins.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([winner, count]) => ({
      winner,
      count,
      win_rate: validChoices ? (count / validChoices).toFixed(4) : '0.0000',
    }));

  const winnerByCase = new Map();
  for (const row of winnerSelectionRows) {
    const bucket = winnerByCase.get(row.case_id) ?? [];
    bucket.push(row.best_system_label);
    winnerByCase.set(row.case_id, bucket);
  }
  const exactWinnerMatches = [];
  for (const labelsForCase of winnerByCase.values()) {
    if (labelsForCase.length !== 2) continue;
    exactWinnerMatches.push(labelsForCase[0] === labelsForCase[1] ? 1 : 0);
  }
  winnerAgreementRow = {
    dimension: 'case_level_winner',
    n: exactWinnerMatches.length,
    exact_agreement_rate: mean(exactWinnerMatches).toFixed(4),
    within_1_agreement_rate: '',
  };
  agreementRows.push(winnerAgreementRow);
}

const summary = {
  label_count: labels.length,
  winner_selection_count: winnerSelectionRows.length,
  by_system: summaryRows,
  by_judge_and_system: perJudgeRows,
  agreement: agreementRows,
  winner_selection: winnerSelectionSummaryRows,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'llm-fidelity-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'llm-fidelity-summary.csv'), toCsv(summaryRows, ['system', 'n_outputs', ...DIMENSIONS, 'overall_mean']));
fs.writeFileSync(path.join(outDir, 'llm-fidelity-per-judge-summary.csv'), toCsv(perJudgeRows, ['judge', 'annotator_id', 'system', 'n_outputs', 'overall_mean', ...DIMENSIONS]));
fs.writeFileSync(path.join(outDir, 'llm-fidelity-agreement.csv'), toCsv(agreementRows, ['dimension', 'n', 'exact_agreement_rate', 'within_1_agreement_rate']));
fs.writeFileSync(path.join(outDir, 'llm-fidelity-winner-selection-summary.csv'), toCsv(winnerSelectionSummaryRows, ['winner', 'count', 'win_rate']));

console.log(JSON.stringify({
  out_dir: outDir,
  label_count: labels.length,
  winner_selection_count: winnerSelectionRows.length,
  files: [
    'llm-fidelity-summary.json',
    'llm-fidelity-summary.csv',
    'llm-fidelity-per-judge-summary.csv',
    'llm-fidelity-agreement.csv',
    'llm-fidelity-winner-selection-summary.csv',
  ],
}, null, 2));
