# CBEA Finance Local Demo

This local prototype shows how CBEA can sit between market-data agents and
user-facing trading or market claims. It does not call external APIs, execute
trades, or provide investment advice.

## Workflow

```text
market or strategy agent draft
  -> MarketClaim JSON
  -> dynamic budget allocation
  -> CBEA finance gate
  -> CommitmentLedger JSONL
  -> diagnostics CSV and reviewer-safe market brief
```

The gate treats financial outputs as commitments with an authority boundary.
It checks whether a draft claim has current evidence, allowed authority,
bounded wording, risk controls, and walk-forward evidence before allowing a
stronger commitment. The budget allocator makes that boundary dynamic: market
regime, drawdown, exposure, symbol caps, and freshness policy determine how much
evidence and risk budget a claim can spend.

## Run

```bash
npm run finance:demo
```

Outputs are written to `runs/cbea-finance-demo/`:

- `commitment-ledger.jsonl`: one verdict object per claim.
- `gate-diagnostics.csv`: compact status table for inspection.
- `market-brief.md`: customer-safe summary of approved, qualified, escalated,
  and rejected claims.

To run the local tests:

```bash
npm run test:finance
```

## Claim Fields

The sample input lives at `prototypes/cbea-finance/data/market-claims.sample.json`.
The sample budget state lives at `prototypes/cbea-finance/data/budget-state.sample.json`.

Key fields:

- `claim_type`: financial commitment category, such as
  `risk_and_exposure`, `fee_and_cost`, `trade_action`, or
  `advice_and_recommendation`.
- `requested_commitment`: the strength requested by the agent, such as
  `diagnostic`, `fee_estimate`, `client_recommendation`, or `live_trade`.
- `authority_state`: `confirmed`, `missing`, `stale`, or `prohibited`.
- `evidence`: timestamped source rows or derived metrics supporting the claim.
- `risk_controls`: position, drawdown, and leverage limits for executable
  trading claims.
- `backtest`: walk-forward and out-of-sample evidence for trading claims.
- `allowed_output` and `not_allowed`: the commitment boundary supplied by the
  governance layer.

## Dynamic Budget Fields

The budget state is intentionally small:

- `market_regime`: `normal` or `stressed`.
- `portfolio_drawdown_pct`: current drawdown used to contract authority.
- `max_drawdown_budget_pct`: drawdown threshold where live action is disabled.
- `global_risk_budget_pct`: total risk budget available to the agent flow.
- `current_exposure_pct`: budget already spent by open positions.
- `symbol_caps`: per-symbol maximum position sizes.
- `freshness_hours`: required evidence freshness by claim type.

Each ledger row records `budget_snapshot` and the same object inside
`verdict.budget`, including `max_allowed_commitment`, `max_position_pct`,
`risk_budget_remaining_pct`, `freshness_hours`, and `downgrade_reasons`.

## Boundary

This prototype is a local system slice, not a profitable trading agent. It is
intended to demonstrate the transition from market signals to evidence-bounded
commitments. In a live integration, the gate should sit before any broker,
exchange, report, or customer-facing channel.
