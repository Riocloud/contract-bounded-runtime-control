# Recall Isn't Enough: Bounding Commitments in Personalized Language Systems

This repository contains a sanitized reproducibility package for experiments on
bounding commitments in long-horizon personalized language systems. It is
intended to support artifact review and follow-up replication of the
synthetic/composite benchmark results for "Recall Isn't Enough: Bounding
Commitments in Personalized Language Systems."

The repository does not contain write-up source, compiled documents, production
backend code, raw production histories, user identifiers, credentials, or
server configuration.

## Contents

- `data/fixtures/`: synthetic/composite fixtures and JSON schema.
- `data/results/`: sanitized matched-run score tables, backend sensitivity,
  shadow-boundary diagnostics, long-history payload diagnostics, production
  aggregate summaries, and aggregate summary tables.
- `data/model_judge/`: blinded model-judge item CSV, labels, pairwise choices,
  annotation keys, and run manifests.
- `data/test_cases/`: minimal synthetic shape checks for the final appendix
  tables; these are not empirical evidence.
- `scripts/`: fixture generation, matched-run, model-judge, summary, and
  privacy-boundary scripts.

## Data Boundary

All fixtures are synthetic or composite. They preserve abstract failure
mechanisms such as false hardening, hidden exceptions, witness drop,
no-feasible candidates, consequence debt, over-personalization, and surface
mismatch. They do not include raw production histories, raw biographies,
identifiers, contact information, billing records, individual timestamps, or
identifiable life-event combinations.

The deployment diagnostics included in this release are aggregate-only; this
repository does not publish session rows. Long-history payload diagnostics
contain only synthetic fixture identifiers, method labels, provider-reported
usage counts, and latency measurements; prompts and generated text are not
included.

The checked-in result CSVs are release artifacts, not raw run logs. They contain
fixture identifiers, method labels, automatic score flags, aggregate metrics,
token/cost summaries, and normalized model-family labels. They do not contain
raw model outputs, provider responses, API endpoints, API keys, local machine
paths, or exact run timestamps. Local reruns should write raw JSON and progress
files under `runs/` or another ignored directory.

## Reproduce Summary Tables

Requirements:

- Node.js 20 or newer.
- No package install is required for the included summary scripts.
- No API key is required for the checked-in artifact validation path.

Reviewer quick start:

```bash
unzip recall-isnt-enough-bounding-commitments-arr-artifact-*.zip
cd recall-isnt-enough-bounding-commitments-artifact
node --version
npm run check
```

From an already-unpacked artifact directory, run:

```bash
npm run check
```

This does not make provider calls. It writes reproduced summary files under
`runs/`, including `runs/llm-judge-summary/`, and runs the automatic-metric,
bootstrap-interval, horizon-stability, long-history payload, model-judge,
judge-winner bootstrap, selector-baseline, boundary diagnostic, release-table,
and privacy-boundary checks. It also validates the minimal public table test
cases for the release tables.

To regenerate the 360 synthetic/composite fixtures:

```bash
npm run generate:fixtures
```

To summarize the released model-judge labels only:

```bash
npm run summarize:judge
npm run summarize:judge-bootstrap
```

To recompute automatic metrics, paired bootstrap intervals, and horizon
stability from the released per-row score table, plus the long-history payload
summary from the released latency diagnostic rows and the selector-level MMR
diagnostic:

```bash
npm run summarize:metrics
npm run summarize:bootstrap
npm run summarize:horizon
npm run summarize:long-history
npm run summarize:selector-baselines
npm run summarize:boundary
```

To validate the checked-in artifacts against the release table values:

```bash
npm run check:release
```

Additional checked-in aggregate files:

- `data/results/cbea-ablation-metrics.csv`: 360-fixture CBEA/LCV ablations.
- `data/results/backend-sensitivity-operating-points.csv`: 360-fixture gated
  operating points for MiniMax-M2.7, DeepSeek-V4-Flash, and GPT-OSS-120B.
- `data/results/hy3-output-budget-diagnostic.csv`: output-budget diagnostic for
  Hy3-preview/Hunyuan3-preview. It is intentionally separate from the matched
  360-fixture backend sensitivity table.
- `data/results/shadow-oracle-overall.csv` and
  `data/results/shadow-oracle-domain.csv`: uncompiled-context boundary
  diagnostics. These measure visible facts outside the validator-covered
  contract; they are not an extension of the covered guarantee.
