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

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const headers = ['statistic', 'observed', 'ci_low', 'ci_high', 'iterations', 'case_count', 'selection_count'];
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const rank = (sorted.length - 1) * p;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

function summarize(selections, statistics) {
  const denominator = selections.length || 1;
  const counts = new Map();
  for (const winner of selections) counts.set(winner, (counts.get(winner) ?? 0) + 1);
  const rate = (name) => (counts.get(name) ?? 0) / denominator;
  return Object.fromEntries(statistics.map((statistic) => {
    if (statistic.includes('_minus_')) {
      const [left, right] = statistic.split('_minus_');
      return [statistic, rate(left) - rate(right)];
    }
    return [statistic, rate(statistic)];
  }));
}

const pairwisePath = path.resolve(readArg('pairwise', 'data/model_judge/combined-pairwise.csv'));
const keyPath = path.resolve(readArg('key', 'data/model_judge/annotation-key.csv'));
const outPath = path.resolve(readArg('out', 'runs/judge-winner-bootstrap.csv'));
const iterations = Number.parseInt(readArg('iterations', '10000'), 10);
const seed = Number.parseInt(readArg('seed', '20260513'), 10);
const random = mulberry32(seed);

const pairwiseRows = parseCsv(fs.readFileSync(pairwisePath, 'utf8'));
const keyRows = parseCsv(fs.readFileSync(keyPath, 'utf8'));
const baselineByCaseAndSystem = new Map(keyRows.map((row) => [`${row.case_id}::${row.system_label}`, row.baseline_id]));
const baselineSet = new Set(keyRows.map((row) => row.baseline_id).filter(Boolean));

const caseBuckets = new Map();
const selections = [];
for (const row of pairwiseRows) {
  const label = row.best_system_label;
  const winner = label === 'tie' || label === 'none'
    ? label
    : (baselineByCaseAndSystem.get(`${row.case_id}::${label}`) ?? 'unknown');
  selections.push({ case_id: row.case_id, winner });
  const bucket = caseBuckets.get(row.case_id) ?? [];
  bucket.push(winner);
  caseBuckets.set(row.case_id, bucket);
}

const caseIds = [...caseBuckets.keys()].sort();
const statistics = [
  ...[...baselineSet].sort(),
  'tie',
  'cbea_lcv_runtime_minus_raw_prompt_stuffing',
].filter((value, index, values) => values.indexOf(value) === index);
const observed = summarize(selections.map((row) => row.winner), statistics);
const samplesByStatistic = new Map(statistics.map((statistic) => [statistic, []]));

for (let iteration = 0; iteration < iterations; iteration += 1) {
  const sampledWinners = [];
  for (let index = 0; index < caseIds.length; index += 1) {
    const caseId = caseIds[Math.floor(random() * caseIds.length)];
    sampledWinners.push(...caseBuckets.get(caseId));
  }
  const sample = summarize(sampledWinners, statistics);
  for (const statistic of statistics) samplesByStatistic.get(statistic).push(sample[statistic]);
}

const rows = statistics.map((statistic) => {
  const values = samplesByStatistic.get(statistic);
  const publicName = statistic === 'cbea_lcv_runtime_minus_raw_prompt_stuffing'
    ? 'cbea_minus_raw'
    : statistic;
  return {
    statistic: publicName,
    observed: observed[statistic].toFixed(4),
    ci_low: percentile(values, 0.025).toFixed(4),
    ci_high: percentile(values, 0.975).toFixed(4),
    iterations,
    case_count: caseIds.length,
    selection_count: selections.length,
  };
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, toCsv(rows));
console.log(JSON.stringify({ out: outPath, case_count: caseIds.length, selection_count: selections.length, iterations }, null, 2));
