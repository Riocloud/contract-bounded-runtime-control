# Human Fidelity Annotation Rubric

Use this annotation only to judge fidelity to the synthetic/composite case facts.
Do not judge whether the advice would improve a real user's life, finances,
health, relationship, or career.

Score each dimension as:

- 0: clear failure.
- 1: partial, ambiguous, or mixed.
- 2: clearly satisfies the case facts.

Dimensions:

1. constraint_fidelity: respects explicitly confirmed hard constraints.
2. evidence_coverage: uses required witnesses, detail slots, and tail evidence.
3. consequence_continuity: preserves downstream obligations created by earlier choices or case facts.
4. no_feasible_handling: repairs, abstains, or asks to recontract when the case has no valid commitment.
5. appropriate_personalization: avoids irrelevant, intrusive, repetitive, or sycophantic personalization.
6. surface_coherence: realized prose is clear enough to evaluate the structured commitment.

Pairwise choice:

For each case, choose the system label that is most faithful to the confirmed
constraints and evidence. If all are equally poor, choose the least harmful
output and explain briefly in notes.
