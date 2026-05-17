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
| Model-judge dimension summaries, winner choices, and output evidence | `data/model_judge/balanced-90/annotation-items.csv`, `data/model_judge/balanced-90/annotation-key.csv`, `data/model_judge/annotation-key.csv`, `data/model_judge/combined-labels.csv`, `data/model_judge/combined-pairwise.csv`, `data/results/model-output-evidence.csv` | `npm run summarize:judge`, `npm run summarize:judge-bootstrap`, `npm run summarize:model-output-evidence`, `npm run check:release`; external judge replay uses `scripts/run-llm-fidelity-audit.mjs --items=data/model_judge/balanced-90/annotation-items.csv` |
| Production aggregate diagnostics | `data/results/production-data-wash-summary.csv`, `data/results/production-runtime-coverage.csv` | `npm run check:release` |
| Privacy boundary | released tracked files | `npm run check:privacy` |

## Output Evidence Boundary

`data/results/model-output-evidence.csv` is a reproducible, sanitized join over
the released 90-case blinded model-judge sample, automatic flags, judge labels,
and pairwise winner choices. It is output-bearing evidence for the model-judge
diagnostics, not a full provider raw-log dump and not a claim that every matched
360-fixture row includes raw provider JSON in the artifact.

## Paper Experiment Coverage

| Paper item | Experiment / diagnostic | Artifact support | Command / check | Status |
|---|---|---|---|---|
| Figure 1, Table 1 | Runtime object and control-flow overview | `scripts/run-cbea-lcv-real-pilot.mjs`, `scripts/check-clean-harness.test.mjs`, `data/fixtures/cbea-lcv.schema.json` | `npm run test:harness` | Covered as method/runtime structure, not a numeric experiment |
| Table 2, Figure 2, Table 15 | Matched 360-fixture MiniMax-M2.7 comparison over nine variants | `data/results/real-pilot-results.csv`, `data/results/real-pilot-metrics.csv` | `npm run summarize:metrics`, `npm run check:release` | Covered from released scored rows |
| Figure 3, Table 17 | Backend sensitivity over MiniMax-M2.7, DeepSeek-V4-Flash, and GPT-OSS-120B | `data/results/backend-sensitivity-operating-points.csv` | `npm run check:release` | Covered from released aggregate rows |
| Appendix K | Hy3-preview output-budget diagnostic | `data/results/hy3-output-budget-diagnostic.csv` | `npm run check:release` | Covered from released aggregate rows |
| Table 3, Table 20 | Blinded model-judge winner and bootstrap summaries | `data/model_judge/balanced-90/annotation-items.csv`, `data/model_judge/combined-labels.csv`, `data/model_judge/combined-pairwise.csv`, `data/results/judge-winner-bootstrap.csv`, `data/results/model-output-evidence.csv` | `npm run summarize:judge`, `npm run summarize:judge-bootstrap`, `npm run summarize:model-output-evidence`, `npm run check:release` | Covered from released judge items, output evidence, labels, and pairwise choices |
| Table 21, Table 22 | Per-judge descriptive means and inter-judge agreement | `data/model_judge/combined-labels.csv`, `data/model_judge/combined-pairwise.csv`, `data/results/model-output-evidence.csv` | `npm run summarize:judge`, `npm run summarize:model-output-evidence`, `npm run check:release` | Covered from released labels, pairwise choices, and output evidence |
| Appendix A, Table 4 | Anonymous artifact card | `README.md`, `ARTIFACT_NOTES.md`, this manifest | Manual inspection plus `npm run check:privacy` | Covered |
| Appendix B, Table 5, Table 6 | Comparison interfaces and fixed CBEA/LCV reporting details | `scripts/run-cbea-lcv-real-pilot.mjs`, `data/fixtures/cbea-lcv.expanded360.synthetic.json`, `README.md` | `npm run test:harness` | Covered by harness logic and documentation |
| Appendix C, Table 7 | Privacy-safe production data-wash denominators | `data/results/production-data-wash-summary.csv`, `data/results/production-runtime-coverage.csv` | `npm run check:release` | Covered as aggregate-only diagnostics |
| Appendix C, Table 8, Table 9 | Fixture buckets and stress surfaces | `data/fixtures/cbea-lcv.expanded360.synthetic.json`, `data/fixtures/cbea-lcv.schema.json`, `scripts/generate-cbea-lcv-expanded-fixtures.mjs` | `npm run generate:fixtures`, `npm run test:harness` | Covered |
| Appendix D, Table 10 | Long-history prompt-payload diagnostic | `data/results/long-history-payload-results.csv`, `data/results/long-history-payload-summary.csv` | `npm run summarize:long-history`, `npm run check:release` | Covered from released per-call usage/latency rows |
| Table 11 | Paired bootstrap intervals for headline deltas | `data/results/real-pilot-results.csv`, `data/results/bootstrap-headline-diffs.csv` | `npm run summarize:bootstrap`, `npm run check:release` | Covered |
| Appendix E, Table 12 | Horizon-complexity stability diagnostic | `data/fixtures/cbea-lcv.expanded360.synthetic.json`, `data/results/real-pilot-results.csv`, `data/results/horizon-stability.csv` | `npm run summarize:horizon`, `npm run check:release` | Covered |
| Appendix F, Table 13 | LCV repair-routing case sketch | `scripts/run-cbea-lcv-real-pilot.mjs`, `data/fixtures/cbea-lcv.expanded360.synthetic.json` | `npm run test:harness` | Covered as illustrative logic, not a separate empirical table |
| Appendix G, Table 14 | Targeted runtime ablations | `data/results/cbea-ablation-metrics.csv` | `npm run check:release` | Covered from released aggregate rows |
| Appendix I, Table 16 | Selector-level MMR diagnostic | `data/fixtures/cbea-lcv.expanded360.synthetic.json`, `data/results/selector-baseline-mmr.csv` | `npm run summarize:selector-baselines`, `npm run check:release` | Covered |
| Appendix L, Table 18, Table 19 | Shadow-oracle boundary and per-domain uncompiled-fact recall | `data/fixtures/cbea-lcv.v6-shadow360.synthetic.json`, `data/fixtures/cbea-lcv.v6-shadow360.stats.json`, `data/results/shadow-oracle-overall.csv`, `data/results/shadow-oracle-domain.csv` | `npm run summarize:boundary`, `npm run check:release` | Covered |

