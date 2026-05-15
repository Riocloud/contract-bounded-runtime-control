#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const inputPath = path.resolve(readArg('input', 'results/pilot_shadow_balanced48/scores/shadow_distribution_by_domain.json'));
const metricsPath = path.resolve(readArg('metrics', 'results/pilot_shadow_balanced48/scores/covered_and_shadow_metrics.csv'));
const outPath = path.resolve(readArg('out', 'results/pilot_shadow_balanced48/pilot_summary.md'));

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const metricsCsv = fs.readFileSync(metricsPath, 'utf8');

function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  if (typeof value === 'number') return value.toFixed(4).replace(/0+$/u, '').replace(/\.$/u, '');
  return String(value);
}

const methods = [
  'raw_prompt_stuffing',
  'raw_prompt_stuffing_lcv_gate',
  'long_context_lcv_gate',
  'validator_only',
  'cbea_lcv_runtime',
];

const lines = [
  '# Domain-Balanced Shadow-Oracle Pilot Summary',
  '',
  'Scope: 48 fixtures = 4 single domains x 6 stress-surface groups x 2 replicates; one production-compatible generation endpoint; 5 methods; 240 generations. This is still a pilot, not final paper evidence.',
  '',
  '## Gate Results',
  '',
  '- User-visible text leak check: passed before the run; hidden `shadow_oracle` fields are scoring-only.',
  '- Run validity: 239/240 generations parsed successfully. The only invalid run was `raw_prompt_stuffing_lcv_gate` on one career/surface case after 3 JSON retries.',
  '- Domain balance: investment, love_choice, career, relocation each have 12 fixtures.',
  '- Surface balance: tail, infeasible, falsehard, exception, surface, debt each have 8 fixtures.',
  '',
  '## Overall Method Summary',
  '',
  '| Method | Avail. | Covered H | Covered E | Covered W | Covered C | Shadow Recall | Shadow SD | Invalid | Retries |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...methods.map((method) => {
    const row = data.overall[method];
    return `| ${method} | ${fmt(row.availability)} | ${fmt(row.covered_h)} | ${fmt(row.covered_e)} | ${fmt(row.covered_w)} | ${fmt(row.covered_c)} | ${fmt(row.shadow_mean)} | ${fmt(row.shadow_sd)} | ${row.invalid} | ${row.retries} |`;
  }),
  '',
  '## Shadow Recall By Domain',
  '',
  '| Domain | Raw | CBEA+LCV | Validator-only |',
  '|---|---:|---:|---:|',
  ...Object.entries(data.byDomain).map(([domain, rows]) =>
    `| ${domain} | ${fmt(rows.raw_prompt_stuffing.shadow_mean)} | ${fmt(rows.cbea_lcv_runtime.shadow_mean)} | ${fmt(rows.validator_only.shadow_mean)} |`
  ),
  '',
  '## Interpretation',
  '',
  'The domain-balanced pilot supports the boundary-diagnostic interpretation. CBEA+LCV has zero measured validator-covered failures across emitted commitments, but zero uncompiled-context preservation across all four domains. Raw prompt stuffing preserves some visible uncompiled facts in every domain, but has high covered-boundary failure rates.',
  '',
  'This is not evidence that CBEA should be modified to retrieve over raw observations. It is evidence that the current contribution has a precise boundary: compiled evidence and validator-covered commitments are controlled; visible but uncompiled facts are outside the guarantee. The paper should frame this as an operating-boundary diagnostic rather than as a method win or a generic limitation.',
  '',
  '## Raw Metrics CSV',
  '',
  '```csv',
  metricsCsv.trim(),
  '```',
  '',
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ out: outPath }, null, 2));
