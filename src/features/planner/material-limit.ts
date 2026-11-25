// Pure, DOM-free material limit engine: how many times an action can run on current inventory.
// Shared by Quick Input "Max" and the action timer (infinite-queue duration estimates).

export interface MaterialLimitResult {
  readonly isInfinite: boolean;
  readonly max: number;
  /** Item HRID that runs out first ("" when unlimited). */
  readonly bottleneckHrid: string;
}

export interface MaterialLimitInput {
  /** Action detail from `clientData.actionDetailMap` (uses `type`, `inputItems`, `upgradeItemHrid`). */
  readonly actionDetail: any;
  readonly clientData: any;
  readonly characterItems: readonly any[];
  readonly drinkSlotsMap: ReadonlyMap<string, readonly any[]>;
  /** Loadout the action runs with; null = currently equipped gear and the action type's drink slots. */
  readonly loadout: any | null;
  /**
   * Queued character action (`primaryItemHash` / `secondaryItemHash`). Needed for alchemy and
   * enhancing, whose costs depend on the selected item rather than the action detail.
   */
  readonly actionInstance?: any;
}

const COIN_HRID = "/items/coin";

const UNLIMITED: MaterialLimitResult = Object.freeze({ isInfinite: true, max: Infinity, bottleneckHrid: "" });

/** Parse "characterID::itemLocation::itemHrid::enhancementLevel" item hashes. */
export function parseItemHash(hash: unknown): { itemHrid: string; enhancementLevel: number } | null {
  if (typeof hash !== "string" || !hash) return null;
  const parts = hash.split("::");
  const itemHrid = parts.find((p) => p.startsWith("/items/"));
  if (!itemHrid) return null;
  const enh = Number(parts[parts.length - 1]);
  return { itemHrid, enhancementLevel: Number.isFinite(enh) && enh >= 0 ? Math.floor(enh) : 0 };
}

/** Tea scaling factor `1 + drinkConcentration` from the loadout's gear, or from equipped gear. */
export function computeDrinkConcentrationScale(
  clientData: any,
  characterItems: readonly any[],
  loadout: any | null
): number {
  const itemDetailMap = clientData?.itemDetailMap || {};
  const multTable: readonly number[] = clientData?.enhancementLevelTotalBonusMultiplierTable || [];
  const statOf = (itemHrid: string, enhancementLevel: number): number => {
    const eq = itemDetailMap[itemHrid]?.equipmentDetail;
    if (!eq) return 0;
    const base = eq.noncombatStats?.drinkConcentration || 0;
    const enh = (eq.noncombatEnhancementBonuses?.drinkConcentration || 0) * (multTable[enhancementLevel] || 0);
    return base + enh;
  };

  let conc = 0;
  if (loadout?.wearableMap && typeof loadout.wearableMap === "object") {
    for (const raw of Object.values(loadout.wearableMap)) {
      const parsed = parseItemHash(raw);
      if (parsed) conc += statOf(parsed.itemHrid, parsed.enhancementLevel);
    }
    return 1 + Math.max(0, conc);
  }

  for (const item of characterItems) {
    if (!item?.itemHrid || !item.itemLocationHrid || item.itemLocationHrid === "/item_locations/inventory") {
      continue;
    }
    conc += statOf(item.itemHrid, item.enhancementLevel || 0);
  }
  return 1 + Math.max(0, conc);
}

/** Drinks the action will use: the loadout's drink slots when configured, else the action type's slots. */
export function resolveActionDrinks(
  actionType: string,
  loadout: any | null,
  drinkSlotsMap: ReadonlyMap<string, readonly any[]>
): string[] {
  if (loadout && Array.isArray(loadout.drinkItemHrids)) {
    return loadout.drinkItemHrids.filter((h: unknown): h is string => typeof h === "string" && h.length > 0);
  }
  return (drinkSlotsMap.get(actionType) || []).map((d: any) => d?.itemHrid).filter(Boolean);
}

