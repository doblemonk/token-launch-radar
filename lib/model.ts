// The token radar's model (radar-3): one snapshot of the protocol universe in, one ranked board out.
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
//   log(implied) = intercept + slope x log(tvl_usd)
//   implied      = max(1, round(exp(intercept + slope x ln(tvl_usd))))
//   implied      = max(1, round(k x tvl_usd^slope)) with k = exp(intercept)
//
// intercept and slope are the ordinary-least-squares fit of log(market cap) on log(TVL) over the
// snapshot's live-token protocols (market cap, CoinGecko id and symbol all present, CEX excluded,
// TVL and market cap positive). No coefficient is hardcoded: a new snapshot refits the curve from
// its own figures. The fit is a size curve, not a flat multiple: the market pays a smaller multiple
// per dollar of TVL as a protocol gets bigger, and the slope (0.47 on this snapshot, well under 1)
// is that fact measured, not assumed. No protocol name is ever special-cased: the same function
// scores every row. The intercept is UNcentered (log market cap at TVL = $1), so the dashboard's
// chart and its "k x TVL^slope" line use the same numbers as the board with no conversion.
//
// WHY THIS SHAPE — the blind test (see NOTES-model.md for the full numbers). On this snapshot's
// 119 live-token comparables, predicting log(market cap):
//   flat median multiple (radar-2):  leave-one-out mean abs log error 1.77, walk-forward 1.89
//   log-log size curve (radar-3):    leave-one-out 1.57, walk-forward 1.63
//   walk-forward = train on protocols listed before a cutoff, test on those listed after, at four
//   cutoffs (2024-01-01, 2024-07-01, 2025-01-01, 2025-07-01); the size curve beats the flat
//   multiple at every cutoff. Median absolute % error: 84.6% vs 88.3% leave-one-out, 77.2% vs
//   86.2% walk-forward. The curve wins out of sample by a clear margin, so it ships.
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
// The fitted curve is refit on the same comparables for the rank ranges: 200 bootstrap resamples
// (seed 20261117, mulberry32) each refit the curve and re-rank the board, and every row carries
// rank_low / rank_high, the min and max rank it took across refits. A row whose range is wide is
// a row the curve is unsure about, and the dashboard shows the range.
//
// One limit the snapshot forces: DefiLlama's parentProtocol is not one of the snapshot's ten fields,
// so the exclusion below uses every field the snapshot carries (category, name, version marker) and
// the house's watchlist itself. A below-floor protocol whose parent the snapshot does not name could
// still slip in; the board therefore says a protocol "records no token", never that it has none.
//
// CONTRACT (radar-3) — the dashboard's app.js mirrors this byte-for-byte; change one, change both:
//   ModelConstants fields: intercept, slope, comp_count.
//   impliedOf(row, model) = max(1, round(exp(intercept + slope x ln(tvl_usd)))), with implied 1
//     when tvl_usd <= 0. The intercept is uncentered: the chart line is
//     log10(mcap) = (intercept + slope x ln(tvl_usd)) / ln(10), and the curve's coefficient is
//     k = exp(intercept), so the page may also write implied = k x tvl_usd^slope.
//   RadarData.fit = { intercept, slope, n_comps, r2, n_refits }: the same fit, for the page's
//     fit panels and chart (n_comps == model.comp_count; n_refits == rank_range_refits == 200).
//   RadarData.oos = { metric, flat, fitted, flat_loo, fitted_loo, cutoffs, kept_terms,
//     dropped_terms }: the blind test, MEASURED AT RUN TIME from the snapshot (see measureOos):
//     metric is 'mean absolute log error'; flat/fitted are the walk-forward pooled errors of the
//     flat median multiple and the fitted curve; flat_loo/fitted_loo are the leave-one-out
//     errors; cutoffs are the walk-forward cutoff dates; kept_terms/dropped_terms name the terms
//     the blind test kept and dropped.
//   farmSteps(p, age_days, implied_value_usd): capital by TVL tier (TVL >= 5B: $250; >= 1B: $150;
//     >= 100M: $100; else $50); hold days by age (age null: 30; < 180: 60; < 365: 45; else 30);
//     gas per transaction by first chain (Ethereum $5.00; Solana/Sui/Aptos $0.10; BSC $0.30;
//     Polygon $0.20; Arbitrum/Optimism/Base/zkSync Era/Linea/Scroll/Blast/Mode/Mantle/Starknet/
//     Avalanche $0.50; any other chain $1.00); transactions = 2 setup + ceil(hold/7) weekly +
//     1 exit + 1 claim; total gas = transactions x gas per transaction, rounded to cents.
//     Verdict from coverage = implied_value_usd / total gas: >= 20000 FARM (full capital, weekly
//     actions over the whole hold); >= 2000 THIN (capital halved, minimum $25, two qualifying
//     actions in the first 30 days, gas = 6 transactions); else SKIP (no deposit, $0 spent, the
//     step states the gas the plan would have cost). The last step always nets the plan: gas
//     spent, capital returned on exit, days locked, implied value, and the verdict.

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
 * The model's constants: the fitted log-log size curve, as the dashboard states them and the
 * sandbox may change them. intercept is log(market cap) at TVL = $1 (uncentered, so the page's
 * chart and its "k x TVL^slope" line need no conversion); slope is the elasticity of market cap
 * with respect to TVL; comp_count is how many live-token protocols the fit used.
 */
