// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are never ranked, they are the evidence: the comparables.
//
// Implied value is priced off those comparables, from the snapshot's own figures alone:
//
//   peers      = the live-token protocols in the same category (market cap and TVL both recorded)
//   multiple   = the peers' median market-cap / TVL, shrunk toward the all-category median when a
//                category has few peers: (n x category median + 3 x global median) / (n + 3)
//   implied    = TVL x multiple x momentum x maturity x breadth, with
//     momentum = 1 + 0.35 x clamp(change_7d, -50, 100) / 100
//     maturity = 0.75 + 0.35 x min(age_days, 1095) / 1095     (unknown age counts as 365 days)
//     breadth  = 1 + 0.03 x min(chains - 1, 7)
//   and the multiple itself clamped to [0.05, 2.5] so one hot category cannot price a row alone.
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard
// states the formula, each category's multiple and its peer count beside the board it produced.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_peers: number;
  multiple_floor: number;
  multiple_cap: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  shrink_peers: 3,
  multiple_floor: 0.05,
  multiple_cap: 2.5,
  momentum_weight: 0.35,
  momentum_floor: -50,
  momentum_cap: 100,
  maturity_floor: 0.75,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 7,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 220;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's comparable set: how many live peers priced it, and the multiple they imply. */
export interface CategoryStat {
  category: string;
  peers: number;
  median_multiple: number;
  used_multiple: number;
  board_rows: number;
}

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
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    peers: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
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
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  peers: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
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

/** Everything the dashboard needs: the board, the live set, the category evidence and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  universe_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  categories: CategoryStat[];
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

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The category key a protocol is priced under: its own category, or the shared uncategorised one. */
function categoryKey(p: SnapshotProtocol): string {
  return p.category ?? 'Uncategorised';
}

export interface CompTable {
  global_multiple: number;
  by_category: Map<string, { peers: number; median_multiple: number; used_multiple: number }>;
}

/**
 * The comparable multiples: for each category, the median market-cap / TVL of its live-token
 * protocols in this snapshot, shrunk toward the global median by the peer count and clamped.
 */
export function buildComps(snapshot: Snapshot, model: ModelConstants = MODEL): CompTable {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = categoryKey(p);
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.25;
  const clampMultiple = (m: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, m));
  const by_category = new Map<string, { peers: number; median_multiple: number; used_multiple: number }>();
  for (const [key, list] of ratios) {
    const med = median(list);
    const shrunk = (list.length * med + model.shrink_peers * globalMedian) / (list.length + model.shrink_peers);
    by_category.set(key, { peers: list.length, median_multiple: round4(med), used_multiple: round4(clampMultiple(shrunk)) });
  }
  return { global_multiple: round4(clampMultiple(globalMedian)), by_category };
}

