import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { allocateBudget, evaluateMarketClaim } from './gate.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');

test('approves a fresh diagnostic market claim with bounded language', () => {
  const verdict = evaluateMarketClaim({
    claim_id: 'diagnostic-btc-risk',
    claim_type: 'risk_and_exposure',
    requested_commitment: 'diagnostic',
    symbol: 'BTCUSDT',
    statement: 'BTC downside volatility increased over the last 24 hours.',
    authority_state: 'confirmed',
    as_of: '2026-05-16T20:00:00Z',
    evidence: [
      {
        id: 'vol-24h',
        source: 'sample_market_snapshot',
        observed_at: '2026-05-16T19:55:00Z',
        metric: 'realized_vol_24h',
        value: 0.071,
      },
    ],
    allowed_output: 'diagnostic_only',
    not_allowed: ['profit_guarantee', 'personalized_investment_advice', 'trade_execution'],
  });

  assert.equal(verdict.status, 'approved');
  assert.equal(verdict.allowed_commitment, 'diagnostic_only');
  assert.deepEqual(verdict.blocking_reasons, []);
});

test('blocks a live trade commitment when evidence is stale and risk controls are missing', () => {
  const verdict = evaluateMarketClaim({
    claim_id: 'live-aapl-momentum',
    claim_type: 'trade_action',
    requested_commitment: 'live_trade',
    symbol: 'AAPL',
    statement: 'The agent should buy AAPL now because the signal should be profitable.',
    authority_state: 'confirmed',
    as_of: '2026-05-16T20:00:00Z',
    evidence: [
      {
        id: 'mom-20d',
        source: 'sample_price_window',
        observed_at: '2026-05-14T20:00:00Z',
        metric: 'momentum_20d',
        value: 0.043,
      },
    ],
    backtest: {
      walk_forward: false,
      out_of_sample: false,
      transaction_cost_bps: 0,
      slippage_bps: 0,
    },
    allowed_output: 'paper_trade_only',
    not_allowed: ['profit_guarantee', 'unreviewed_live_trade'],
  });

  assert.equal(verdict.status, 'rejected');
  assert.equal(verdict.allowed_commitment, 'diagnostic_only');
  assert.match(verdict.customer_safe_message, /cannot authorize a live trade/i);
  assert.ok(verdict.blocking_reasons.includes('stale_evidence'));
  assert.ok(verdict.blocking_reasons.includes('missing_risk_controls'));
  assert.ok(verdict.blocking_reasons.includes('missing_walk_forward_backtest'));
  assert.ok(verdict.blocking_reasons.includes('profit_language_detected'));
});

test('routes personalized advice commitments to human review even with evidence', () => {
  const verdict = evaluateMarketClaim({
    claim_id: 'advisor-portfolio-fit',
    claim_type: 'advice_and_recommendation',
    requested_commitment: 'client_recommendation',
    symbol: 'NVDA',
    statement: 'This position fits your portfolio and you should increase allocation.',
    authority_state: 'confirmed',
    as_of: '2026-05-16T20:00:00Z',
    evidence: [
      {
        id: 'trend-60d',
        source: 'sample_market_snapshot',
        observed_at: '2026-05-16T19:58:00Z',
        metric: 'trend_60d',
        value: 0.12,
      },
    ],
    risk_controls: {
      max_position_pct: 1,
      max_drawdown_pct: 3,
      leverage: 1,
    },
    allowed_output: 'educational_only',
    not_allowed: ['personalized_investment_advice'],
  });

  assert.equal(verdict.status, 'escalate');
  assert.equal(verdict.allowed_commitment, 'educational_only');
  assert.ok(verdict.blocking_reasons.includes('advice_boundary_requires_review'));
});

