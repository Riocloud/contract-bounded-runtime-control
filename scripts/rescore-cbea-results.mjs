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

function bool(value) {
  return String(value).toLowerCase() === 'true';
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll(/follow[\s_-]*up/gu, 'followup')
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function tokens(value) {
  return normalizeText(value).split(/\s+/u).filter(Boolean);
}

function obligationCovered(haystackTokens, debt) {
  return tokens(debt).every((token) => haystackTokens.has(token));
}

function parseOutput(row) {
  if (!row.parsed_output) return {};
  try {
    return JSON.parse(row.parsed_output);
  } catch {
    return {};
  }
}

const fixturesPath = path.resolve(readArg('fixtures', 'data/fixtures/cbea-lcv.expanded360.synthetic.json'));
const inputPath = path.resolve(readArg('input', 'data/results/real-pilot-results.csv'));
const outPath = path.resolve(readArg('out', 'runs/real-pilot-results.rescored.csv'));

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const fixtureById = new Map(fixtures.map((fixture) => [fixture.fixture_id, fixture]));
const { headers, rows } = parseCsv(fs.readFileSync(inputPath, 'utf8'));
const outputHeaders = headers.includes('no_feasible_expected')
  ? headers
  : (headers.includes('repair_expected')
    ? headers.flatMap((header) => header === 'repair_expected' ? [header, 'no_feasible_expected'] : [header])
    : [...headers, 'no_feasible_expected']);

let rescoredRows = 0;
const rescored = rows.map((row) => {
  const fixture = fixtureById.get(row.fixture_id);
  const withNoFeasibleExpected = fixture && !Object.hasOwn(row, 'no_feasible_expected')
    ? { ...row, no_feasible_expected: String(Boolean(fixture.oracle_feasible_set_empty)) }
    : row;
  if (!fixture || !Array.isArray(fixture.consequence_debt) || fixture.consequence_debt.length === 0) {
    return withNoFeasibleExpected;
  }
  if (Object.hasOwn(row, 'structured_commitment_available') && !bool(row.structured_commitment_available)) {
    return { ...withNoFeasibleExpected, consequence_continuity_failure: 'false' };
  }
  const parsed = parseOutput(withNoFeasibleExpected);
  const consequenceText = [
    ...asArray(parsed.consequence_obligations),
    parsed.output_text || '',
    row.output_text || '',
  ].join(' ');
  const haystackTokens = new Set(tokens(consequenceText));
  const missingConsequence = !fixture.consequence_debt.every((debt) => obligationCovered(haystackTokens, debt));
  rescoredRows += 1;
  return {
    ...withNoFeasibleExpected,
    consequence_continuity_failure: String(missingConsequence),
  };
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, toCsv(rescored, outputHeaders));
console.log(JSON.stringify({
  out: outPath,
  input_rows: rows.length,
  rescored_rows: rescoredRows,
}, null, 2));