## Table-by-Table Coverage

| Table | Paper role | Artifact support | Reproduction / check | Coverage status |
|---|---|---|---|---|
| Table 1 | Runtime objects and failure surfaces | `scripts/run-cbea-lcv-real-pilot.mjs`, `data/fixtures/cbea-lcv.schema.json` | `npm run test:harness` | Covered as implementation structure |
| Table 2 | Matched offline operating points over 360 fixtures | `data/results/real-pilot-results.csv`, `data/results/real-pilot-metrics.csv` | `npm run summarize:metrics`, `npm run check:release` | Covered |
| Table 3 | Model-judge diagnostic means and winner share | `data/model_judge/combined-labels.csv`, `data/model_judge/combined-pairwise.csv`, `data/model_judge/balanced-90/annotation-items.csv`, `data/results/model-output-evidence.csv` | `npm run summarize:judge`, `npm run summarize:model-output-evidence`, `npm run check:release` | Covered |
| Table 4 | Anonymous reproducibility artifact card | `README.md`, `ARTIFACT_NOTES.md`, `REPRODUCTION_MANIFEST.md` | `npm run check:privacy` plus manual inspection | Covered |
| Table 5 | Comparison set for the matched offline run | `README.md`, `scripts/run-cbea-lcv-real-pilot.mjs` | `npm run test:harness` | Covered as method configuration |
| Table 6 | Fixed CBEA/LCV reporting details | `scripts/run-cbea-lcv-real-pilot.mjs`, `scripts/summarize-selector-baselines.mjs` | `npm run test:harness`, `npm run summarize:selector-baselines` | Covered as method configuration |
| Table 7 | Privacy-safe production data-wash export | `data/results/production-data-wash-summary.csv`, `data/results/production-runtime-coverage.csv` | `npm run check:release` | Covered as aggregate-only diagnostic |
| Table 8 | Primary exported fixture buckets | `data/fixtures/cbea-lcv.expanded360.synthetic.json`, `scripts/generate-cbea-lcv-expanded-fixtures.mjs` | `npm run generate:fixtures`, `npm run test:harness` | Covered |
| Table 9 | Benchmark stress surfaces | `data/fixtures/cbea-lcv.schema.json`, `data/fixtures/cbea-lcv.expanded360.synthetic.json`, `data/test_cases/table-09-12-minimal.synthetic.json` | `npm run check:table-cases`, `npm run test:harness` | Covered |
| Table 10 | Long-history prompt-payload diagnostic | `data/results/long-history-payload-results.csv`, `data/results/long-history-payload-summary.csv` | `npm run summarize:long-history`, `npm run check:release` | Covered |
| Table 11 | Paired bootstrap intervals over 360 fixtures | `data/results/real-pilot-results.csv`, `data/results/bootstrap-headline-diffs.csv` | `npm run summarize:bootstrap`, `npm run check:release` | Covered |
| Table 12 | Horizon-complexity diagnostic | `data/results/real-pilot-results.csv`, `data/results/horizon-stability.csv`, `data/fixtures/cbea-lcv.expanded360.synthetic.json` | `npm run summarize:horizon`, `npm run check:release` | Covered |
| Table 13 | Illustrative LCV repair routing case | `scripts/run-cbea-lcv-real-pilot.mjs`, `data/fixtures/cbea-lcv.expanded360.synthetic.json` | `npm run test:harness` | Covered as illustrative routing logic |
| Table 14 | Targeted ablation results | `data/results/cbea-ablation-metrics.csv` | `npm run check:release` | Covered |
| Table 15 | Validator-covered control failures, 9-method detail | `data/results/real-pilot-results.csv`, `data/results/real-pilot-metrics.csv` | `npm run summarize:metrics`, `npm run check:release` | Covered |
| Table 16 | Selector-level MMR diagnostic | `data/fixtures/cbea-lcv.expanded360.synthetic.json`, `data/results/selector-baseline-mmr.csv` | `npm run summarize:selector-baselines`, `npm run check:release` | Covered |
| Table 17 | Backend sensitivity over 360 fixtures x 3 methods x 3 backends | `data/results/backend-sensitivity-operating-points.csv` | `npm run check:release` | Covered |
| Table 18 | Shadow-oracle boundary diagnostic | `data/results/shadow-oracle-overall.csv`, `data/fixtures/cbea-lcv.v6-shadow360.synthetic.json` | `npm run summarize:boundary`, `npm run check:release` | Covered |
| Table 19 | Per-domain uncompiled-fact recall | `data/results/shadow-oracle-domain.csv`, `data/fixtures/cbea-lcv.v6-shadow360.synthetic.json` | `npm run summarize:boundary`, `npm run check:release` | Covered |
| Table 20 | Case-cluster bootstrap over model-judge winner selections | `data/model_judge/combined-pairwise.csv`, `data/results/judge-winner-bootstrap.csv`, `data/results/model-output-evidence.csv` | `npm run summarize:judge-bootstrap`, `npm run summarize:model-output-evidence`, `npm run check:release` | Covered |
| Table 21 | Per-judge descriptive means | `data/model_judge/combined-labels.csv`, `runs/llm-judge-summary/llm-fidelity-per-judge-summary.csv`, `data/results/model-output-evidence.csv` | `npm run summarize:judge`, `npm run summarize:model-output-evidence`, `npm run check:release` | Covered |
| Table 22 | Agreement between two model judges | `data/model_judge/combined-labels.csv`, `data/model_judge/combined-pairwise.csv`, `runs/llm-judge-summary/llm-fidelity-agreement.csv`, `data/results/model-output-evidence.csv` | `npm run summarize:judge`, `npm run summarize:model-output-evidence`, `npm run check:release` | Covered |

## External Reruns

Re-running generation or model-judge calls requires external provider access and
is outside the default artifact-validation path:

- matched model calls: `scripts/run-cbea-lcv-real-pilot.mjs`
- model-judge calls: `scripts/run-llm-fidelity-audit.mjs`

Use `runs/` or another ignored directory for any raw rerun outputs.
