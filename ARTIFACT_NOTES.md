# Artifact Notes

This package is a sanitized reproducibility artifact for "Recall Isn't Enough:
Bounding Commitments in Personalized Language Systems."

## Quick Start

```bash
node --version
npm run check
```

The checked-in validation path does not require API keys and does not make
provider calls. It recomputes the released summaries from sanitized fixtures,
released score rows, aggregate diagnostics, model-judge labels, and pairwise
winner choices.

## Release Boundary

The artifact intentionally contains:

- synthetic/composite fixtures and schema;
- released scored result rows and aggregate diagnostics;
- model-judge blinded item CSV, annotation keys, combined labels, pairwise
  winner choices, and run manifests;
- a sanitized `data/results/model-output-evidence.csv` view that joins the
  90-case blinded judge-sample outputs to automatic flags and judge scores;
- scripts for metric summaries, bootstrap intervals, selector diagnostics,
  release-table checks, and privacy-boundary checks.

The artifact intentionally does not contain:

- raw production histories, user identifiers, session rows, credentials, API
  endpoints, or server configuration;
- raw provider responses, prompt dumps, full provider JSON, or exact run
  timestamps;

The model-judge summaries in the paper are reproducible from the released
blinded item CSV, labels, pairwise winner choices, annotation keys, manifests,
scripts, and sanitized model-output evidence view. Full judge-call replay
requires an external OpenAI-compatible judge endpoint.

## Interpreting the Scope

This artifact supports reproduction of reported summary tables and diagnostic
checks from released, privacy-bounded artifacts. It is not a raw production-data
release and is not a full replay bundle for paid/provider-side model calls.
