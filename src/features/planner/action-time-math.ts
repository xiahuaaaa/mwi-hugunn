// Credit: Action timing & tea/equipment buff calculation aligned with Toolasha (Celasha, CC-BY-NC-SA-4.0) & MWITools (bot7420, shykai).
import type { ActionTypeBuffSources } from "../../core/types";
import { parseItemHash, resolveActionDrinks } from "./material-limit";

export interface ActionEstimateInput {
  readonly action: any;
  readonly actionIndex: number;
  readonly currentActionLoadoutId?: number | null;
  readonly clientData: any;
  readonly buffSources: ActionTypeBuffSources;
  readonly characterSkills: readonly any[];
  readonly characterItems: readonly any[];
  readonly characterQuests: readonly any[];
  readonly characterLoadouts: Record<string, any>;
  readonly drinkSlotsMap: ReadonlyMap<string, readonly any[]>;
  readonly nowMs?: number;
  /** For infinite (no max count) actions: runs allowed by materials; turns ∞ into a finite estimate. */
  readonly materialLimit?: number | null;
}

export interface ActionTimingEstimate {
  readonly perAttemptSec: number;
  readonly effectiveSecPerCount: number;
  readonly actionSpeed: number;
  readonly taskActionSpeed: number;
  readonly efficiency: number;
  readonly remainingActions: number;
  readonly totalSec: number;
  readonly isInfinite: boolean;
  /** True when an infinite action's duration is bounded by `materialLimit`. */
  readonly materialLimited: boolean;
}

const EFFICIENCY_FUNCTIONS = new Set([
  "/action_functions/gathering",
  "/action_functions/production",
  "/action_functions/alchemy",
]);

function getItemLevelFromHash(
  itemHash: unknown,
  characterItems: readonly any[],
  itemDetailMap: Record<string, any>
): number | null {
  if (typeof itemHash !== "string" || !itemHash) return null;
  for (let i = 0; i < characterItems.length; i++) {
    const it = characterItems[i];
    if (it?.hash === itemHash && it.itemHrid) {
      const lvl = itemDetailMap[it.itemHrid]?.itemLevel;
      if (typeof lvl === "number") return lvl;
    }
  }
  const parts = itemHash.split("::");
  const hrid = parts.find((p) => p.startsWith("/items/"));
  if (hrid && typeof itemDetailMap[hrid]?.itemLevel === "number") {
    return itemDetailMap[hrid].itemLevel;
  }
  return null;
}

function isActionOnTask(actionHrid: string, characterQuests: readonly any[]): boolean {
  if (!actionHrid || !Array.isArray(characterQuests)) return false;
  for (let i = 0; i < characterQuests.length; i++) {
    const q = characterQuests[i];
    if (
      q &&
      q.category === "/quest_category/random_task" &&
      q.type === "/quest_type/action" &&
      q.status === "/quest_status/in_progress" &&
      q.actionHrid === actionHrid
    ) {
      return true;
    }
  }
  return false;
}

function getSkillLevel(skillHrid: string, characterSkills: readonly any[]): number {
  if (!skillHrid || !Array.isArray(characterSkills)) return 0;
  for (let i = 0; i < characterSkills.length; i++) {
    if (characterSkills[i]?.skillHrid === skillHrid) {
      return Number(characterSkills[i].level) || 0;
    }
  }
  return 0;
}

function accumulateBuffList(
  buffs: readonly any[] | undefined,
  skillLevelBuffHrid: string,
  acc: {
    actionSpeed: number;
    efficiency: number;
    actionLevelFlat: number;
    skillLevelFlat: number;
    skillLevelRatio: number;
  }
): void {
  if (!Array.isArray(buffs)) return;
  for (let i = 0; i < buffs.length; i++) {
    const b = buffs[i];
    if (!b || !b.typeHrid) continue;
    const flat = typeof b.flatBoost === "number" ? b.flatBoost : 0;
    const ratio = typeof b.ratioBoost === "number" ? b.ratioBoost : 0;
    if (b.typeHrid === "/buff_types/action_speed") {
      acc.actionSpeed += flat + ratio;
    } else if (b.typeHrid === "/buff_types/efficiency") {
      acc.efficiency += flat + ratio;
    } else if (b.typeHrid === "/buff_types/action_level") {
      acc.actionLevelFlat += flat;
    } else if (skillLevelBuffHrid && b.typeHrid === skillLevelBuffHrid) {
      acc.skillLevelFlat += flat;
      acc.skillLevelRatio += ratio;
    }
  }
}

