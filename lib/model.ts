// Token radar, model radar-2: a sealed snapshot in, a ranked board out.
//
// One snapshot of the protocol universe — every protocol the index lists, the watchlist of
// slugs the radar must cover, the floor that divides watchlist from early radar — becomes a
// board of pre-token protocols ranked by implied launch value, plus the live-token set and the
// compact dataset the dashboard renders.
//
// The ranking invents no figure. Implied value is one closed form over the snapshot's own
// numbers (TVL, seven-day change, listing age, chain count), the same form for every row:
//
//   base       = tvl_usd * 0.25
//   growth     = clamp(change_7d, -50, 300)            (per cent; one week is noisy, cap it)
//   growthMult = 1 + growth / 100 * 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age unknown: 365 days)
//   diversity  = 1 + 0.04 * min(max(chains - 1, 0), 5)
//   implied    = max(1, round(base * growthMult * maturity * diversity))
//
// The board is the watchlist (every slug, the floor) plus the early radar: rankable pre-token
// protocols below the floor, by TVL. Rankable means pre-token (no market cap, no CoinGecko id,
// no symbol), not a centralised exchange, and not a versioned pool: a name ending in a release
// number is a pool of another protocol, not a protocol of its own. Live-token protocols are
// set aside with the market's own values and never enter the ranking.
//
// Farm plans are derived the same way, from category, chains, TVL and age — never from a
// hand-written list of names. The dashboard re-derives them in the page, so the plan a visitor
// reads and the plan board.json carries are the same derivation.

/** One day, in milliseconds: the unit age is counted in. */
const DAY_MS = 86_400_000;

/** The model's constants: the dashboard states them, and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  diversity_per_chain: number;
  diversity_max_extra: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25, growth_weight: 0.5,
  growth_floor: -50, growth_cap: 300,
  maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095,
  unknown_age_days: 365, diversity_per_chain: 0.04, diversity_max_extra: 5,
};

/** The version label of this model: the dashboard names it, the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** The early radar's size: pre-token protocols below the watchlist floor, by TVL. */
export const EARLY_ROWS = 200;

/** The Live token view's size: live-token protocols, by market cap. */
export const LIVE_ROWS = 24;

/** One protocol as the sealed input carries it: ten fields, no more. */
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

/** The snapshot document as a whole. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One farm step: the action, its cost, and its time. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One ranked row of board.json. */
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
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    diversity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the dashboard holds it, compact, its farm plan made in the page. */
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
  growth_multiplier: number;
  maturity_multiplier: number;
  diversity_multiplier: number;
  on_watchlist: boolean;
}

/** A protocol whose token already trades: the board shows the market's value, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** All the dashboard needs to render: the board, the live set, and the model behind them. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The headline's figures: watchlist slugs, board rows, live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The error a snapshot this model cannot score is refused with. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The number when it is finite, else `fallback`. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** Four decimals, for the multipliers board.json carries. */
const round4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; diversityMult: number; age: number | null } {
  const listedAge = ageDays(asOf, protocol.listed_at);
  const base = protocol.tvl_usd * model.base_multiple;
  const clampedGrowth = Math.min(model.growth_cap, Math.max(model.growth_floor, numOr(protocol.change_7d, 0)));
  const growthMult = 1 + (clampedGrowth / 100) * model.growth_weight;
  const ageUsed = listedAge ?? model.unknown_age_days;
  const aged = Math.min(Math.max(ageUsed, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (aged / model.maturity_days) * model.maturity_range;
  const extra = Math.min(Math.max(protocol.chains.length - 1, 0), model.diversity_max_extra);
  const diversityMult = 1 + extra * model.diversity_per_chain;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * diversityMult));
  return { implied, growthPct: clampedGrowth, growthMult, maturityMult, diversityMult, age: listedAge };
}

/** DefiLlama's version marker: a name ending in a release is another protocol's pool. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the board may rank a protocol: pre-token, no exchange, no versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Protocols by slug, for the watchlist lookup. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** Slug order for ties: the smaller slug first. */
function bySlugAsc(a: { slug: string }, b: { slug: string }): number {
  if (a.slug === b.slug) return 0;
  return a.slug < b.slug ? -1 : 1;
}

/** The protocols the board ranks: the watchlist first, then the early radar by TVL. */
function pickBoardSet(snapshot: Snapshot): Map<string, SnapshotProtocol> {
  const index = indexBySlug(snapshot.protocols);
  const picked = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) picked.set(slug, found);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by TVL. The cap sits
  // above the count the snapshot holds, so none is left out: a picked protocol stays picked.
  const belowFloor = (p: SnapshotProtocol): boolean => !picked.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd;
  const early = snapshot.protocols
    .filter(belowFloor)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugAsc(a, b))
    .slice(0, EARLY_ROWS);
  for (const p of early) picked.set(p.slug, p);
  return picked;
}

