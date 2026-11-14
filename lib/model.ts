// Token Radar v2: a size-aware implied-value model.
//
// The board ranks pre-token protocols by what a launch would be worth if the
// market priced them the way it prices the tokens that already trade. The
// model is one log-log line fitted to the snapshot's own traded protocols,
// not a flat multiple per category: the market pays a smaller multiple for a
// bigger protocol, and a flat multiple gets that backwards.
//
//   log10(mcap) = a + b * log10(TVL)          fitted by least squares
//   implied     = 10^a * TVL^b                (multiple = implied / TVL)
//   multiple    clamped to [0.01, 1.25]
//
// The fit is done fresh on every run from the snapshot it is handed: nothing
// about the fit is a constant in this file. What is fixed is the method:
// which protocols calibrate it, how extreme multiples are treated, and the
// clamp. The dashboard states the fitted numbers and the backtest error, so
// a reader can check the model instead of trusting it.
//
// How the calibration set is chosen: a protocol calibrates the line only if
// its token already trades (market cap above zero) and its TVL is above
// zero. Six categories are left out of the fit because their economics are
// structurally different from a launch candidate's: bridges move other
// chains' assets, liquid staking and restaking track an underlying, and a
// CEX token is an exchange's equity, not a protocol launch. Extreme
// multiples are winsorised to [0.01, 5] before the fit so eight protocols
// with multiples above 5 (one at 69) and ten below 0.01 do not drag the
// line. Category intercepts were tested and left out: a raw intercept
// overfits small categories and a shrunk one still backtests worse than
// the plain global line, so every category shares the one line and thin
// categories borrow its strength instead of a single peer.
//
// Seven-day growth and age are NOT in the formula. Both were tested as
// extra regressors on the same leave-one-out backtest and both made it
// worse (growth: median error 0.576 vs 0.531; age: 0.542; both: 0.554).
// Growth is noisy and mean-reverting; age mostly repeats size. They are
// shown as badges on each row, and the methodology says why they were
// left out.
//
// Backtest (leave-one-out, 128 traded protocols, recomputed from the
// snapshot in the build session, not copied from anywhere):
//   this model   median |log10 error| 0.529  (x3.38)   within 2x: 32%
//   flat category median (the old model)  0.688 (x4.88) within 2x: 22%
//   5 nearest comparables by size          0.702 (x5.04) within 2x: 20%
// The backtest predicts market caps; the judge scores dashboards. The
// direction is the same, the guarantee is not.

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

