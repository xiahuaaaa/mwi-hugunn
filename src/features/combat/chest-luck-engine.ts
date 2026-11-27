// Credit: Chest luck CDF & rarity tier model inspired by [银河奶牛]康康运气 (Weierstras, https://greasyfork.org/scripts/536205, MIT License).
import {
  CHEST_COST_FALLBACKS,
  CombatPriceResolver,
  DUNGEON_CHEST_KEYS,
  DUNGEON_ENTRY_KEYS,
  dropItemCharaFunc,
  getCharaFuncCDF,
  getLuckColor,
  itemCountExpt,
  itemCountVar,
  mulListCF,
  powCF,
  type CombatPriceMode,
  type CountedLootItem,
  type ItemDropModel,
} from "./combat-luck-engine";

export interface ChestOpenEvent {
  readonly id: number;
  readonly openedItemHrid: string;
  readonly openedCount: number;
  readonly gainedItems: readonly CountedLootItem[];
  readonly timestamp: number;
}

export type ChestRarityTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ChestItemRarity {
  readonly itemHrid: string;
  readonly count: number;
  readonly enhancementLevel: number;
  readonly tier: ChestRarityTier;
  readonly jackpot: boolean;
  readonly dropRate: number | null;
  readonly unitPrice: number;
  readonly totalPrice: number;
}

export interface ChestOpenAnalysis {
  readonly openedItemHrid: string;
  readonly openedCount: number;
  readonly priceMode: CombatPriceMode;
  readonly income: number;
  readonly expectation: number;
  readonly stddev: number;
  readonly delta: number;
  readonly cost: number;
  readonly profit: number;
  readonly luck: number | null;
  readonly luckColor: string;
  readonly items: readonly ChestItemRarity[];
  readonly hasDropModel: boolean;
}

export interface ChestCdfCacheEntry {
  readonly limit: number;
  readonly cdf: (x: number) => number;
}

export type ChestCdfCache = Map<string, ChestCdfCacheEntry>;

const MAX_CDF_CACHE_ENTRIES = 16;

export const RARITY_THRESHOLDS: readonly { readonly maxRate: number; readonly tier: ChestRarityTier }[] = [
  { maxRate: 0.001, tier: 6 },
  { maxRate: 0.01, tier: 5 },
  { maxRate: 0.02, tier: 4 },
  { maxRate: 0.05, tier: 3 },
  { maxRate: 0.15, tier: 2 },
  { maxRate: 0.5, tier: 1 },
];

export function classifyDropRateTier(dropRate: number | null): ChestRarityTier {
  if (dropRate === null || !Number.isFinite(dropRate) || dropRate <= 0) return 0;
  for (const entry of RARITY_THRESHOLDS) {
    if (dropRate <= entry.maxRate) return entry.tier;
  }
  return 0;
}

export function parseLootOpenedPayload(raw: unknown, id: number, now = Date.now()): ChestOpenEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  const openedRaw = payload.openedItem;
  if (!openedRaw || typeof openedRaw !== "object") return null;

  const opened = openedRaw as Record<string, unknown>;
  const openedItemHrid = typeof opened.itemHrid === "string" ? opened.itemHrid.trim() : "";
  const openedCount = Number(opened.count);
  if (!openedItemHrid || !Number.isFinite(openedCount) || openedCount <= 0) return null;

  const rawGained = payload.gainedItems;
  if (rawGained !== undefined && rawGained !== null && !Array.isArray(rawGained)) return null;

  const gainedItems: CountedLootItem[] = [];
  if (Array.isArray(rawGained)) {
    for (const entry of rawGained) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const itemHrid = typeof rec.itemHrid === "string" ? rec.itemHrid.trim() : "";
      const count = Number(rec.count);
      if (!itemHrid || !Number.isFinite(count) || count <= 0) continue;
      const rawEnh = Number(rec.enhancementLevel);
      const enhancementLevel = Number.isFinite(rawEnh) && rawEnh > 0 ? Math.floor(rawEnh) : 0;
      gainedItems.push({ itemHrid, count, enhancementLevel });
    }
  }

  return {
    id,
    openedItemHrid,
    openedCount,
    gainedItems,
    timestamp: now,
  };
}

export function computeChestDropModels(
  chestHrid: string,
  clientData: any | null,
  priceResolver: CombatPriceResolver,
  priceMode: CombatPriceMode,
  marketEpoch: string
): ItemDropModel[] | null {
  const rawDrops = clientData?.openableLootDropMap?.[chestHrid];
  if (!Array.isArray(rawDrops) || rawDrops.length === 0) return null;

  const models: ItemDropModel[] = [];
  for (const drop of rawDrops) {
    if (!drop || typeof drop.itemHrid !== "string" || !drop.itemHrid) continue;
    const minCount = Number(drop.minCount) || 0;
    const maxCount = Number(drop.maxCount ?? drop.minCount) || 0;
    models.push({
      hrid: drop.itemHrid,
      dropRate: Number(drop.dropRate) || 0,
      minCount,
      maxCount,
      price: priceResolver.getUnitPrice(drop.itemHrid, priceMode, 0, clientData, marketEpoch),
    });
  }
  return models.length > 0 ? models : null;
}