- `data/results/backend-robustness-deepseek360.csv`: legacy ungated DeepSeek
  endpoint check retained for traceability. The current gated operating-point
  comparison is `backend-sensitivity-operating-points.csv`.
- `data/results/long-history-payload-results.csv`: release-safe per-call usage
  and latency rows for the long-history payload diagnostic.
- `data/results/long-history-payload-summary.csv`: aggregate values reported in
  the long-history payload table.
- `data/results/judge-winner-bootstrap.csv`: case-cluster bootstrap intervals
  over blinded model-judge winner selections.
- `data/results/selector-baseline-mmr.csv`: selector-level comparison between
  CBEA activation and an MMR relevance-diversity baseline at the same evidence
  budget. This diagnostic replays the fixed runtime activation policy used by
  the released harness; it is not a learned or tuned CBEA selector.
- `data/results/production-data-wash-summary.csv` and
  `data/results/production-runtime-coverage.csv`: aggregate-only production
  data-wash denominators and runtime-object coverage.

## Re-run Model Calls

The checked-in results were generated with external OpenAI-compatible endpoints
over synthetic/composite fixtures. To re-run generation with your own provider:

```bash
export PROVIDER_BASE_URL="https://api.example.com"
export PROVIDER_MODEL="provider-model-name"
export PROVIDER_API_KEY="..."
# Optional: disable OpenAI JSON response_format for providers that reject it.
export PROVIDER_RESPONSE_FORMAT="json_object"
# Optional: provider-specific reasoning control. Use "none" to request no
# explicit reasoning channel where supported by the provider.
export PROVIDER_REASONING=""

node scripts/run-cbea-lcv-real-pilot.mjs \
  --fixtures=data/fixtures/cbea-lcv.expanded360.synthetic.json \
  --out=runs/real-model \
  --temperature=0.2 \
  --max-tokens=2200 \
  --max-parse-retries=3 \
  --concurrency=16
```

For recovery-only reruns after transient parse or transport failures, pass a
JSON task-pair list with `fixture_id` and `method` fields:

```bash
node scripts/run-cbea-lcv-real-pilot.mjs \
  --fixtures=data/fixtures/cbea-lcv.expanded360.synthetic.json \
  --task-pairs=runs/recovery-task-pairs.json \
  --out=runs/recovery \
  --temperature=0.2 \
  --max-tokens=2200 \
  --max-parse-retries=3 \
  --concurrency=16
```

Use `scripts/merge-recovered-results.mjs` to merge recovered rows into a
release-safe per-row score CSV. Do not commit the raw JSON outputs produced by
reruns.

To re-run the model-judge audit with an OpenAI-compatible judge endpoint, use
the released blinded item CSV. It contains synthetic/composite case references,
blinded system labels, and user-visible output text, but no raw production
history or identifiers.

```bash
export LLM_JUDGE_BASE_URL="https://api.example.com/v1"
export LLM_JUDGE_MODEL="judge-model-name"
export LLM_JUDGE_API_KEY="..."

node scripts/run-llm-fidelity-audit.mjs \
  --items=data/model_judge/balanced-90/annotation-items.csv \
  --out=runs/qwen-judge \
  --concurrency=6 \
  --timeout-ms=240000 \
  --pairwise=true
```

To build a fresh 90-case blinded judge sample from a local output-bearing result
CSV:

```bash
npm run judge:sample
```

This writes the sample under `data/model_judge/balanced-90/`. The checked-in
release score table is sanitized and does not contain raw output columns, so the
included `data/model_judge/balanced-90/annotation-items.csv` is the replay input
for the reported judge audit. If you have a separate production profile file,
`scripts/build-model-judge-sample.mjs` also accepts `--profile=path/to/profile.json`
so the sample can be reweighted without changing the rest of the audit pipeline.

## Model-Judge Audit Scope

The model-judge audit is diagnostic evidence, not human validation and not a
real-world decision-quality evaluation. Judges score fidelity to
synthetic/composite case facts on a 0--2 scoring schema and choose pairwise winners
among blinded outputs.

The checked-in run manifests record model identifiers, concurrency, and timeout
settings. They intentionally omit API keys, endpoint URLs, precise calendar
timestamps, raw provider responses, and local machine paths.

## License

Code and synthetic/composite artifacts are released under the MIT License.
