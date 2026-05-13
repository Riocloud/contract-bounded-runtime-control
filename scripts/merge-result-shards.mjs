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
  const [headers, ...dataRows] = rows.filter((items) => items.some(Boolean));
  return {
    headers,
    rows: dataRows.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? '']))),
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, headers) {
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`;
}

const inputPaths = (readArg('inputs', '') || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => path.resolve(item));
const outPath = path.resolve(readArg('out', 'runs/real-pilot-results.merged.csv'));

if (inputPaths.length === 0) {
  console.error('Missing --inputs comma-separated CSV paths.');
  process.exit(2);
}

let headers = null;
const merged = [];
const seen = new Set();
const duplicates = [];
for (const inputPath of inputPaths) {
  const parsed = parseCsv(fs.readFileSync(inputPath, 'utf8'));
  if (!headers) headers = parsed.headers;
  if (headers.join('\t') !== parsed.headers.join('\t')) {
    throw new Error(`Header mismatch in ${inputPath}`);
  }
  for (const row of parsed.rows) {
    const key = `${row.fixture_id}\t${row.baseline_id}`;
    if (seen.has(key)) {
      duplicates.push(key);
      continue;
    }
    seen.add(key);
    merged.push(row);
  }
}

if (duplicates.length > 0) {
  throw new Error(`Duplicate fixture/method rows: ${duplicates.slice(0, 10).join(', ')}`);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, toCsv(merged, headers));
console.log(JSON.stringify({
  out: outPath,
  input_count: inputPaths.length,
  row_count: merged.length,
}, null, 2));
