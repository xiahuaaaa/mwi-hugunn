const ITEM_HRID_RE = /^\/items\/[a-z0-9_]+$/;
const MIN_ENHANCEMENT_LEVEL = 0;
const MAX_ENHANCEMENT_LEVEL = 20;

export interface MarketNavTarget {
  readonly itemHrid: string;
  readonly level: number | null;
}

export interface MarketNavState {
  readonly visible: boolean;
  readonly index: number;
  readonly total: number;
  readonly prev: MarketNavTarget | null;
  readonly next: MarketNavTarget | null;
}

export function normalizeMarketList(hrids: readonly unknown[]): readonly string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (let i = 0; i < hrids.length; i++) {
    const raw = hrids[i];
    if (typeof raw !== "string") continue;
    const hrid = raw.trim();
    if (!ITEM_HRID_RE.test(hrid) || seen.has(hrid)) continue;
    seen.add(hrid);
    normalized.push(hrid);
  }
  return normalized;
}

export function resolveTargetLevel(
  targetItemHrid: string,
  currentLevel: number | null,
  isEnhanceable: (hrid: string) => boolean
): number | null {
  if (!isEnhanceable(targetItemHrid)) return MIN_ENHANCEMENT_LEVEL;
  if (currentLevel === null) return null;
  if (!Number.isFinite(currentLevel)) return MIN_ENHANCEMENT_LEVEL;
  return Math.max(MIN_ENHANCEMENT_LEVEL, Math.min(MAX_ENHANCEMENT_LEVEL, Math.trunc(currentLevel)));
}

export function resolveMarketListNavState(
  list: readonly string[],
  currentItemHrid: string,
  currentLevel: number | null,
  isEnhanceable: (hrid: string) => boolean
): MarketNavState {
  const index = list.indexOf(currentItemHrid);
  if (index < 0) {
    return {
      visible: false,
      index: -1,
      total: list.length,
      prev: null,
      next: null,
    };
  }

  const prevHrid = index > 0 ? list[index - 1] : null;
  const nextHrid = index < list.length - 1 ? list[index + 1] : null;

  return {
    visible: true,
    index,
    total: list.length,
    prev: prevHrid
      ? {
          itemHrid: prevHrid,
          level: resolveTargetLevel(prevHrid, currentLevel, isEnhanceable),
        }
      : null,
    next: nextHrid
      ? {
          itemHrid: nextHrid,
          level: resolveTargetLevel(nextHrid, currentLevel, isEnhanceable),
        }
      : null,
  };
}