export function computeChestCost(
  chestHrid: string,
  openedCount: number,
  priceMode: CombatPriceMode,
  priceResolver: CombatPriceResolver,
  clientData: any | null,
  marketEpoch: string
): number {
  if (openedCount <= 0) return 0;
  const chestKeyHrid = DUNGEON_CHEST_KEYS[chestHrid];
  if (!chestKeyHrid) return 0;

  const costMode: CombatPriceMode = priceMode === "bid_net" ? "ask" : "bid_net";
  const fb = CHEST_COST_FALLBACKS[chestHrid];
  const keyPrice =
    priceResolver.getUnitPrice(chestKeyHrid, costMode, 0, clientData, marketEpoch) ||
    (costMode === "ask" ? fb?.keyAsk : fb?.keyBid) ||
    0;

  let entryPrice = 0;
  const entryKeyHrid = DUNGEON_ENTRY_KEYS[chestHrid];
  if (entryKeyHrid) {
    entryPrice =
      priceResolver.getUnitPrice(entryKeyHrid, costMode, 0, clientData, marketEpoch) ||
      (costMode === "ask" ? fb?.entryAsk : fb?.entryBid) ||
      0;
  }

  return (keyPrice + entryPrice) * openedCount;
}

function getOrComputeChestCdf(
  cacheKey: string,
  models: ItemDropModel[],
  openedCount: number,
  expectation: number,
  stddev: number,
  cdfCache?: ChestCdfCache
): ChestCdfCacheEntry {
  if (cdfCache) {
    const cached = cdfCache.get(cacheKey);
    if (cached) {
      cdfCache.delete(cacheKey);
      cdfCache.set(cacheKey, cached);
      return cached;
    }
  }

  let maxSingleDrop = 0;
  for (const d of models) {
    const v = d.price * d.maxCount;
    if (v > maxSingleDrop) maxSingleDrop = v;
  }

  const initialLimit = Math.max(maxSingleDrop + expectation * 3, expectation + 10 * stddev);
  const cf = powCF(mulListCF(models.map(dropItemCharaFunc)), openedCount);
  const entry = getCharaFuncCDF(cf, initialLimit, 1024);

  if (cdfCache) {
    if (cdfCache.size >= MAX_CDF_CACHE_ENTRIES) {
      const oldest = cdfCache.keys().next().value;
      if (oldest !== undefined) cdfCache.delete(oldest);
    }
    cdfCache.set(cacheKey, entry);
  }

  return entry;
}

export function analyzeChestOpen(
  event: ChestOpenEvent,
  clientData: any | null,
  priceResolver: CombatPriceResolver,
  priceMode: CombatPriceMode,
  marketEpoch: string,
  cdfCache?: ChestCdfCache
): ChestOpenAnalysis {
  const models = computeChestDropModels(event.openedItemHrid, clientData, priceResolver, priceMode, marketEpoch);
  const hasDropModel = models !== null && models.length > 0;

  const baseDropByHrid = new Map<string, { dropRate: number; maxCount: number }>();
  if (models) {
    for (const d of models) {
      const prev = baseDropByHrid.get(d.hrid);
      if (!prev || d.dropRate > prev.dropRate) {
        baseDropByHrid.set(d.hrid, { dropRate: d.dropRate, maxCount: d.maxCount });
      }
    }
  }

  let income = 0;
  const items: ChestItemRarity[] = [];
  for (const gained of event.gainedItems) {
    const enh = gained.enhancementLevel || 0;
    const unitPrice = priceResolver.getUnitPrice(gained.itemHrid, priceMode, enh, clientData, marketEpoch);
    const totalPrice = unitPrice * gained.count;
    income += totalPrice;

    const baseDrop = baseDropByHrid.get(gained.itemHrid);
    const dropRate = baseDrop ? baseDrop.dropRate : null;
    const tier = classifyDropRateTier(dropRate);
    const jackpot = baseDrop !== undefined && gained.count > baseDrop.maxCount * event.openedCount * 2;

    items.push({
      itemHrid: gained.itemHrid,
      count: gained.count,
      enhancementLevel: enh,
      tier,
      jackpot,
      dropRate,
      unitPrice,
      totalPrice,
    });
  }

  let expectation = 0;
  let variance = 0;
  if (models) {
    let perChestExp = 0;
    let perChestVar = 0;
    for (const d of models) {
      perChestExp += itemCountExpt(d) * d.price;
      perChestVar += itemCountVar(d) * d.price * d.price;
    }
    expectation = perChestExp * event.openedCount;
    variance = perChestVar * event.openedCount;
  }

  const stddev = Math.sqrt(Math.max(0, variance));
  let luck: number | null = null;
  if (hasDropModel && models && variance > 0) {
    const cacheKey = `${event.openedItemHrid}|${event.openedCount}|${priceMode}|${marketEpoch}`;
    const entry = getOrComputeChestCdf(cacheKey, models, event.openedCount, expectation, stddev, cdfCache);
    const rawLuck = entry.cdf(income);
    if (Number.isFinite(rawLuck)) {
      luck = Math.min(Math.max(rawLuck, 0), 1);
    }
  }

  const delta = hasDropModel ? income - expectation : 0;
  const cost = computeChestCost(event.openedItemHrid, event.openedCount, priceMode, priceResolver, clientData, marketEpoch);
  const profit = income - cost;

  return {
    openedItemHrid: event.openedItemHrid,
    openedCount: event.openedCount,
    priceMode,
    income,
    expectation,
    stddev,
    delta,
    cost,
    profit,
    luck,
    luckColor: getLuckColor(luck),
    items,
    hasDropModel,
  };
}
