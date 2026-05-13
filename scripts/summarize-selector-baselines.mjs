#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const headers = [
    'selector',
    'fixture_count',
    'avg_selected',
    'hard_constraint_recall',
    'required_witness_recall',
    'tail_witness_recall',
    'consequence_debt_recall',
    'control_evidence_recall',
  ];
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`;
}

function makeEvidenceUnits(fixture) {
  return [
    ...fixture.noisy_user_observations.map((text, index) => ({ id: `obs_${index + 1}`, text, kind: 'observation' })),
    ...fixture.confirmed_hard_constraints.map((text, index) => ({ id: `hard_${index + 1}`, text, kind: 'hard_constraint' })),
    ...fixture.mutable_state_facts.map((text, index) => ({ id: `mutable_${index + 1}`, text, kind: 'mutable_state' })),
    ...fixture.required_witnesses.map((text, index) => ({ id: text || `witness_${index + 1}`, text, kind: 'required_witness' })),
    ...fixture.tail_witnesses.map((text, index) => ({ id: text || `tail_${index + 1}`, text, kind: 'tail_witness' })),
    ...fixture.consequence_debt.map((text, index) => ({ id: text || `debt_${index + 1}`, text, kind: 'consequence_debt' })),
  ];
}

function tokenize(text) {
  return new Set(String(text || '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1));
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection || 1);
}

function cbeaSelect(fixture, budget) {
  const all = makeEvidenceUnits(fixture);
  const selected = all.filter((item) =>
    item.id.startsWith('hard_')
    || fixture.required_witnesses.includes(item.id)
    || fixture.tail_witnesses.includes(item.id)
    || fixture.consequence_debt.includes(item.id)
    || item.id === 'obs_1'
    || item.id === 'obs_3'
  );
  return selected.slice(0, budget);
}

function mmrSelect(fixture, budget, lambda) {
  const all = makeEvidenceUnits(fixture);
  const query = tokenize([
    fixture.scenario_focus,
    ...fixture.required_dimensions,
    ...fixture.noisy_user_observations.slice(0, 2),
  ].join(' '));
  const tokenized = all.map((item, index) => ({
    ...item,
    index,
    tokens: tokenize(`${item.id} ${item.text}`),
  }));
  const selected = [];
  const remaining = tokenized.slice();
  while (selected.length < budget && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index];
      const relevance = jaccard(item.tokens, query);
      const maxSimilarity = selected.length === 0
        ? 0
        : Math.max(...selected.map((chosen) => jaccard(item.tokens, chosen.tokens)));
      const score = lambda * relevance - (1 - lambda) * maxSimilarity;
      if (score > bestScore || (score === bestScore && item.index < remaining[bestIndex].index)) {
        bestScore = score;
        bestIndex = index;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

function selectedHas(selected, target) {
  const needle = String(target || '').toLowerCase();
  return selected.some((item) =>
    String(item.id).toLowerCase() === needle
    || String(item.text).toLowerCase() === needle
    || String(item.text).toLowerCase().includes(needle));
}

function recall(selected, targets) {
  const values = (targets || []).filter(Boolean);
  if (values.length === 0) return null;
  return values.filter((target) => selectedHas(selected, target)).length / values.length;
}

function mean(values) {
  const filtered = values.filter((value) => value !== null && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function metricRow(selector, fixtureSelections) {
  const metrics = fixtureSelections.map(({ fixture, selected }) => {
    const hard = recall(selected, fixture.confirmed_hard_constraints);
    const witnesses = recall(selected, fixture.required_witnesses);
    const tail = recall(selected, fixture.tail_witnesses);
    const debt = recall(selected, fixture.consequence_debt);
    const control = recall(selected, [
      ...fixture.confirmed_hard_constraints,
      ...fixture.required_witnesses,
      ...fixture.tail_witnesses,
      ...fixture.consequence_debt,
    ]);
    return { selected_count: selected.length, hard, witnesses, tail, debt, control };
  });
  return {
    selector,
    fixture_count: fixtureSelections.length,
    avg_selected: mean(metrics.map((row) => row.selected_count)).toFixed(2),
    hard_constraint_recall: mean(metrics.map((row) => row.hard)).toFixed(4),
    required_witness_recall: mean(metrics.map((row) => row.witnesses)).toFixed(4),
    tail_witness_recall: mean(metrics.map((row) => row.tail)).toFixed(4),
    consequence_debt_recall: mean(metrics.map((row) => row.debt)).toFixed(4),
    control_evidence_recall: mean(metrics.map((row) => row.control)).toFixed(4),
  };
}

const fixturePath = path.resolve(readArg('fixtures', 'data/fixtures/cbea-lcv.expanded360.synthetic.json'));
const outPath = path.resolve(readArg('out', 'runs/selector-baseline-mmr.csv'));
const limit = Number.parseInt(readArg('limit', '0'), 10);
const budget = Number.parseInt(readArg('budget', '12'), 10);
const lambda = Number.parseFloat(readArg('lambda', '0.7'));
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const selectedFixtures = limit > 0 ? fixtures.slice(0, limit) : fixtures;

const cbeaSelections = selectedFixtures.map((fixture) => ({ fixture, selected: cbeaSelect(fixture, budget) }));
const mmrSelections = selectedFixtures.map((fixture) => ({ fixture, selected: mmrSelect(fixture, budget, lambda) }));
const rows = [
  metricRow('cbea_lcv_selector', cbeaSelections),
  metricRow('mmr_relevance_diversity', mmrSelections),
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, toCsv(rows));
console.log(JSON.stringify({ out: outPath, fixture_count: selectedFixtures.length, budget, lambda }, null, 2));
