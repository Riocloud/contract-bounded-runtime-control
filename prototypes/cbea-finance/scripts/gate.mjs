#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_FRESHNESS_HOURS = 24;
const LIVE_TRADE_MAX_POSITION_PCT = 1;
const DEFAULT_BUDGET_STATE = {
  market_regime: 'normal',
  portfolio_drawdown_pct: 0,
  max_drawdown_budget_pct: 5,
  global_risk_budget_pct: 1,
  current_exposure_pct: 0,
  symbol_caps: {},
  freshness_hours: {
    diagnostic: 24,
    fee_and_cost: 6,
    risk_and_exposure: 6,
    trade_action: 1,
    advice_and_recommendation: 24,
  },
};

function parseArgs(argv) {
  return new Map(argv.map((arg) => {
    const [key, ...rest] = arg.split('=');
    return [key.replace(/^--/, ''), rest.length > 0 ? rest.join('=') : true];
  }));
}

function hoursBetween(start, end) {
  const left = new Date(start);
  const right = new Date(end);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Number.POSITIVE_INFINITY;
  return Math.abs(right.getTime() - left.getTime()) / 36e5;
}

function hasProfitPromise(statement) {
  return /\b(guarantee|guaranteed|certain|risk[- ]?free|will profit|should be profitable|sure profit)\b/i.test(statement);
}

function isPersonalizedAdvice(claim) {
  return claim.claim_type === 'advice_and_recommendation'
    || claim.requested_commitment === 'client_recommendation'
    || /\b(your portfolio|fits your|you should|increase allocation|buy now|sell now)\b/i.test(claim.statement || '');
}

function hasFreshEvidence(claim, freshnessHours) {
  if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) return false;
  return claim.evidence.every((item) => hoursBetween(item.observed_at, claim.as_of) <= freshnessHours);
}

function missingRiskControls(claim) {
  const controls = claim.risk_controls || {};
  return !Number.isFinite(Number(controls.max_position_pct))
    || !Number.isFinite(Number(controls.max_drawdown_pct))
    || !Number.isFinite(Number(controls.leverage));
}

function missingWalkForwardBacktest(claim) {
  const backtest = claim.backtest || {};
  return backtest.walk_forward !== true
    || backtest.out_of_sample !== true
    || !Number.isFinite(Number(backtest.transaction_cost_bps))
    || !Number.isFinite(Number(backtest.slippage_bps))
    || Number(backtest.transaction_cost_bps) <= 0
    || Number(backtest.slippage_bps) <= 0;
}

function liveTradeTooLarge(claim) {
  const controls = claim.risk_controls || {};
  return Number(controls.max_position_pct) > LIVE_TRADE_MAX_POSITION_PCT
    || Number(controls.leverage) > 1;
}

function commitmentRank(commitment) {
  const ranks = {
    diagnostic_only: 0,
    qualified_diagnostic: 1,
    qualified_fee_estimate: 1,
    educational_only: 1,
    paper_trade_only: 2,
    live_small_allowed: 3,
  };
  return ranks[commitment] ?? 0;
}

function minCommitment(left, right) {
  return commitmentRank(left) <= commitmentRank(right) ? left : right;
}

function normalizeBudgetState(state = {}) {
  return {
    ...DEFAULT_BUDGET_STATE,
    ...state,
    symbol_caps: {
      ...DEFAULT_BUDGET_STATE.symbol_caps,
      ...(state.symbol_caps || {}),
    },
    freshness_hours: {
      ...DEFAULT_BUDGET_STATE.freshness_hours,
      ...(state.freshness_hours || {}),
    },
  };
}

