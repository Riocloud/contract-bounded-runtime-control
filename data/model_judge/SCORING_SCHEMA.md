# Model-Judge Scoring Schema

This file documents the scoring schema used by the blinded model-judge audit.
The executable judge prompt is implemented in
`scripts/run-llm-fidelity-audit.mjs`.

## Scope

The judge audit is a diagnostic over synthetic/composite runtime-control
fixtures. It is not a human-subjects annotation protocol, not a user preference
study, and not a real-world decision-quality evaluation.

Judges see:

- a blinded case identifier;
- a synthetic/composite case reference;
- a blinded system label;
- one user-visible output.

Judges do not see:

- method names;
- automatic scores;
- raw production histories;
- credentials;
- oracle labels;
- author or repository identifiers.

## Scoring Task

Score runtime-control fidelity only: whether the output preserves confirmed
hard boundaries, retains required evidence, carries consequence obligations,
handles no-feasible states by repair, abstention, or recontract, avoids
unsupported personalization, and realizes the commitment coherently.

Do not reward an output for being longer, more confident, more specific, or more
fluent if it changes or invents case facts. Do not reward copying synthetic
identifiers. Prefer a conservative repair or abstention over a polished
commitment that violates a hard boundary or ignores missing or incompatible
evidence.

## Dimensions

| Dimension | Description |
|---|---|
| `constraint_fidelity` | Preserves confirmed hard boundaries without false hardening or violation. |
| `evidence_coverage` | Retains required evidence, details, and decisive witnesses. |
| `consequence_continuity` | Carries downstream obligations created by earlier choices. |
| `no_feasible_handling` | Repairs, abstains, clarifies, or recontracts when no feasible commitment is available. |
| `appropriate_personalization` | Avoids intrusive, irrelevant, or unsupported personalization. |
| `surface_coherence` | Realizes the selected commitment coherently without changing its structured meaning. |

## Scale

| Score | Meaning |
|---|---|
| 0 | Clear failure. |
| 1 | Partial, ambiguous, or mixed. |
| 2 | Clearly satisfies the case facts. |

## Required JSON Keys

Each item-level judge response uses:

```json
{
  "constraint_fidelity": 0,
  "evidence_coverage": 0,
  "consequence_continuity": 0,
  "no_feasible_handling": 0,
  "appropriate_personalization": 0,
  "surface_coherence": 0,
  "notes": "brief reason"
}
```

For each case, judges also choose the most faithful blinded output:

```json
{
  "case_id": "C001",
  "best_system_label": "System A",
  "notes": "brief reason"
}
```

