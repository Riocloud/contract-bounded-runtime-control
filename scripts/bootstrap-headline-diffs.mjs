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
  if (field.length > 0 || row.length > 0) row.push(field);
  if (row.length > 0) rows.push(row);
  const [headers, ...dataRows] = rows.filter((items) => items.some(Boolean));
  return dataRows.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ''])));
}

function bool(value) {
  return String(value).toLowerCase() === 'true';
}

function numeric(value) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[index];
}

function toCsv(rows) {
  const headers = ['surface', 'diff', 'ci_low', 'ci_high'];
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => row[header]).join(',')).join('\n')}\n`;
}

const inputPath = path.resolve(readArg('input', 'data/results/real-pilot-results.csv'));
const outPath = path.resolve(readArg('out', 'runs/bootstrap-headline-diffs.csv'));
const iterations = Number.parseInt(readArg('iterations', '10000'), 10);
const random = mulberry32(Number.parseInt(readArg('seed', '20260430'), 10));
const rows = parseCsv(fs.readFileSync(inputPath, 'utf8'));

const byFixture = new Map();
for (const row of rows) {
  if (!byFixture.has(row.fixture_id)) byFixture.set(row.fixture_id, new Map());
  byFixture.get(row.fixture_id).set(row.baseline_id, row);
}

const pairs = [...byFixture.values()]
  .map((bucket) => ({
    raw: bucket.get('raw_prompt_stuffing'),
    cbea: bucket.get('cbea_lcv_runtime'),
  }))
  .filter((pair) => pair.raw && pair.cbea);

const surfaces = [
  {
    surface: 'Structured availability',
    value: (row) => (bool(row.structured_commitment_available) ? 1 : 0),
  },
  {
    surface: 'Parse retries per fixture',
    value: (row) => numeric(row.parse_retry_count),
  },
  {
    surface: 'All-row repair correctness',
    value: (row) => (bool(row.repair_correct) ? 1 : 0),
  },
  {
    surface: 'Latency, ms',
    value: (row) => numeric(row.latency_ms),
  },
];

const summary = surfaces.map((surface) => {
  const deltas = pairs.map((pair) => surface.value(pair.cbea) - surface.value(pair.raw));
  const observed = mean(deltas);
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const sample = [];
    for (let j = 0; j < deltas.length; j += 1) {
      sample.push(deltas[Math.floor(random() * deltas.length)]);
    }
    samples.push(mean(sample));
  }
  return {
    surface: surface.surface,
    diff: observed.toFixed(surface.surface === 'Latency, ms' ? 0 : 4),
    ci_low: percentile(samples, 0.025).toFixed(surface.surface === 'Latency, ms' ? 0 : 4),
    ci_high: percentile(samples, 0.975).toFixed(surface.surface === 'Latency, ms' ? 0 : 4),
  };
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, toCsv(summary));
console.log(JSON.stringify({ out: outPath, pairs: pairs.length, iterations }, null, 2));