function collectLoadoutBonuses(
  loadout: any,
  actionType: string,
  skillPart: string,
  skillLevelBuffHrid: string,
  clientData: any,
  drinkSlotsMap: ReadonlyMap<string, readonly any[]>,
  acc: {
    actionSpeed: number;
    efficiency: number;
    actionLevelFlat: number;
    skillLevelFlat: number;
    skillLevelRatio: number;
  }
): { taskSpeed: number } {
  const itemDetailMap = clientData?.itemDetailMap || {};
  const multTable: readonly number[] = clientData?.enhancementLevelTotalBonusMultiplierTable || [];
  const speedKey = `${skillPart}Speed`;
  const effKey = `${skillPart}Efficiency`;
  const lvlKey = `${skillPart}Level`;

  let drinkConcentration = 0;
  let taskSpeed = 0;

  const wearables = loadout?.wearableMap;
  if (wearables && typeof wearables === "object") {
    for (const raw of Object.values(wearables)) {
      const parsed = parseItemHash(raw);
      if (!parsed) continue;
      const eq = itemDetailMap[parsed.itemHrid]?.equipmentDetail;
      if (!eq) continue;
      const stats = eq.noncombatStats || {};
      const enhStats = eq.noncombatEnhancementBonuses || {};
      const mult = multTable[parsed.enhancementLevel] || 0;

      const addStat = (key: string): number => {
        const base = typeof stats[key] === "number" ? stats[key] : 0;
        const enh = typeof enhStats[key] === "number" ? enhStats[key] * mult : 0;
        return base + enh;
      };

      acc.actionSpeed += addStat(speedKey) + addStat("skillingSpeed");
      acc.efficiency += addStat(effKey) + addStat("skillingEfficiency");
      acc.skillLevelFlat += addStat(lvlKey);
      taskSpeed += addStat("taskSpeed");
      drinkConcentration += addStat("drinkConcentration");
    }
  }

  const slotDrinks = resolveActionDrinks(actionType, loadout, drinkSlotsMap);

  const teaScale = 1 + Math.max(0, drinkConcentration);
  for (const hrid of slotDrinks) {
    const buffs = itemDetailMap[hrid]?.consumableDetail?.buffs;
    if (!Array.isArray(buffs)) continue;
    for (const b of buffs) {
      if (!b || !b.typeHrid) continue;
      const flat = (typeof b.flatBoost === "number" ? b.flatBoost : 0) * teaScale;
      const ratio = (typeof b.ratioBoost === "number" ? b.ratioBoost : 0) * teaScale;
      if (b.typeHrid === "/buff_types/action_speed") {
        acc.actionSpeed += flat + ratio;
      } else if (b.typeHrid === "/buff_types/efficiency") {
        acc.efficiency += flat + ratio;
      } else if (b.typeHrid === "/buff_types/action_level") {
        acc.actionLevelFlat += flat;
      } else if (skillLevelBuffHrid && b.typeHrid === skillLevelBuffHrid) {
        acc.skillLevelFlat += flat;
        acc.skillLevelRatio += ratio;
      }
    }
  }

  return { taskSpeed };
}

/**
 * Estimate per-attempt time, efficiency-adjusted completion speed, and total queue duration
 * matching MWI's 8 server buff sources, skill level transcendence, task speed, and loadouts.
 */
