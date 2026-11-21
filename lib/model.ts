// The token radar's model (radar-5): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other protocol that passes the same exclusion test the watchlist was built from: the early rows the
// radar exists to find. A protocol is pre-token when its index entry records no token (no market cap,
// no CoinGecko id, no symbol); the snapshot's live-token protocols are kept apart and shown as the
// market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, through a curve FITTED to this
// snapshot at run time:
//
//   log(implied) = intercept + slope x log(tvl_usd) + chainOffset(firstChain)
//   implied      = max(1, round(exp(intercept + slope x ln(tvl_usd) + chainOffset)))
//
// intercept, slope and the five chain offsets are the ridge-shrunk least-squares fit of
// log(market cap) on log(TVL) plus first-chain dummies over the snapshot's live-token protocols
// (market cap, CoinGecko id and symbol all present, CEX excluded, TVL and market cap positive).
// The chain dummies are for the five most common first chains among the comparables — Ethereum,
// Binance, Base, Solana, Arbitrum — each shrunk with ridge penalty 10 on its coefficient only
// (intercept and slope unpenalised); a protocol whose first chain is none of the five, or that
// names no chain, gets offset 0. No coefficient is hardcoded: a new snapshot refits the curve
// from its own figures. The fit is a size curve with a chain shift, not a flat multiple: the market
// pays a smaller multiple per dollar of TVL as a protocol gets bigger, and the slope (0.43 on this
// snapshot, well under 1) is that fact measured, not assumed. No protocol name is ever
// special-cased: the same function scores every row. The intercept is UNcentered (log market cap
// at TVL = $1 for a protocol with no chain offset), so the dashboard's chart and its
// "k x TVL^slope" line use the same numbers as the board with no conversion (the chart line is
// the no-offset curve; a row's own offset is shown in its detail view).
//
// WHY THIS SHAPE — the blind test (see NOTES-model.md for the full numbers). On this snapshot's
// 119 live-token comparables, predicting log(market cap):
//   flat median multiple (radar-2):  leave-one-out mean abs log error 1.77, walk-forward 1.89
//   log-log size curve (radar-3):    leave-one-out 1.57, walk-forward 1.63
//   size curve + first-chain dummies, ridge 10 (radar-4):
//                                    leave-one-out 1.54, walk-forward 1.57
//   walk-forward = train on protocols listed before a cutoff, test on those listed after, at four
//   cutoffs (2024-01-01, 2024-07-01, 2025-01-01, 2025-07-01); the radar-4 model beats the
//   radar-3 curve at every cutoff (per-cutoff 1.485 / 1.537 / 1.600 / 1.826 vs 1.514 / 1.577 /
//   1.672 / 1.954). Median absolute % error: 83.3% vs 84.6% leave-one-out, 75.6% vs 77.2%
//   walk-forward. The chain shift is real, not a shrinkage artefact: it survives ridge penalties
//   from 3 to 100, survives dropping any one dummy (including Arbitrum, whose offset rests on
//   four comparables), and survives the rankable-like subset (n = 94, Bridge / Liquid Staking
//   excluded: leave-one-out 1.50 vs 1.52, walk-forward 1.52 vs 1.55). It does NOT survive the
//   TVL >= $50M-only subset (n = 45: 1.59 vs 1.59 leave-one-out, 1.52 vs 1.50 walk-forward),
//   so the chain shift is an effect among the smaller protocols that dominate the board, not
//   among the largest ones. The full-fit offsets on this snapshot: Ethereum +0.50, Binance
//   +0.30, Base -0.13, Solana -0.35, Arbitrum +0.75 — Ethereum-first protocols trade at roughly
//   1.6x the market cap of a same-TVL protocol on another chain, Solana-first at roughly 0.7x.
//   The unshrunk dummies do NOT survive (leave-one-out 1.60, walk-forward 1.64): the ridge is
//   load-bearing, which is why the penalty is part of the contract, not a tuning detail.
// Terms the blind test REJECTED, and the model does not carry:
//   category offsets — worse leave-one-out (1.63 vs 1.57) and singular in walk-forward training
//     sets, where a category has no earlier protocol; the per-category samples (1 to 15) are noise.
//   a 7-day growth term — the fitted coefficient is NEGATIVE (-1.88 per unit of growth fraction:
//     a protocol that just spiked in TVL is worth less per TVL dollar, not more), it worsens
//     leave-one-out (1.60 vs 1.57) and worsens walk-forward median % error (85.5% vs 77.2%);
//     its small mean-error gain at three of four cutoffs is inside noise. Dropped, not shrunk.
//   an age term (log1p(age_days)) — worsens walk-forward badly (1.90 vs 1.63 pooled) and
//     leave-one-out slightly (1.59 vs 1.57). Dropped. Age is still recorded on every row and
//     shown, and still sets the farm plan's hold length; it is not a value term.
//   a quadratic size term — no gain leave-one-out (1.59) or walk-forward (1.63). Dropped.
//   (radar-4 rejections, blind-tested on the same 119 comparables; numbers in NOTES-model.md)
//   chains count / multi-chain indicator — no gain on either test (leave-one-out 1.58,
//     walk-forward 1.64); the count's coefficient is ~0 once the first chain is known.
//   an Ethereum-first dummy alone — no leave-one-out gain (1.5722 vs 1.5722) and only 2 of 4
//     walk-forward cutoffs; the effect needs the full five-chain set, not one dummy.
//   Huber / LAD robust fits of the size curve — Huber wins on mean error (leave-one-out 1.57,
//     walk-forward 1.59) but worsens walk-forward median % error (83.6% vs 77.2%) and loses
//     leave-one-out on the rankable-like subset; LAD is worse on both. Dropped, including the
//     Huber + chain-dummies combination (better mean error still, worse median % error).
//   a piecewise two-segment size curve (breakpoint searched in-train) — worse on both tests
//     (leave-one-out 1.59, walk-forward 1.67). Dropped.
//   a spike-penalty indicator (change_7d > 20%) — UNIDENTIFIABLE, not merely worse: no live-token
//     comparable gained more than 2.7% in 7 days, so the indicator is identically zero on the
//     training population and its coefficient cannot be estimated from this snapshot at all.
//     The estimable analogues (positive-week indicator, -20% downside indicator) are both worse
//     on both tests. Dropped; any spike coefficient would be invented, not measured.
//   growth with a new transform (signed sqrt, winsorised to ±10% or ±20%) — all worse on both
//     tests (leave-one-out 1.59, walk-forward 1.61–1.67). Dropped; the growth signal is the
//     mean-reversion already rejected in radar-3, and no transform rescues it.
//   slope x category interactions (ridge-shrunk) — worse leave-one-out (1.58–1.59) and no
//     walk-forward gain (1.62). Dropped.
//   TVL-weighted least squares (weight TVL or sqrt(TVL)) — worse on both tests, badly for the
//     full TVL weight (walk-forward 1.88). Dropped.
//   log TVL per chain — wins walk-forward (1.58) but loses leave-one-out (1.58 vs 1.57). Dropped
//     by the ship rule, which requires both.
//   Residual-noise rank ranges: adding the fit's leave-one-out residual noise (sd 2.06 log units)
//     to each row's log implied value over 200 refits gives rank ranges of median width 195 of a
//     possible 197 — every row's range covers nearly the whole board, the top row changes in 97%
//     of refits. That is the honest predictive uncertainty (adjacent rows are far closer in
//     implied value than the model's error), and it is NOT shipped as rank ranges: a range that
//     wide carries no information. The shipped ranges stay the parameter-bootstrap ranges below,
//     which measure fit stability, and the residual-noise finding is stated in the dossier text
//     instead: read the board as tiers, not a precise ranking.
// The fitted curve is refit on the same comparables for the rank ranges: 200 bootstrap resamples
// (seed 20261117, mulberry32) each refit the curve and re-rank the board, and every row carries
// rank_low / rank_high, the min and max rank it took across refits. A row whose range is wide is
// a row the curve is unsure about, and the dashboard shows the range. Unlike radar-3, these
// ranges now MOVE: the chain offsets make implied value a function of first chain as well as
// TVL, so a refit can reorder rows (195 of 198 rows move rank between the radar-3 curve and
// this model; mean |Δrank| 23.9).
//
// One limit the snapshot forces: DefiLlama's parentProtocol is not one of the snapshot's ten fields,
// so the exclusion below uses every field the snapshot carries (category, name, version marker) and
// the house's watchlist itself. A below-floor protocol whose parent the snapshot does not name could
// still slip in; the board therefore says a protocol "records no token", never that it has none.
//
// CONTRACT (radar-5) — the dashboard's app.js mirrors this byte-for-byte; change one, change both:
//   ModelConstants fields: intercept, slope, chainEthereum, chainBinance, chainBase,
//     chainSolana, chainArbitrum, comp_count. The five chain fields are the ridge-shrunk
//     first-chain offsets (penalty 10, see CHAIN_RIDGE); a chain not among the five has offset 0.
//   impliedOf(tvl_usd, firstChain, model) = max(1, round(exp(intercept + slope x ln(tvl_usd)
//     + chainOffset))), with implied 1 when tvl_usd <= 0, where chainOffset is model.chainEthereum
//     when firstChain is 'Ethereum', model.chainBinance for 'Binance', model.chainBase for 'Base',
//     model.chainSolana for 'Solana', model.chainArbitrum for 'Arbitrum', and 0 otherwise
//     (including firstChain null). The intercept is uncentered: the chart line is
//     log10(mcap) = (intercept + slope x ln(tvl_usd)) / ln(10), the no-offset curve, and the
//     curve's coefficient is k = exp(intercept), so the page may also write the no-offset implied
//     value as k x tvl_usd^slope and then multiply by exp(chainOffset) for the row's chain.
//   RadarData.fit = { intercept, slope, chainEthereum, chainBinance, chainBase, chainSolana,
//     chainArbitrum, n_comps, r2, n_refits }: the same fit, for the page's fit panels and chart
//     (n_comps == model.comp_count; n_refits == rank_range_refits == 200).
//   RadarData.oos = { metric, flat, fitted, flat_loo, fitted_loo, cutoffs, kept_terms,
//     dropped_terms }: the blind test, MEASURED AT RUN TIME from the snapshot (see measureOos):
//     metric is 'mean absolute log error'; flat/fitted are the walk-forward pooled errors of the
//     flat median multiple and the fitted model; flat_loo/fitted_loo are the leave-one-out
//     errors; cutoffs are the walk-forward cutoff dates; kept_terms/dropped_terms name the terms
//     the blind test kept and dropped.
//   farmSteps(p, age_days, implied_value_usd, cutoffs): capital by TVL tier (TVL >= 5B: $250; >= 1B: $150;
//     >= 100M: $100; else $50); hold days by age (age null: 30; < 180: 60; < 365: 45; else 30);
//     gas per transaction by first chain (Ethereum $5.00; Solana/Sui/Aptos $0.10; BSC $0.30;
//     Polygon $0.20; Arbitrum/Optimism/Base/zkSync Era/Linea/Scroll/Blast/Mode/Mantle/Starknet/
//     Avalanche $0.50; any other chain $1.00); transactions = 2 setup + ceil(hold/7) weekly +
//     1 exit + 1 claim; total gas = transactions x gas per transaction, rounded to cents.
//     Verdict from implied value per $1 of capital (implied / capital tier), against the board's
//     own tercile cutoffs (farmCutoffs: lo is the midpoint between the values a third and a
//     third-plus-one of the way up the board's sorted implied-per-capital list, hi the midpoint
//     between the two-thirds and two-thirds-plus-one values; RadarData.farm_cutoffs publishes
//     them, so the page uses the same numbers): at or above hi FARM (full capital, weekly actions
//     over the whole hold); at or above lo THIN (capital halved, minimum $25, two qualifying actions in
//     the first 30 days, gas = 6 transactions); below lo SKIP (no deposit now, $0 spent — a watch
//     plan, not an empty one: the step states the exact implied-value trigger that promotes the
//     row to THIN (lo x capital, or hi x capital when one demotion caps it at THIN; no trigger
//     when two demotions cap it at SKIP), and the exact farm steps to take the week it fires,
//     THIN-sized). Two one-tier demotions, each at most once: stale — age_days >= 1095 (3 years
//     listed, still records no token); gas-drag — the full plan's gas exceeds the capital tier.
//     SKIP is priority triage under limited capital, not "uneconomic": on this snapshot every gas
//     bill is under 1/57,000 of implied value. The last step always nets the plan: gas spent,
//     capital returned on exit, days locked, implied value, implied value per $1 of capital, the
//     tercile cutoffs, every demotion that fired, and the verdict.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/**
 * The model's constants: the fitted log-log size curve plus first-chain offsets, as the
 * dashboard states them and the sandbox may change them. intercept is log(market cap) at TVL
 * = $1 for a protocol with no chain offset (uncentered, so the page's chart and its
 * "k x TVL^slope" line need no conversion); slope is the elasticity of market cap with respect
 * to TVL; the chain* fields are the ridge-shrunk offsets for the five dummy chains (0 for any
 * other first chain, including none); comp_count is how many live-token protocols the fit used.
 */