export interface ModelConstants {
  intercept: number;
  slope: number;
  comp_count: number;
}

export const MODEL: ModelConstants = {
  // Fallback only: buildRadar replaces this with the snapshot-fitted curve (see fitValueModel).
  // Slope 1 with intercept log(0.25) is exactly implied = 0.25 x TVL, the old fallback multiple,
  // so a board can still be scored when the snapshot carries too few live-token comparables to
  // fit from.
  intercept: Math.log(0.25),
  slope: 1,
  comp_count: 0,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

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
}

/** The least-squares line through the points, with its R-squared, or null when unidentified. */
function ols(points: FitPoint[]): { intercept: number; slope: number; r2: number } | null {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.logTvl;
    sumY += p.logMcap;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.logTvl - meanX;
    sxx += dx * dx;
    sxy += dx * (p.logMcap - meanY);
  }
  if (!(sxx > 0) || !Number.isFinite(sxx)) return null;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    const pred = intercept + slope * p.logTvl;
    ssRes += (p.logMcap - pred) * (p.logMcap - pred);
    ssTot += (p.logMcap - meanY) * (p.logMcap - meanY);
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
  return { intercept: round4(intercept), slope: round4(slope), r2: round4(r2) };
}

/** The snapshot's live-token comparables: token trades, CEX excluded. */
function compPoints(snapshot: Snapshot): FitPoint[] {
  const points: FitPoint[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.gecko_id === null || p.symbol === null) continue;
    if (p.category === 'CEX') continue;
    if (!(p.tvl_usd > 0) || !(p.mcap_usd > 0)) continue;
    points.push({ logTvl: Math.log(p.tvl_usd), logMcap: Math.log(p.mcap_usd), listedAt: p.listed_at });
  }
  return points;
}

/**
 * The value curve, fitted from the snapshot at run time: the least-squares line of log(market cap)
 * on log(TVL) over the live-token protocols, with its R-squared. Falls back to the flat 0.25
 * multiple when the snapshot carries too few comparables to fit from.
 */
