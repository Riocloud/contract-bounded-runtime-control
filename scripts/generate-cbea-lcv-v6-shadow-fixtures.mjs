#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    out.push(text);
    seen.add(text);
  }
  return out;
}

function hashText(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sanitizeVisibleText(text) {
  return String(text)
    .replaceAll('hidden_exception', 'unspoken exception')
    .replaceAll('false_hardening', 'overly rigid interpretation')
    .replaceAll('tail_witness', 'late witness')
    .replaceAll('consequence_debt', 'follow-up obligation')
    .replaceAll('oracle_only', 'uncompiled')
    .replaceAll('deferred_', 'later ')
    .replaceAll(/shadow_[a-z0-9_]+/giu, 'uncompiled evidence')
    .replaceAll(/sh[0-9]+_/giu, '');
}

const FACT_POOLS = {
  investment: [
    ['constraint', 'keep emergency cash outside speculative trades', ['emergency cash outside speculative trades', 'keep emergency cash out of speculative trades', 'cash reserve separate from speculation'], ['cash\\s+(reserve\\s+)?(outside|separate).*speculative', 'emergency\\s+cash.*(not|never|outside).*trade']],
    ['evidence', 'a late household note says the rent buffer is not investable', ['rent buffer is not investable', 'household note says the rent buffer', 'rent money should not be invested'], ['rent\\s+(buffer|money).*(not|never).*invest']],
    ['detail', 'name the protected reserve before discussing upside', ['name the protected reserve before upside', 'protected reserve before discussing upside', 'mention reserve before return'], ['protected\\s+reserve.*before.*(upside|return)']],
    ['consequence', 'schedule a family cash review after any rebalance', ['family cash review after any rebalance', 'review family cash after rebalancing', 'cash review after rebalance'], ['cash\\s+review.*rebalance', 'rebalance.*family\\s+cash\\s+review']],
    ['evidence', 'an older note limits new risk until the insurance bill clears', ['new risk until the insurance bill clears', 'insurance bill clears before new risk', 'older note limits new risk'], ['insurance\\s+bill.*before.*new\\s+risk', 'new\\s+risk.*insurance\\s+bill']],
  ],
  love_choice: [
    ['constraint', 'do not present a relationship choice as fate or certainty', ['not fate or certainty', 'avoid fate framing', 'do not call the relationship choice certain'], ['(avoid|not|no).*fate', 'relationship.*(not|never).*certain']],
    ['evidence', 'a later message says the other person asked for slower pacing', ['asked for slower pacing', 'other person wanted slower pacing', 'later message says slow down'], ['(asked|wanted).*(slower|slow).*pacing']],
    ['detail', 'include one concrete boundary-setting sentence', ['concrete boundary-setting sentence', 'one boundary setting sentence', 'include a boundary sentence'], ['boundary[- ]setting\\s+sentence', 'include.*boundary\\s+sentence']],
    ['consequence', 'check whether the next message respects consent', ['next message respects consent', 'follow up on consent', 'respect consent in the next message'], ['next\\s+message.*consent', 'follow.*consent']],
    ['evidence', 'an older conversation says ambiguity should be named directly', ['ambiguity should be named directly', 'name ambiguity directly', 'older conversation says name ambiguity'], ['ambiguity.*named?\\s+directly', 'name\\s+ambiguity']],
  ],
  career: [
    ['constraint', 'do not recommend quitting before a written offer exists', ['written offer before quitting', 'no quitting without written offer', 'do not recommend quitting before a written offer'], ['written\\s+offer.*before.*quitting', 'no\\s+quitting.*written\\s+offer']],
    ['evidence', 'a late manager note says the internal transfer window is still open', ['internal transfer window is still open', 'late manager note about transfer window', 'transfer window still open'], ['transfer\\s+window.*still\\s+open']],
    ['detail', 'compare cash runway and role learning separately', ['cash runway and role learning separately', 'compare runway separately from learning', 'separate cash runway from learning'], ['cash\\s+runway.*role\\s+learning', 'separate.*runway.*learning']],
    ['consequence', 'carry forward a reminder to revisit benefits coverage', ['revisit benefits coverage', 'carry forward benefits coverage', 'reminder about benefits coverage'], ['revisit.*benefits\\s+coverage', 'benefits\\s+coverage.*reminder']],
    ['evidence', 'an old planning note says visa timing constrains start dates', ['visa timing constrains start dates', 'old planning note about visa timing', 'visa timing limits start dates'], ['visa\\s+timing.*start\\s+date']],
  ],
  relocation: [
    ['constraint', 'do not choose a move that breaks the school commute limit', ['school commute limit', 'do not exceed school commute', 'breaks the school commute limit'], ['school\\s+commute\\s+limit', 'not.*exceed.*school\\s+commute']],
    ['evidence', 'a late apartment note says the elevator outage affects accessibility', ['elevator outage affects accessibility', 'late apartment note about elevator', 'accessibility affected by elevator outage'], ['elevator\\s+outage.*accessibility', 'accessibility.*elevator']],
    ['detail', 'state the backup childcare plan if recommending the move', ['backup childcare plan', 'state backup childcare', 'childcare backup if moving'], ['backup\\s+childcare', 'childcare\\s+backup']],
    ['consequence', 'track a follow-up visit before signing the lease', ['follow-up visit before signing the lease', 'visit before lease signing', 'track a lease follow up visit'], ['visit.*before.*lease', 'lease.*follow[- ]up\\s+visit']],
    ['evidence', 'an older note says noise sensitivity matters more than square footage', ['noise sensitivity matters more than square footage', 'older note about noise sensitivity', 'noise over square footage'], ['noise\\s+sensitivity.*square\\s+footage', 'noise.*over.*square\\s+footage']],
  ],
  comprehensive: [
    ['constraint', 'do not trade off health coverage for short-term convenience', ['health coverage over convenience', 'do not trade off health coverage', 'avoid sacrificing health coverage'], ['health\\s+coverage.*convenience', 'not.*trade.*health\\s+coverage']],
    ['evidence', 'a late family note says weekend caregiving is already committed', ['weekend caregiving is already committed', 'late family note about caregiving', 'weekend caregiving commitment'], ['weekend\\s+caregiving.*committed']],
    ['detail', 'separate financial risk, relationship impact, and time load', ['financial risk relationship impact and time load', 'separate risk impact and time load', 'separate financial risk relationship impact'], ['financial\\s+risk.*relationship\\s+impact.*time\\s+load']],
    ['consequence', 'schedule a check-in after the first two weeks', ['check-in after the first two weeks', 'schedule a two week check in', 'first two weeks check in'], ['(two|2)\\s+week.*check[- ]in', 'check[- ]in.*first\\s+two\\s+weeks']],
    ['evidence', 'an older preference says reversible options should be tried first', ['reversible options should be tried first', 'older preference for reversible options', 'try reversible options first'], ['reversible\\s+options.*first']],
  ],
};

const NOISE = [
  'The user mentions a busy week and asks for a concise answer.',
  'A recent mood note says they feel impatient but still want a careful decision.',
  'An unrelated preference says examples are easier to read than abstract advice.',
  'The archive includes a reminder about keeping the answer practical.',
  'A background note mentions they dislike dramatic framing.',
  'The user asks not to over-index on the most recent event.',
  'A harmless aside mentions calendar pressure and limited attention.',
  'The user prefers the final answer to separate facts from suggestions.',
];

function factObject(fixture, entry, index) {
  const [type, canonical, aliases, patterns] = entry;
  const contradict = hashText(`${fixture.fixture_id}:polarity:${index}`) % 5 === 0;
  return {
    id: `sh${index + 1}`,
    canonical,
    aliases: unique([canonical, ...aliases]),
    paraphrase_patterns: patterns,
    type,
    weight: type === 'consequence' ? 0.8 : 1.0,
    turn_due_by: 3 + (hashText(`${fixture.fixture_id}:due:${index}`) % 3),
    polarity: contradict ? 'contradict_detection' : 'respect',
    embedded_in_turns: [],
  };
}

function chooseFacts(fixture) {
  const pool = FACT_POOLS[fixture.scenario_focus] || FACT_POOLS.comprehensive;
  const count = 1 + (hashText(`${fixture.fixture_id}:count`) % 5);
  const start = hashText(fixture.fixture_id) % pool.length;
  return Array.from({ length: count }, (_, index) => {
    const fact = factObject(fixture, pool[(start + index) % pool.length], index);
    return fact;
  });
}

function makeFactObservation(fact, fixture, factIndex, aliasIndex) {
  const alias = fact.aliases[aliasIndex % fact.aliases.length];
  if (fact.polarity === 'contradict_detection') {
    return `Earlier notes mentioned ${alias}, but a later correction says that point was withdrawn and should not be carried into the recommendation.`;
  }
  const templates = [
    `A delayed user note says ${alias}.`,
    `In an older part of the archive, the user says ${alias}.`,
    `A low-salience follow-up adds that ${alias}.`,
  ];
  return templates[(hashText(`${fixture.fixture_id}:template:${factIndex}:${aliasIndex}`) % templates.length)];
}

function embedFacts(fixture, facts) {
  const original = Array.isArray(fixture.noisy_user_observations) ? fixture.noisy_user_observations : [];
  const noiseCount = 4 + (hashText(`${fixture.fixture_id}:noise`) % 5);
  const observations = [...original.slice(0, 2)];
  for (let index = 0; index < noiseCount; index += 1) {
    observations.push(NOISE[(hashText(`${fixture.fixture_id}:noise:${index}`) + index) % NOISE.length]);
  }
  observations.push(...original.slice(2));

  for (const [factIndex, fact] of facts.entries()) {
    const primaryIndex = 2 + (hashText(`${fixture.fixture_id}:embed:${factIndex}`) % Math.max(1, observations.length - 2));
    observations.splice(primaryIndex, 0, makeFactObservation(fact, fixture, factIndex, 0));
    fact.embedded_in_turns.push(primaryIndex);
    if (fact.turn_due_by >= 3 && fact.aliases.length > 1) {
      const secondaryIndex = Math.min(
        observations.length,
        primaryIndex + 1 + (hashText(`${fixture.fixture_id}:embed2:${factIndex}`) % 3),
      );
      observations.splice(secondaryIndex, 0, makeFactObservation(fact, fixture, factIndex, 1));
      fact.embedded_in_turns.push(secondaryIndex);
    }
  }

  let effectiveNoiseCount = noiseCount;
  while (effectiveNoiseCount / Math.max(1, observations.length) < 0.3) {
    observations.push(NOISE[(hashText(`${fixture.fixture_id}:extra-noise:${effectiveNoiseCount}`) + effectiveNoiseCount) % NOISE.length]);
    effectiveNoiseCount += 1;
  }
  const noiseDensity = effectiveNoiseCount / Math.max(1, observations.length);
  return {
    observations: observations.map(sanitizeVisibleText),
    noiseDensity: Math.round(noiseDensity * 10_000) / 10_000,
  };
}

function toShadowFixture(fixture) {
  const facts = chooseFacts(fixture);
  const { observations, noiseDensity } = embedFacts(fixture, facts);
  return {
    ...fixture,
    noisy_user_observations: observations,
    validator_covered_hard_constraints: unique(fixture.confirmed_hard_constraints),
    validator_covered_required_witnesses: unique(fixture.required_witnesses),
    validator_covered_tail_witnesses: unique(fixture.tail_witnesses),
    validator_covered_detail_slots: unique(fixture.required_detail_slots),
    validator_covered_consequence_debt: unique(fixture.consequence_debt),
    shadow_oracle: {
      facts,
      noise_density_score: noiseDensity,
    },
    turns: [
      {
        turn_index: 0,
        user: `Introduce ${fixture.scenario_focus} context and covered contract predicates.`,
        system_action_oracle: 'compile_validator_covered_contract',
      },
      {
        turn_index: 1,
        user: 'Add visible natural-language evidence that is not compiled into validator predicates.',
        system_action_oracle: 'store_shadow_oracle_evidence',
      },
      {
        turn_index: 2,
        user: 'Request a commitment under the current runtime state.',
        system_action_oracle: 'check_validator_covered_commitment',
      },
      {
        turn_index: 3,
        user: 'Follow up on delayed consequences from the visible archive.',
        system_action_oracle: 'check_shadow_oracle_retention',
      },
    ],
  };
}

function validateFixture(fixture) {
  const visible = fixture.noisy_user_observations.join('\n');
  if (/(shadow_|sh[0-9]+_|oracle_only|deferred_|hidden_)/u.test(visible)) {
    throw new Error(`shadow label leaked into visible text: ${fixture.fixture_id}`);
  }
  const facts = fixture.shadow_oracle?.facts || [];
  if (facts.length < 1 || facts.length > 5) {
    throw new Error(`shadow fact count out of range: ${fixture.fixture_id}`);
  }
  if (fixture.shadow_oracle.noise_density_score < 0.3) {
    throw new Error(`noise density too low: ${fixture.fixture_id}`);
  }
  for (const fact of facts) {
    if ((fact.aliases || []).length < 3 || (fact.paraphrase_patterns || []).length < 1) {
      throw new Error(`shadow matcher under-specified: ${fixture.fixture_id}:${fact.id}`);
    }
    if (!fact.aliases.some((alias) => visible.includes(alias))) {
      throw new Error(`shadow fact not embedded visibly: ${fixture.fixture_id}:${fact.id}`);
    }
  }
}

function coverageStats(fixtures) {
  let covered = 0;
  let shadow = 0;
  const factCounts = [];
  const types = new Map();
  const polarities = new Map();
  for (const fixture of fixtures) {
    covered += unique(fixture.validator_covered_hard_constraints).length;
    covered += unique(fixture.validator_covered_required_witnesses).length;
    covered += unique(fixture.validator_covered_tail_witnesses).length;
    covered += unique(fixture.validator_covered_detail_slots).length;
    covered += unique(fixture.validator_covered_consequence_debt).length;
    const facts = fixture.shadow_oracle.facts;
    shadow += facts.length;
    factCounts.push(facts.length);
    for (const fact of facts) {
      types.set(fact.type, (types.get(fact.type) || 0) + 1);
      polarities.set(fact.polarity, (polarities.get(fact.polarity) || 0) + 1);
    }
  }
  return {
    fixture_count: fixtures.length,
    mean_validator_coverage: Math.round((covered / (covered + shadow)) * 10_000) / 10_000,
    validator_covered_items: covered,
    shadow_oracle_items: shadow,
    min_shadow_facts_per_fixture: Math.min(...factCounts),
    max_shadow_facts_per_fixture: Math.max(...factCounts),
    shadow_fact_count_distribution: Object.fromEntries(
      [...new Set(factCounts)].sort((a, b) => a - b).map((count) => [count, factCounts.filter((value) => value === count).length]),
    ),
    shadow_types: Object.fromEntries([...types].sort()),
    shadow_polarities: Object.fromEntries([...polarities].sort()),
    scenario_focuses: [...new Set(fixtures.map((fixture) => fixture.scenario_focus))],
    failure_surfaces: [...new Set(fixtures.flatMap((fixture) => fixture.failure_surface))],
  };
}

const inputPath = path.resolve(readArg('input', 'data/fixtures/cbea-lcv.expanded360.synthetic.json'));
const outPath = path.resolve(readArg('out', 'data/fixtures/cbea-lcv.v6-shadow360.synthetic.json'));
const statsPath = path.resolve(readArg('stats', 'data/fixtures/cbea-lcv.v6-shadow360.stats.json'));

const fixtures = JSON.parse(fs.readFileSync(inputPath, 'utf8')).map(toShadowFixture);
for (const fixture of fixtures) validateFixture(fixture);
const stats = coverageStats(fixtures);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(fixtures, null, 2)}\n`);
fs.writeFileSync(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
console.log(JSON.stringify({ out: outPath, stats: statsPath, ...stats }, null, 2));