/** The board's protocols, strongest first, ranked 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const scored = [...pickBoardSet(snapshot).values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || bySlugAsc(a.p, b.p));
  return scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category,
    chains: s.p.chains, tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd, listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id, symbol: s.p.symbol, token_status: 'pre-token',
    age_days: s.age, implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple, growth_pct: s.growthPct,
      growth_multiplier: round4dp(s.growthMult), maturity_multiplier: round4dp(s.maturityMult),
      diversity_multiplier: round4dp(s.diversityMult), age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** One step as a single string: action, then cost and time, 20..600 characters per the gate. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A protocol's first chain, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  const first = p.chains[0];
  return first !== undefined ? first : 'its main chain';
}

/** A protocol's second chain, or null when it runs on one chain. */
function secondChain(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** The capital one farm position needs, read off the protocol's own TVL. */
function farmCapital(p: SnapshotProtocol): number {
  const tiers: Array<[number, number]> = [[5_000_000_000, 250], [1_000_000_000, 150], [100_000_000, 100]];
  for (const [floor, amount] of tiers) if (p.tvl_usd >= floor) return amount;
  return 50;
}

/** One transaction's cost on a chain, in dollars: Ethereum dear, Bitcoin middling, the rest cheap. */
function chainGas(chain: string): number {
  if (chain === 'Ethereum') return 12;
  if (chain === 'Bitcoin') return 8;
  return 1;
}

/** The hold length, from the protocol's age: younger protocols get the longer window. */
function holdDays(age: number | null): number {
  if (age === null || age >= 365) return 30;
  return age < 180 ? 60 : 45;
}

/** One category's three moves: first, second, and every week. */
interface CategoryPlay {
  primary: string;
  secondary: string;
  weekly: string;
}

/** One rule of the farm playbook: the category words it answers to, and the three moves it gives. */
interface PlayRule {
  keys: string[];
  make: (name: string, capital: number, chain: string) => CategoryPlay;
}

/** The playbook, first match wins: fourteen categories, then the default for the rest. */
const PLAYBOOK: PlayRule[] = [
  { keys: ['lend', 'cdp', 'collateral'], make: (name, capital, chain) => ({
    primary: `Supply $${capital} of USDC to ${name} on ${chain} and leave it earning.`,
    secondary: `Borrow a small amount against the supply, then repay it, so the position shows both sides of the market.`,
    weekly: `Top up the supply or repay part of the borrow once a week.`,
  }) },
  { keys: ['dex', 'yield', 'leveraged farm', 'liquidity manager'], make: (name, capital, chain) => ({
    primary: `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position in range.`,
    secondary: `Swap a small amount through the pool so the wallet shows trading as well as liquidity.`,
    weekly: `Collect the fees or rebalance the range once a week.`,
  }) },
  { keys: ['bridge'], make: (name, capital, chain) => ({
    primary: `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
    secondary: `Bridge a small amount back the other way so the wallet shows a round trip.`,
    weekly: `Move a small amount across the bridge once a week.`,
  }) },
  { keys: ['staking', 'restak'], make: (name, capital, chain) => ({
    primary: `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`,
    secondary: `Restake the staking rewards instead of claiming them, so the stake compounds.`,
    weekly: `Check the staking rewards and restake them once a week.`,
  }) },
  { keys: ['perpetual', 'derivative'], make: (name, capital, chain) => ({
    primary: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`,
    secondary: `Close the hedge, then reopen it, so the position shows more than one trade.`,
    weekly: `Adjust the hedge or place one small trade once a week.`,
  }) },
  { keys: ['prediction'], make: (name, capital, chain) => ({
    primary: `Fund $${capital} and place one market position on ${name}.`,
    secondary: `Settle the first position and place a second one on a different market.`,
    weekly: `Place one new market position a week.`,
  }) },
  { keys: ['curator', 'allocator', 'risk'], make: (name, capital, chain) => ({
    primary: `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
    secondary: `Deposit a second, smaller amount into a different vault the curator runs.`,
    weekly: `Check the vault's yield and rebalance between vaults once a week.`,
  }) },
  { keys: ['stable'], make: (name, capital, chain) => ({
    primary: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
    secondary: `Use the stable asset in one of the protocol's own pools or vaults.`,
    weekly: `Move the stable asset through one of the protocol's own features once a week.`,
  }) },
  { keys: ['rwa'], make: (name, capital, chain) => ({
    primary: `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`,
    secondary: `Check the yield the holding has accrued and record the rate it pays.`,
    weekly: `Top up the holding a little once a week while the yield accrues.`,
  }) },
  { keys: ['insurance'], make: (name, capital, chain) => ({
    primary: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`,
    secondary: `Read the policy terms and check what the cover pays out on.`,
    weekly: `Check the policy and the covered positions once a week.`,
  }) },
  { keys: ['basis'], make: (name, capital, chain) => ({
    primary: `Deposit $${capital} into ${name}'s basis strategy on ${chain} and keep the position.`,
    secondary: `Check the funding rate the strategy earns and record it.`,
    weekly: `Top up or rebalance the basis position once a week.`,
  }) },
  { keys: ['aggregator'], make: (name, capital, chain) => ({
    primary: `Deposit $${capital} into ${name}'s top vault on ${chain} and keep the shares.`,
    secondary: `Move the shares into a second vault the aggregator runs.`,
    weekly: `Harvest the yield or move between vaults once a week.`,
  }) },
  { keys: ['chain'], make: (name, capital, chain) => ({
    primary: `Bridge $${capital} of USDC onto ${name}'s chain and use it in one of the chain's own apps.`,
    secondary: `Use the bridged funds in a second app on the same chain.`,
    weekly: `Make one on-chain action a week on the chain.`,
  }) },
];

/** A category's play, worded so a farmer can follow it: the first rule whose words match. */
function playFor(p: SnapshotProtocol, capital: number, chain: string): CategoryPlay {
  const cat = (p.category ?? '').toLowerCase();
  for (const rule of PLAYBOOK) {
    if (rule.keys.some((k) => cat.includes(k))) return rule.make(p.name, capital, chain);
  }
  return {
    primary: `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`,
    secondary: `Use a second feature of the protocol with a small amount.`,
    weekly: `Make one qualifying action a week, such as a deposit, a swap or a vote.`,
  };
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. A protocol on more than one chain repeats its deposit on a second chain; the rest get a
 * second action in their own category.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const second = secondChain(p);
  const capital = farmCapital(p);
  const gas = chainGas(chain);
  const hold = holdDays(age);
  const play = playFor(p, capital, chain);
  const third: FarmStep =
    second !== null
      ? {
          text: `Repeat the deposit on ${second} as well, with half the capital, so the activity spans two chains.`,
          cost: `a second deposit of $${Math.round(capital / 2)} and about $${gas} of gas`,
          time: '10 minutes',
        }
      : { text: play.secondary, cost: `about $${gas} of gas`, time: '10 minutes' };
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: play.primary,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    third,
    {
      text: play.weekly,
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Open ${p.name}'s own points or rewards page and note what it counts; if it runs a community channel, join it and read the announcements.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, claim only from the link the protocol itself publishes; never pay to claim, and never follow a link from a direct message.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, and plan the unwind: withdraw in the same order you deposited.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols for the dashboard's Live token view, by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
    }));
}