export function allocateBudget(claim, budgetState = {}) {
  const state = normalizeBudgetState(budgetState);
  const requested = claim?.requested_commitment || 'diagnostic';
  const claimType = claim?.claim_type || 'risk_and_exposure';
  const symbol = claim?.symbol || '';
  const downgradeReasons = [];
  const riskBudgetRemaining = Math.max(
    0,
    Number(state.global_risk_budget_pct || 0) - Number(state.current_exposure_pct || 0),
  );
  const symbolCap = Number.isFinite(Number(state.symbol_caps?.[symbol]))
    ? Number(state.symbol_caps[symbol])
    : LIVE_TRADE_MAX_POSITION_PCT;
  const baseFreshness = Number(state.freshness_hours?.[claimType] ?? state.freshness_hours?.diagnostic ?? DEFAULT_FRESHNESS_HOURS);

  let maxAllowedCommitment = claim?.allowed_output || 'diagnostic_only';
  let maxPositionPct = Math.min(symbolCap, riskBudgetRemaining, LIVE_TRADE_MAX_POSITION_PCT);
  let freshnessHours = baseFreshness;

  if (requested === 'live_trade') {
    maxAllowedCommitment = minCommitment(maxAllowedCommitment, 'live_small_allowed');
    freshnessHours = Math.min(baseFreshness, Number(state.freshness_hours?.trade_action ?? 1));
  }

  if (state.market_regime === 'stressed') {
    downgradeReasons.push('stressed_market_regime');
    maxAllowedCommitment = 'diagnostic_only';
    maxPositionPct = 0;
    freshnessHours = Math.min(freshnessHours, Number(state.freshness_hours?.trade_action ?? 1));
  }

  if (Number(state.portfolio_drawdown_pct || 0) >= Number(state.max_drawdown_budget_pct || 5)) {
    downgradeReasons.push('drawdown_budget_exceeded');
    maxAllowedCommitment = 'diagnostic_only';
    maxPositionPct = 0;
  }

  if (requested === 'live_trade' && riskBudgetRemaining <= 0.5) {
    downgradeReasons.push('portfolio_risk_budget_exhausted');
    maxAllowedCommitment = 'diagnostic_only';
    maxPositionPct = 0;
  }

  if (claimType === 'advice_and_recommendation') {
    maxAllowedCommitment = 'educational_only';
  }

  return {
    market_regime: state.market_regime,
    max_allowed_commitment: maxAllowedCommitment,
    max_position_pct: Number(maxPositionPct.toFixed(4)),
    risk_budget_remaining_pct: Number(riskBudgetRemaining.toFixed(4)),
    freshness_hours: freshnessHours,
    downgrade_reasons: [...new Set(downgradeReasons)],
  };
}

function buildMessage(claim, status, reasons, allowedCommitment) {
  const readableCommitment = allowedCommitment.replaceAll('_', ' ');
  if (status === 'approved') {
    return `${claim.symbol}: approved as ${readableCommitment}. This is evidence-bounded and does not authorize profit promises or unreviewed trading.`;
  }
  if (status === 'qualified') {
    return `${claim.symbol}: only a ${readableCommitment} statement is allowed because ${reasons.join(', ')}. Fresh evidence is required before stronger wording.`;
  }
  if (status === 'escalate') {
    return `${claim.symbol}: route to human review. The agent may provide educational context, but may not make a personalized recommendation.`;
  }
  return `${claim.symbol}: CBEA cannot authorize a live trade or stronger financial commitment because ${reasons.join(', ')}. Keep the output diagnostic-only.`;
}