/** The multiple and peer count one protocol is priced with: its category's, or the global fallback. */
function multipleFor(p: SnapshotProtocol, comps: CompTable): { multiple: number; peers: number } {
  const stat = comps.by_category.get(categoryKey(p));
  if (stat !== undefined) return { multiple: stat.used_multiple, peers: stat.peers };
  return { multiple: comps.global_multiple, peers: 0 };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comps: CompTable,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; peers: number; momentumMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, peers } = multipleFor(protocol, comps);
  const growthPct = Math.min(model.momentum_cap, Math.max(model.momentum_floor, finite(protocol.change_7d, 0)));
  const momentumMult = 1 + (growthPct / 100) * model.momentum_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * momentumMult * maturityMult * breadthMult));
  return { implied, multiple, peers, momentumMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
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

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = buildComps(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is on the board.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, comps, model) }));
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
    watchlist: watchlist.has(s.p.slug),
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      peers: s.peers,
      momentum_multiplier: round4(s.momentumMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

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

/** A second chain a protocol names, when it has one. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
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

/** A category's farm playbook: the core action, the follow-up action and the weekly habit. */
interface Playbook {
  core: (p: SnapshotProtocol, capital: number, chain: string) => string;
  second: (p: SnapshotProtocol, capital: number, chain: string) => string;
  weekly: string;
}

const PLAYBOOKS: { match: string[]; book: Playbook }[] = [
  {
    match: ['lend', 'cdp', 'collateralized'],
    book: {
      core: (p, c, chain) => `Supply $${c} of USDC to ${p.name} on ${chain} so the wallet holds a live lending position.`,
      second: (p, c) => `Borrow a small amount (under 30% of the supplied value) against the position on ${p.name} and repay it a week later, so both sides of the market record the wallet.`,
      weekly: 'one supply, borrow or repay action',
    },
  },
  {
    match: ['dex', 'derivative', 'perpetual', 'options', 'futures'],
    book: {
      core: (p, c, chain) => `Provide $${c} of liquidity to ${p.name}'s most-used pool or vault on ${chain} and keep the position open.`,
      second: (p, c) => `Route a few swaps through ${p.name} itself rather than an aggregator, so the wallet's volume is recorded by the protocol.`,
      weekly: 'one swap or liquidity adjustment',
    },
  },
  {
    match: ['bridge'],
    book: {
      core: (p, c, chain) => `Bridge $${c} of USDC through ${p.name} to ${chain} and use the bridged funds in one app on the far side.`,
      second: (p, c) => `Bridge a smaller amount back through ${p.name} after two weeks, so the wallet shows round-trip use rather than a single pass.`,
      weekly: 'one bridge transfer in either direction',
    },
  },
  {
    match: ['staking', 'restak'],
    book: {
      core: (p, c, chain) => `Stake $${c} of the chain's staking asset through ${p.name} on ${chain} and keep the liquid receipt token in the wallet.`,
      second: (p) => `Use the receipt token from ${p.name} in one integrated app it names, so the position counts as active rather than parked.`,
      weekly: 'one claim or restake of the rewards',
    },
  },
  {
    match: ['curator', 'allocator', 'risk', 'yield', 'farm', 'vault'],
    book: {
      core: (p, c, chain) => `Deposit $${c} into a ${p.name} vault on ${chain} and keep the vault shares in the wallet.`,
      second: (p, c, chain) => `Add a second, smaller deposit to a different ${p.name} vault on ${chain} after two weeks, so the wallet is not riding on one strategy.`,
      weekly: 'one deposit or share-balance check-in transaction',
    },
  },
  {
    match: ['stable'],
    book: {
      core: (p, c, chain) => `Mint or deposit $${c} of the stable asset through ${p.name} on ${chain} and hold the balance.`,
      second: (p) => `Stake part of the stable balance in ${p.name}'s own savings or staking module, if it offers one, and keep the receipt.`,
      weekly: 'one mint, stake or transfer of the stable asset',
    },
  },
  {
    match: ['rwa', 'real world'],
    book: {
      core: (p, c, chain) => `Mint $${c} of ${p.name}'s yield asset on ${chain} after its onboarding checks, and hold the position.`,
      second: (p) => `Complete every verification step ${p.name} offers (account, accreditation or region checks), since a completed profile is what a distribution can be keyed to.`,
      weekly: 'one yield claim or balance confirmation',
    },
  },
  {
    match: ['insurance'],
    book: {
      core: (p, c, chain) => `Buy $${c} of cover from ${p.name} on ${chain} for a position you actually hold, and keep the policy to expiry.`,
      second: (p, c, chain) => `Stake a smaller amount into a ${p.name} cover pool on ${chain} so the wallet appears on both sides of the market.`,
      weekly: 'one cover renewal check or pool action',
    },
  },
  {
    match: ['prediction', 'betting', 'gaming', 'nft', 'launchpad', 'social'],
    book: {
      core: (p, c, chain) => `Fund the wallet with $${c} on ${chain} and complete ${p.name}'s core action (a position, a mint or a launch) once, in full.`,
      second: (p) => `Finish ${p.name}'s profile and any season or quest steps it publishes, since consumer apps key rewards to completed profiles.`,
      weekly: 'one session that completes a full action, not just a login',
    },
  },
];

const DEFAULT_BOOK: Playbook = {
  core: (p, c, chain) => `Deposit $${c} of USDC into ${p.name} on ${chain} and keep the position open.`,
  second: (p) => `Repeat the core action on ${p.name} with a smaller amount after two weeks, so the wallet shows a pattern of use, not one visit.`,
  weekly: 'one deposit, swap or claim',
};

/** The playbook a protocol's category selects. */
function playbookFor(p: SnapshotProtocol): Playbook {
  const c = (p.category ?? '').toLowerCase();
  for (const entry of PLAYBOOKS) if (entry.match.some((m) => c.includes(m))) return entry.book;
  return DEFAULT_BOOK;
}

/**
 * A protocol's farm plan: six steps derived from its own record (category, chains, TVL, age),
 * never from a hand-written list of names. The dashboard renders the same plan from the same fields.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const secondChain = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbookFor(p);
  const steps: FarmStep[] = [
    {
      text: `Set up a fresh wallet for ${p.name} that holds only the funds you plan to farm, reach the app only from the protocol's own published link, and keep the seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: book.core(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: book.second(p, capital, chain),
      cost: 'about $3 of gas',
      time: '10 minutes',
    },
  ];
  if (secondChain !== null) {
    steps.push({
      text: `Repeat one qualifying action on ${secondChain}, where ${p.name} also records TVL, so the activity is not confined to a single chain.`,
      cost: 'about $3 of gas',
      time: '10 minutes',
    });
  }
  steps.push(
    {
      text: `Keep a weekly cadence on ${p.name}: ${book.weekly}, every week, so the wallet reads as a returning user across several snapshots.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days before withdrawing anything, then check the protocol's own points or rewards page and claim only from the link it publishes, never from a message or a search ad.`,
      cost: `the $${capital} stays in the position, and never pay to claim`,
      time: `${hold} days, then 10 minutes`,
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log for ${p.name}, so the position can be repeated, proved or unwound without guesswork.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps.slice(0, 7);
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

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
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
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    peers: row.model.peers,
    momentum_multiplier: row.model.momentum_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comps = buildComps(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const boardCount = new Map<string, number>();
  for (const r of board) boardCount.set(r.category ?? 'Uncategorised', (boardCount.get(r.category ?? 'Uncategorised') ?? 0) + 1);
  const categories: CategoryStat[] = [...comps.by_category.entries()]
    .map(([category, s]) => ({ category, peers: s.peers, median_multiple: s.median_multiple, used_multiple: s.used_multiple, board_rows: boardCount.get(category) ?? 0 }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: comps.global_multiple,
    universe_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    categories,
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
