// Credit: Loot luck & percentile CDF statistics inspired by [银河奶牛]康康运气 (Weierstras, https://greasyfork.org/scripts/536205, MIT License).
import type { MarketStore } from "../../core/types";

export type CombatPriceMode = "bid_net" | "ask";

export interface CountedLootItem {
  itemHrid: string;
  count: number;
  enhancementLevel?: number;
}

export interface BattlePlayerSnapshot {
  characterId: number | string;
  name: string;
  isCurrentPlayer?: boolean;
  loot: CountedLootItem[];
  skillExp: Record<string, number>;
  consumables: Array<{ itemHrid: string; count: number }>;
  combatDropQuantity: number;
  combatDropRate: number;
  combatRareFind: number;
  drinkConcentration: number;
  deathCount: number;
  aura: string | null;
}

export interface ItemDropModel {
  hrid: string;
  dropRate: number;
  minCount: number;
  maxCount: number;
  price: number;
}

export interface SpawnEntry {
  hrid: string;
  strength: number;
  rate: number;
  difficultyTier: number;
}

export interface CombatMapEntry {
  info: {
    type: "solo" | "group" | "dungeon";
    mapHrid: string;
    name: string;
    order: number;
  };
  spawnInfo: {
    bossWave: number;
    maxSpawnCount: number;
    maxTotalStrength: number;
    spawns: SpawnEntry[];
    expectedSpawns: Record<string, number>;
  };
  monsterDrops: Record<string, Array<{
    isRare: boolean;
    itemHrid: string;
    dropRate: number;
    dropRatePerDifficultyTier: number;
    minCount: number;
    maxCount: number;
    minDifficultyTier: number;
  }>>;
  bossDrops: Record<string, Array<{
    isRare: boolean;
    itemHrid: string;
    dropRate: number;
    dropRatePerDifficultyTier: number;
    minCount: number;
    maxCount: number;
    minDifficultyTier: number;
  }>>;
}

export interface MapDropData {
  mapType: "solo" | "group" | "dungeon";
  spawnInfo: CombatMapEntry["spawnInfo"];
  bossCount: number;
  normalCount: number;
  bossDrops: Record<string, ItemDropModel[]>;
  monsterDrops: Record<string, ItemDropModel[]>;
}

export interface AnalyzedLootEntry {
  itemHrid: string;
  count: number;
  enhancementLevel: number;
  unitPrice: number;
  totalPrice: number;
  expectedCount: number;
  rarity: number;
}

export interface AnalyzedConsumableEntry {
  itemHrid: string;
  remainingCount: number;
  askPrice: number;
  dailyCount: number;
  dailyCost: number;
}

export interface PlayerBattleAnalysis {
  characterId: number | string;
  name: string;
  priceMode: CombatPriceMode;
  durationSec: number;
  runCount: number;
  completedRuns: number;
  eph: number;
  currentIncome: number;
  expectation: number;
  variance: number;
  stddev: number;
  hourlyIncome: number;
  dailyIncome: number;
  dailyExpectation: number;
  dailyStddev: number;
  foodDailyCost: number;
  currentProfit: number;
  profitExpectation: number;
  dailyProfit: number;
  dailyProfitExpectation: number;
  luck: number | null;
  luckColor: string;
  topSkillHrid: string | null;
  topSkillXp: number;
  topSkillXpPerHour: number;
  totalXp: number;
  totalXpPerHour: number;
  skillExpEntries: Array<{ skillHrid: string; xp: number; xpPerHour: number }>;
  lootItems: AnalyzedLootEntry[];
  consumables: AnalyzedConsumableEntry[];
  aura: string | null;
  deathCount: number;
  hasMapModel: boolean;
}

export const DUNGEON_ENTRY_KEYS: Record<string, string> = {
  "/items/chimerical_chest": "/items/chimerical_entry_key",
  "/items/sinister_chest": "/items/sinister_entry_key",
  "/items/enchanted_chest": "/items/enchanted_entry_key",
  "/items/pirate_chest": "/items/pirate_entry_key",
};

export const DUNGEON_CHEST_KEYS: Record<string, string> = {
  "/items/chimerical_chest": "/items/chimerical_chest_key",
  "/items/sinister_chest": "/items/sinister_chest_key",
  "/items/enchanted_chest": "/items/enchanted_chest_key",
  "/items/pirate_chest": "/items/pirate_chest_key",
  "/items/chimerical_refinement_chest": "/items/chimerical_chest_key",
  "/items/sinister_refinement_chest": "/items/sinister_chest_key",
  "/items/enchanted_refinement_chest": "/items/enchanted_chest_key",
  "/items/pirate_refinement_chest": "/items/pirate_chest_key",
};

export const CHEST_COST_FALLBACKS: Record<string, { keyAsk: number; keyBid: number; entryAsk?: number; entryBid?: number }> = {
  "/items/chimerical_chest": { keyAsk: 3600e3, keyBid: 3400e3, entryAsk: 210e3, entryBid: 190e3 },
  "/items/sinister_chest": { keyAsk: 6700e3, keyBid: 6400e3, entryAsk: 330e3, entryBid: 300e3 },
  "/items/enchanted_chest": { keyAsk: 8200e3, keyBid: 7800e3, entryAsk: 400e3, entryBid: 370e3 },
  "/items/pirate_chest": { keyAsk: 9400e3, keyBid: 9200e3, entryAsk: 460e3, entryBid: 440e3 },
};

export const AURA_ABILITY_SUFFIXES = [
  "revive",
  "insanity",
  "invincible",
  "fierce_aura",
  "aqua_aura",
  "sylvan_aura",
  "flame_aura",
  "speed_aura",
  "critical_aura",
];

// ===== Formatting & Colors (Kangkang Luck style) =====

function hsvToRgb(h: number, s: number, v: number): string {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = v; g = t; b = p; break;
    case 1:
      r = q; g = v; b = p; break;
    case 2:
      r = p; g = v; b = t; break;
    case 3:
      r = p; g = q; b = v; break;
    case 4:
      r = t; g = p; b = v; break;
    case 5:
      r = v; g = p; b = q; break;
  }
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export function getLuckColor(luck: number | null): string {
  if (luck === null || !Number.isFinite(luck)) return "#cbd5e1";
  const clamped = Math.min(Math.max(luck, 0), 1);
  const h = clamped * 0.34;
  const s = 0.9 - clamped * 0.25;
  const v = 1 - clamped * 0.25;
  return hsvToRgb(h, s, v);
}

export function formatLuckPercent(luck: number | null): string {
  if (luck === null || !Number.isFinite(luck)) return "--";
  return `${(Math.min(Math.max(luck, 0), 1) * 100).toFixed(2)}%`;
}