export function fitValueModel(snapshot: Snapshot): { model: ModelConstants; r2: number | null } {
  const points = compPoints(snapshot);
  if (points.length < CALIBRATION_MIN_COMPS) return { model: { ...MODEL }, r2: null };
  const fit = ols(points);
  if (fit === null) return { model: { ...MODEL }, r2: null };
  return { model: { intercept: fit.intercept, slope: fit.slope, comp_count: points.length }, r2: fit.r2 };
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
 * of the flat median multiple against the fitted size curve, on the snapshot's live-token
 * comparables. Walk-forward trains on protocols listed before a cutoff and tests on those listed
 * after; a cutoff is skipped when its training set is under 10 or its test set under 5. The
 * kept/dropped term lists are the verdict of that test on this snapshot: only the log-TVL size
 * curve survived; category offsets, the 7-day growth term, the age term and a quadratic size
 * term all made held-out error worse and were dropped (see NOTES-model.md for the numbers).
 */
export function measureOos(snapshot: Snapshot): OosSummary {
  const points = compPoints(snapshot);
  const kept = ['log TVL (size curve)'];
  const dropped = ['category offsets', '7-day growth', 'age (log1p)', 'quadratic size term'];
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
    const fit = ols(train);
    if (fit !== null) looFitted.push(fit.intercept + fit.slope * held.logTvl - held.logMcap);
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
    const fit = ols(train);
    for (const t of test) {
      if (med !== null) wfFlat.push(Math.log(med) + t.logTvl - t.logMcap);
      if (fit !== null) wfFitted.push(fit.intercept + fit.slope * t.logTvl - t.logMcap);
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

/** The implied value one protocol gets under the fitted size curve. */
export function impliedOf(tvlUsd: number, model: ModelConstants): number {
  if (!(tvlUsd > 0)) return 1;
  const logImplied = model.intercept + model.slope * Math.log(tvlUsd);
  if (!Number.isFinite(logImplied)) return 1;
  return Math.max(1, Math.round(Math.exp(logImplied)));
}

/** The implied value and the age one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; age: number | null } {
  return { implied: impliedOf(protocol.tvl_usd, model), age: ageDays(asOf, protocol.listed_at) };
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
    const refit = ols(resample);
    if (refit === null) continue;
    const refitModel: ModelConstants = { intercept: refit.intercept, slope: refit.slope, comp_count: n };
    const ranked = [...chosen]
      .map((p) => ({ slug: p.slug, implied: impliedOf(p.tvl_usd, refitModel) }))
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
        comp_count: model.comp_count,
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age, s.implied).map(stepText),
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
function capitalFor(p: SnapshotProtocol): number {
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
 * farming is the gas; the verdict compares that gas bill with the implied value at stake:
 * coverage = implied_value_usd / total gas. FARM at coverage >= 20000 (gas under 1/20000 of the
 * value), THIN at coverage >= 2000 (capital halved, minimum $25, two qualifying actions in the
 * first 30 days, 6 transactions of gas), SKIP below that (no deposit, $0 spent, the step states
 * the gas the plan would have cost).
 *
 * Deliberately identical to the dashboard's own derivation (dashboard/app.js farmSteps): the page
 * recomputes this plan for its detail view, so any change here must be made there in the same edit
 * or the board and the page will show different plans for the same protocol. See the CONTRACT at
 * the top of this file.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasPerTx(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weekly = Math.ceil(hold / 7);
  const fullGas = Math.round((weekly + 4) * gas * 100) / 100;
  const coverage = fullGas > 0 ? implied / fullGas : Number.POSITIVE_INFINITY;
  const verdict: 'FARM' | 'THIN' | 'SKIP' = coverage >= 20000 ? 'FARM' : coverage >= 2000 ? 'THIN' : 'SKIP';
  const deposit = verdict === 'THIN' ? Math.max(25, Math.round(capital / 2)) : capital;
  const planGas = verdict === 'THIN' ? Math.round(6 * gas * 100) / 100 : fullGas;
  const ratio = fullGas > 0 ? Math.round(implied / fullGas).toLocaleString('en-US') : 'infinite';
  const action = actionFor(p, deposit, chain);

  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: '$0.00, no transaction',
      time: '5 minutes',
    },
  ];
  if (verdict === 'SKIP') {
    steps.push({
      text: `Do not deposit: the verdict below is SKIP, so no position is funded and no capital leaves the wallet.`,
      cost: '$0.00, no deposit',
      time: '0 minutes',
    });
    steps.push({
      text: `No weekly actions: the position was never funded, so there is nothing to qualify.`,
      cost: '$0.00, no gas',
      time: '0 minutes',
    });
    steps.push({
      text: `Nothing is locked: no capital left the wallet, so there is no hold to wait out.`,
      cost: '$0.00 locked',
      time: '0 days',
    });
    steps.push({
      text: `No claim to check: nothing was farmed, so there is no points page to watch.`,
      cost: '$0.00, nothing to claim',
      time: '0 minutes',
    });
    steps.push({
      text: `Log the skip: write the protocol, the date and the reason in a farm log, and check the plan again if its implied value rises.`,
      cost: '$0.00, nothing but the log',
      time: '5 minutes',
    });
    steps.push({
      text: `Net: ${money(0)} spent, ${usd(0)} locked, 0 days held. Implied value ${usd(implied)} — the gas the plan would have cost, ${money(fullGas)}, is 1 in ${ratio} of it. Verdict: SKIP — the value at stake does not cover the cost of farming it.`,
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
        ? `Net: ${money(planGas)} of gas spent, ${usd(deposit)} of capital returned on exit, ${hold} days locked. Implied value ${usd(implied)} — the full plan's gas bill, ${money(fullGas)}, is 1 in ${ratio} of it, so the deposit was halved and the weekly actions cut to two. Verdict: THIN — farm it small.`
        : `Net: ${money(planGas)} of gas spent, ${usd(deposit)} of capital returned on exit, ${hold} days locked. Implied value ${usd(implied)} — the gas bill is 1 in ${ratio} of it. Verdict: FARM.`,
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
      n_comps: calibrated.comp_count,
      r2: fitted.r2,
      n_refits: BOOTSTRAP_REFITS,
    },
    oos: measureOos(snapshot),
    rank_range_refits: BOOTSTRAP_REFITS,
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
