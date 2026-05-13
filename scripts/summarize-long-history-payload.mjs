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

function writeCsv(filePath, rows, headers) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`);
}

function number(value) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values) {
  const xs = values.filter((value) => Number.isFinite(value));
  return xs.reduce((sum, value) => sum + value, 0) / xs.length;
}

function lowerMedian(values) {
  const xs = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (xs.length === 0) return '';
  return xs[Math.floor((xs.length - 1) / 2)];
}

function centeredMedian(values) {
  const xs = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (xs.length === 0) return '';
  const middle = (xs.length - 1) / 2;
  const lower = Math.floor(middle);
  const upper = Math.ceil(middle);
  return Math.round((xs[lower] + xs[upper]) / 2);
}

function centeredMedianRaw(values) {
  const xs = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (xs.length === 0) return null;
  const middle = (xs.length - 1) / 2;
  const lower = Math.floor(middle);
  const upper = Math.ceil(middle);
  return (xs[lower] + xs[upper]) / 2;
}

function seconds(value) {
  return (value / 1000).toFixed(2);
}

function pairedRows(rows, endpoint) {
  const byFixture = new Map();
  for (const row of rows.filter((item) => item.endpoint === endpoint && item.status === 'ok')) {
    const bucket = byFixture.get(row.fixture_id) ?? {};
    bucket[row.method] = row;
    byFixture.set(row.fixture_id, bucket);
  }
  return [...byFixture.entries()].flatMap(([fixtureId, bucket]) => {
    const raw = bucket.raw_prompt_stuffing;
    const cbea = bucket.cbea_lcv_runtime;
    if (!raw || !cbea) return [];
    return [{
      fixture_id: fixtureId,
      delta_input_tokens_raw_minus_cbea: number(raw.input_tokens) - number(cbea.input_tokens),
      delta_latency_ms_raw_minus_cbea: number(raw.latency_ms) - number(cbea.latency_ms),
    }];
  });
}

const inputPath = path.resolve(readArg('input', 'data/results/long-history-payload-results.csv'));
const outPath = path.resolve(readArg('out', 'runs/long-history-payload-summary.csv'));
const rows = parseCsv(fs.readFileSync(inputPath, 'utf8'));
const endpoints = ['MiniMax', 'DeepSeek', 'Qwen'];

const summary = endpoints.map((endpoint) => {
  const rawRows = rows.filter((row) => row.endpoint === endpoint && row.method === 'raw_prompt_stuffing' && row.status === 'ok');
  const cbeaRows = rows.filter((row) => row.endpoint === endpoint && row.method === 'cbea_lcv_runtime' && row.status === 'ok');
  const pairs = pairedRows(rows, endpoint);
  const latencyDeltas = pairs.map((row) => number(row.delta_latency_ms_raw_minus_cbea));
  const latencyMeanMs = mean(latencyDeltas);
  const latencyP50Ms = centeredMedianRaw(latencyDeltas);
  return {
    endpoint,
    n_pairs: pairs.length,
    raw_input_p50: lowerMedian(rawRows.map((row) => number(row.input_tokens))),
    cbea_input_p50: lowerMedian(cbeaRows.map((row) => number(row.input_tokens))),
    delta_input_p50: lowerMedian(pairs.map((row) => number(row.delta_input_tokens_raw_minus_cbea))),
    raw_output_p50: lowerMedian(rawRows.map((row) => number(row.output_tokens))),
    cbea_output_p50: lowerMedian(cbeaRows.map((row) => number(row.output_tokens))),
    delta_latency_mean_ms: Math.round(latencyMeanMs),
    delta_latency_p50_ms: centeredMedian(latencyDeltas),
    delta_latency_mean_s: seconds(latencyMeanMs),
    delta_latency_p50_s: seconds(latencyP50Ms),
  };
});

writeCsv(outPath, summary, [
  'endpoint',
  'n_pairs',
  'raw_input_p50',
  'cbea_input_p50',
  'delta_input_p50',
  'raw_output_p50',
  'cbea_output_p50',
  'delta_latency_mean_ms',
  'delta_latency_p50_ms',
  'delta_latency_mean_s',
  'delta_latency_p50_s',
]);

console.log(JSON.stringify({ out: outPath, rows: summary.length }, null, 2));