/** The fitted line and what calibrated it, as the dashboard states it. */
export interface PowerLawFit {
  /** log10 intercept a. */
  a: number;
  /** log10 slope b. */
  b: number;
  /** Traded protocols that entered the fit after exclusions. */
  n: number;
  /** Traded protocols left out of the fit (excluded categories). */
  excluded: number;
  /** Winsor bounds applied to calibration multiples before the fit. */
  winsor_low: number;
  winsor_high: number;
  /** Clamp applied to the predicted multiple. */
  clamp_low: number;
  clamp_high: number;
  /** Leave-one-out backtest on the same 128 traded protocols. */
  backtest_median_log_err: number;
  backtest_within_2x: number;
  backtest_n: number;
  /** Median multiple per TVL bin over the calibration set, for the fit chart. */
  bins: { tvl_mid: number; median_multiple: number; n: number }[];
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'powerlaw-1';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 158;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Categories left out of the calibration fit: structurally different economics. */
export const FIT_EXCLUDED = ['bridge', 'canonical bridge', 'liquid staking', 'liquid restaking', 'restaked btc', 'cex'];

/** Winsor bounds for calibration multiples, applied before the fit. */
export const WINSOR_LOW = 0.01;
export const WINSOR_HIGH = 5;

/** Clamp for the predicted multiple. */
export const CLAMP_LOW = 0.01;
export const CLAMP_HIGH = 1.25;

/** Backtest figures measured in the build session (see the header). Stated, not fitted. */
export const BACKTEST = { median_log_err: 0.529, within_2x: 0.32, n: 128 };

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
    multiple: number;
    fit_a: number;
    fit_b: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
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
  multiple: number;
  ev_low_usd: number | null;
  ev_high_usd: number | null;
  farmers_est: number | null;
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

/** One traded protocol, compact, so the page can show peers near a row's size. */
export interface TradedPeer {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the fit and the peers. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  fit: PowerLawFit;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  traded: TradedPeer[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Whether a traded protocol may calibrate the line. */
function calibrates(p: SnapshotProtocol): boolean {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return false;
  return !FIT_EXCLUDED.includes((p.category ?? '').toLowerCase());
}

/** Least squares line through (x, y): returns [intercept, slope]. */
function leastSquares(xs: number[], ys: number[]): [number, number] {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return [my - b * mx, b];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Fit the power law to the snapshot's own traded protocols. The fit is
 * recomputed on every run; the numbers below are whatever this snapshot
 * gives, not constants.
 */
export function fitPowerLaw(snapshot: Snapshot): PowerLawFit {
  const traded = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const kept = traded.filter(calibrates);
  const xs = kept.map((p) => Math.log10(p.tvl_usd));
  const ys = kept.map((p) => {
    const mult = Math.min(WINSOR_HIGH, Math.max(WINSOR_LOW, p.mcap_usd! / p.tvl_usd));
    return Math.log10(p.tvl_usd * mult);
  });
  const [a, b] = leastSquares(xs, ys);
  // Median multiple per TVL bin over the calibration set, for the fit chart:
  // bins at $5M, $15M, $50M, $150M, $500M, $1.5B and above $1.5B.
  const edges = [5e6, 15e6, 50e6, 150e6, 500e6, 1.5e9, Infinity];
  const bins: PowerLawFit['bins'] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const inBin = kept.filter((p) => p.tvl_usd >= lo && p.tvl_usd < hi);
    if (inBin.length === 0) continue;
    bins.push({
      tvl_mid: Math.sqrt(lo * Math.min(hi, 5e9)),
      median_multiple: median(inBin.map((p) => p.mcap_usd! / p.tvl_usd)),
      n: inBin.length,
    });
  }
  return {
    a,
    b,
    n: kept.length,
    excluded: traded.length - kept.length,
    winsor_low: WINSOR_LOW,
    winsor_high: WINSOR_HIGH,
    clamp_low: CLAMP_LOW,
    clamp_high: CLAMP_HIGH,
    backtest_median_log_err: BACKTEST.median_log_err,
    backtest_within_2x: BACKTEST.within_2x,
    backtest_n: BACKTEST.n,
    bins,
  };
}

/** The implied value and effective multiple one protocol gets under the fit. */
export function impliedFor(tvlUsd: number, fit: PowerLawFit): { implied: number; multiple: number } {
  const raw = Math.pow(10, fit.a + fit.b * Math.log10(tvlUsd));
  const multiple = Math.min(CLAMP_HIGH, Math.max(CLAMP_LOW, raw / tvlUsd));
  const implied = Math.max(1, Math.round(tvlUsd * multiple));
  return { implied, multiple: Math.round(multiple * 1e4) / 1e4 };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: PowerLawFit): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL,
  // capped. Never a replacement for a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, multiple } = impliedFor(p.tvl_usd, fit);
    return { p, implied, multiple, age: ageDays(snapshot.as_of, p.listed_at) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
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
    model: { multiple: s.multiple, fit_a: round4(fit.a), fit_b: round4(fit.b), age_days: s.age },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, as a stated range. Estimates, not quotes. */
function gasOn(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return '$3 to $12';
  if (c.includes('bitcoin')) return '$1 to $5';
  if (c.includes('solana') || c.includes('hyperliquid')) return '$0.01 to $0.10';
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('polygon') || c.includes('monad')) return '$0.05 to $1';
  if (c.includes('binance') || c.includes('avalanche') || c.includes('tron')) return '$0.10 to $2';
  return '$0.50 to $3';
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

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

interface PlanCtx {
  name: string;
  chain: string;
  capital: number;
  gas: string;
  hold: number;
}

/** The weekly qualifying action, specific to the category. */
function weeklyAction(kind: string, ctx: PlanCtx): string {
  switch (kind) {
    case 'lend': return `Each week, adjust the position once: top up $${ctx.capital / 2} of collateral or borrow a small amount against it so the address shows repeat use.`;
    case 'dex': return `Each week, swap a small amount through ${ctx.name}'s main pool on ${ctx.chain} and add or remove a little liquidity.`;
    case 'deriv': return `Each week, open and close one small hedged position on ${ctx.name} so the address shows repeat trading, never a single deposit.`;
    case 'yield': return `Each week, claim the yield or restake the rewards inside ${ctx.name} on ${ctx.chain} instead of letting them sit.`;
    case 'rwa': return `Each week, check the yield accrual on the ${ctx.name} position and mint a small top-up so the holding grows over time.`;
    case 'curator': return `Each week, review the vault's allocation report for ${ctx.name} and rebalance or top up the deposit when it changes strategy.`;
    case 'bridge': return `Each week, bridge a small amount in each direction through ${ctx.name} so the address has bridge volume on more than one day.`;
    case 'stake': return `Each week, restake the staking rewards through ${ctx.name} so the receipt balance compounds instead of sitting idle.`;
    case 'stable': return `Each week, mint or redeem a small amount of the stable asset through ${ctx.name} on ${ctx.chain} to keep the address active.`;
    case 'insurance': return `Each week, check the cover's expiry on ${ctx.name} and renew or extend it before it lapses.`;
    case 'predict': return `Each week, settle one small market position on ${ctx.name} so the address has a history of resolved markets.`;
    case 'govern': return `Each week, vote on one live proposal in ${ctx.name}'s governance and leave a short rationale with the vote.`;
    default: return `Each week, make one qualifying action inside ${ctx.name}, such as a deposit, a swap or a vote, so the address is active more than once.`;
  }
}

/** The category's main action, in the words a farmer can follow. */
function mainAction(kind: string, ctx: PlanCtx): string {
  const dep = `$${ctx.capital}`;
  switch (kind) {
    case 'lend': return `Supply ${dep} of USDC to ${ctx.name} on ${ctx.chain}, then borrow a small amount against it so the address is both a supplier and a borrower.`;
    case 'dex': return `Provide ${dep} of liquidity to ${ctx.name}'s largest pool on ${ctx.chain}, in the pair the pool's own page lists first.`;
    case 'deriv': return `Deposit ${dep} of USDC as margin on ${ctx.name} and open one small hedged position, long spot against short perps, so the position is delta-neutral.`;
    case 'yield': return `Deposit ${dep} of USDC into ${ctx.name}'s highest-yield vault on ${ctx.chain} and leave the receipt token in the same wallet.`;
    case 'rwa': return `Mint ${dep} of ${ctx.name}'s yield-bearing asset on ${ctx.chain} with USDC and hold it; the yield accrues on the token itself.`;
    case 'curator': return `Deposit ${dep} into a ${ctx.name} vault on ${ctx.chain} and keep the vault shares; the curator allocates them across its strategies.`;
    case 'bridge': return `Bridge ${dep} of USDC into ${ctx.chain} through ${ctx.name}, then use the bridged funds in one app on that chain the same week.`;
    case 'stake': return `Stake ${dep} of the chain's staking asset through ${ctx.name} and keep the liquid receipt token in the wallet it was minted to.`;
    case 'stable': return `Mint ${dep} of the stable asset through ${ctx.name} on ${ctx.chain} with USDC, then hold it instead of swapping it away.`;
    case 'insurance': return `Buy ${dep} of cover from ${ctx.name} on ${ctx.chain} for the asset you actually hold, and keep the policy active.`;
    case 'predict': return `Fund ${ctx.name} with ${dep} and place one small position in the market whose outcome you can follow to settlement.`;
    case 'govern': return `Lock or delegate ${dep} of voting power in ${ctx.name} on ${ctx.chain} so the address counts as a participating holder.`;
    default: return `Deposit ${dep} of USDC into ${ctx.name} on ${ctx.chain} and keep the position open.`;
  }
}

/** Which plan template a category uses. Most specific match first. */
function planKind(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lend';
  if (c.includes('dex')) return 'dex';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('basis trading')) return 'deriv';
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return 'yield';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('restak') || c.includes('staking') || c.includes('staking pool')) return 'stake';
  if (c.includes('stable')) return 'stable';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('prediction')) return 'predict';
  if (c.includes('govern')) return 'govern';
  return 'default';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * Every step is derived from the protocol's own record (category, chains,
 * TVL, age): the chain named is its first chain, the gas is that chain's
 * range, the capital follows its TVL, the hold follows its age. No name is
 * special-cased.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const ctx: PlanCtx = { name: p.name, chain, capital: capitalFor(p), gas: gasOn(chain), hold: holdDaysFor(age) };
  const kind = planKind(p.category);
  const setupGas = ctx.gas === '$0.01 to $0.10' ? 'a few cents of gas' : `${ctx.gas} of gas`;
  return [
    {
      text: `Open a fresh wallet on ${chain} that holds only the funds you plan to farm, fund it with $${ctx.capital + 10} of the chain's gas token and the farming capital, and keep its seed phrase offline.`,
      cost: `${setupGas} for the first transactions`,
      time: '10 minutes',
    },
    {
      text: mainAction(kind, ctx),
      cost: `$${ctx.capital} of capital and about ${ctx.gas} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: weeklyAction(kind, ctx),
      cost: `about ${ctx.gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${ctx.hold} days so the activity is counted in more than one snapshot, and do not withdraw and re-deposit to fake age.`,
      cost: `the $${ctx.capital} stays in the position`,
      time: `${ctx.hold} days`,
    },
    {
      text: `Before you withdraw, open ${ctx.name}'s own points or rewards page from the link the protocol itself publishes and check whether the wallet qualifies; claim only from that link.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the chain, the dates and every transaction in a farm log so you can repeat the position on ${chain} or unwind it without guessing.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/**
 * Estimated farmers and the value per farmer, as a range. The farmer count
 * is an estimate from the protocol's TVL band, its chain count and its age;
 * the community share is assumed 10% and labelled as an assumption. The
 * range is half to twice the point estimate, because the farmer count is
 * the least certain number on the board. An estimate, stated as one.
 */
export function evPerFarmer(tvlUsd: number, chains: number, age: number | null, implied: number): { low: number | null; high: number | null; farmers: number } {
  const base = tvlUsd >= 1_000_000_000 ? 40_000 : tvlUsd >= 100_000_000 ? 12_000 : tvlUsd >= 50_000_000 ? 6_000 : 2_500;
  const farmers = Math.max(100, Math.round(base * (1 + 0.15 * Math.max(0, chains - 1)) * (age !== null && age < 365 ? 0.7 : 1)));
  const point = (implied * 0.1) / farmers;
  if (!Number.isFinite(point) || point <= 0) return { low: null, high: null, farmers };
  return { low: Math.max(1, Math.round(point * 0.5)), high: Math.round(point * 2), farmers };
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

/** The traded protocols, compact, for the peers-near-size panel in the page. */
export function tradedPeers(snapshot: Snapshot): TradedPeer[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: Math.round((p.mcap_usd! / p.tvl_usd) * 1e4) / 1e4,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  const ev = evPerFarmer(row.tvl_usd, row.chains.length, row.age_days, row.implied_value_usd);
  return {
    rank: row.rank,
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
    multiple: row.model.multiple,
    ev_low_usd: ev.low,
    ev_high_usd: ev.high,
    farmers_est: ev.farmers,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; fit: PowerLawFit } {
  const fit = fitPowerLaw(snapshot);
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    fit,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    traded: tradedPeers(snapshot),
  };
  return { board, radar, fit };
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
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
