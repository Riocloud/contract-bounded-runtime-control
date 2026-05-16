# Reproduction Manifest

## Primary Validation Command

```bash
npm run check
```

This command runs the harness tests, regenerates summary files under `runs/`,
checks released table values, validates public table test cases, and runs the
privacy-boundary check.

## Reported Result Sources

| Paper item | Released source files | Reproduction / check command |
|---|---|---|
| Matched 360-fixture operating points | `data/results/real-pilot-results.csv`, `data/results/real-pilot-metrics.csv` | `npm run summarize:metrics`, `npm run check:release` |
| Paired bootstrap intervals | `data/results/real-pilot-results.csv`, `data/results/bootstrap-headline-diffs.csv` | `npm run summarize:bootstrap`, `npm run check:release` |
| Horizon-complexity diagnostic | `data/fixtures/cbea-lcv.expanded360.synthetic.json`, `data/results/real-pilot-results.csv`, `data/results/horizon-stability.csv` | `npm run summarize:horizon`, `npm run check:release` |
| Backend sensitivity operating points | `data/results/backend-sensitivity-operating-points.csv` | `npm run check:release` |
| Hy3 output-budget diagnostic | `data/results/hy3-output-budget-diagnostic.csv` | `npm run check:release` |
| Shadow-oracle boundary diagnostic | `data/fixtures/cbea-lcv.v6-shadow360.synthetic.json`, `data/fixtures/cbea-lcv.v6-shadow360.stats.json`, `data/results/shadow-oracle-overall.csv`, `data/results/shadow-oracle-domain.csv` | `npm run summarize:boundary`, `npm run check:release` |
| Long-history payload diagnostic | `data/results/long-history-payload-results.csv`, `data/results/long-history-payload-summary.csv` | `npm run summarize:long-history`, `npm run check:release` |
| Selector-level MMR diagnostic | `data/fixtures/cbea-lcv.expanded360.synthetic.json`, `data/results/selector-baseline-mmr.csv` | `npm run summarize:selector-baselines`, `npm run check:release` |
| Model-judge dimension summaries and winner choices | `data/model_judge/balanced-90/annotation-items.csv`, `data/model_judge/balanced-90/annotation-key.csv`, `data/model_judge/annotation-key.csv`, `data/model_judge/combined-labels.csv`, `data/model_judge/combined-pairwise.csv` | `npm run summarize:judge`, `npm run summarize:judge-bootstrap`, `npm run check:release`; external judge replay uses `scripts/run-llm-fidelity-audit.mjs --items=data/model_judge/balanced-90/annotation-items.csv` |
| Production aggregate diagnostics | `data/results/production-data-wash-summary.csv`, `data/results/production-runtime-coverage.csv` | `npm run check:release` |
| Privacy boundary | released tracked files | `npm run check:privacy` |

## External Reruns

Re-running generation or model-judge calls requires external provider access and
is outside the default artifact-validation path:

- matched model calls: `scripts/run-cbea-lcv-real-pilot.mjs`
- model-judge calls: `scripts/run-llm-fidelity-audit.mjs`

Use `runs/` or another ignored directory for any raw rerun outputs.