export function formatCombatPrice(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs < 10000) return `${sign}${Math.round(abs)}`;
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toPrecision(4).replace(/\.?0+$/, "")}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toPrecision(4).replace(/\.?0+$/, "")}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toPrecision(4).replace(/\.?0+$/, "")}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toPrecision(4).replace(/\.?0+$/, "")}K`;
  return `${sign}${Math.round(abs)}`;
}

export function formatBattleDuration(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function formatChatSummary(
  stat: PlayerBattleAnalysis,
  mapName: string,
  tier: number,
  isZh: boolean
): string {
  const tierTag = tier > 0 ? ` T${tier}` : "";
  const dur = formatBattleDuration(stat.durationSec);
  const luckStr = formatLuckPercent(stat.luck);
  if (isZh) {
    return `${mapName}${tierTag} (${dur}, ${stat.eph.toFixed(1)} 场/h) | 总计价值: ${formatCombatPrice(stat.currentIncome)}   每天收入: ${formatCombatPrice(stat.dailyIncome)}/d   期望日入: ${formatCombatPrice(stat.dailyExpectation)}/d   预计日利: ${formatCombatPrice(stat.dailyProfit)}/d   当前运气: ${luckStr}`;
  }
  return `${mapName}${tierTag} (${dur}, ${stat.eph.toFixed(1)} EPH) | Income: ${formatCombatPrice(stat.currentIncome)}   Daily: ${formatCombatPrice(stat.dailyIncome)}/d   Expected: ${formatCombatPrice(stat.dailyExpectation)}/d   Profit: ${formatCombatPrice(stat.dailyProfit)}/d   Luck: ${luckStr}`;
}

// ===== Pure TypeScript Radix-2 FFT & Characteristic Function Math =====

type ComplexPair = [number, number];

const fftTables = new Map<number, { rev: Uint32Array; cos: Float64Array; sin: Float64Array }>();

function getFftTable(n: number) {
  const existing = fftTables.get(n);
  if (existing) return existing;
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>>= 1;
    }
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    const ang = (-2 * Math.PI * k) / n;
    cos[k] = Math.cos(ang);
    sin[k] = Math.sin(ang);
  }
  const table = { rev, cos, sin };
  fftTables.set(n, table);
  return table;
}

/** In-place forward Radix-2 Cooley-Tukey FFT (matches ml-fft convention: angle = -2*pi*k/n). */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  const { rev, cos, sin } = getFftTable(n);

  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >>> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const idx = j * step;
        const wr = cos[idx];
        const wi = sin[idx];
        const k = i + j;
        const l = k + half;
        const tr = wr * re[l] - wi * im[l];
        const ti = wr * im[l] + wi * re[l];
        re[l] = re[k] - tr;
        im[l] = im[k] - ti;
        re[k] += tr;
        im[k] += ti;
      }
    }
  }
}

function complexMul(a: ComplexPair, b: ComplexPair): ComplexPair {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

function complexDiv(a: ComplexPair, b: ComplexPair): ComplexPair {
  const mag = b[0] * b[0] + b[1] * b[1];
  if (mag === 0) return [0, 0];
  return [(a[0] * b[0] + a[1] * b[1]) / mag, (a[1] * b[0] - a[0] * b[1]) / mag];
}

function complexPow(c: ComplexPair, exp: number): ComplexPair {
  const arg = Math.atan2(c[1], c[0]) * exp;
  const mag = Math.pow(c[0] * c[0] + c[1] * c[1], exp / 2);
  return [mag * Math.cos(arg), mag * Math.sin(arg)];
}

function getRoots(angleStep: number, samples: number): [Float64Array, Float64Array] {
  const sin = new Float64Array(samples);
  const cos = new Float64Array(samples);
  sin[0] = 0;
  cos[0] = 1;
  if (samples > 1) {
    sin[1] = Math.sin(angleStep);
    cos[1] = Math.cos(angleStep);
  }
  for (let i = 2; i < samples; i++) {
    const j = i >>> 1;
    const k = i - j;
    sin[i] = sin[j] * cos[k] + cos[j] * sin[k];
    cos[i] = cos[j] * cos[k] - sin[j] * sin[k];
  }
  return [cos, sin];
}

export type CharaFunc = (samples: number, scale: number) => ComplexPair[];

export function constantCF(x: number): CharaFunc {
  return (samples) => Array.from({ length: samples }, () => [x, 0] as ComplexPair);
}

function mulCF(cf1: CharaFunc, cf2: CharaFunc): CharaFunc {
  return (samples, scale) => {
    const z = cf1(samples, scale);
    const y = cf2(samples, scale);
    for (let i = 0; i < samples; i++) {
      const a0 = z[i][0];
      const a1 = z[i][1];
      const b0 = y[i][0];
      const b1 = y[i][1];
      z[i] = [a0 * b0 - a1 * b1, a0 * b1 + a1 * b0];
    }
    return z;
  };
}

export function mulListCF(cfs: CharaFunc[]): CharaFunc {
  if (cfs.length === 0) return constantCF(1);
  if (cfs.length === 1) return cfs[0];
  return (samples, scale) => {
    const z = cfs[0](samples, scale);
    for (let c = 1; c < cfs.length; c++) {
      const y = cfs[c](samples, scale);
      for (let i = 0; i < samples; i++) {
        const a0 = z[i][0];
        const a1 = z[i][1];
        const b0 = y[i][0];
        const b1 = y[i][1];
        z[i] = [a0 * b0 - a1 * b1, a0 * b1 + a1 * b0];
      }
    }
    return z;
  };
}

export function powCF(cf: CharaFunc, n: number): CharaFunc {
  if (n === 1) return cf;
  if (n <= 0) return constantCF(1);
  return (samples, scale) => {
    const z = cf(samples, scale);
    for (let i = 0; i < samples; i++) {
      z[i] = complexPow(z[i], n);
    }
    return z;
  };
}

export function itemCountExpt(item: { minCount: number; maxCount: number; dropRate: number }): number {
  return (item.dropRate * (item.minCount + item.maxCount)) / 2;
}

export function itemCountVar(item: { minCount: number; maxCount: number; dropRate: number }): number {
  const { minCount: l, maxCount: r, dropRate } = item;
  const F = (x: number) => {
    const a = Math.floor(x);
    const p = x - a;
    return a * ((a * a + 0.5) / 3 + p * (a + p)) + (p * p) / 2;
  };
  const EX2 = () => {
    if (r > l + 1e-5) {
      return (F(r) - F(l)) / (r - l);
    }
    const x = (l + r) / 2;
    const a = Math.floor(x);
    const p = x - a;
    return a * a + 2 * a * p + p;
  };
  const ex = itemCountExpt(item);
  return Math.max(0, dropRate * EX2() - ex * ex);
}

export function dropItemCharaFunc(item: ItemDropModel): CharaFunc {
  const { minCount: l, maxCount: r, dropRate, price } = item;
  if (dropRate <= 0 || price <= 0 || r <= 0) {
    return constantCF(1);
  }
  const eps = 1e-8;
  const L = Math.ceil(l);
  const R = Math.floor(r);

  if (L > R || r - l < eps) {
    const p = (l + r) / 2 - R;
    const pr = p * dropRate;
    const mpr = (1 - p) * dropRate;
    const mr = 1 - dropRate;

    return (samples, scale) => {
      const val: ComplexPair[] = new Array(samples);
      const base = 2 * Math.PI * scale * price;
      const [cosR1, sinR1] = getRoots(base * (R + 1), samples);
      const [cosR, sinR] = getRoots(base * R, samples);
      for (let T = 0; T < samples; T++) {
        val[T] = [cosR1[T] * pr + cosR[T] * mpr + mr, sinR1[T] * pr + sinR[T] * mpr];
      }
      return val;
    };
  }

  if (L === R) {
    const pL = (dropRate * (L - l) * (L - l)) / ((r - l) * 2);
    const pR = (dropRate * (r - R) * (r - R)) / ((r - l) * 2);
    const mr = 1 - dropRate;

    return (samples, scale) => {
      const val: ComplexPair[] = new Array(samples);
      const base = 2 * Math.PI * scale * price;
      const [cos, sin] = getRoots(base, samples);
      const [cosR, sinR] = getRoots(base * R, samples);
      for (let T = 0; T < samples; T++) {
        const a: ComplexPair = [dropRate + (pL + pR) * (cos[T] - 1), (-pL + pR) * sin[T]];
        const c = complexMul([cosR[T], sinR[T]], a);
        c[0] += mr;
        val[T] = c;
      }
      return val;
    };
  }

  const dL = L - l;
  const dR = r - R;
  const dL2 = dL * dL;
  const dR2 = dR * dR;
  const mr = 1 - dropRate;
  const invLen = dropRate / (r - l);

  return (samples, scale) => {
    const val: ComplexPair[] = new Array(samples);
    const base = 2 * Math.PI * scale * price;
    const [cos, sin] = getRoots(base, samples);
    const [cosR, sinR] = getRoots(base * R, samples);
    const [cosL, sinL] = getRoots(base * L, samples);
    for (let T = 0; T < samples; T++) {
      const ctm1d2 = (cos[T] - 1) / 2;
      const std2 = sin[T] / 2;
      const elt: ComplexPair = [cosL[T], sinL[T]];
      const ert: ComplexPair = [cosR[T], sinR[T]];
      const fL = complexMul([dL + dL2 * ctm1d2, -dL2 * std2], elt);
      const fR = complexMul([dR + dR2 * ctm1d2, dR2 * std2], ert);
      const irwin: ComplexPair =
        ctm1d2 > -eps && std2 < eps && std2 > -eps
          ? [(R - L) * elt[0], (R - L) * (elt[1] + std2 * (R - L - 1))]
          : complexDiv([ert[0] - elt[0], ert[1] - elt[1]], [ctm1d2 * 2, std2 * 2]);
      const fMid = complexMul(irwin, [1 + ctm1d2, std2]);
      val[T] = [mr + invLen * (fL[0] + fR[0] + fMid[0]), invLen * (fL[1] + fR[1] + fMid[1])];
    }
    return val;
  };
}

function getScaledCDF(cf: CharaFunc, samples: number, scale: number): (x: number) => number {
  const padding = 2;
  const offset = 0.4;
  const N = samples * padding;
  const val = cf(samples, scale * (1 - offset));

  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < samples; i++) {
    re[i] = val[i][0];
    im[i] = val[i][1];
  }

  fftInPlace(re, im);

  let sum = 0;
  for (let i = 0; i < N; i++) {
    re[i] -= 0.5;
    sum += re[i];
  }
  if (sum <= 0 || !Number.isFinite(sum)) {
    return () => 0.5;
  }
  for (let i = 0; i < N; i++) {
    re[i] /= sum;
  }

  const rawCdf = new Float64Array(N);
  rawCdf[0] = (re[0] + re[N - 1]) / 2;
  for (let i = 1; i < N; i++) {
    rawCdf[i] = rawCdf[i - 1] + (re[i] + re[i - 1]) / 2;
  }

  // Moving median filter (window radius = padding)
  const cdf = new Float64Array(N);
  const win = new Array<number>(2 * padding);
  for (let i = 0; i < N; i++) {
    let idx = 0;
    for (let j = i - padding + 1; j <= i + padding; j++) {
      const p = rawCdf[((j % N) + N) % N];
      win[idx++] = j < 0 ? p - 1 : j >= N ? p + 1 : p;
    }
    win.sort((a, b) => a - b);
    cdf[i] = (win[padding - 1] + win[padding]) / 2;
  }

  const baseIdx = Math.floor(N * (1 - offset));
  const base = cdf[baseIdx] - 1;
  for (let i = 0; i < N; i++) cdf[i] -= base;
  for (let i = 1; i < N; i++) {
    if (cdf[i] < cdf[i - 1]) cdf[i] = cdf[i - 1];
  }

  return (x: number) => {
    if (x < 0) return 0;
    if (x >= 1) return 1;
    const t = x * (1 - offset) * N - 0.5;
    let i = Math.floor(t + 0.5);
    if (i < 0) i = 0;
    if (i >= N) i = N - 1;
    const r = t - i;
    const L = i - 1 < 0 ? cdf[i + N - 1] - 1 : cdf[i - 1];
    const R = i + 1 >= N ? cdf[i - N + 1] + 1 : cdf[i + 1];
    const A = (cdf[i] + L) / 2;
    const B = (cdf[i] + R) / 2;
    const kA = cdf[i] - L;
    const kB = R - cdf[i];
    const ret =
      2 * (r + 1) * (r - 0.5) * (r - 0.5) * A +
      2 * (1 - r) * (r + 0.5) * (r + 0.5) * B +
      (r * r - 0.25) * ((r - 0.5) * kA + (r + 0.5) * kB);
    return ret < 0 ? 0 : ret > 1 ? 1 : ret;
  };
}

function binarySearchInverse(fn: (x: number) => number, left: number, right: number, target: number): number {
  let l = left;
  let r = right;
  for (let i = 0; i < 48; i++) {
    const mid = (l + r) / 2;
    if (fn(mid) < target) l = mid;
    else r = mid;
  }
  return (l + r) / 2;
}

export function getCharaFuncCDF(
  cf: CharaFunc,
  initialLimit: number,
  samples = 1024
): { limit: number; cdf: (x: number) => number } {
  const eps = 1e-4;
  const speed = 0.9;
  const limitEps = 1e-4;
  const maxIter = 20;
  const rescaleSamples = 64;
  let limit = Math.max(100, initialLimit);

  for (let i = 0; i < maxIter; i++) {
    const rough = getScaledCDF(cf, rescaleSamples, 1 / limit);
    if (rough(speed) < 1 - eps) break;
    const x = binarySearchInverse(rough, 0, 1, 1 - eps);
    if (x / speed > 1 - limitEps || x <= 1e-6) break;
    limit *= x / speed;
  }

  const finalCdf = getScaledCDF(cf, samples, 1 / limit);
  return {
    limit,
    cdf: (x: number) => finalCdf(x / limit),
  };
}

// ===== Spawn DP & DAG =====

export function computeExpectedSpawns(
  spawns: SpawnEntry[],
  maxSpawnCount: number,
  maxTotalStrength: number
): Record<string, number> {
  const res: Record<string, number> = {};
  for (const m of spawns) res[m.hrid] = 0;
  if (!spawns.length || maxSpawnCount <= 0 || maxTotalStrength <= 0) return res;

  const N = Math.min(200, Math.floor(maxTotalStrength));
  const K = Math.min(50, Math.floor(maxSpawnCount));
  const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(K + 1).fill(0));
  dp[0][0] = 1;

  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= K; j++) {
      if (dp[i][j] === 0) continue;
      for (const m of spawns) {
        const ni = i + Math.max(1, Math.round(m.strength || 1));
        const nj = j + 1;
        if (ni > N || nj > K) continue;
        const val = dp[i][j] * m.rate;
        dp[ni][nj] += val;
        res[m.hrid] = (res[m.hrid] || 0) + val;
      }
    }
  }
  return res;
}

interface SpawnGraphNode {
  init: number;
  edges: Array<{ to: number; hrid: string }>;
}

function buildSpawnTransGraph(spawns: SpawnEntry[], maxSpawnCount: number, maxTotalStrength: number): SpawnGraphNode[] {
  const K = Math.min(50, Math.floor(maxSpawnCount));
  const N = Math.min(200, Math.floor(maxTotalStrength));
  const idMap = new Map<number, number>();
  const nodes: SpawnGraphNode[] = [];

  const key = (i: number, j: number) => i * (K + 1) + j;
  const getId = (i: number, j: number) => {
    const k = key(i, j);
    const existing = idMap.get(k);
    if (existing !== undefined) return existing;
    const id = nodes.length;
    idMap.set(k, id);
    nodes.push({ init: 0, edges: [] });
    return id;
  };

  getId(0, 0);

  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= K; j++) {
      const k = key(i, j);
      const id = idMap.get(k);
      if (id === undefined) continue;
      for (const m of spawns) {
        const ni = i + Math.max(1, Math.round(m.strength || 1));
        const nj = j + 1;
        if (ni > N || nj > K) {
          nodes[id].init += m.rate;
        } else {
          nodes[id].edges.push({ to: getId(ni, nj), hrid: m.hrid });
        }
      }
    }
  }
  return nodes;
}

function normalWaveCF(
  spawnInfo: CombatMapEntry["spawnInfo"],
  monsterDrops: Record<string, ItemDropModel[]>
): CharaFunc {
  const { spawns, maxSpawnCount, maxTotalStrength } = spawnInfo;
  if (!spawns.length || maxSpawnCount <= 0 || maxTotalStrength <= 0) {
    return constantCF(1);
  }

  const cfs: Record<string, CharaFunc> = {};
  for (const m of spawns) {
    cfs[m.hrid] = mulListCF((monsterDrops[m.hrid] || []).map((d) => dropItemCharaFunc(d)));
  }

  const transGraph = buildSpawnTransGraph(spawns, maxSpawnCount, maxTotalStrength);
  return (samples, scale) => {
    const cfTab: Record<string, ComplexPair[]> = {};
    for (const m of spawns) {
      const z = cfs[m.hrid](samples, scale);
      for (let i = 0; i < samples; i++) {
        z[i][0] *= m.rate;
        z[i][1] *= m.rate;
      }
      cfTab[m.hrid] = z;
    }

    const val: ComplexPair[][] = new Array(transGraph.length);
    for (let u = transGraph.length - 1; u >= 0; u--) {
      const cur: ComplexPair[] = Array.from({ length: samples }, () => [transGraph[u].init, 0] as ComplexPair);
      for (const edge of transGraph[u].edges) {
        const child = val[edge.to];
        const mcf = cfTab[edge.hrid];
        for (let i = 0; i < samples; i++) {
          cur[i][0] += child[i][0] * mcf[i][0] - child[i][1] * mcf[i][1];
          cur[i][1] += child[i][0] * mcf[i][1] + child[i][1] * mcf[i][0];
        }
      }
      val[u] = cur;
    }
    return val[0];
  };
}

// ===== Drop Expectation, Variance & CDF =====

export function computeDropExpectation(dropData: MapDropData): number {
  let total = 0;
  for (const drops of Object.values(dropData.bossDrops)) {
    for (const item of drops) {
      total += dropData.bossCount * itemCountExpt(item) * item.price;
    }
  }
  const expSpawns = dropData.spawnInfo.expectedSpawns;
  for (const [hrid, drops] of Object.entries(dropData.monsterDrops)) {
    const cnt = (expSpawns[hrid] || 0) * dropData.normalCount;
    if (cnt <= 0) continue;
    for (const item of drops) {
      total += cnt * itemCountExpt(item) * item.price;
    }
  }
  return total;
}

export function computeDropVariance(dropData: MapDropData): number {
  let total = 0;
  for (const drops of Object.values(dropData.bossDrops)) {
    for (const item of drops) {
      total += dropData.bossCount * itemCountVar(item) * item.price * item.price;
    }
  }
  const expSpawns = dropData.spawnInfo.expectedSpawns;
  for (const [hrid, drops] of Object.entries(dropData.monsterDrops)) {
    const cnt = (expSpawns[hrid] || 0) * dropData.normalCount;
    if (cnt <= 0) continue;
    for (const item of drops) {
      total += cnt * itemCountVar(item) * item.price * item.price;
    }
  }
  return total;
}

export function computeBattleLuckCDF(
  dropData: MapDropData,
  expectation: number,
  stddev: number,
  samples = 1024
): ((income: number) => number) | null {
  const totalWaves = dropData.bossCount + dropData.normalCount;
  if (totalWaves <= 0 || expectation <= 0 || stddev <= 0) return null;

  const dungeonDrops = dropData.bossDrops["_dungeon"];
  if (dropData.mapType === "dungeon" && dungeonDrops && dungeonDrops.length > 0) {
    let deterministicOffset = 0;
    const randomCFs: CharaFunc[] = [];

    for (const drop of dungeonDrops) {
      if (drop.price <= 0 || drop.dropRate <= 0) continue;
      if (drop.dropRate >= 1 && Math.abs(drop.maxCount - drop.minCount) < 1e-8) {
        const baseInt = Math.floor(drop.minCount);
        const frac = drop.minCount - baseInt;
        deterministicOffset += baseInt * drop.price * dropData.bossCount;
        if (frac > 1e-6) {
          randomCFs.push(
            powCF(
              dropItemCharaFunc({
                hrid: drop.hrid,
                dropRate: 1,
                minCount: frac,
                maxCount: frac,
                price: drop.price,
              }),
              dropData.bossCount
            )
          );
        }
      } else {
        randomCFs.push(powCF(dropItemCharaFunc(drop), dropData.bossCount));
      }
    }

    if (randomCFs.length === 0) return null;
    const cf = mulListCF(randomCFs);
    const remainingExp = Math.max(100, expectation - deterministicOffset);
    const initLimit = Math.max(1e6, remainingExp + 10 * stddev, 2e5 * dropData.bossCount);
    const { cdf } = getCharaFuncCDF(cf, initLimit, samples);
    return (income: number) => cdf(income - deterministicOffset);
  }

  const normalCF =
    dropData.normalCount > 0 ? powCF(normalWaveCF(dropData.spawnInfo, dropData.monsterDrops), dropData.normalCount) : constantCF(1);
  const bossWaveCF = mulListCF(
    Object.values(dropData.bossDrops).map((drops) => mulListCF(drops.map((d) => dropItemCharaFunc(d))))
  );
  const bossCF = dropData.bossCount > 0 ? powCF(bossWaveCF, dropData.bossCount) : constantCF(1);
  const fullCF = mulCF(normalCF, bossCF);

  const initLimit = Math.max(1e8, 2e5 * totalWaves, (expectation + 10 * stddev) * 1.5);
  const { cdf } = getCharaFuncCDF(fullCF, initLimit, samples);
  return cdf;
}

// ===== Price Resolver (Kangkang Luck style: special items + shop tokens + chests) =====

export class CombatPriceResolver {
  private marketStore: MarketStore;
  private clientData: any | null = null;
  private specialPrices = new Map<string, { ask: number; bid: number; bidNet: number }>();
  private cacheKey = "";

  constructor(marketStore: MarketStore) {
    this.marketStore = marketStore;
  }

  private ensureCache(clientData: any | null, marketLoadedKey: string): void {
    const key = `${clientData ? "cd1" : "cd0"}:${marketLoadedKey}`;
    if (this.cacheKey === key && this.clientData === clientData) return;
    this.cacheKey = key;
    this.clientData = clientData;
    this.specialPrices.clear();

    this.specialPrices.set("/items/coin", { ask: 1, bid: 1, bidNet: 1 });
    if (!clientData) return;

    const bagP = this.readRawPrice("/items/bag_of_10_cowbells", 0);
    if (bagP.ask > 0 || bagP.bid > 0) {
      this.specialPrices.set("/items/cowbell", {
        ask: bagP.ask / 10,
        bid: bagP.bid / 10,
        bidNet: bagP.bidNet / 10,
      });
    }

    const mirrorP = this.readRawPrice("/items/mirror_of_protection", 0);
    if (mirrorP.ask > 0 || mirrorP.bid > 0) {
      for (const hrid of ["/items/chimerical_quiver", "/items/sinister_cape", "/items/enchanted_cloak"]) {
        this.specialPrices.set(hrid, mirrorP);
      }
    }

    // Shop tokens best exchange rate
    const shopMap = clientData.shopItemDetailMap || {};
    const costItemBest = new Map<string, { ask: number; bid: number; bidNet: number }>();
    for (const detail of Object.values<any>(shopMap)) {
      if (!detail?.itemHrid || !Array.isArray(detail.costs) || detail.costs.length === 0) continue;
      const outP = this.getAllPriceModes(detail.itemHrid, 0);
      for (const c of detail.costs) {
        if (!c?.itemHrid || c.itemHrid === "/items/coin" || !c.count) continue;
        const div = detail.costs.length * c.count;
        const ask = outP.ask / div;
        const bid = outP.bid / div;
        const bidNet = outP.bidNet / div;
        const prev = costItemBest.get(c.itemHrid);
        if (!prev || bidNet > prev.bidNet) {
          costItemBest.set(c.itemHrid, { ask, bid, bidNet });
        }
      }
    }
    for (const [hrid, p] of costItemBest.entries()) {
      this.specialPrices.set(hrid, p);
    }

    // Iterative chest expected value + task token valuation
    const openables = clientData.openableLootDropMap || {};
    const taskShop = clientData.taskShopItemDetailMap || {};
    for (let iter = 0; iter < 12; iter++) {
      for (const [boxHrid, items] of Object.entries<any[]>(openables)) {
        if (boxHrid === "/items/bag_of_10_cowbells" || !Array.isArray(items)) continue;
        let totalAsk = 0;
        let totalBid = 0;
        let totalBidNet = 0;
        for (const drop of items) {
          if (!drop?.itemHrid) continue;
          const p = this.getAllPriceModes(drop.itemHrid, 0);
          const expCount = ((drop.dropRate || 0) * ((drop.minCount || 0) + (drop.maxCount ?? drop.minCount ?? 0))) / 2;
          totalAsk += p.ask * expCount;
          totalBid += p.bid * expCount;
          totalBidNet += p.bidNet * expCount;
        }

        const entryKeyHrid = DUNGEON_ENTRY_KEYS[boxHrid];
        const chestKeyHrid = DUNGEON_CHEST_KEYS[boxHrid];
        if (chestKeyHrid) {
          const fb = CHEST_COST_FALLBACKS[boxHrid];
          const keyP = this.getAllPriceModes(chestKeyHrid, 0);
          const keyAsk = keyP.ask || fb?.keyAsk || 0;
          const keyBid = keyP.bidNet || fb?.keyBid || 0;
          let entryAsk = 0;
          let entryBid = 0;
          if (entryKeyHrid) {
            const ep = this.getAllPriceModes(entryKeyHrid, 0);
            entryAsk = ep.ask || fb?.entryAsk || 0;
            entryBid = ep.bidNet || fb?.entryBid || 0;
          }
          this.specialPrices.set(boxHrid, {
            ask: Math.max(0, totalAsk - keyBid - entryBid),
            bid: Math.max(0, totalBid - keyAsk - entryAsk),
            bidNet: Math.max(0, totalBidNet - keyAsk - entryAsk),
          });
        } else {
          this.specialPrices.set(boxHrid, { ask: totalAsk, bid: totalBid, bidNet: totalBidNet });
        }
      }

      let tokenAsk = 0;
      let tokenBid = 0;
      let tokenBidNet = 0;
      for (const item of Object.values<any>(taskShop)) {
        if (!item?.cost || item.cost.itemHrid !== "/items/task_token" || !item.cost.count) continue;
        const targetHrid = item.itemHrid || `/items/${String(item.name || "").toLowerCase().replace(/\s+/g, "_")}`;
        const p = this.getAllPriceModes(targetHrid, 0);
        tokenAsk = Math.max(tokenAsk, p.ask / item.cost.count);
        tokenBid = Math.max(tokenBid, p.bid / item.cost.count);
        tokenBidNet = Math.max(tokenBidNet, p.bidNet / item.cost.count);
      }
      if (tokenBidNet > 0 || tokenAsk > 0) {
        this.specialPrices.set("/items/task_token", { ask: tokenAsk, bid: tokenBid, bidNet: tokenBidNet });
      }
    }
  }

  private readRawPrice(itemHrid: string, enh = 0): { ask: number; bid: number; bidNet: number } {
    if (itemHrid === "/items/coin") return { ask: 1, bid: 1, bidNet: 1 };
    const m = this.marketStore.getPrice(itemHrid, enh);
    const rawAsk = m?.ask && m.ask > 0 ? m.ask : 0;
    const rawBid = m?.bid && m.bid > 0 ? m.bid : 0;

    if (rawAsk > 0 || rawBid > 0) {
      const ask = rawAsk > 0 ? rawAsk : Math.ceil(rawBid / 0.98);
      const bid = rawBid > 0 ? rawBid : Math.floor(rawAsk * 0.98);
      const bidNet =
        itemHrid === "/items/bag_of_10_cowbells" ? Math.floor(bid * 0.82) : Math.floor(bid * 0.98);
      return { ask, bid, bidNet };
    }

    const sellPrice = this.clientData?.itemDetailMap?.[itemHrid]?.sellPrice;
    if (typeof sellPrice === "number" && sellPrice > 0) {
      return { ask: sellPrice, bid: sellPrice, bidNet: sellPrice };
    }
    return { ask: 0, bid: 0, bidNet: 0 };
  }

  private getAllPriceModes(itemHrid: string, enh = 0): { ask: number; bid: number; bidNet: number } {
    if (enh === 0 && this.specialPrices.has(itemHrid)) {
      return this.specialPrices.get(itemHrid)!;
    }
    return this.readRawPrice(itemHrid, enh);
  }

  getUnitPrice(
    itemHrid: string,
    mode: CombatPriceMode,
    enh = 0,
    clientData: any | null = null,
    marketEpoch = "0"
  ): number {
    this.ensureCache(clientData, marketEpoch);
    const all = this.getAllPriceModes(itemHrid, enh);
    return mode === "ask" ? all.ask : all.bidNet;
  }

  getAskPrice(itemHrid: string, enh = 0, clientData: any | null = null, marketEpoch = "0"): number {
    this.ensureCache(clientData, marketEpoch);
    return this.getAllPriceModes(itemHrid, enh).ask;
  }
}

// ===== Combat Map Model & Rarity Registry =====

export class CombatMapRegistry {
  private clientDataRef: any | null = null;
  private maps = new Map<string, CombatMapEntry>();
  private itemFreq = new Map<string, number>();

  private rebuildIfNeeded(clientData: any | null): void {
    if (!clientData || this.clientDataRef === clientData) return;
    this.clientDataRef = clientData;
    this.maps.clear();
    this.itemFreq.clear();

    const monsterMap = clientData.combatMonsterDetailMap || {};
    const actionMap = clientData.actionDetailMap || {};

    for (const [actionHrid, detail] of Object.entries<any>(actionMap)) {
      if (!actionHrid.startsWith("/actions/combat/") || !detail?.combatZoneInfo) continue;

      if (detail.combatZoneInfo.isDungeon) {
        const rewardDropTable = detail.combatZoneInfo.dungeonInfo?.rewardDropTable || [];
        this.maps.set(actionHrid, {
          info: {
            type: "dungeon",
            mapHrid: actionHrid,
            name: detail.name || actionHrid,
            order: detail.sortIndex || 0,
          },
          spawnInfo: {
            bossWave: 1,
            maxSpawnCount: 0,
            maxTotalStrength: 0,
            spawns: [],
            expectedSpawns: {},
          },
          monsterDrops: {},
          bossDrops: {
            _dungeon: rewardDropTable.map((d: any) => ({
              isRare: false,
              itemHrid: d.itemHrid,
              dropRate: Number(d.dropRate) || 0,
              dropRatePerDifficultyTier: Number(d.dropRatePerDifficultyTier) || 0,
              minCount: Number(d.minCount) || 0,
              maxCount: Number(d.maxCount ?? d.minCount) || 0,
              minDifficultyTier: Number(d.minDifficultyTier ?? d.minEliteTier ?? 0) || 0,
            })),
          },
        });
        continue;
      }

      const fightInfo = detail.combatZoneInfo.fightInfo;
      const rawSpawnInfo = fightInfo?.randomSpawnInfo;
      const rawSpawns = Array.isArray(rawSpawnInfo?.spawns) ? rawSpawnInfo.spawns : [];
      if (rawSpawns.length === 0) continue;

      const totalRate = rawSpawns.reduce((s: number, x: any) => s + (Number(x.rate) || 0), 0);
      if (totalRate <= 0) continue;

      const spawns: SpawnEntry[] = rawSpawns.map((s: any) => ({
        hrid: s.combatMonsterHrid,
        strength: Number(s.strength) || 1,
        rate: (Number(s.rate) || 0) / totalRate,
        difficultyTier: Number(s.difficultyTier ?? s.eliteTier ?? 0) || 0,
      }));

      const bossSpawns: any[] = Array.isArray(fightInfo.bossSpawns) ? fightInfo.bossSpawns : [];
      const bossWave = Number(fightInfo.battlesPerBoss) || 0;
      const mapType: "solo" | "group" = spawns.length > 1 || bossWave > 0 ? "group" : "solo";

      const collectDrops = (monsterHrid: string) => {
        const md = monsterMap[monsterHrid];
        if (!md) return [];
        const normal = (md.dropTable || []).map((d: any) => ({
          isRare: false,
          itemHrid: d.itemHrid,
          dropRate: Number(d.dropRate) || 0,
          dropRatePerDifficultyTier: Number(d.dropRatePerDifficultyTier) || 0,
          minCount: Number(d.minCount) || 0,
          maxCount: Number(d.maxCount ?? d.minCount) || 0,
          minDifficultyTier: Number(d.minDifficultyTier ?? d.minEliteTier ?? 0) || 0,
        }));
        const rare = (md.rareDropTable || []).map((d: any) => ({
          isRare: true,
          itemHrid: d.itemHrid,
          dropRate: Number(d.dropRate) || 0,
          dropRatePerDifficultyTier: Number(d.dropRatePerDifficultyTier) || 0,
          minCount: Number(d.minCount) || 0,
          maxCount: Number(d.maxCount ?? d.minCount) || 0,
          minDifficultyTier: Number(d.minDifficultyTier ?? d.minEliteTier ?? 0) || 0,
        }));
        return [...normal, ...rare];
      };

      const monsterDrops: CombatMapEntry["monsterDrops"] = {};
      for (const s of spawns) {
        if (!monsterDrops[s.hrid]) monsterDrops[s.hrid] = collectDrops(s.hrid);
      }

      const bossDrops: CombatMapEntry["bossDrops"] = {};
      for (const bs of bossSpawns) {
        if (bs?.combatMonsterHrid && !bossDrops[bs.combatMonsterHrid]) {
          bossDrops[bs.combatMonsterHrid] = collectDrops(bs.combatMonsterHrid);
        }
      }

      const maxSpawnCount = Number(rawSpawnInfo.maxSpawnCount) || 1;
      const maxTotalStrength = Number(rawSpawnInfo.maxTotalStrength) || 1;
      const expectedSpawns = computeExpectedSpawns(spawns, maxSpawnCount, maxTotalStrength);

      this.maps.set(actionHrid, {
        info: {
          type: mapType,
          mapHrid: actionHrid,
          name: detail.name || actionHrid,
          order: detail.sortIndex || 0,
        },
        spawnInfo: {
          bossWave,
          maxSpawnCount,
          maxTotalStrength,
          spawns,
          expectedSpawns,
        },
        monsterDrops,
        bossDrops,
      });
    }

    // Build global item frequency table for rarity coloring
    const itemTotal = new Map<string, number>();
    const itemNum = new Map<string, number>();
    for (const entry of this.maps.values()) {
      for (const [mHrid, drops] of Object.entries(entry.monsterDrops)) {
        const expSpawn = entry.spawnInfo.expectedSpawns[mHrid] || 0;
        for (const d of drops) {
          const expt = ((d.minCount + d.maxCount) / 2) * d.dropRate * expSpawn;
          itemTotal.set(d.itemHrid, (itemTotal.get(d.itemHrid) || 0) + expt);
          itemNum.set(d.itemHrid, (itemNum.get(d.itemHrid) || 0) + 1);
        }
      }
      if (entry.spawnInfo.bossWave > 0) {
        for (const drops of Object.values(entry.bossDrops)) {
          for (const d of drops) {
            const expt = (((d.minCount + d.maxCount) / 2) * d.dropRate) / entry.spawnInfo.bossWave;
            itemTotal.set(d.itemHrid, (itemTotal.get(d.itemHrid) || 0) + expt);
            itemNum.set(d.itemHrid, (itemNum.get(d.itemHrid) || 0) + 1);
          }
        }
      }
    }
    for (const [hrid, tot] of itemTotal.entries()) {
      const cnt = itemNum.get(hrid) || 1;
      this.itemFreq.set(hrid, tot / cnt);
    }
  }

  getMapEntry(clientData: any | null, mapHrid: string | null): CombatMapEntry | null {
    if (!mapHrid) return null;
    this.rebuildIfNeeded(clientData);
    return this.maps.get(mapHrid) ?? null;
  }

  buildDropData(
    clientData: any | null,
    mapHrid: string,
    difficultyTier: number,
    runCount: number,
    playerCount: number,
    player: BattlePlayerSnapshot,
    priceResolver: CombatPriceResolver,
    priceMode: CombatPriceMode,
    marketEpoch: string
  ): MapDropData | null {
    const entry = this.getMapEntry(clientData, mapHrid);
    if (!entry) return null;

    const completed = Math.max(0, runCount - 1);
    const bossWave = entry.spawnInfo.bossWave;
    const bossCount = bossWave > 0 ? Math.floor(completed / bossWave) : 0;
    const normalCount = bossWave > 0 ? bossCount * (bossWave - 1) + (completed % bossWave) : completed;

    const partySize = Math.max(1, playerCount);
    const dq = Math.max(0, player.combatDropQuantity || 0);
    const dr = Math.max(0, player.combatDropRate || 0);
    const rf = Math.max(0, player.combatRareFind || 0);
    const tier = Math.max(0, difficultyTier || 0);

    const resolveItemPrice = (hrid: string) => priceResolver.getUnitPrice(hrid, priceMode, 0, clientData, marketEpoch);

    if (entry.info.type === "dungeon") {
      const chestDrops = entry.bossDrops["_dungeon"] || [];
      const dungeonModels: ItemDropModel[] = [];
      for (const drop of chestDrops) {
        if (drop.minDifficultyTier > tier) continue;
        const baseRate = drop.dropRate + drop.dropRatePerDifficultyTier * tier;
        const adjustedRate = Math.min(1, Math.max(0, baseRate));
        if (adjustedRate <= 0) continue;

        const price = resolveItemPrice(drop.itemHrid);
        if (adjustedRate >= 1) {
          const chestsPerRun = (5 / partySize) * (1 + dq);
          dungeonModels.push({
            hrid: drop.itemHrid,
            dropRate: 1,
            minCount: drop.minCount * chestsPerRun,
            maxCount: drop.maxCount * chestsPerRun,
            price,
          });
        } else {
          dungeonModels.push({
            hrid: drop.itemHrid,
            dropRate: adjustedRate,
            minCount: drop.minCount,
            maxCount: drop.maxCount,
            price,
          });
        }
      }
      return {
        mapType: "dungeon",
        spawnInfo: entry.spawnInfo,
        bossCount: completed,
        normalCount: 0,
        bossDrops: { _dungeon: dungeonModels },
        monsterDrops: {},
      };
    }

    const tierMultiplier = 1 + 0.1 * tier;
    const quantityMult = (1 + dq) / partySize;
    const convertDrops = (drops: CombatMapEntry["monsterDrops"][string]): ItemDropModel[] => {
      const list: ItemDropModel[] = [];
      for (const drop of drops) {
        if (drop.minDifficultyTier > tier) continue;
        let adjustedRate = 0;
        if (drop.isRare) {
          adjustedRate = Math.min(1, Math.max(0, drop.dropRate * (1 + rf)));
        } else {
          const baseRate = drop.dropRate + drop.dropRatePerDifficultyTier * tier;
          adjustedRate = Math.min(1, Math.max(0, tierMultiplier * baseRate * (1 + dr)));
        }
        if (adjustedRate <= 0) continue;
        list.push({
          hrid: drop.itemHrid,
          dropRate: adjustedRate,
          minCount: drop.minCount * quantityMult,
          maxCount: drop.maxCount * quantityMult,
          price: resolveItemPrice(drop.itemHrid),
        });
      }
      return list;
    };

    const monsterDrops: Record<string, ItemDropModel[]> = {};
    for (const [mHrid, drops] of Object.entries(entry.monsterDrops)) {
      monsterDrops[mHrid] = convertDrops(drops);
    }

    const bossDrops: Record<string, ItemDropModel[]> = {};
    for (const [bHrid, drops] of Object.entries(entry.bossDrops)) {
      bossDrops[bHrid] = convertDrops(drops);
    }

    return {
      mapType: entry.info.type,
      spawnInfo: entry.spawnInfo,
      bossCount,
      normalCount,
      bossDrops,
      monsterDrops,
    };
  }

  getItemRarity(itemHrid: string, unitPrice: number): number {
    const freq = this.itemFreq.get(itemHrid) ?? 0;
    if (freq >= 1 || unitPrice <= 1000) {
      if (itemHrid.includes("_chest")) return 0;
      return -1;
    }
    if (
      itemHrid.includes("_aura") ||
      itemHrid === "/items/revive" ||
      itemHrid === "/items/insanity" ||
      itemHrid === "/items/invincible"
    ) {
      return 6;
    }
    if (unitPrice >= 2e6) return 5;
    if (unitPrice >= 8e5) return 4;
    if (unitPrice >= 2.5e5) return 3;
    if (unitPrice >= 2e5) return 2;
    if (unitPrice >= 1e5 && freq <= 0.02) return 2;
    if (unitPrice >= 5e4 && freq <= 7e-3) return 2;
    if (unitPrice >= 3e4) return 1;
    return 0;
  }
}

export function getRarityColor(rarity: number): string {
  switch (rarity) {
    case 6: return "#64dbff";
    case 5: return "#ff8888";
    case 4: return "#ffa844";
    case 3: return "#e586ff";
    case 2: return "#a9d5ff";
    case 1: return "#b9f1be";
    case 0: return "#f8fafc";
    default: return "#94a3b8";
  }
}

// ===== Consumables Cost Estimator =====

export function estimateConsumablesCost(
  player: BattlePlayerSnapshot,
  clientData: any | null,
  priceResolver: CombatPriceResolver,
  marketEpoch: string
): { costPerSec: number; dailyCost: number; items: AnalyzedConsumableEntry[] } {
  let costPerSec = 0;
  const items: AnalyzedConsumableEntry[] = [];
  const drinkConc = Math.max(0, player.drinkConcentration || 0);

  for (const cons of player.consumables) {
    if (!cons?.itemHrid) continue;
    const hrid = cons.itemHrid;
    const askPrice = priceResolver.getAskPrice(hrid, 0, clientData, marketEpoch) || 500;
    const detail = clientData?.itemDetailMap?.[hrid];
    const cdRaw = Number(detail?.consumableDetail?.cooldownDuration) || 0;
    let cooldownSec = 0;
    if (cdRaw > 1e6) {
      cooldownSec = cdRaw / 1e9;
    } else if (cdRaw > 0) {
      cooldownSec = cdRaw;
    }

    const lower = hrid.toLowerCase();
    const isDrink =
      detail?.categoryHrid === "/item_categories/drink" ||
      lower.includes("coffee") ||
      lower.includes("tea");
    if (cooldownSec <= 0) {
      cooldownSec = isDrink ? 300 : 60;
    }
    const effectiveCooldown = isDrink ? cooldownSec / (1 + drinkConc) : cooldownSec;
    const perSec = askPrice / Math.max(1, effectiveCooldown);
    costPerSec += perSec;
    items.push({
      itemHrid: hrid,
      remainingCount: cons.count,
      askPrice,
      dailyCount: 86400 / Math.max(1, effectiveCooldown),
      dailyCost: perSec * 86400,
    });
  }

  return {
    costPerSec,
    dailyCost: costPerSec * 86400,
    items,
  };
}

// ===== Session Analysis + Caching =====

export class CombatLuckEngine {
  private priceResolver: CombatPriceResolver;
  private mapRegistry = new CombatMapRegistry();
  private analysisCache = new Map<string, PlayerBattleAnalysis>();

  constructor(marketStore: MarketStore) {
    this.priceResolver = new CombatPriceResolver(marketStore);
  }

  getMapRegistry(): CombatMapRegistry {
    return this.mapRegistry;
  }

  clearCache(): void {
    this.analysisCache.clear();
  }

  analyzePlayer(params: {
    clientData: any | null;
    mapHrid: string | null;
    difficultyTier: number;
    durationSec: number;
    runCount: number;
    playerCount: number;
    player: BattlePlayerSnapshot;
    priceMode: CombatPriceMode;
    marketEpoch: string;
  }): PlayerBattleAnalysis {
    const {
      clientData,
      mapHrid,
      difficultyTier,
      durationSec,
      runCount,
      playerCount,
      player,
      priceMode,
      marketEpoch,
    } = params;

    const safeDuration = Math.max(1, durationSec);
    const completedRuns = Math.max(0, runCount - 1);
    const eph = completedRuns > 0 ? (3600 * completedRuns) / safeDuration : 0;

    // Cache heavy drop model + FFT CDF by (mapHrid, difficultyTier, runCount, player stats, priceMode, marketEpoch)
    const lootSig = player.loot.map((l) => `${l.itemHrid}:${l.enhancementLevel || 0}:${l.count}`).join(",");
    const xpSig = Object.entries(player.skillExp)
      .map(([k, v]) => `${k}:${v}`)
      .join(",");
    const consSig = player.consumables.map((c) => `${c.itemHrid}:${c.count}`).join(",");
    const cacheKey = [
      mapHrid || "",
      difficultyTier,
      runCount,
      playerCount,
      player.characterId,
      player.combatDropQuantity.toFixed(4),
      player.combatDropRate.toFixed(4),
      player.combatRareFind.toFixed(4),
      player.drinkConcentration.toFixed(4),
      priceMode,
      marketEpoch,
      lootSig,
      xpSig,
      consSig,
    ].join("|");

    // Recompute time-derived metrics cleanly on durationSec change without re-running FFT when cached core matches
    const coreKey = [
      mapHrid || "",
      difficultyTier,
      runCount,
      playerCount,
      player.characterId,
      player.combatDropQuantity.toFixed(4),
      player.combatDropRate.toFixed(4),
      player.combatRareFind.toFixed(4),
      priceMode,
      marketEpoch,
    ].join("|");

    const dropData =
      mapHrid && completedRuns > 0
        ? this.mapRegistry.buildDropData(
            clientData,
            mapHrid,
            difficultyTier,
            runCount,
            playerCount,
            player,
            this.priceResolver,
            priceMode,
            marketEpoch
          )
        : null;

    // Build expected item counts map for detail breakdown
    const expectedCountByHrid = new Map<string, number>();
    if (dropData) {
      for (const drops of Object.values(dropData.bossDrops)) {
        for (const d of drops) {
          expectedCountByHrid.set(d.hrid, (expectedCountByHrid.get(d.hrid) || 0) + dropData.bossCount * itemCountExpt(d));
        }
      }
      for (const [mHrid, drops] of Object.entries(dropData.monsterDrops)) {
        const expSpawn = dropData.spawnInfo.expectedSpawns[mHrid] || 0;
        for (const d of drops) {
          expectedCountByHrid.set(
            d.hrid,
            (expectedCountByHrid.get(d.hrid) || 0) + expSpawn * dropData.normalCount * itemCountExpt(d)
          );
        }
      }
    }

    // Loot valuation
    let currentIncome = 0;
    const lootItems: AnalyzedLootEntry[] = [];
    for (const item of player.loot) {
      if (!item?.itemHrid || item.count <= 0) continue;
      const enh = item.enhancementLevel || 0;
      const unitPrice = this.priceResolver.getUnitPrice(item.itemHrid, priceMode, enh, clientData, marketEpoch);
      const totalPrice = unitPrice * item.count;
      currentIncome += totalPrice;
      const bidRef = this.priceResolver.getUnitPrice(item.itemHrid, "bid_net", enh, clientData, marketEpoch);
      lootItems.push({
        itemHrid: item.itemHrid,
        count: item.count,
        enhancementLevel: enh,
        unitPrice,
        totalPrice,
        expectedCount: expectedCountByHrid.get(item.itemHrid) || 0,
        rarity: this.mapRegistry.getItemRarity(item.itemHrid, bidRef),
      });
    }

    // Core statistical moments & luck CDF (memoized by wave/coreKey so UI ticks never redo FFT)
    let expectation = 0;
    let variance = 0;
    let luck: number | null = null;

    const cachedCore = this.analysisCache.get(coreKey);
    if (dropData) {
      if (cachedCore && Math.abs(cachedCore.currentIncome - currentIncome) < 1e-6 && cacheKey === coreKey) {
        expectation = cachedCore.expectation;
        variance = cachedCore.variance;
        luck = cachedCore.luck;
      } else {
        expectation = computeDropExpectation(dropData);
        variance = computeDropVariance(dropData);
        const stddev = Math.sqrt(Math.max(0, variance));
        const cdfFn = this.getOrBuildCdf(coreKey, dropData, expectation, stddev);
        if (cdfFn) {
          const val = cdfFn(currentIncome);
          if (Number.isFinite(val)) {
            luck = Math.min(Math.max(val, 0), 1);
          }
        }
      }
    }

    const stddev = Math.sqrt(Math.max(0, variance));
    const hourlyIncome = (3600 * currentIncome) / safeDuration;
    const dailyIncome = (86400 * currentIncome) / safeDuration;
    const dailyExpectation = (86400 * expectation) / safeDuration;
    const dailyStddev = Math.sqrt(Math.max(0, (86400 * variance) / safeDuration));

    const cons = estimateConsumablesCost(player, clientData, this.priceResolver, marketEpoch);
    const currentProfit = currentIncome - cons.costPerSec * safeDuration;
    const profitExpectation = expectation - cons.costPerSec * safeDuration;
    const dailyProfit = dailyIncome - cons.dailyCost;
    const dailyProfitExpectation = dailyExpectation - cons.dailyCost;

    // Skills XP
    const skillExpEntries = Object.entries(player.skillExp)
      .map(([skillHrid, xp]) => ({
        skillHrid,
        xp: Number(xp) || 0,
        xpPerHour: (3600 * (Number(xp) || 0)) / safeDuration,
      }))
      .filter((e) => e.xp > 0)
      .sort((a, b) => b.xp - a.xp);

    const totalXp = skillExpEntries.reduce((s, e) => s + e.xp, 0);
    const totalXpPerHour = (3600 * totalXp) / safeDuration;
    const topSkill = skillExpEntries[0] || null;

    const result: PlayerBattleAnalysis = {
      characterId: player.characterId,
      name: player.name,
      priceMode,
      durationSec: safeDuration,
      runCount,
      completedRuns,
      eph,
      currentIncome,
      expectation,
      variance,
      stddev,
      hourlyIncome,
      dailyIncome,
      dailyExpectation,
      dailyStddev,
      foodDailyCost: cons.dailyCost,
      currentProfit,
      profitExpectation,
      dailyProfit,
      dailyProfitExpectation,
      luck,
      luckColor: getLuckColor(luck),
      topSkillHrid: topSkill?.skillHrid ?? null,
      topSkillXp: topSkill?.xp ?? 0,
      topSkillXpPerHour: topSkill?.xpPerHour ?? 0,
      totalXp,
      totalXpPerHour,
      skillExpEntries,
      lootItems,
      consumables: cons.items,
      aura: player.aura,
      deathCount: player.deathCount,
      hasMapModel: Boolean(dropData),
    };

    if (this.analysisCache.size > 40) {
      const oldest = this.analysisCache.keys().next().value;
      if (oldest) this.analysisCache.delete(oldest);
    }
    this.analysisCache.set(cacheKey, result);
    return result;
  }

  private cdfCache = new Map<string, ((income: number) => number) | null>();

  private getOrBuildCdf(
    coreKey: string,
    dropData: MapDropData,
    expectation: number,
    stddev: number
  ): ((income: number) => number) | null {
    if (this.cdfCache.has(coreKey)) {
      return this.cdfCache.get(coreKey) ?? null;
    }
    const cdfFn = computeBattleLuckCDF(dropData, expectation, stddev, 1024);
    if (this.cdfCache.size > 24) {
      const oldest = this.cdfCache.keys().next().value;
      if (oldest) this.cdfCache.delete(oldest);
    }
    this.cdfCache.set(coreKey, cdfFn);
    return cdfFn;
  }
}
