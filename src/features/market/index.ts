import type { FeatureModule } from "../../core/types";
import { createNetworthModule, createTooltipEvModule } from "./economy-overlay";
import { createGuildShopRankModule } from "./guild-shop-rank";
import { createMagicSortModule } from "./magic-sort";
import { createMarketListNavModule } from "./market-list-nav";
import { createMarketQuickOpsModule } from "./market-quick-ops";
import { createMarketShortcutsModule } from "./market-shortcuts";
import { createVolumeDisplayModule } from "./volume-display";

export const marketModules: FeatureModule[] = [
  createMarketShortcutsModule(),
  createMarketListNavModule(),
  createMagicSortModule(),
  createVolumeDisplayModule(),
  createMarketQuickOpsModule(),
  createTooltipEvModule(),
  createNetworthModule(),
  createGuildShopRankModule(),
];