/** Artisan material saving ratio (e.g. 0.1 × concentration scale for Artisan Tea). */
export function computeArtisanSaving(
  drinkHrids: readonly string[],
  clientData: any,
  characterItems: readonly any[],
  loadout: any | null
): number {
  const itemDetailMap = clientData?.itemDetailMap || {};
  let artisan = 0;
  for (const hrid of drinkHrids) {
    const buffs = itemDetailMap[hrid]?.consumableDetail?.buffs;
    if (!Array.isArray(buffs)) continue;
    for (const b of buffs) {
      if (b?.typeHrid === "/buff_types/artisan") {
        artisan += (Number(b.flatBoost) || 0) + (Number(b.ratioBoost) || 0);
      }
    }
  }
  if (artisan <= 0) return 0;
  const scale = computeDrinkConcentrationScale(clientData, characterItems, loadout);
  return Math.min(0.99, artisan * scale);
}

/** Max runs allowed by inventory materials (inputs reduced by Artisan; upgrade base item at +0). */
interface CostEntry {
  readonly itemHrid: string;
  readonly enhancementLevel: number;
  readonly count: number;
}

interface ItemStack {
  readonly itemHrid: string;
  readonly enhancementLevel: number;
  readonly count: number;
  readonly hash: string;
}

/** Inventory stacks keyed by `itemHrid::enhancementLevel` (mirrors client `getItemStack`) and by hash. */
function buildInventory(characterItems: readonly any[]): {
  byKey: Map<string, number>;
  byHash: Map<string, ItemStack>;
} {
  const byKey = new Map<string, number>();
  const byHash = new Map<string, ItemStack>();
  for (const item of characterItems) {
    if (!item?.itemHrid || !item.count || item.count <= 0) continue;
    if (item.itemLocationHrid && item.itemLocationHrid !== "/item_locations/inventory") continue;
    const enhancementLevel = item.enhancementLevel || 0;
    const k = `${item.itemHrid}::${enhancementLevel}`;
    byKey.set(k, (byKey.get(k) || 0) + item.count);
    if (typeof item.hash === "string" && item.hash) {
      byHash.set(item.hash, { itemHrid: item.itemHrid, enhancementLevel, count: item.count, hash: item.hash });
    }
  }
  return { byKey, byHash };
}

/** Resolve a selected item stack by hash (falls back to parsing the hash against inventory stacks). */
function resolveStack(inv: ReturnType<typeof buildInventory>, hash: unknown): ItemStack | null {
  if (typeof hash !== "string" || !hash) return null;
  const direct = inv.byHash.get(hash);
  if (direct) return direct;
  const parsed = parseItemHash(hash);
  if (!parsed) return null;
  const count = inv.byKey.get(`${parsed.itemHrid}::${parsed.enhancementLevel}`) || 0;
  return count > 0 ? { ...parsed, count, hash } : null;
}

/** Alchemy coin fee per item (client `getAlchemyCoinCost`): coinify 0, decompose/unrefine 5×(10+lvl), transmute max(50, ⌊sell/5⌋). */
export function getAlchemyCoinCost(actionHrid: string, itemLevel: number, sellPrice: number): number {
  if (actionHrid === "/actions/alchemy/decompose" || actionHrid === "/actions/alchemy/unrefine") {
    return Math.floor(5 * (10 + (itemLevel || 0)));
  }
  if (actionHrid === "/actions/alchemy/transmute") {
    const fifth = (sellPrice || 0) / 5;
    return fifth > 50 ? Math.floor(fifth) : 50;
  }
  return 0;
}

/**
 * Max runs allowed by inventory — a port of the game client's `getItemActionLimit`:
 * - production: `inputItems` (+0 stacks only, reduced by Artisan Tea); upgrade item limited by the selected stack;
 * - alchemy: ⌊stack/bulk⌋, capped by catalyst count (or ⌊stack/(bulk+1)⌋ if the catalyst is the same stack),
 *   plus `bulk` items and `getAlchemyCoinCost() × bulk` coins per run;
 * - enhancing: the selected item's `enhancementCosts` (skipped when `enhancingMaxLevel > 0`, where stopping is target-level driven).
 */
