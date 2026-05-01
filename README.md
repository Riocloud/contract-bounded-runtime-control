# Contract-Bounded Runtime Control Artifacts

This repository contains a sanitized reproducibility package for experiments on
contract-bounded runtime control in long-horizon personalized language systems.
It is intended to support paper review and follow-up replication of the
synthetic/composite benchmark results.

The repository does not contain the paper source, LaTeX, PDF, production
backend code, raw production histories, user identifiers, credentials, or
server configuration.

## Contents

- `data/fixtures/`: synthetic/composite fixtures and JSON schema.
- `data/results/`: matched offline generation metrics and per-row scores.
- `data/model_judge/`: model-judge labels, pairwise choices, annotation key,
  and run manifests.
- `data/test_cases/`: minimal synthetic shape checks for the final appendix
  tables; these are not empirical evidence.
- `scripts/`: fixture generation, matched-run, model-judge, summary, and
  privacy-boundary scripts.
- `docs/rubric.md`: the fidelity scoring rubric used for the model-judge audit.

## Data Boundary

All fixtures are synthetic or composite. They preserve abstract failure
mechanisms such as false hardening, hidden exceptions, witness drop,
no-feasible candidates, consequence debt, over-personalization, and surface
mismatch. They do not include raw production histories, raw biographies,
identifiers, contact information, billing records, individual timestamps, or
identifiable life-event combinations.

The deployment diagnostics discussed in the accompanying paper are
aggregate-only; this repository does not publish session rows.

## Reproduce Summary Tables

Requirements:

- Node.js 20 or newer.
- No package install is required for the included summary scripts.

Run:

```bash
npm run check
```

This writes model-judge summary files under `runs/llm-judge-summary/` and runs
the automatic-metric, bootstrap-interval, model-judge, and privacy-boundary
checks under `runs/`. It also validates the minimal public table test cases for
the final appendix tables.

To regenerate the 90 synthetic/composite fixtures:

```bash
npm run generate:fixtures
```

To summarize the released model-judge labels only:

```bash
npm run summarize:judge
```

To recompute automatic metrics and paired bootstrap intervals from the released
per-row results:

```bash
npm run summarize:metrics
npm run summarize:bootstrap
```

## Re-run Model Calls

The checked-in results were generated with external OpenAI-compatible APIs over
synthetic/composite fixtures. To re-run generation with your own provider:

```bash
export PROVIDER_BASE_URL="https://api.example.com"
export PROVIDER_MODEL="MiniMax-M2.7"
export PROVIDER_API_KEY="..."

node scripts/run-cbea-lcv-real-pilot.mjs \
  --fixtures=data/fixtures/cbea-lcv.expanded90.synthetic.json \
  --out=runs/real-model \
  --temperature=0.2 \
  --max-tokens=2200 \
  --max-parse-retries=1 \
  --concurrency=8
```

To re-run the model-judge audit with an OpenAI-compatible judge endpoint,
provide an annotation item CSV with the same columns used by
`scripts/run-llm-fidelity-audit.mjs`: `annotation_id`, `case_id`,
`system_label`, case metadata columns, and `output_text`.

```bash
export LLM_JUDGE_BASE_URL="https://api.example.com/v1"
export LLM_JUDGE_MODEL="Qwen/Qwen3.6-35B-A3B"
export LLM_JUDGE_API_KEY="..."

node scripts/run-llm-fidelity-audit.mjs \
  --items=path/to/annotation-items.csv \
  --out=runs/qwen-judge \
  --concurrency=6 \
  --timeout-ms=240000 \
  --pairwise=true
```

## Model-Judge Audit Scope

The model-judge audit is diagnostic evidence, not human validation and not a
real-world decision-quality evaluation. Judges score fidelity to
synthetic/composite case facts on a 0--2 rubric and choose pairwise winners
among blinded outputs.

The checked-in run manifests record model identifiers, provider strings,
concurrency, and timeout settings. They intentionally omit API keys, precise
calendar timestamps, and local machine paths.

## Citation

If you use these artifacts, cite the accompanying paper:

> Contract-Bounded Runtime Control for Long-Horizon Personalized Language
> Systems.

## License

Code and synthetic/composite artifacts are released under the MIT License.