export interface ModelConstants {
  intercept: number;
  slope: number;
  chainEthereum: number;
  chainBinance: number;
  chainBase: number;
  chainSolana: number;
  chainArbitrum: number;
  comp_count: number;
}

export const MODEL: ModelConstants = {
  // Fallback only: buildRadar replaces this with the snapshot-fitted curve (see fitValueModel).
  // Slope 1 with intercept log(0.25) is exactly implied = 0.25 x TVL, the old fallback multiple,
  // so a board can still be scored when the snapshot carries too few live-token comparables to
  // fit from. Chain offsets are 0 in the fallback: no chain shift without comparables to fit it.
  intercept: Math.log(0.25),
  slope: 1,
  chainEthereum: 0,
  chainBinance: 0,
  chainBase: 0,
  chainSolana: 0,
  chainArbitrum: 0,
  comp_count: 0,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token comparables the fit needs before it trusts the curve. */
export const CALIBRATION_MIN_COMPS = 5;

/** Bootstrap refits behind every row's rank range; the seed makes the board deterministic. */
export const BOOTSTRAP_REFITS = 200;
export const BOOTSTRAP_SEED = 20261117;

/** A seeded generator (mulberry32): the same seed gives the same bootstrap every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fitted point: log TVL against log market cap, with the listing date for walk-forward. */
interface FitPoint {
  logTvl: number;
  logMcap: number;
  listedAt: string | null;
  firstChain: string | null;
}

/** The first chains that carry a dummy: the five most common among the comparables. */
export const CHAIN_DUMMIES = ['Ethereum', 'Binance', 'Base', 'Solana', 'Arbitrum'] as const;

/**
 * The ridge penalty on each chain dummy's coefficient (intercept and slope unpenalised).
 * The penalty is load-bearing: the unshrunk dummies fail the blind test (leave-one-out 1.60,
 * walk-forward 1.64), while penalties from 3 to 100 all beat the radar-3 curve on both tests;
 * 10 is the pre-registered value, not the best of the sweep.
 */
export const CHAIN_RIDGE = 10;

/** The design row of a point: intercept, log TVL, then one dummy per chain in CHAIN_DUMMIES. */
function designRow(p: FitPoint): number[] {
  return [1, p.logTvl, ...CHAIN_DUMMIES.map((c) => (p.firstChain === c ? 1 : 0))];
}

/** Solve a small dense linear system by Gauss-Jordan with partial pivoting, or null if singular. */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    if (Math.abs(m[piv]![c]!) < 1e-12) return null;
    const tmp = m[c]!;
    m[c] = m[piv]!;
    m[piv] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/**
 * The ridge-shrunk fit through the points: log(market cap) on log(TVL) plus first-chain
 * dummies, penalty CHAIN_RIDGE on the dummy coefficients only. Returns the fitted constants
 * (rounded to 4dp, as the radar-3 fit was) with R-squared, or null when unidentified. The
 * penalty keeps the solve identified even when a training set has no protocol on some dummy
 * chain — the failure that sank the plain category offsets in radar-3.
 */
function ridgeFit(points: FitPoint[]): { model: ModelConstants; r2: number } | null {
  const p = 2 + CHAIN_DUMMIES.length;
  if (points.length < 2) return null;
  const xtx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xty: number[] = new Array<number>(p).fill(0);
  for (const pt of points) {
    const x = designRow(pt);
    for (let a = 0; a < p; a++) {
      xty[a]! += x[a]! * pt.logMcap;
      for (let b = 0; b < p; b++) xtx[a]![b]! += x[a]! * x[b]!;
    }
  }
  for (let a = 2; a < p; a++) xtx[a]![a]! += CHAIN_RIDGE;
  const beta = solveLinear(xtx, xty);
  if (beta === null || beta.some((v) => !Number.isFinite(v))) return null;
  const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
  const model: ModelConstants = {
    intercept: round4(beta[0]!),
    slope: round4(beta[1]!),
    chainEthereum: round4(beta[2]!),
    chainBinance: round4(beta[3]!),
    chainBase: round4(beta[4]!),
    chainSolana: round4(beta[5]!),
    chainArbitrum: round4(beta[6]!),
    comp_count: points.length,
  };
  const meanY = points.reduce((a, pt) => a + pt.logMcap, 0) / points.length;
  let ssRes = 0;
  let ssTot = 0;
  for (const pt of points) {
    const pred = model.intercept + model.slope * pt.logTvl + chainOffsetOf(pt.firstChain, model);
    ssRes += (pt.logMcap - pred) * (pt.logMcap - pred);
    ssTot += (pt.logMcap - meanY) * (pt.logMcap - meanY);
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { model, r2: round4(r2) };
}

/** The chain offset a first chain carries under `model`: one of the five dummies, else 0. */
export function chainOffsetOf(firstChain: string | null, model: ModelConstants): number {
  switch (firstChain) {
    case 'Ethereum':
      return model.chainEthereum;
    case 'Binance':
      return model.chainBinance;
    case 'Base':
      return model.chainBase;
    case 'Solana':
      return model.chainSolana;
    case 'Arbitrum':
      return model.chainArbitrum;
    default:
      return 0;
  }
}

/** The snapshot's live-token comparables: token trades, CEX excluded. */
function compPoints(snapshot: Snapshot): FitPoint[] {
  const points: FitPoint[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.gecko_id === null || p.symbol === null) continue;
    if (p.category === 'CEX') continue;
    if (!(p.tvl_usd > 0) || !(p.mcap_usd > 0)) continue;
    points.push({
      logTvl: Math.log(p.tvl_usd),
      logMcap: Math.log(p.mcap_usd),
      listedAt: p.listed_at,
      firstChain: p.chains.length > 0 ? p.chains[0]! : null,
    });
  }
  return points;
}

/**
 * The value curve, fitted from the snapshot at run time: the ridge-shrunk least-squares fit of
 * log(market cap) on log(TVL) plus first-chain dummies over the live-token protocols, with its
 * R-squared. Falls back to the flat 0.25 multiple when the snapshot carries too few comparables
 * to fit from.
 */
export function fitValueModel(snapshot: Snapshot): { model: ModelConstants; r2: number | null } {
  const points = compPoints(snapshot);
  if (points.length < CALIBRATION_MIN_COMPS) return { model: { ...MODEL }, r2: null };
  const fit = ridgeFit(points);
  if (fit === null) return { model: { ...MODEL }, r2: null };
  return { model: fit.model, r2: fit.r2 };
}

/** The model the board is scored with: the snapshot-fitted size curve. */
export function calibratedModel(snapshot: Snapshot): ModelConstants {
  return fitValueModel(snapshot).model;
}

/** The walk-forward cutoff dates the blind test trains before and tests after. */
export const WALK_FORWARD_CUTOFFS = ['2024-01-01', '2024-07-01', '2025-01-01', '2025-07-01'];

/** The blind test's numbers, measured at run time from the snapshot's own comparables. */
export interface OosSummary {
  metric: string;
  flat: number | null;
  fitted: number | null;
  flat_loo: number | null;
  fitted_loo: number | null;
  cutoffs: string[];
  kept_terms: string[];
  dropped_terms: string[];
}

/** The median of a list, or null when it is empty. */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The mean absolute log error of a list of log errors, or null when it is empty. */
function male(errs: number[]): number | null {
  if (errs.length === 0) return null;
  const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
  return round4(errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length);
}

/**
 * The blind test, measured at run time: leave-one-out and walk-forward mean absolute log error
 * of the flat median multiple against the fitted size curve with first-chain dummies, on the
 * snapshot's live-token comparables. Walk-forward trains on protocols listed before a cutoff and
 * tests on those listed after; a cutoff is skipped when its training set is under 10 or its test
 * set under 5. The kept/dropped term lists are the verdict of that test on this snapshot: only
 * the log-TVL size curve plus the ridge-shrunk first-chain dummies survived; category offsets,
 * the 7-day growth term, the age term, a quadratic size term and every radar-4 candidate but the
 * chain dummies made held-out error worse — or, for the spike penalty, could not be estimated
 * at all — and were dropped (see NOTES-model.md for the numbers).
 */
export function measureOos(snapshot: Snapshot): OosSummary {
  const points = compPoints(snapshot);
  const kept = ['log TVL (size curve)', 'first-chain dummies (ridge 10)'];
  const dropped = [
    'category offsets',
    '7-day growth',
    'age (log1p)',
    'quadratic size term',
    'chains count / multi-chain',
    'Ethereum-first dummy alone',
    'Huber / LAD robust fit',
    'piecewise size hinge',
    'spike penalty (no support among comps)',
    'growth transforms (signed sqrt / winsorised)',
    'slope x category',
    'TVL-weighted least squares',
    'log TVL per chain',
  ];
  const empty: OosSummary = {
    metric: 'mean absolute log error',
    flat: null,
    fitted: null,
    flat_loo: null,
    fitted_loo: null,
    cutoffs: [...WALK_FORWARD_CUTOFFS],
    kept_terms: kept,
    dropped_terms: dropped,
  };
  if (points.length < CALIBRATION_MIN_COMPS) return empty;
  // Leave-one-out.
  const looFlat: number[] = [];
  const looFitted: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const train = points.filter((_, j) => j !== i);
    const held = points[i]!;
    const med = median(train.map((t) => Math.exp(t.logMcap - t.logTvl)));
    if (med !== null) looFlat.push(Math.log(med) + held.logTvl - held.logMcap);
    const fit = ridgeFit(train);
    if (fit !== null) {
      looFitted.push(fit.model.intercept + fit.model.slope * held.logTvl + chainOffsetOf(held.firstChain, fit.model) - held.logMcap);
    }
  }
  // Walk-forward, pooled over the cutoffs.
  const wfFlat: number[] = [];
  const wfFitted: number[] = [];
  const listed = points.filter((p) => p.listedAt !== null);
  for (const cut of WALK_FORWARD_CUTOFFS) {
    const train = listed.filter((p) => p.listedAt! < cut);
    const test = listed.filter((p) => p.listedAt! >= cut);
    if (train.length < 10 || test.length < 5) continue;
    const med = median(train.map((t) => Math.exp(t.logMcap - t.logTvl)));
    const fit = ridgeFit(train);
    for (const t of test) {
      if (med !== null) wfFlat.push(Math.log(med) + t.logTvl - t.logMcap);
      if (fit !== null) {
        wfFitted.push(fit.model.intercept + fit.model.slope * t.logTvl + chainOffsetOf(t.firstChain, fit.model) - t.logMcap);
      }
    }
  }
  return {
    ...empty,
    flat: male(wfFlat),
    fitted: male(wfFitted),
    flat_loo: male(looFlat),
    fitted_loo: male(looFitted),
  };
}

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  rank_low: number;
  rank_high: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    intercept: number;
    slope: number;
    chainEthereum: number;
    chainBinance: number;
    chainBase: number;
    chainSolana: number;
    chainArbitrum: number;
    comp_count: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  rank_low: number;
  rank_high: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The fitted curve, for the dashboard's fit panels and chart (n_comps == model.comp_count). */
