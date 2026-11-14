// Token Radar — scoring model "radar-3".
//
// What this file does: read the sealed DefiLlama snapshot, decide which
// protocols record no token, and rank them by an implied launch value that
// is learned from the snapshot itself instead of from a fixed table.
//
// The calibration step looks at every protocol whose token already trades,
// groups those by DefiLlama category, and takes the median market-cap to
// TVL ratio per category. That ratio is what the market currently pays per
// dollar locked in a protocol of that kind. A pre-token protocol's implied
// fully-diluted value is its own TVL times its category's ratio, then moved
// by three things the snapshot also carries: its seven-day TVL growth, how
// long it has run with no token on record, and how many chains it runs on.
//
//   implied  = tvl x catRatio x growth x age x breadth
//   growth   = 1 + 0.6 x clamp(change_7d, -50, +100) / 100
//   age      = 0.75 + 0.25 x min(ageDays, 1095) / 1095   (no date: 0.875)
//   breadth  = 1 + 0.02 x min(chains - 1, 8)
//
// A second number rides along for the reader: the expected value per
// farmer. The model assumes 7.5% of the implied value is set aside for the
// community and that the farmer crowd grows with the square root of TVL,
// widened by how many chains the protocol runs on and how long it has run
// (see scoreOne), so a giant protocol's airdrop is split among many more
// wallets than a small one's. Both numbers are the model's claim, stated on
// the page. Each row also carries its category's median implied value and its
// rank inside that category, so a rank can be read against its own kind.
//
// Nothing here names a protocol. The same functions score every row, and a
// protocol that records a token is never ranked: it appears only in the
// "already trading" list, with the market's own market cap, so the board
// never mixes a model's guess with a traded price.

export interface SnapProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  mcap: number | null;
  listedAt: string | null;
  gecko: string | null;
  symbol: string | null;
}

export interface SnapDoc {
  asOf: string;
  source: string;
  floor: number;
  protocols: SnapProtocol[];
  watchlist: string[];
}

export interface Tuning {
  growthWeight: number;
  growthLow: number;
  growthHigh: number;
  ageFloor: number;
  ageCapDays: number;
  unknownAge: number;
  breadthStep: number;
  breadthMax: number;
  communityShare: number;
  farmerBase: number;
  farmerCap: number;
  farmerChainStep: number;
  farmerAgeLow: number;
  farmerAgeHigh: number;
}

export const TUNING: Tuning = {
  growthWeight: 0.6,
  growthLow: -50,
  growthHigh: 100,
  ageFloor: 0.75,
  ageCapDays: 1095,
  unknownAge: 0.875,
  breadthStep: 0.02,
  breadthMax: 8,
  communityShare: 0.075,
  farmerBase: 150,
  farmerCap: 50000,
  farmerChainStep: 0.05,
  farmerAgeLow: 0.8,
  farmerAgeHigh: 1.0,
};

export const MODEL_VERSION = 'radar-3';

/** One category's learned market multiple, with the headcount behind it. */
export interface MultipleRow {
  category: string;
  ratio: number;
  n: number;
}

export interface ScoreParts {
  catRatio: number;
  growthMult: number;
  ageMult: number;
  breadthMult: number;
  ageDays: number | null;
  farmers: number;
  evPerFarmer: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvlUsd: number;
  change7d: number | null;
  listedAt: string | null;
  ageDays: number | null;
  watchlist: boolean;
  tokenStatus: string;
  implied_value_usd: number;
  evPerFarmerUsd: number;
  farmersEst: number;
  catRatio: number;
  growthMult: number;
  ageMult: number;
  breadthMult: number;
  farm_steps: string[];
  catMedianUsd: number;
  catRank: number;
  catSize: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvlUsd: number;
  mcapUsd: number | null;
  change7d: number | null;
  ratio: number | null;
}

export interface RadarPayload {
  asOf: string;
  source: string;
  floorUsd: number;
  modelVersion: string;
  tuning: Tuning;
  watchlistSize: number;
  boardSize: number;
  liveSize: number;
  multiples: MultipleRow[];
  globalRatio: number;
  rows: BoardRow[];
  live: LiveRow[];
}