/** A board row compacted for data.js, its farm plan generated in the page. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category,
    chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d,
    mcap_usd: row.mcap_usd, listed_at: row.listed_at, age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    diversity_multiplier: row.model.diversity_multiplier,
    on_watchlist: onWatchlist,
  };
}

/** Everything the dashboard renders, built from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, watchlist_size: snapshot.watchlist.length,
    board_size: board.length, early_size: early, live_size: live.length,
    rows: board.map((r) => radarRow(r, watch.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** A snapshot out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  const o = asRecord(raw, 'snapshot.json is not a JSON object');
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  return {
    as_of: o.as_of, source: o.source, floor_usd: o.floor_usd,
    protocols: o.protocols.map((v, i) => toProtocol(v, i)),
    watchlist: o.watchlist as string[],
  };
}

/** A JSON value as a record, refused with `message` when it is not one. */
function asRecord(v: unknown, message: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(message);
  return v as Record<string, unknown>;
}

/** A string field, or null when it is absent or not a string. */
function strField(o: Record<string, unknown>, key: string): string | null {
  return typeof o[key] === 'string' ? (o[key] as string) : null;
}

/** A finite number field, or null when it is absent or not a finite number. */
function numField(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** One protocol entry, refused unless it carries a slug, a name and a TVL. */
function toProtocol(v: unknown, i: number): SnapshotProtocol {
  const p = asRecord(v, `snapshot.json's protocol ${i} is not an object`);
  if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
    throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  }
  return {
    slug: p.slug, name: p.name, category: strField(p, 'category'),
    chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: p.tvl_usd, change_7d: numField(p, 'change_7d'),
    listed_at: strField(p, 'listed_at'), gecko_id: strField(p, 'gecko_id'),
    symbol: strField(p, 'symbol'), mcap_usd: numField(p, 'mcap_usd'),
  };
}

/** The reason a board is not one the gate takes, or null: coverage, ranks, order, one shared implied value, farm steps. */
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
    const bad = rowIssue(r);
    if (bad !== null) return bad;
  }
  return null;
}

/** Why one row is not one the gate will take, or null. */
function rowIssue(r: BoardRow): string | null {
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
  for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  return null;
}

/** data.js, compact: the dashboard's whole dataset as one script, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