export function evaluateMarketClaim(claim, options = {}) {
  const budget = allocateBudget(claim, options.budgetState || {});
  const freshnessHours = Number(options.freshnessHours || budget.freshness_hours || DEFAULT_FRESHNESS_HOURS);
  const blockingReasons = [];
  const warnings = [];

  if (!claim || typeof claim !== 'object') {
    return {
      claim_id: '',
      status: 'rejected',
      allowed_commitment: 'diagnostic_only',
      blocking_reasons: ['invalid_claim_object'],
      warnings,
      budget,
      customer_safe_message: 'Invalid claim object. Keep the output diagnostic-only.',
    };
  }

  if (!claim.claim_id) blockingReasons.push('missing_claim_id');
  if (!claim.symbol) blockingReasons.push('missing_symbol');
  if (!claim.statement) blockingReasons.push('missing_statement');
  if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) blockingReasons.push('missing_evidence');
  if (Array.isArray(claim.evidence) && claim.evidence.length > 0 && !hasFreshEvidence(claim, freshnessHours)) {
    blockingReasons.push('stale_evidence');
  }
  if (claim.authority_state === 'prohibited') blockingReasons.push('prohibited_authority');
  if (claim.authority_state === 'missing') blockingReasons.push('missing_authority');
  if (claim.authority_state === 'stale') blockingReasons.push('stale_authority');
  if (hasProfitPromise(claim.statement || '')) blockingReasons.push('profit_language_detected');
  if (Array.isArray(claim.not_allowed) && claim.not_allowed.includes('trade_execution') && claim.requested_commitment === 'live_trade') {
    blockingReasons.push('trade_execution_not_allowed');
  }

  if (isPersonalizedAdvice(claim)) {
    blockingReasons.push('advice_boundary_requires_review');
  }

  if (claim.requested_commitment === 'live_trade') {
    if (missingRiskControls(claim)) blockingReasons.push('missing_risk_controls');
    if (missingWalkForwardBacktest(claim)) blockingReasons.push('missing_walk_forward_backtest');
    if (!missingRiskControls(claim) && liveTradeTooLarge(claim)) blockingReasons.push('live_trade_exceeds_small_cap');
    if (!missingRiskControls(claim) && Number(claim.risk_controls.max_position_pct) > budget.max_position_pct) {
      blockingReasons.push('position_exceeds_dynamic_budget');
    }
  }

  let status = 'approved';
  let allowedCommitment = minCommitment(claim.allowed_output || 'diagnostic_only', budget.max_allowed_commitment);
  const hardBlockers = blockingReasons.filter((reason) => [
    'missing_claim_id',
    'missing_symbol',
    'missing_statement',
    'missing_evidence',
    'prohibited_authority',
    'profit_language_detected',
    'trade_execution_not_allowed',
  ].includes(reason));

  if (claim.requested_commitment === 'live_trade' && blockingReasons.length > 0) {
    status = 'rejected';
    allowedCommitment = 'diagnostic_only';
  } else if (blockingReasons.includes('advice_boundary_requires_review')) {
    status = 'escalate';
    allowedCommitment = minCommitment(claim.allowed_output || 'educational_only', budget.max_allowed_commitment);
  } else if (hardBlockers.length > 0) {
    status = 'rejected';
    allowedCommitment = 'diagnostic_only';
  } else if (blockingReasons.length > 0) {
    status = 'qualified';
    allowedCommitment = minCommitment(claim.allowed_output || 'qualified_diagnostic', budget.max_allowed_commitment);
  } else if (budget.downgrade_reasons.length > 0 && budget.max_allowed_commitment === 'diagnostic_only') {
    status = claim.requested_commitment === 'live_trade' ? 'rejected' : 'qualified';
    allowedCommitment = 'diagnostic_only';
  }

  if (claim.requested_commitment === 'live_trade' && status === 'approved') {
    warnings.push('live_trade_requires_external_broker_supervision');
  }

  const uniqueReasons = [...new Set(blockingReasons)];
  return {
    claim_id: claim.claim_id || '',
    status,
    allowed_commitment: allowedCommitment,
    blocking_reasons: uniqueReasons,
    warnings,
    budget,
    evidence_ids: Array.isArray(claim.evidence) ? claim.evidence.map((item) => item.id).filter(Boolean) : [],
    customer_safe_message: buildMessage(claim, status, uniqueReasons, allowedCommitment),
  };
}