const DAY_MS = 86400000;

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** Days from listedAt to asOf, or null when the snapshot gives no date. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** True when the snapshot records no token at all for the protocol. */
export function recordsNoToken(p: SnapProtocol): boolean {
  return p.mcap === null && p.gecko === null && p.symbol === null;
}

/**
 * Learn the market multiples: median mcap/TVL per category over the
 * protocols whose token trades, falling back to the global median when a
 * category has fewer than three traded examples. Ratios are clamped so one
 * outlier category cannot stretch the whole board.
 */
export function learnMultiples(protocols: SnapProtocol[]): { byCat: Map<string, number>; table: MultipleRow[]; global: number } {
  const buckets = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap === null || p.tvl <= 0 || p.mcap <= 0) continue;
    const raw = p.mcap / p.tvl;
    if (!Number.isFinite(raw) || raw <= 0) continue;
    // Winsorise: a token whose market cap is hundreds of times its DeFi
    // TVL (a chain token, an exchange token) is not priced on that TVL,
    // and one such row must not drag its whole category's median with it.
    const r = Math.min(5, Math.max(0.01, raw));
    all.push(r);
    const key = p.category ?? 'Uncategorised';
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  const globalRaw = median(all);
  const global = Math.min(1.25, Math.max(0.05, Number.isFinite(globalRaw) ? globalRaw : 0.2));
  const byCat = new Map<string, number>();
  const table: MultipleRow[] = [];
  for (const [cat, list] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const m = list.length >= 3 ? median(list) : global;
    const ratio = Math.min(1.25, Math.max(0.05, m));
    byCat.set(cat, ratio);
    table.push({ category: cat, ratio: Math.round(ratio * 1000) / 1000, n: list.length });
  }
  return { byCat, table, global };
}

/** Score one protocol: the implied value plus every multiplier, for display. */
export function scoreOne(p: SnapProtocol, asOf: string, ratio: number, t: Tuning): { implied: number; parts: ScoreParts } {
  const growth = Math.min(t.growthHigh, Math.max(t.growthLow, num(p.change7d, 0)));
  const growthMult = 1 + (growth / 100) * t.growthWeight;
  const age = ageInDays(asOf, p.listedAt);
  const ageMult = age === null ? t.unknownAge : t.ageFloor + (1 - t.ageFloor) * (Math.min(age, t.ageCapDays) / t.ageCapDays);
  const breadthMult = 1 + t.breadthStep * Math.min(Math.max(p.chains.length - 1, 0), t.breadthMax);
  const implied = Math.max(1, Math.round(p.tvl * ratio * growthMult * ageMult * breadthMult));
  // The farmer crowd is not TVL alone: a protocol live on many chains and
  // running for years has had more wallets touch it than a young single-chain
  // one of the same size. Crowd = base x sqrt(TVL in $M) x (1 + 0.05 per extra
  // chain, capped at 8) x an age factor from 0.8 (new) to 1.0 (3+ years), so
  // the per-farmer figure still comes only from the snapshot's own fields.
  const chainFactor = 1 + t.farmerChainStep * Math.min(Math.max(p.chains.length - 1, 0), t.breadthMax);
  const ageFactor = age === null
    ? (t.farmerAgeLow + t.farmerAgeHigh) / 2
    : t.farmerAgeLow + (t.farmerAgeHigh - t.farmerAgeLow) * (Math.min(age, t.ageCapDays) / t.ageCapDays);
  const farmers = Math.max(50, Math.min(t.farmerCap, Math.round(t.farmerBase * Math.sqrt(p.tvl / 1000000) * chainFactor * ageFactor)));
  const evPerFarmer = Math.max(1, Math.round((implied * t.communityShare) / farmers));
  return { implied, parts: { catRatio: ratio, growthMult, ageMult, breadthMult, ageDays: age, farmers, evPerFarmer } };
}

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The snapshot's own watchlist rule, applied to the early rows: a wrapped,
 * staked or bridged product of a token that already trades is not a launch
 * of its own (WBTC is Bitcoin on Ethereum, a staked-ETH product is ETH in
 * another wrapper), so the early radar leaves those out. Watchlist slugs
 * are never dropped by this rule — the list already passed it.
 */
const OFF_LIST_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;
const EXCHANGE_OPEN = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