export function estimateActionTiming(input: ActionEstimateInput): ActionTimingEstimate {
  const {
    action,
    actionIndex,
    currentActionLoadoutId,
    clientData,
    buffSources,
    characterSkills,
    characterItems,
    characterQuests,
    characterLoadouts,
    drinkSlotsMap,
    nowMs = Date.now(),
    materialLimit = null,
  } = input;

  const detail = clientData?.actionDetailMap?.[action?.actionHrid];
  if (!detail) {
    return {
      perAttemptSec: 0,
      effectiveSecPerCount: 0,
      actionSpeed: 0,
      taskActionSpeed: 0,
      efficiency: 0,
      remainingActions: 0,
      totalSec: 0,
      isInfinite: false,
      materialLimited: false,
    };
  }

  const baseSec = (detail.baseTimeCost || 0) / 1e9 > 0 ? (detail.baseTimeCost || 0) / 1e9 : 3;
  const actionType: string = detail.type || "";
  const skillPart = actionType.split("/").pop() || "";
  const actionFunc: string = detail.function || "";

  let reqSkillHrid: string = detail.levelRequirement?.skillHrid || "";
  if (!reqSkillHrid) {
    if (actionFunc === "/action_functions/alchemy") reqSkillHrid = "/skills/alchemy";
    else if (actionFunc === "/action_functions/enhancing") reqSkillHrid = "/skills/enhancing";
  }
  const reqSkillPart = reqSkillHrid.split("/").pop() || skillPart;
  const skillLevelBuffHrid = reqSkillPart ? `/buff_types/${reqSkillPart}_level` : "";

  const acc = {
    actionSpeed: 0,
    efficiency: 0,
    actionLevelFlat: 0,
    skillLevelFlat: 0,
    skillLevelRatio: 0,
  };

  // Global non-loadout buff dictionaries (identical across equipped loadouts)
  accumulateBuffList(buffSources.mooPass?.[actionType], skillLevelBuffHrid, acc);
  accumulateBuffList(buffSources.community?.[actionType], skillLevelBuffHrid, acc);
  accumulateBuffList(buffSources.house?.[actionType], skillLevelBuffHrid, acc);
  accumulateBuffList(buffSources.guild?.[actionType], skillLevelBuffHrid, acc);
  accumulateBuffList(buffSources.achievement?.[actionType], skillLevelBuffHrid, acc);
  accumulateBuffList(buffSources.personal?.[actionType], skillLevelBuffHrid, acc);

  const actionLoadoutId = action?.characterLoadoutID;
  const switchedLoadout =
    actionIndex > 0 &&
    typeof actionLoadoutId === "number" &&
    actionLoadoutId > 0 &&
    actionLoadoutId !== currentActionLoadoutId &&
    characterLoadouts?.[actionLoadoutId]
      ? characterLoadouts[actionLoadoutId]
      : null;

  const onTask = isActionOnTask(action.actionHrid, characterQuests);
  let taskActionSpeed = 0;

  if (switchedLoadout) {
    const ldRes = collectLoadoutBonuses(
      switchedLoadout,
      actionType,
      skillPart,
      skillLevelBuffHrid,
      clientData,
      drinkSlotsMap,
      acc
    );
    if (onTask) taskActionSpeed = ldRes.taskSpeed;
  } else {
    accumulateBuffList(buffSources.equipment?.[actionType], skillLevelBuffHrid, acc);
    accumulateBuffList(buffSources.consumable?.[actionType], skillLevelBuffHrid, acc);
    if (onTask && Array.isArray(buffSources.equipmentTaskActionBuffs)) {
      for (const b of buffSources.equipmentTaskActionBuffs) {
        if (b?.typeHrid === "/buff_types/task_action_speed") {
          taskActionSpeed += (b.flatBoost || 0) + (b.ratioBoost || 0);
        }
      }
    }
  }

  // Skill level transcendence bonus (matches calculateBuffsForAction in client)
  const baseSkillLevel = getSkillLevel(reqSkillHrid, characterSkills);
  const boostedSkillLevel = (1 + acc.skillLevelRatio) * baseSkillLevel + acc.skillLevelFlat;
  const itemDetailMap = clientData?.itemDetailMap || {};

  if (
    actionFunc === "/action_functions/gathering" ||
    actionFunc === "/action_functions/production"
  ) {
    const adjReqLevel = (detail.levelRequirement?.level || 0) + acc.actionLevelFlat;
    if (boostedSkillLevel >= adjReqLevel) {
      acc.efficiency += 0.01 * (boostedSkillLevel - adjReqLevel);
    }
  } else if (actionFunc === "/action_functions/alchemy") {
    const itemLevel = getItemLevelFromHash(action?.primaryItemHash, characterItems, itemDetailMap);
    if (itemLevel !== null && boostedSkillLevel > itemLevel) {
      acc.efficiency += (boostedSkillLevel - itemLevel) / 100;
    }
  } else if (actionFunc === "/action_functions/enhancing") {
    const itemLevel = getItemLevelFromHash(action?.primaryItemHash, characterItems, itemDetailMap);
    if (itemLevel !== null && boostedSkillLevel > itemLevel) {
      acc.actionSpeed += (boostedSkillLevel - itemLevel) / 100;
    }
  }

  const perAttemptSec = Math.max(
    3,
    baseSec / Math.max(0.1, 1 + acc.actionSpeed) / Math.max(0.1, 1 + taskActionSpeed)
  );
  const efficiency = EFFICIENCY_FUNCTIONS.has(actionFunc) ? Math.max(0, acc.efficiency) : 0;
  const effectiveRate = 1 + efficiency;
  const effectiveSecPerCount = perAttemptSec / effectiveRate;

  const hasMax = Boolean(action?.hasMaxCount && (action?.maxCount || 0) > 0);
  const matLimit =
    !hasMax && typeof materialLimit === "number" && Number.isFinite(materialLimit)
      ? Math.max(0, Math.floor(materialLimit))
      : null;
  const bounded = hasMax || matLimit !== null;
  const remainingActions = hasMax
    ? Math.max(0, action.maxCount - (action.currentCount || 0))
    : (matLimit ?? 0);

  let elapsedFraction = 0;
  if (actionIndex === 0 && action?.startTime) {
    const startMs = new Date(action.startTime).getTime();
    if (Number.isFinite(startMs)) {
      const elapsedSec = Math.max(0, (nowMs - startMs) / 1000);
      elapsedFraction = Math.min(perAttemptSec * 0.99, elapsedSec % perAttemptSec);
    }
  }

  const totalSec = bounded
    ? Math.max(0, remainingActions * effectiveSecPerCount - elapsedFraction)
    : 0;

  return {
    perAttemptSec,
    effectiveSecPerCount,
    actionSpeed: acc.actionSpeed,
    taskActionSpeed,
    efficiency,
    remainingActions,
    totalSec,
    isInfinite: !bounded,
    materialLimited: matLimit !== null,
  };
}
