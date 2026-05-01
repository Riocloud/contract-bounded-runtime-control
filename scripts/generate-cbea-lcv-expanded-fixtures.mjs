#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const focusSpecs = [
  {
    focus: 'investment',
    label: 'investment planning',
    dimensions: ['finance', 'relationship_family'],
    detailSlots: ['protected_cash', 'household_cost', 'late_tail_witness'],
    hard: ['protected_cash_must_remain_outside_high_volatility_position', 'household_buffer_must_stay_available'],
    mutable: ['risk_position_size_can_change', 'rebalance_timing_can_change'],
    witnesses: ['protected_cash_anchor', 'position_size_anchor'],
    tail: ['household_boundary_tail'],
    debt: ['household_liquidity_followup'],
    validFields: ['decision', 'risk_boundary', 'next_check'],
  },
  {
    focus: 'love_choice',
    label: 'relationship pacing',
    dimensions: ['relationship_family', 'time_window'],
    detailSlots: ['relationship_detail', 'relationship_aftershock', 'late_tail_witness'],
    hard: ['relationship_status_is_stable', 'no_explicit_breakup_signal'],
    mutable: ['shared_living_timeline_can_change', 'family_meeting_timing_can_change'],
    witnesses: ['stable_relationship_anchor', 'pacing_boundary_anchor'],
    tail: ['family_meeting_tail'],
    debt: ['shared_living_followup'],
    validFields: ['relationship_boundary', 'timeline', 'family_consequence'],
  },
  {
    focus: 'career',
    label: 'career transition',
    dimensions: ['career', 'finance', 'time_window'],
    detailSlots: ['role_detail', 'income_bridge', 'late_tail_witness'],
    hard: ['visa_or_contract_deadline_must_be_respected', 'minimum_income_floor_must_hold'],
    mutable: ['application_sequence_can_change', 'skill_investment_can_change'],
    witnesses: ['deadline_anchor', 'income_floor_anchor'],
    tail: ['caregiver_schedule_tail'],
    debt: ['career_delay_followup'],
    validFields: ['career_step', 'income_boundary', 'fallback_plan'],
  },
  {
    focus: 'relocation',
    label: 'relocation decision',
    dimensions: ['career', 'relationship_family', 'time_window'],
    detailSlots: ['settlement_detail', 'move_caused_career_consequence', 'late_tail_witness'],
    hard: ['weekly_in_person_obligation_cannot_move', 'new_role_presence_requirement_is_fixed'],
    mutable: ['start_date_can_shift', 'commute_plan_can_change'],
    witnesses: ['presence_requirement_anchor', 'care_schedule_anchor'],
    tail: ['caregiving_tail_anchor'],
    debt: ['caregiving_followup', 'career_delay_followup'],
    validFields: ['abstain_reason', 'needed_clarification', 'relocation_boundary'],
  },
  {
    focus: 'comprehensive',
    label: 'multi-domain life planning',
    dimensions: ['finance', 'career', 'relationship_family', 'time_window'],
    detailSlots: ['cashflow_detail', 'role_conflict_detail', 'late_tail_witness'],
    hard: ['medical_or_family_boundary_must_not_be_overridden', 'fixed_cashflow_obligation_must_be_preserved'],
    mutable: ['sequence_of_actions_can_change', 'support_request_timing_can_change'],
    witnesses: ['cashflow_obligation_anchor', 'family_boundary_anchor'],
    tail: ['role_conflict_tail'],
    debt: ['multi_domain_followup'],
    validFields: ['priority_order', 'constraint_boundary', 'followup_trigger'],
  },
];