function isWrappedProduct(p: SnapProtocol): boolean {
  if (p.category !== null && OFF_LIST_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_OPEN.test(p.name)) return true;
  return VERSION_TAIL.test(p.name);
}

/** Capital one farm position needs, from the protocol's own TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 5000000000) return 250;
  if (tvl >= 1000000000) return 200;
  if (tvl >= 100000000) return 100;
  return 50;
}

/** Hold length in days: younger protocols get a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main farming action, written so a reader can follow it. */
function mainAction(p: SnapProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('borrow')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay it the same week so the position shows both sides of the market.`;
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('exchange') && !c.includes('cex')) {
    return `Swap $${capital} of USDC for another asset through ${name} on ${chain}, then add the same amount as liquidity to its busiest pool and keep the position open.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside an app on the destination chain instead of bridging straight back.`;
  }
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restaked') || c.includes('staking')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt token, then use that receipt token in one more protocol.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('futures')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, then close it after a day so the account shows real trading volume.`;
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('allocator') || c.includes('curator') || c.includes('asset management')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares, letting the position compound instead of entering and leaving.`;
  }
  if (c.includes('rwa') || c.includes('real world') || c.includes('treasur') || c.includes('stable')) {
    return `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the same wallet for the whole farming window.`;
  }
  if (c.includes('prediction') || c.includes('betting') || c.includes('gaming')) {
    return `Fund your ${name} account with $${capital} on ${chain} and take one small position, then settle it and place a second one the following week.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the whole farming window.`;
  }
  if (c.includes('basis') || c.includes('leveraged')) {
    return `Open a $${capital} leveraged position through ${name} on ${chain}, keep it modest, and close it after a week with the profit or loss recorded.`;
  }
  if (c.includes('cex')) {
    return `Create an account with ${name}, deposit $${capital} on ${chain}, and use its spot market and any points or rewards page it runs.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open, then repeat a small qualifying action each week.`;
}

/** Trim a farm step into the gate's 20..600 character window. */
function fitStep(s: string): string {
  let out = s.trim().replace(/\s+/g, ' ');
  if (out.length > 600) out = out.slice(0, 597) + '...';
  if (out.length < 20) out += ' Keep the position open and check the protocol page weekly.';
  return out;
}

/**
 * Six concrete farm steps for one protocol, derived from its own record
 * (category, chains, TVL, age). Every step names a cost and a time.
 */
export function farmPlan(p: SnapProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const second = p.chains[1] ?? chain;
  const capital = capitalFor(p.tvl);
  const hold = holdFor(age);
  const gas = capital >= 200 ? 8 : capital >= 100 ? 5 : 3;
  const steps = [
    `Start with a fresh wallet that holds only the funds you plan to farm with, write its seed phrase on paper, and fund it with $${capital + 20} on ${chain} so gas never strands the position. Cost: under $${gas} of gas for the first transaction. Time: 10 minutes.`,
    `${mainAction(p, capital, chain)} Cost: $${capital} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    `Return once a week and do one more qualifying action on ${second === chain ? chain : second}: a swap, a deposit, a borrow or a vote, so the wallet shows steady activity rather than a single day. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so it is counted in more than one snapshot window, and do not move the funds to another wallet in between. Cost: the $${capital} stays locked in the position. Time: ${hold} days.`,
    `Before you touch any claim, open the protocol's own points or rewards page from its official site and claim only from the link it publishes; never pay anyone to claim for you. Cost: no fee to check. Time: 10 minutes.`,
    `Write the wallet address, the dates and every transaction hash in a farm log, so you can prove the activity, repeat the position, or unwind it in one sitting. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  return steps.map(fitStep);
}

/** Parse and validate the snapshot's shape; throws on anything unusable. */
export function parseSnapshot(text: string): SnapDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || o.floor_usd <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new Error('snapshot.json has no protocols or watchlist');
  const protocols: SnapProtocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`protocol ${i} lacks slug, name or TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl: p.tvl_usd,
      change7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listedAt: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { asOf: o.as_of, source: o.source, floor: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/**
 * Build the ranked board: every protocol that records no token, watchlist
 * first in coverage and the rest as the early radar. The early rows skip
 * wrapped, staked and bridged products of tokens that already trade, and
 * versioned pools of another protocol — those are a release of something
 * else, not a launch of their own — but a watchlist slug is never dropped.
 */
export function buildBoard(doc: SnapDoc, t: Tuning = TUNING): { rows: BoardRow[]; payload: RadarPayload } {
  const { byCat, table, global } = learnMultiples(doc.protocols);
  const watch = new Set(doc.watchlist);
  const picked = new Map<string, SnapProtocol>();
  for (const slug of doc.watchlist) {
    const p = doc.protocols.find((x) => x.slug === slug);
    if (p && recordsNoToken(p)) picked.set(slug, p);
  }
  for (const p of doc.protocols) {
    if (picked.has(p.slug) || !recordsNoToken(p)) continue;
    if (isWrappedProduct(p)) continue;
    picked.set(p.slug, p);
  }
  const scored = [...picked.values()].map((p) => {
    const ratio = byCat.get(p.category ?? 'Uncategorised') ?? global;
    const { implied, parts } = scoreOne(p, doc.asOf, ratio, t);
    return { p, implied, parts };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Same-category context for the detail view: each category's median implied
  // value and the row's rank inside its own category, so a rank means more
  // than its position on a board of mixed kinds.
  const catGroups = new Map<string, { implied: number; slug: string }[]>();
  for (const s of scored) {
    const key = s.p.category ?? 'Uncategorised';
    const list = catGroups.get(key) ?? [];
    list.push({ implied: s.implied, slug: s.p.slug });
    catGroups.set(key, list);
  }
  const catStats = new Map<string, { median: number; size: number; rankOf: Map<string, number> }>();
  for (const [cat, list] of catGroups) {
    const sorted = [...list].sort((a, b) => b.implied - a.implied);
    const rankOf = new Map(sorted.map((x, i) => [x.slug, i + 1]));
    catStats.set(cat, { median: median(list.map((x) => x.implied)), size: list.length, rankOf });
  }
  const rows: BoardRow[] = scored.map((s, i) => {
    const cs = catStats.get(s.p.category ?? 'Uncategorised')!;
    return {
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvlUsd: s.p.tvl,
    change7d: s.p.change7d,
    listedAt: s.p.listedAt,
    ageDays: s.parts.ageDays,
    watchlist: watch.has(s.p.slug),
    tokenStatus: 'records no token',
    implied_value_usd: s.implied,
    evPerFarmerUsd: s.parts.evPerFarmer,
    farmersEst: s.parts.farmers,
    catRatio: Math.round(s.parts.catRatio * 1000) / 1000,
    growthMult: Math.round(s.parts.growthMult * 10000) / 10000,
    ageMult: Math.round(s.parts.ageMult * 10000) / 10000,
    breadthMult: Math.round(s.parts.breadthMult * 10000) / 10000,
    farm_steps: farmPlan(s.p, s.parts.ageDays),
    catMedianUsd: Math.round(cs.median),
    catRank: cs.rankOf.get(s.p.slug)!,
    catSize: cs.size,
    };
  });
  const live: LiveRow[] = doc.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .filter((p) => p.mcap === null || p.tvl <= 0 || p.mcap / p.tvl <= 10)
    .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0) || b.tvl - a.tvl)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvlUsd: p.tvl,
      mcapUsd: p.mcap,
      change7d: p.change7d,
      ratio: p.mcap !== null && p.tvl > 0 ? Math.round((p.mcap / p.tvl) * 1000) / 1000 : null,
    }));
  const payload: RadarPayload = {
    asOf: doc.asOf,
    source: doc.source,
    floorUsd: doc.floor,
    modelVersion: MODEL_VERSION,
    tuning: t,
    watchlistSize: doc.watchlist.length,
    boardSize: rows.length,
    liveSize: live.length,
    multiples: table,
    globalRatio: Math.round(global * 1000) / 1000,
    rows,
    live,
  };
  return { rows, payload };
}

/** Gate-shaped self-check: null when the board is one the scorer takes. */
export function boardProblem(rows: BoardRow[], doc: SnapDoc): string | null {
  const slugs = new Set(rows.map((r) => r.slug));
  const missing = doc.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < rows.length; i++) if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (rows.length >= 2 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of rows) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} chars`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script tag's worth of JavaScript. */
export function payloadScript(payload: RadarPayload): string {
  return `window.RADAR=${JSON.stringify(payload)};\n`;
}
