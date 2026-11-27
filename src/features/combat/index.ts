import type { FeatureModule } from "../../core/types";
import { createChestLuckModule } from "./chest-luck";
import {
  createCombatLightTrackerModule,
  createCombatScoreModule,
  createLoadoutBadgeModule,
} from "./combat-light";
import { createLabyrinthHelperModule } from "./labyrinth-helper";
import { createLabyrinthRateModule, isLabyrinthWorkerActive } from "./labyrinth-rate";

export const combatModules: FeatureModule[] = [
  createLabyrinthRateModule(),
  createLabyrinthHelperModule(),
  createCombatLightTrackerModule(),
  createChestLuckModule(),
  createLoadoutBadgeModule(),
  createCombatScoreModule(),
];

export { isLabyrinthWorkerActive };