test('dynamic budget contracts live-trade authority during stressed market state', () => {
  const budget = allocateBudget({
    claim_type: 'trade_action',
    requested_commitment: 'live_trade',
    symbol: 'BTCUSDT',
  }, {
    market_regime: 'stressed',
    portfolio_drawdown_pct: 6,
    global_risk_budget_pct: 2,
    current_exposure_pct: 1.5,
    symbol_caps: {
      BTCUSDT: 0.75,
    },
    freshness_hours: {
      diagnostic: 24,
      trade_action: 1,
    },
  });

  assert.equal(budget.max_allowed_commitment, 'diagnostic_only');
  assert.equal(budget.max_position_pct, 0);
  assert.equal(budget.freshness_hours, 1);
  assert.ok(budget.downgrade_reasons.includes('stressed_market_regime'));
  assert.ok(budget.downgrade_reasons.includes('drawdown_budget_exceeded'));
  assert.ok(budget.downgrade_reasons.includes('portfolio_risk_budget_exhausted'));
});

test('approves a small live trade only when dynamic risk and evidence budgets allow it', () => {
  const claim = {
    claim_id: 'live-msft-small',
    claim_type: 'trade_action',
    requested_commitment: 'live_trade',
    symbol: 'MSFT',
    statement: 'The MSFT momentum signal can be tested with a small bounded live position.',
    authority_state: 'confirmed',
    as_of: '2026-05-16T20:00:00Z',
    evidence: [
      {
        id: 'msft-mom-20d',
        source: 'sample_price_window',
        observed_at: '2026-05-16T19:45:00Z',
        metric: 'momentum_20d',
        value: 0.031,
      },
    ],
    backtest: {
      walk_forward: true,
      out_of_sample: true,
      transaction_cost_bps: 8,
      slippage_bps: 5,
    },
    risk_controls: {
      max_position_pct: 0.25,
      max_drawdown_pct: 1.5,
      leverage: 1,
    },
    allowed_output: 'live_small_allowed',
    not_allowed: ['profit_guarantee', 'unbounded_position_size'],
  };

  const verdict = evaluateMarketClaim(claim, {
    budgetState: {
      market_regime: 'normal',
      portfolio_drawdown_pct: 1,
      global_risk_budget_pct: 3,
      current_exposure_pct: 1,
      symbol_caps: {
        MSFT: 0.5,
      },
      freshness_hours: {
        diagnostic: 24,
        trade_action: 1,
      },
    },
  });

  assert.equal(verdict.status, 'approved');
  assert.equal(verdict.allowed_commitment, 'live_small_allowed');
  assert.equal(verdict.budget.max_position_pct, 0.5);
  assert.equal(verdict.budget.risk_budget_remaining_pct, 2);
  assert.deepEqual(verdict.budget.downgrade_reasons, []);
  assert.ok(verdict.warnings.includes('live_trade_requires_external_broker_supervision'));
});

test('demo runner writes ledger, diagnostics, and market brief locally', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbea-finance-demo-'));
  const result = spawnSync(process.execPath, [
    'prototypes/cbea-finance/scripts/gate.mjs',
    '--input=prototypes/cbea-finance/data/market-claims.sample.json',
    '--budget=prototypes/cbea-finance/data/budget-state.sample.json',
    `--out=${outDir}`,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.ok(fs.existsSync(path.join(outDir, 'commitment-ledger.jsonl')));
  assert.ok(fs.existsSync(path.join(outDir, 'gate-diagnostics.csv')));
  assert.ok(fs.existsSync(path.join(outDir, 'market-brief.md')));

  const ledgerRows = fs.readFileSync(path.join(outDir, 'commitment-ledger.jsonl'), 'utf8').trim().split('\n');
  assert.equal(ledgerRows.length, 4);
  const entries = ledgerRows.map((line) => JSON.parse(line));
  const statuses = entries.map((entry) => entry.verdict.status);
  assert.deepEqual(statuses.sort(), ['approved', 'escalate', 'qualified', 'rejected']);
  assert.ok(entries.every((entry) => entry.verdict.budget));
  assert.ok(entries.every((entry) => entry.budget_snapshot));

  const brief = fs.readFileSync(path.join(outDir, 'market-brief.md'), 'utf8');
  assert.match(brief, /CBEA Finance Local Demo/);
  assert.match(brief, /Dynamic Budget/);
  assert.match(brief, /Rejected/);
  assert.doesNotMatch(brief, /guaranteed profit/i);
});