export interface FitSummary {
  intercept: number;
  slope: number;
  chainEthereum: number;
  chainBinance: number;
  chainBase: number;
  chainSolana: number;
  chainArbitrum: number;
  n_comps: number;
  r2: number | null;
  n_refits: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: FitSummary;
  oos: OosSummary;
  rank_range_refits: number;
  /** The farm plan's tercile cutoffs (implied value per $1 of capital), measured from this board. */
  farm_cutoffs: FarmCutoffs;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The implied value one protocol gets under the fitted size curve with its chain offset. */
export function impliedOf(tvlUsd: number, firstChain: string | null, model: ModelConstants): number {
  if (!(tvlUsd > 0)) return 1;
  const logImplied = model.intercept + model.slope * Math.log(tvlUsd) + chainOffsetOf(firstChain, model);
  if (!Number.isFinite(logImplied)) return 1;
  return Math.max(1, Math.round(Math.exp(logImplied)));
}

/** The implied value and the age one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; age: number | null } {
  const firstChain = protocol.chains.length > 0 ? protocol.chains[0]! : null;
  return { implied: impliedOf(protocol.tvl_usd, firstChain, model), age: ageDays(asOf, protocol.listed_at) };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The watchlist's own exclusion, applied to every row the board ranks, not just the watchlist: the
 * categories of wrapped, staked and bridged products, the whole words wrapped / staked / staking in
 * a name, and names that begin with an exchange's name. The house's watchlist was built with this
 * plus DefiLlama's parentProtocol, which the snapshot does not carry; everything checkable here is
 * checked here.
 */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, not a wrapped, staked or bridged product
 * of a token that already trades, not an exchange, not a versioned pool. The watchlist's 40 slugs
 * all pass this; it is the same test for the early rows below the floor.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    (p.category === null || !EXCLUDED_CATEGORIES.has(p.category)) &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/**
 * Every row's rank range over bootstrap refits of the curve: resample the comparables with
 * replacement, refit, re-rank the board, and keep the lowest and highest rank each row took.
 * Seeded, so the same snapshot writes the same ranges every run. A refit that cannot be solved
 * (no spread in the resample) is skipped, not counted.
 */
function rankRanges(
  chosen: SnapshotProtocol[],
  points: FitPoint[],
): Map<string, { low: number; high: number }> {
  const ranges = new Map<string, { low: number; high: number }>();
  for (const p of chosen) ranges.set(p.slug, { low: Number.POSITIVE_INFINITY, high: 0 });
  const rand = mulberry32(BOOTSTRAP_SEED);
  const n = points.length;
  for (let b = 0; b < BOOTSTRAP_REFITS; b++) {
    const resample: FitPoint[] = [];
    for (let i = 0; i < n; i++) resample.push(points[Math.floor(rand() * n)]!);
    const refit = ridgeFit(resample);
    if (refit === null) continue;
    const refitModel: ModelConstants = refit.model;
    const ranked = [...chosen]
      .map((p) => ({ slug: p.slug, implied: impliedOf(p.tvl_usd, p.chains.length > 0 ? p.chains[0]! : null, refitModel) }))
      .sort((a, b2) => b2.implied - a.implied || (a.slug < b2.slug ? -1 : a.slug > b2.slug ? 1 : 0));
    ranked.forEach((r, i) => {
      const range = ranges.get(r.slug)!;
      const rank = i + 1;
      if (rank < range.low) range.low = rank;
      if (rank > range.high) range.high = rank;
    });
  }
  // A row no refit ever ranked (impossible in practice) keeps its own rank; the caller fills it.
  return ranges;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other protocol that passes the same exclusion test as the watchlist, at
  // any size — no TVL cap, no row cap. The board is the whole rankable universe the snapshot
  // carries, so the ranking, not a cutoff, decides what a reader sees first.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { implied, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const ranges = rankRanges([...chosen.values()], compPoints(snapshot));
  const cutoffs = farmCutoffs(scored.map((s) => s.implied / capitalFor(s.p)));
  return scored.map((s, i) => {
    const range = ranges.get(s.p.slug);
    const rank = i + 1;
    return {
      rank,
      rank_low: range !== undefined && Number.isFinite(range.low) ? range.low : rank,
      rank_high: range !== undefined && range.high > 0 ? range.high : rank,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        intercept: model.intercept,
        slope: model.slope,
        chainEthereum: model.chainEthereum,
        chainBinance: model.chainBinance,
        chainBase: model.chainBase,
        chainSolana: model.chainSolana,
        chainArbitrum: model.chainArbitrum,
        comp_count: model.comp_count,
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age, s.implied, cutoffs).map(stepText),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Whole dollars with thousands separators. */
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** A gas amount in dollars, always to the cent. */
function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: { tvl_usd: number }): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The gas one transaction costs on a chain, in dollars: mainnet dear, cheap chains cheap. */
const GAS_PER_TX: Record<string, number> = {
  Ethereum: 5,
  Solana: 0.1,
  Sui: 0.1,
  Aptos: 0.1,
  BSC: 0.3,
  Polygon: 0.2,
  Arbitrum: 0.5,
  Optimism: 0.5,
  Base: 0.5,
  'zkSync Era': 0.5,
  Linea: 0.5,
  Scroll: 0.5,
  Blast: 0.5,
  Mode: 0.5,
  Mantle: 0.5,
  Starknet: 0.5,
  Avalanche: 0.5,
};

/** The gas one transaction costs on `chain`, in dollars; $1.00 where the chain is not listed. */
function gasPerTx(chain: string): number {
  return GAS_PER_TX[chain] ?? 1;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, and a last step that
 * nets the whole plan. The plan is derived from the protocol's own record (category, chains, TVL,
 * age, implied value), never from a hand-written list of names.
 *
 * The costing: capital by TVL tier (see capitalFor), gas per transaction by first chain (see
 * GAS_PER_TX), transactions = 2 to set up (approve + deposit) + one qualifying action a week
 * over the hold + 1 to exit + 1 to claim. The capital is returned on exit, so the net cost of
 * farming is the gas; the verdict triages the farmer's scarce resource, capital, by implied
 * value per $1 of capital against the board's own tercile cutoffs (see farmCutoffs and
 * farmVerdict): top third FARM (full capital, weekly actions over the whole hold), middle third
 * THIN (capital halved, minimum $25, two qualifying actions in the first 30 days, 6
 * transactions of gas), bottom third SKIP (no deposit now, $0 spent — a watch plan: the step
 * states the exact implied-value trigger that promotes the row to THIN and the exact farm
 * steps to take the week it fires, THIN-sized; no trigger when two demotions cap it at SKIP).
 * Two one-tier demotions, each at most once: stale (listed >= 1095 days, still records no
 * token) and gas-drag (the full plan's gas exceeds the capital tier). SKIP is priority triage
 * under limited capital, not "uneconomic": on this snapshot the dearest gas bill is still under
 * 1/57,000 of the smallest implied value. The last step always nets the plan and states the
 * reason: gas spent, capital returned on exit, days locked, implied value, implied value per $1
 * of capital, the tercile cutoffs, every demotion that fired, and the verdict.
 *
 * Deliberately identical to the dashboard's own derivation (dashboard/app.js farmSteps): the page
 * recomputes this plan for its detail view, so any change here must be made there in the same edit
 * or the board and the page will show different plans for the same protocol. See the CONTRACT at
 * the top of this file.
 */
/** The board's farm tercile cutoffs: implied value per $1 of capital, measured from the board itself. */
export interface FarmCutoffs {
  lo: number;
  hi: number;
}

/**
 * The tercile cutoffs of a list of implied-per-capital values, sorted ascending: lo is the
 * midpoint between the values a third and a third-plus-one of the way up the list, hi the
 * midpoint between the two-thirds and two-thirds-plus-one values (indices floor(n/3)-1 and
 * floor(n/3), and floor(2n/3)-1 and floor(2n/3); a list under 3 rows puts both cutoffs at its
 * smallest value). Midpoints, not the boundary values themselves, so "at or above hi" is
 * exactly the top third and "at or above lo" exactly the top two thirds when no value ties
 * across a boundary. Measured at run time from the board being scored, never hardcoded: a
 * hardcoded dollar threshold is what left radar-3 with no THIN or SKIP row on this snapshot,
 * because no row's gas bill came within 1/57,000 of its implied value. Terciles guarantee the
 * spread is the board's own spread.
 */
export function farmCutoffs(values: number[]): FarmCutoffs {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { lo: 0, hi: 0 };
  const mid = (i: number): number => {
    const a = sorted[Math.max(0, Math.min(sorted.length - 1, i))]!;
    const b = sorted[Math.max(0, Math.min(sorted.length - 1, i + 1))]!;
    return (a + b) / 2;
  };
  return { lo: mid(Math.floor(sorted.length / 3) - 1), hi: mid(Math.floor((2 * sorted.length) / 3) - 1) };
}

/** How many days listed still counts as stale: three years with no token on record. */
export const FARM_STALE_DAYS = 1095;

/** One row's farm verdict, with every reason the netting step must state. */
export interface FarmVerdict {
  verdict: 'FARM' | 'THIN' | 'SKIP';
  base: 'FARM' | 'THIN' | 'SKIP';
  stale: boolean;
  gasDrag: boolean;
  impPerCap: number;
}

/**
 * The verdict for one row: its base tier from implied value per $1 of capital against the
 * board's tercile cutoffs, then at most one tier down for staleness (listed >= 1095 days, still
 * no token — the snapshot's own launch record is cumulative with age: 5.8% of protocols listed
 * under 180 days ago have a token, 73.8% of those listed 3+ years ago do, so a 3-year survivor
 * is selected against launching) and at most one tier down for gas-drag (the full plan's gas
 * exceeds the capital it would deploy — a 1:1 dollar comparison, no invented threshold). The
 * base tier is a priority triage on the farmer's scarce resource, capital: SKIP means "farm the
 * rows above it first", not "uneconomic" — on this snapshot the dearest gas bill is still under
 * 1/57,000 of the smallest implied value. No launch probability enters: the snapshot carries no
 * token-launch dates, so no forward P(launch) can be estimated from it, and the category/age
 * base rates do not beat a constant base rate out of sample (see NOTES-model.md).
 */
export function farmVerdict(
  impPerCap: number,
  cutoffs: FarmCutoffs,
  age: number | null,
  fullGas: number,
  capital: number,
): FarmVerdict {
  const base: 'FARM' | 'THIN' | 'SKIP' =
    impPerCap >= cutoffs.hi ? 'FARM' : impPerCap >= cutoffs.lo ? 'THIN' : 'SKIP';
  const stale = age !== null && age >= FARM_STALE_DAYS;
  const gasDrag = fullGas > capital;
  const demote = (v: 'FARM' | 'THIN' | 'SKIP'): 'FARM' | 'THIN' | 'SKIP' => (v === 'FARM' ? 'THIN' : 'SKIP');
  let verdict = base;
  if (stale) verdict = demote(verdict);
  if (gasDrag) verdict = demote(verdict);
  return { verdict, base, stale, gasDrag, impPerCap };
}

export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number, cutoffs: FarmCutoffs): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasPerTx(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weekly = Math.ceil(hold / 7);
  const fullGas = Math.round((weekly + 4) * gas * 100) / 100;
  const impPerCap = capital > 0 ? implied / capital : Number.POSITIVE_INFINITY;
  const v = farmVerdict(impPerCap, cutoffs, age, fullGas, capital);
  const verdict = v.verdict;
  const deposit = verdict === 'THIN' ? Math.max(25, Math.round(capital / 2)) : capital;
  const planGas = verdict === 'THIN' ? Math.round(6 * gas * 100) / 100 : fullGas;
  const ratio = fullGas > 0 ? Math.round(implied / fullGas).toLocaleString('en-US') : 'infinite';
  const action = actionFor(p, deposit, chain);
  const tierWord = v.base === 'FARM' ? 'top' : v.base === 'THIN' ? 'middle' : 'bottom';
  const reason =
    `${usd(Math.round(impPerCap))} implied per $1 — ${tierWord} third (thirds at ${usd(Math.round(cutoffs.lo))} and ${usd(Math.round(cutoffs.hi))})` +
    (v.stale && age !== null
      ? ` Listed ${age.toLocaleString('en-US')}d ago, still no token: drops one tier`
      : '') +
    (v.gasDrag ? ` Gas ${money(fullGas)} exceeds the ${usd(capital)} deposit: drops one tier` : '');

  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: '$0.00, no transaction',
      time: '5 minutes',
    },
  ];
  if (verdict === 'SKIP') {
    // Watch + trigger: no capital now, but a concrete level that promotes the row.
    // The trigger is the implied value that lifts the verdict to THIN, accounting for the
    // demotions: with none, the base tier must reach THIN (lo x capital); with one, the base
    // must reach FARM (hi x capital) so one demotion still leaves THIN; with two, no implied
    // value promotes the row, so there is no trigger. The fired plan is THIN-sized, since the
    // row reaches THIN first.
    const demotions = (v.stale ? 1 : 0) + (v.gasDrag ? 1 : 0);
    const thinTrigger = demotions === 0 ? Math.round(cutoffs.lo * capital) : Math.round(cutoffs.hi * capital);
    const demoteName = v.stale && v.gasDrag ? 'staleness and gas-drag' : v.stale ? 'staleness' : 'gas-drag';
    const thinDeposit = Math.max(25, Math.round(capital / 2));
    const thinAction = actionFor(p, thinDeposit, chain);
    const triggerText =
      demotions === 0
        ? `Trigger: THIN at ${usd(thinTrigger)} implied (${usd(Math.round(cutoffs.lo))} per $1); FARM at ${usd(Math.round(cutoffs.hi * capital))} (${usd(Math.round(cutoffs.hi))} per $1).`
        : demotions === 1
          ? `Trigger: THIN at ${usd(thinTrigger)} implied (${usd(Math.round(cutoffs.hi))} per $1). The ${demoteName} demotion caps this row at THIN.`
          : `No trigger: the ${demoteName} demotions cap this row at SKIP. Watch for a token launch instead.`;
    const netClose = demotions < 2 ? 'watch the trigger above and farm it the week it fires' : 'watch for a token launch instead';
    steps.push({
      text: `Watch, do not deposit: no capital goes in now. Check the TVL and any token-launch signal each week — the next step is the level that changes it.`,
      cost: '$0.00, no deposit',
      time: '5 minutes a week',
    });
    steps.push({
      text: triggerText,
      cost: '$0.00, nothing to spend',
      time: '0 minutes',
    });
    steps.push({
      text: `If the row promotes to THIN, farm it small: ${thinAction} Then make two qualifying actions in the first 30 days, then stop.`,
      cost: `${usd(thinDeposit)} of capital and about ${money(2 * gas)} of gas (2 transactions)`,
      time: '15 minutes to set up',
    });
    steps.push({
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the ${usd(thinDeposit)} stays in the position`,
      time: `${hold} days`,
    });
    steps.push({
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: `nothing to check, about ${money(gas)} of gas to claim`,
      time: '10 minutes',
    });
    steps.push({
      text: `Net: ${money(0)} spent now, ${usd(0)} locked, 0 days held. Implied value ${usd(implied)} — the gas the plan would have cost, ${money(fullGas)}, is 1 in ${ratio} of it. ${reason}. Verdict: SKIP — with limited capital, farm the rows above it first; ${netClose}.`,
      cost: `${money(0)} total`,
      time: '0 minutes',
    });
    return steps;
  }
  steps.push({
    text: action,
    cost: `${usd(deposit)} of capital and about ${money(2 * gas)} of gas (2 transactions)`,
    time: '15 minutes to set up',
  });
  if (verdict === 'THIN') {
    steps.push({
      text: `Make two qualifying actions in the first 30 days, such as a deposit, a borrow, a swap or a vote, then stop: a thin position does not pay for weekly transactions.`,
      cost: `about ${money(2 * gas)} of gas in total`,
      time: '10 minutes each',
    });
  } else {
    steps.push({
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, for ${weekly} actions over ${hold} days.`,
      cost: `about ${money(weekly * gas)} of gas in total`,
      time: '10 minutes a week',
    });
  }
  steps.push({
    text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
    cost: `the ${usd(deposit)} stays in the position`,
    time: `${hold} days`,
  });
  steps.push({
    text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
    cost: `nothing to check, about ${money(gas)} of gas to claim`,
    time: '10 minutes',
  });
  steps.push({
    text: `Withdraw the ${usd(deposit)} and write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
    cost: `about ${money(gas)} of gas to exit`,
    time: '10 minutes',
  });
  steps.push({
    text:
      verdict === 'THIN'
        ? `Net: ${money(planGas)} of gas spent, ${usd(deposit)} of capital returned on exit, ${hold} days locked. Implied value ${usd(implied)} — the full plan's gas bill, ${money(fullGas)}, is 1 in ${ratio} of it, so the deposit was halved and the weekly actions cut to two. ${reason}. Verdict: THIN — farm it small.`
        : `Net: ${money(planGas)} of gas spent, ${usd(deposit)} of capital returned on exit, ${hold} days locked. Implied value ${usd(implied)} — the gas bill is 1 in ${ratio} of it. ${reason}. Verdict: FARM.`,
    cost: `${money(planGas)} total`,
    time: `${hold} days`,
  });
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    rank_low: row.rank_low,
    rank_high: row.rank_high,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants | null = null): { board: BoardRow[]; radar: RadarData } {
  const fitted = model === null ? fitValueModel(snapshot) : { model, r2: null };
  const calibrated = fitted.model;
  const board = buildBoard(snapshot, calibrated);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: calibrated,
    model_version: MODEL_VERSION,
    fit: {
      intercept: calibrated.intercept,
      slope: calibrated.slope,
      chainEthereum: calibrated.chainEthereum,
      chainBinance: calibrated.chainBinance,
      chainBase: calibrated.chainBase,
      chainSolana: calibrated.chainSolana,
      chainArbitrum: calibrated.chainArbitrum,
      n_comps: calibrated.comp_count,
      r2: fitted.r2,
      n_refits: BOOTSTRAP_REFITS,
    },
    oos: measureOos(snapshot),
    rank_range_refits: BOOTSTRAP_REFITS,
    farm_cutoffs: farmCutoffs(board.map((r) => r.implied_value_usd / capitalFor(r))),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, rank ranges, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!(Number.isSafeInteger(r.rank_low) && Number.isSafeInteger(r.rank_high))) return `${r.slug} has a non-integer rank range`;
    if (r.rank_low < 1 || r.rank_high > board.length || r.rank_low > r.rank || r.rank > r.rank_high) {
      return `${r.slug} has rank range ${r.rank_low}..${r.rank_high} outside its rank ${r.rank}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