export function computeMaterialLimit(input: MaterialLimitInput): MaterialLimitResult {
  const { actionDetail, clientData, characterItems, drinkSlotsMap, loadout, actionInstance } = input;
  if (!actionDetail) return UNLIMITED;
  const itemDetailMap = clientData?.itemDetailMap || {};
  const actionFunc: string = actionDetail.function || "";
  const isAlchemy = actionFunc === "/action_functions/alchemy";
  const isEnhancing = actionFunc === "/action_functions/enhancing";

  // Alchemy / enhancing depend on the selected item; without a queued action (e.g. the skill dialog) stay ∞.
  if ((isAlchemy || isEnhancing) && !actionInstance) return UNLIMITED;

  const inv = buildInventory(characterItems);
  let limit = Infinity;
  let bottleneckHrid = "";
  const cap = (value: number, hrid: string): void => {
    if (value < limit) {
      limit = value;
      bottleneckHrid = hrid;
    }
  };

  const upgradeHrid: string = typeof actionDetail.upgradeItemHrid === "string" ? actionDetail.upgradeItemHrid : "";
  if (upgradeHrid) {
    const selected = resolveStack(inv, actionInstance?.primaryItemHash);
    const count = actionInstance?.primaryItemHash
      ? selected?.count || 0
      : inv.byKey.get(`${upgradeHrid}::0`) || 0;
    cap(count, upgradeHrid);
  }

  const costs: CostEntry[] = [];
  if (actionFunc === "/action_functions/production") {
    for (const inp of Array.isArray(actionDetail.inputItems) ? actionDetail.inputItems : []) {
      if (inp?.itemHrid) costs.push({ itemHrid: inp.itemHrid, enhancementLevel: 0, count: Number(inp.count) || 0 });
    }
  } else if (isAlchemy) {
    const item = resolveStack(inv, actionInstance.primaryItemHash);
    if (!item) return { isInfinite: false, max: 0, bottleneckHrid: parseItemHash(actionInstance.primaryItemHash)?.itemHrid || "" };
    const detail = itemDetailMap[item.itemHrid] || {};
    const bulk = Number(detail.alchemyDetail?.bulkMultiplier) || 1;
    cap(Math.floor(item.count / bulk) || 0, item.itemHrid);
    const catalyst = resolveStack(inv, actionInstance.secondaryItemHash);
    if (catalyst) {
      if (catalyst.hash === item.hash) cap(Math.floor(item.count / (bulk + 1)), item.itemHrid);
      else cap(catalyst.count || 0, catalyst.itemHrid);
    }
    costs.push({ itemHrid: item.itemHrid, enhancementLevel: item.enhancementLevel, count: bulk });
    const coin = getAlchemyCoinCost(actionDetail.hrid || "", Number(detail.itemLevel) || 0, Number(detail.sellPrice) || 0);
    if (coin) costs.push({ itemHrid: COIN_HRID, enhancementLevel: 0, count: coin * bulk });
  } else if (isEnhancing) {
    // Target-level enhancing stops once the target enhancement level is reached rather than burning all materials.
    if ((Number(actionInstance.enhancingMaxLevel) || 0) > 0) return UNLIMITED;
    const item = resolveStack(inv, actionInstance.primaryItemHash);
    if (!item) return { isInfinite: false, max: 0, bottleneckHrid: parseItemHash(actionInstance.primaryItemHash)?.itemHrid || "" };
    for (const c of itemDetailMap[item.itemHrid]?.enhancementCosts || []) {
      if (c?.itemHrid) costs.push({ itemHrid: c.itemHrid, enhancementLevel: c.enhancementLevel || 0, count: Number(c.count) || 0 });
    }
  }

  if (costs.length > 0) {
    const drinks = resolveActionDrinks(actionDetail.type || "", loadout, drinkSlotsMap);
    const artisan =
      isAlchemy || isEnhancing
        ? 0
        : computeArtisanSaving(drinks, clientData, characterItems, loadout);
    for (const c of costs) {
      const need = (1 - artisan) * c.count;
      if (!(need > 0)) continue;
      const have = inv.byKey.get(`${c.itemHrid}::${c.enhancementLevel}`) || 0;
      cap(Math.floor(have / need), c.itemHrid);
    }
  }

  if (!Number.isFinite(limit)) return UNLIMITED;
  return { isInfinite: false, max: Math.max(0, limit), bottleneckHrid };
}