export function evaluateClaims(claims, options = {}) {
  return claims.map((claim) => ({
    claim,
    verdict: evaluateMarketClaim(claim, options),
  }));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function writeDiagnosticsCsv(results, filePath) {
  const headers = [
    'claim_id',
    'symbol',
    'claim_type',
    'requested_commitment',
    'status',
    'allowed_commitment',
    'budget_market_regime',
    'budget_max_position_pct',
    'budget_risk_remaining_pct',
    'budget_downgrade_reasons',
    'blocking_reasons',
    'evidence_ids',
  ];
  const rows = results.map(({ claim, verdict }) => [
    claim.claim_id,
    claim.symbol,
    claim.claim_type,
    claim.requested_commitment,
    verdict.status,
    verdict.allowed_commitment,
    verdict.budget.market_regime,
    verdict.budget.max_position_pct,
    verdict.budget.risk_budget_remaining_pct,
    verdict.budget.downgrade_reasons.join('|'),
    verdict.blocking_reasons.join('|'),
    verdict.evidence_ids.join('|'),
  ]);
  fs.writeFileSync(filePath, `${headers.join(',')}\n${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`);
}

function writeLedger(results, filePath) {
  const lines = results.map(({ claim, verdict }) => JSON.stringify({
    claim_id: claim.claim_id,
    symbol: claim.symbol,
    claim_type: claim.claim_type,
    requested_commitment: claim.requested_commitment,
    authority_state: claim.authority_state,
    as_of: claim.as_of,
    evidence_ids: verdict.evidence_ids,
    budget_snapshot: verdict.budget,
    verdict,
  }));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function writeMarketBrief(results, filePath) {
  const counts = results.reduce((acc, { verdict }) => {
    acc[verdict.status] = (acc[verdict.status] || 0) + 1;
    return acc;
  }, {});
  const lines = [
    '# CBEA Finance Local Demo',
    '',
    'This local run demonstrates evidence-bounded market commitments. It is not investment advice and does not execute trades.',
    '',
    '## Gate Summary',
    '',
    `- Approved: ${counts.approved || 0}`,
    `- Qualified: ${counts.qualified || 0}`,
    `- Escalated: ${counts.escalate || 0}`,
    `- Rejected: ${counts.rejected || 0}`,
    '',
    '## Dynamic Budget',
    '',
    'Each verdict records the market regime, freshness window, risk budget remaining, maximum allowed position size, and any downgrade reasons used by the gate.',
    '',
    '## Verdicts',
    '',
  ];
  for (const { claim, verdict } of results) {
    lines.push(`- ${claim.claim_id} (${claim.symbol}): ${verdict.status} -> ${verdict.allowed_commitment}. ${verdict.customer_safe_message}`);
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

export function runFinanceGate(inputPath, outDir, options = {}) {
  const claims = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(claims)) throw new Error(`Expected JSON array in ${inputPath}`);
  let budgetState = options.budgetState || {};
  if (options.budgetPath) {
    budgetState = JSON.parse(fs.readFileSync(options.budgetPath, 'utf8'));
  }
  const results = evaluateClaims(claims, { ...options, budgetState });

  fs.mkdirSync(outDir, { recursive: true });
  writeLedger(results, path.join(outDir, 'commitment-ledger.jsonl'));
  writeDiagnosticsCsv(results, path.join(outDir, 'gate-diagnostics.csv'));
  writeMarketBrief(results, path.join(outDir, 'market-brief.md'));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = String(args.get('input') || 'prototypes/cbea-finance/data/market-claims.sample.json');
  const out = String(args.get('out') || 'runs/cbea-finance-demo');
  const budgetPath = args.has('budget') ? String(args.get('budget')) : undefined;
  const freshnessHours = Number(args.get('freshness-hours') || DEFAULT_FRESHNESS_HOURS);
  const results = runFinanceGate(input, out, { freshnessHours, budgetPath });
  console.log(JSON.stringify({
    input,
    out,
    claims: results.length,
    statuses: results.reduce((acc, { verdict }) => {
      acc[verdict.status] = (acc[verdict.status] || 0) + 1;
      return acc;
    }, {}),
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
