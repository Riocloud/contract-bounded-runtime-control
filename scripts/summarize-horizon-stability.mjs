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
  return dataRows.map((items) =>
    Object.fromEntries(headers.map((header, index) => [header, items[index] ?? '']))
  );
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, headers) {
  return `${headers.join(',')}\n${rows
    .map((row) => headers.map((header) => csvEscape(row[header])).join(','))
    .join('\n')}\n`;
}

function bool(value) {
  return String(value).toLowerCase() === 'true';
}

function rate(numerator, denominator) {
  if (denominator <= 0) return '';
  return (numerator / denominator).toFixed(4);
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return '';
  return (valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2);
}

function horizonGroup(fixture) {
  const domainCount = fixture.required_dimensions.length;
  return {
    domainCount,
    group: `${domainCount}-domain`,
  };
}

const fixturesPath = path.resolve(readArg('fixtures', 'data/fixtures/cbea-lcv.expanded90.synthetic.json'));
const inputPath = path.resolve(readArg('input', 'data/results/real-pilot-results.csv'));
const outPath = path.resolve(readArg('out', 'data/results/horizon-stability.csv'));

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const fixtureById = new Map(fixtures.map((fixture) => [fixture.fixture_id, fixture]));
const rows = parseCsv(fs.readFileSync(inputPath, 'utf8'));

const methods = ['raw_prompt_stuffing', 'cbea_lcv_runtime'];
const groups = [2, 3, 4];

const summary = [];
for (const method of methods) {
  for (const domainCount of groups) {
    const groupRows = rows.filter((row) => {
      const fixture = fixtureById.get(row.fixture_id);
      return row.baseline_id === method && fixture && horizonGroup(fixture).domainCount === domainCount;
    });
    const attempted = groupRows.filter((row) => bool(row.attempted));
    const evaluable = attempted.filter((row) => !bool(row.invalid_run));
    const structured = evaluable.filter((row) => bool(row.structured_commitment_available));
    const repairRows = evaluable.filter((row) => bool(row.repair_expected));

    summary.push({
      baseline_id: method,
      horizon_group: `${domainCount}-domain`,
      fixture_count: new Set(groupRows.map((row) => row.fixture_id)).size,
      structured_count: structured.length,
      hard_constraint_violation_rate: rate(
        structured.filter((row) => bool(row.hard_constraint_violation)).length,
        structured.length
      ),
      witness_drop_rate: rate(
        structured.filter((row) => bool(row.witness_drop)).length,
        structured.length
      ),
      consequence_continuity_failure_rate: rate(
        structured.filter((row) => bool(row.consequence_continuity_failure)).length,
        structured.length
      ),
      repair_correctness_rate: rate(
        repairRows.filter((row) => bool(row.repair_correct)).length,
        repairRows.length
      ),
      avg_parse_retries: average(attempted.map((row) => Number.parseFloat(row.parse_retry_count))),
      avg_latency_ms: average(attempted.map((row) => Number.parseFloat(row.latency_ms))),
    });
  }
}

const headers = [
  'baseline_id',
  'horizon_group',
  'fixture_count',
  'structured_count',
  'hard_constraint_violation_rate',
  'witness_drop_rate',
  'consequence_continuity_failure_rate',
  'repair_correctness_rate',
  'avg_parse_retries',
  'avg_latency_ms',
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, toCsv(summary, headers));
console.log(JSON.stringify({ out: outPath, rows: summary.length }, null, 2));
