#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const GROUPS = [
  ['tail', /_tail_/u],
  ['infeasible', /_infeasible_/u],
  ['falsehard', /_falsehard_/u],
  ['exception', /_exception_/u],
  ['surface', /_surface_/u],
  ['debt', /_debt_/u],
];

const inputPath = path.resolve(readArg('input', 'data/fixtures/cbea-lcv.v6-shadow360.synthetic.json'));
const outPath = path.resolve(readArg('out', 'results/pilot_shadow/fixtures.json'));
const manifestPath = path.resolve(readArg('manifest', 'results/pilot_shadow/fixture-selection.json'));
const perGroup = Number.parseInt(readArg('per-group', '4'), 10);
const perDomainSurface = Number.parseInt(readArg('per-domain-surface', '0'), 10);
const domains = readArg('domains', '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const fixtures = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const selected = [];
const manifest = [];
if (perDomainSurface > 0) {
  const selectedDomains = domains.length > 0
    ? domains
    : ['investment', 'love_choice', 'career', 'relocation'];
  for (const domain of selectedDomains) {
    for (const [group, pattern] of GROUPS) {
      const groupRows = fixtures
        .filter((fixture) => fixture.scenario_focus === domain && pattern.test(fixture.fixture_id))
        .slice(0, perDomainSurface);
      if (groupRows.length !== perDomainSurface) {
        throw new Error(`Expected ${perDomainSurface} fixtures for ${domain}/${group}, found ${groupRows.length}`);
      }
      selected.push(...groupRows);
      manifest.push({
        domain,
        group,
        count: groupRows.length,
        fixture_ids: groupRows.map((fixture) => fixture.fixture_id),
      });
    }
  }
} else {
  for (const [group, pattern] of GROUPS) {
    const groupRows = fixtures.filter((fixture) => pattern.test(fixture.fixture_id)).slice(0, perGroup);
    if (groupRows.length !== perGroup) {
      throw new Error(`Expected ${perGroup} fixtures for group ${group}, found ${groupRows.length}`);
    }
    selected.push(...groupRows);
    manifest.push({
      group,
      count: groupRows.length,
      fixture_ids: groupRows.map((fixture) => fixture.fixture_id),
    });
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(selected, null, 2)}\n`);
fs.writeFileSync(manifestPath, `${JSON.stringify({
  input: inputPath,
  out: outPath,
  per_group: perGroup,
  per_domain_surface: perDomainSurface,
  domains,
  total: selected.length,
  groups: manifest,
}, null, 2)}\n`);
console.log(JSON.stringify({ out: outPath, manifest: manifestPath, total: selected.length }, null, 2));