const variantSpecs = [
  {
    name: 'tail_witness',
    suffix: 'tail',
    failure: ['witness_drop', 'consequence_debt'],
    infeasible: false,
    observation: 'A rare late witness is decisive but appears after more salient background details.',
  },
  {
    name: 'no_feasible',
    suffix: 'infeasible',
    failure: ['no_feasible_candidate', 'hidden_exception'],
    infeasible: true,
    observation: 'Two explicitly confirmed requirements cannot both be satisfied by any available commitment.',
  },
  {
    name: 'false_hardening',
    suffix: 'falsehard',
    failure: ['false_hardening', 'over_personalization'],
    infeasible: false,
    observation: 'A soft preference is phrased emotionally and can be mistaken for a confirmed hard predicate.',
  },
  {
    name: 'hidden_exception',
    suffix: 'exception',
    failure: ['hidden_exception', 'witness_drop'],
    infeasible: false,
    observation: 'A confirmed predicate has a scoped exception that is easy to lose when compressing evidence.',
  },
  {
    name: 'surface_mismatch',
    suffix: 'surface',
    failure: ['surface_mismatch', 'over_personalization'],
    infeasible: false,
    observation: 'The structured commitment can be valid while the realized prose implies an unsupported stronger claim.',
  },
  {
    name: 'consequence_debt',
    suffix: 'debt',
    failure: ['consequence_debt', 'witness_drop'],
    infeasible: false,
    observation: 'An earlier local choice creates a later obligation that must be carried into the result.',
  },
];

function withVariant(base, variant, focusIndex, variantIndex, replicateIndex) {
  const replicateSuffix = `r${String(replicateIndex + 1).padStart(2, '0')}`;
  const id = `synthetic_${base.focus}_${variant.suffix}_${String(focusIndex + 1).padStart(2, '0')}_${String(variantIndex + 1).padStart(2, '0')}_${replicateSuffix}`;
  const variantAnchor = `${base.focus}_${variant.suffix}_${replicateSuffix}_anchor`;
  const hiddenException = `${base.focus}_${variant.suffix}_${replicateSuffix}_scoped_exception`;
  const tailWitness = `${base.tail[0]}_${variant.suffix}_${replicateSuffix}`;
  const requiredWitnesses = [...base.witnesses, variantAnchor];
  const hard = variant.infeasible
    ? [
      ...base.hard,
      `${base.focus}_${variant.suffix}_must_do_action_now`,
      `${base.focus}_${variant.suffix}_must_not_do_action_now`,
    ]
    : variant.failure.includes('hidden_exception')
      ? [...base.hard, hiddenException]
      : base.hard;

  return {
    fixture_id: id,
    scenario_focus: base.focus,
    noisy_user_observations: [
      `Composite synthetic ${base.label} fixture. ${variant.observation}`,
      `No raw production history is used; this fixture preserves only an abstract ${variant.name} stress mechanism.`,
      `Noisy self-report contains recent excitement, older constraints, and one low-frequency witness: ${tailWitness}.`,
      `Replicate ${replicateIndex + 1} varies the witness and follow-up labels while preserving the same oracle stress surface.`,
    ],
    confirmed_hard_constraints: hard,
    mutable_state_facts: [
      ...base.mutable,
      `${base.focus}_${variant.suffix}_local_priority_can_change`,
    ],
    required_dimensions: base.dimensions,
    required_detail_slots: [...base.detailSlots, `${base.focus}_${variant.suffix}_${replicateSuffix}_slot`],
    required_witnesses: requiredWitnesses,
    tail_witnesses: [tailWitness],
    consequence_debt: [...base.debt, `${base.focus}_${variant.suffix}_${replicateSuffix}_followup`],
    oracle_feasible_set_empty: variant.infeasible,
    expected_repair_or_abstain: variant.infeasible,
    expected_valid_commitment_fields: variant.infeasible
      ? ['abstain_reason', 'needed_clarification']
      : base.validFields,
    failure_surface: variant.failure,
  };
}

const replicates = Math.max(1, Number.parseInt(readArg('replicates', '1'), 10));
const fixtures = focusSpecs.flatMap((base, focusIndex) =>
  variantSpecs.flatMap((variant, variantIndex) =>
    Array.from({ length: replicates }, (_, replicateIndex) =>
      withVariant(base, variant, focusIndex, variantIndex, replicateIndex))));

const outPath = path.resolve(readArg('out', 'research/fixtures/cbea-lcv.expanded.synthetic.json'));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(JSON.stringify({
  out: outPath,
  fixture_count: fixtures.length,
  replicates,
  scenario_focuses: [...new Set(fixtures.map((fixture) => fixture.scenario_focus))],
  failure_surfaces: [...new Set(fixtures.flatMap((fixture) => fixture.failure_surface))],
}, null, 2));
