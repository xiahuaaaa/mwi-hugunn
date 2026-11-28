export type TokenThresholdMode = "require" | "any";

export interface TaskRerollLockConfig {
  readonly actionTypes: readonly string[];
  readonly zoneHrids: readonly string[];
  readonly targetHrids: readonly string[];
  readonly minTaskTokens: number | null;
  readonly tokenMode: TokenThresholdMode;
}

export const DEFAULT_LOCK_CONFIG: TaskRerollLockConfig = Object.freeze({
  actionTypes: Object.freeze([]),
  zoneHrids: Object.freeze([]),
  targetHrids: Object.freeze([]),
  minTaskTokens: null,
  tokenMode: "require",
});

export interface TaskQuestSnapshot {
  readonly id?: number | string;
  readonly category?: string;
  readonly status?: string;
  readonly type?: string;
  readonly actionHrid?: string;
  readonly monsterHrid?: string;
  readonly itemRewardsJSON?: string;
  readonly itemRewards?: ReadonlyArray<{ itemHrid?: string; count?: number }>;
  readonly tokenCount?: number;
}

export interface LockCatalogSkill {
  readonly actionTypeHrid: string;
  readonly skillHrid: string;
  readonly name: string;
  readonly sortIndex: number;
  readonly isCombat: boolean;
}

export interface LockCatalogZone {
  readonly actionHrid: string;
  readonly name: string;
  readonly isDungeon: boolean;
  readonly categoryHrid: string;
  readonly categorySortIndex: number;
  readonly sortIndex: number;
  readonly monsterHrids: readonly string[];
}

export interface LockCatalogTarget {
  readonly hrid: string;
  readonly kind: "action" | "monster";
  readonly name: string;
  readonly actionTypeHrid: string;
  readonly sortIndex: number;
  readonly zoneHrids: readonly string[];
}

export interface LockCatalog {
  readonly skills: readonly LockCatalogSkill[];
  readonly zones: readonly LockCatalogZone[];
  readonly targets: readonly LockCatalogTarget[];
  readonly zoneToMonsters: ReadonlyMap<string, ReadonlySet<string>>;
  readonly monsterToZones: ReadonlyMap<string, ReadonlySet<string>>;
  readonly actionToType: ReadonlyMap<string, string>;
}

export type LockMatchReason = "skill" | "zone" | "target" | "tokens";

export interface LockMatchResult {
  readonly matched: boolean;
  readonly reasons: readonly LockMatchReason[];
  readonly tokenCount: number;
  readonly hrid: string;
  readonly actionTypeHrid: string;
}

export type GuardedActionKind = "reroll" | "discard";

export type CardLockPhase =
  | { readonly stage: "armed" }
  | { readonly stage: "cooldown"; readonly kind: GuardedActionKind; readonly unlockAt: number }
  | { readonly stage: "confirm"; readonly kind: GuardedActionKind; readonly expiresAt: number };

export type CardLockAdvanceEvent =
  | "confirmed_allow"
  | "still_cooling"
  | "opened_confirm"
  | "started_cooldown";

export interface CardLockAdvanceResult {
  readonly allow: boolean;
  readonly nextPhase: CardLockPhase;
  readonly event: CardLockAdvanceEvent;
}

export interface TaskCardButtonMeta {
  readonly isLiteNode: boolean;
  readonly disabled: boolean;
  readonly className: string;
  readonly text: string;
  readonly inRerollOptions: boolean;
  readonly inDiscardContainer: boolean;
  readonly inButtonsContainer: boolean;
}

const FALLBACK_TASK_SKILLS: ReadonlyArray<LockCatalogSkill> = [
  { actionTypeHrid: "/action_types/milking", skillHrid: "/skills/milking", name: "Milking", sortIndex: 1, isCombat: false },
  { actionTypeHrid: "/action_types/foraging", skillHrid: "/skills/foraging", name: "Foraging", sortIndex: 2, isCombat: false },
  { actionTypeHrid: "/action_types/woodcutting", skillHrid: "/skills/woodcutting", name: "Woodcutting", sortIndex: 3, isCombat: false },
  { actionTypeHrid: "/action_types/cheesesmithing", skillHrid: "/skills/cheesesmithing", name: "Cheesesmithing", sortIndex: 4, isCombat: false },
  { actionTypeHrid: "/action_types/crafting", skillHrid: "/skills/crafting", name: "Crafting", sortIndex: 5, isCombat: false },
  { actionTypeHrid: "/action_types/tailoring", skillHrid: "/skills/tailoring", name: "Tailoring", sortIndex: 6, isCombat: false },
  { actionTypeHrid: "/action_types/cooking", skillHrid: "/skills/cooking", name: "Cooking", sortIndex: 7, isCombat: false },
  { actionTypeHrid: "/action_types/brewing", skillHrid: "/skills/brewing", name: "Brewing", sortIndex: 8, isCombat: false },
  { actionTypeHrid: "/action_types/alchemy", skillHrid: "/skills/alchemy", name: "Alchemy", sortIndex: 9, isCombat: false },
  { actionTypeHrid: "/action_types/enhancing", skillHrid: "/skills/enhancing", name: "Enhancing", sortIndex: 10, isCombat: false },
  { actionTypeHrid: "/action_types/combat", skillHrid: "/skills/combat", name: "Combat", sortIndex: 11, isCombat: true },
];

const FALLBACK_SKILL_BY_TYPE = new Map(
  FALLBACK_TASK_SKILLS.map((skill) => [skill.actionTypeHrid, skill])
);

const BACK_BTN_RE = /^(返回|Back)$/i;
const REROLL_EXPAND_BTN_RE = /^(重置|Reroll)$/i;
const REROLL_CONFIRM_BTN_RE =
  /^(?:支付\s*[\d.,]+[KMB]?|Pay\s*[\d.,]+[KMB]?|哞卡免费重置|MooPass\s*Free\s*Reroll|.*免费重置|.*Free\s*Reroll)/i;
const DISCARD_CONFIRM_BTN_RE =
  /^(?:确认放弃|确认丢弃|放弃任务|Confirm\s*Discard|Discard\s*Task|Abandon)$/i;

function normalizeStringList(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeMinTaskTokens(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "boolean") return null;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(parsed)) return null;
  const floored = Math.floor(parsed);
  return floored >= 1 ? floored : null;
}

export function normalizeLockConfig(raw: unknown): TaskRerollLockConfig {
  if (!raw || typeof raw !== "object") {
    return {
      actionTypes: [],
      zoneHrids: [],
      targetHrids: [],
      minTaskTokens: null,
      tokenMode: "require",
    };
  }
  const obj = raw as Record<string, unknown>;
  const tokenMode: TokenThresholdMode = obj.tokenMode === "any" ? "any" : "require";
  return {
    actionTypes: normalizeStringList(obj.actionTypes),
    zoneHrids: normalizeStringList(obj.zoneHrids),
    targetHrids: normalizeStringList(obj.targetHrids),
    minTaskTokens: normalizeMinTaskTokens(obj.minTaskTokens),
    tokenMode,
  };
}

export function countActiveRules(cfg: TaskRerollLockConfig): number {
  return (
    cfg.actionTypes.length +
    cfg.zoneHrids.length +
    cfg.targetHrids.length +
    (cfg.minTaskTokens ? 1 : 0)
  );
}

function formatSlugLabel(slug: string): string {
  return slug
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractSlug(hrid: unknown): string {
  if (typeof hrid !== "string") return "";
  const parts = hrid.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function collectSpawnMonsterHrids(zoneInfo: any): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const pushSpawn = (spawn: any) => {
    const hrid =
      typeof spawn?.combatMonsterHrid === "string"
        ? spawn.combatMonsterHrid
        : typeof spawn?.monsterHrid === "string"
          ? spawn.monsterHrid
          : "";
    if (!hrid || seen.has(hrid)) return;
    seen.add(hrid);
    out.push(hrid);
  };

  const fi = zoneInfo?.fightInfo;
  if (fi && typeof fi === "object") {
    for (const s of fi.randomSpawnInfo?.spawns || []) pushSpawn(s);
    for (const s of fi.fixedSpawns || []) pushSpawn(s);
    for (const s of fi.bossSpawns || []) pushSpawn(s);
  }

  const di = zoneInfo?.dungeonInfo;
  if (di && typeof di === "object") {
    const randomWaves = Object.entries<any>(di.randomSpawnInfoMap || {}).sort(
      (a, b) => Number(a[0]) - Number(b[0])
    );
    for (const [, wave] of randomWaves) {
      for (const s of wave?.spawns || []) pushSpawn(s);
    }
    const fixedWaves = Object.entries<any>(di.fixedSpawnsMap || {}).sort(
      (a, b) => Number(a[0]) - Number(b[0])
    );
    for (const [, spawns] of fixedWaves) {
      for (const s of spawns || []) pushSpawn(s);
    }
  }

  return out;
}

function buildSkillsCatalog(clientData: any): LockCatalogSkill[] {
  const actionTypeMap: Record<string, any> = clientData?.actionTypeDetailMap || {};
  const skillMap: Record<string, any> = clientData?.skillDetailMap || {};
  const randomTaskMap: Record<string, any> = clientData?.randomTaskTypeDetailMap || {};
  const byActionType = new Map<string, LockCatalogSkill>();

  for (const [key, entry] of Object.entries<any>(randomTaskMap)) {
    if (!entry || typeof entry !== "object") continue;
    const rawSlug = extractSlug(entry.skillHrid) || extractSlug(entry.hrid || key);
    const isCombat =
      Boolean(entry.isCombat) || rawSlug === "combat" || rawSlug === "monster";
    const candidateType =
      typeof entry.actionTypeHrid === "string" && entry.actionTypeHrid
        ? entry.actionTypeHrid
        : isCombat
          ? "/action_types/combat"
          : rawSlug
            ? `/action_types/${rawSlug}`
            : "";
    if (!candidateType) continue;

    const actionTypeDetail = actionTypeMap[candidateType];
    const resolvedSkillHrid =
      typeof entry.skillHrid === "string" && entry.skillHrid
        ? entry.skillHrid
        : isCombat
          ? "/skills/combat"
          : `/skills/${extractSlug(candidateType)}`;
    const fallback = FALLBACK_SKILL_BY_TYPE.get(candidateType);
    const name =
      (typeof actionTypeDetail?.name === "string" && actionTypeDetail.name.trim()) ||
      (typeof skillMap[resolvedSkillHrid]?.name === "string" && skillMap[resolvedSkillHrid].name.trim()) ||
      (typeof entry.name === "string" && entry.name.trim()) ||
      fallback?.name ||
      formatSlugLabel(extractSlug(candidateType));
    const sortIndex =
      typeof entry.sortIndex === "number" && Number.isFinite(entry.sortIndex)
        ? entry.sortIndex
        : typeof actionTypeDetail?.sortIndex === "number" && Number.isFinite(actionTypeDetail.sortIndex)
          ? actionTypeDetail.sortIndex
          : fallback?.sortIndex ?? 999;

    const existing = byActionType.get(candidateType);
    if (!existing || sortIndex < existing.sortIndex) {
      byActionType.set(candidateType, {
        actionTypeHrid: candidateType,
        skillHrid: resolvedSkillHrid,
        name,
        sortIndex,
        isCombat,
      });
    }
  }

  if (byActionType.size === 0) {
    for (const fallback of FALLBACK_TASK_SKILLS) {
      const actionTypeDetail = actionTypeMap[fallback.actionTypeHrid];
      const skillDetail = skillMap[fallback.skillHrid];
      const name =
        (typeof actionTypeDetail?.name === "string" && actionTypeDetail.name.trim()) ||
        (typeof skillDetail?.name === "string" && skillDetail.name.trim()) ||
        fallback.name;
      const sortIndex =
        typeof actionTypeDetail?.sortIndex === "number" && Number.isFinite(actionTypeDetail.sortIndex)
          ? actionTypeDetail.sortIndex
          : fallback.sortIndex;
      byActionType.set(fallback.actionTypeHrid, {
        ...fallback,
        name,
        sortIndex,
      });
    }
  }

  return Array.from(byActionType.values()).sort(
    (a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name)
  );
}

export function buildLockCatalog(clientData: any): LockCatalog {
  const skills = buildSkillsCatalog(clientData);
  const skillOrderMap = new Map<string, number>();
  skills.forEach((skill, idx) => {
    skillOrderMap.set(skill.actionTypeHrid, idx);
  });

  const catMap: Record<string, any> = clientData?.actionCategoryDetailMap || {};
  const actionMap: Record<string, any> = clientData?.actionDetailMap || {};
  const monsterMap: Record<string, any> =
    clientData?.combatMonsterDetailMap || clientData?.monsterDetailMap || {};

  const zones: LockCatalogZone[] = [];
  const actionToType = new Map<string, string>();
  const actionTargets: LockCatalogTarget[] = [];

  for (const [hrid, detail] of Object.entries<any>(actionMap)) {
    if (!detail || typeof detail !== "object") continue;
    const actionType = typeof detail.type === "string" ? detail.type : "";
    const name = typeof detail.name === "string" ? detail.name.trim() : "";
    if (actionType) {
      actionToType.set(hrid, actionType);
    }

    if (actionType === "/action_types/combat" && detail.combatZoneInfo) {
      const monsterHrids = collectSpawnMonsterHrids(detail.combatZoneInfo);
      if (monsterHrids.length === 0) continue;
      const categoryHrid = typeof detail.category === "string" ? detail.category : "";
      const categorySortIndex =
        typeof catMap[categoryHrid]?.sortIndex === "number" && Number.isFinite(catMap[categoryHrid].sortIndex)
          ? catMap[categoryHrid].sortIndex
          : 999;
      const sortIndex =
        typeof detail.sortIndex === "number" && Number.isFinite(detail.sortIndex) ? detail.sortIndex : 999;
      zones.push({
        actionHrid: hrid,
        name: name || formatSlugLabel(extractSlug(hrid)),
        isDungeon: Boolean(detail.combatZoneInfo.isDungeon),
        categoryHrid,
        categorySortIndex,
        sortIndex,
        monsterHrids,
      });
      continue;
    }

    if (actionType && actionType !== "/action_types/combat" && skillOrderMap.has(actionType) && name) {
      const sortIndex =
        typeof detail.sortIndex === "number" && Number.isFinite(detail.sortIndex) ? detail.sortIndex : 999;
      actionTargets.push({
        hrid,
        kind: "action",
        name,
        actionTypeHrid: actionType,
        sortIndex,
        zoneHrids: [],
      });
    }
  }

  zones.sort(
    (a, b) =>
      a.categorySortIndex - b.categorySortIndex ||
      Number(a.isDungeon) - Number(b.isDungeon) ||
      a.sortIndex - b.sortIndex ||
      a.name.localeCompare(b.name) ||
      a.actionHrid.localeCompare(b.actionHrid)
  );

  const zoneToMonsters = new Map<string, Set<string>>();
  const monsterToZones = new Map<string, Set<string>>();
  const monsterZoneRank = new Map<string, number>();

  zones.forEach((zone, zoneIdx) => {
    const monsterSet = new Set<string>(zone.monsterHrids);
    zoneToMonsters.set(zone.actionHrid, monsterSet);
    zone.monsterHrids.forEach((monsterHrid, spawnIdx) => {
      let zSet = monsterToZones.get(monsterHrid);
      if (!zSet) {
        zSet = new Set<string>();
        monsterToZones.set(monsterHrid, zSet);
      }
      zSet.add(zone.actionHrid);
      if (!monsterZoneRank.has(monsterHrid)) {
        monsterZoneRank.set(monsterHrid, zoneIdx * 1000 + spawnIdx);
      }
    });
  });

  const monsterTargets: LockCatalogTarget[] = [];
  for (const [hrid, detail] of Object.entries<any>(monsterMap)) {
    const name = typeof detail?.name === "string" ? detail.name.trim() : "";
    if (!name) continue;
    const zSet = monsterToZones.get(hrid);
    const combatLevel = Number(detail?.combatDetails?.combatLevel);
    const rank =
      monsterZoneRank.get(hrid) ??
      (Number.isFinite(combatLevel) ? 1_000_000 + Math.round(combatLevel * 100) : 9_999_999);
    monsterTargets.push({
      hrid,
      kind: "monster",
      name,
      actionTypeHrid: "/action_types/combat",
      sortIndex: rank,
      zoneHrids: zSet ? Array.from(zSet) : [],
    });
  }

  const targets = [...actionTargets, ...monsterTargets].sort((a, b) => {
    const sa = skillOrderMap.get(a.actionTypeHrid) ?? 999;
    const sb = skillOrderMap.get(b.actionTypeHrid) ?? 999;
    return sa - sb || a.sortIndex - b.sortIndex || a.name.localeCompare(b.name);
  });

  return {
    skills,
    zones,
    targets,
    zoneToMonsters,
    monsterToZones,
    actionToType,
  };
}

function sumTaskTokens(rewards: unknown): number | null {
  if (!Array.isArray(rewards)) return null;
  let total = 0;
  for (const entry of rewards) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { itemHrid?: unknown; count?: unknown };
    if (item.itemHrid !== "/items/task_token") continue;
    const count = Number(item.count);
    if (Number.isFinite(count) && count > 0) {
      total += count;
    }
  }
  return total;
}

export function extractTaskTokenReward(quest: TaskQuestSnapshot): number {
  if (typeof quest.itemRewardsJSON === "string" && quest.itemRewardsJSON.trim()) {
    try {
      const parsed = JSON.parse(quest.itemRewardsJSON);
      const summed = sumTaskTokens(parsed);
      if (summed !== null) return summed;
    } catch {
    }
  }

  const fromArray = sumTaskTokens(quest.itemRewards);
  if (fromArray !== null) return fromArray;

  if (typeof quest.tokenCount === "number" && Number.isFinite(quest.tokenCount) && quest.tokenCount > 0) {
    return Math.floor(quest.tokenCount);
  }
  return 0;
}

export function evaluateQuestLock(
  quest: TaskQuestSnapshot | null,
  cfg: TaskRerollLockConfig,
  catalog: LockCatalog
): LockMatchResult {
  if (!quest) {
    return { matched: false, reasons: [], tokenCount: 0, hrid: "", actionTypeHrid: "" };
  }

  const tokenCount = extractTaskTokenReward(quest);
  const monsterHrid = typeof quest.monsterHrid === "string" ? quest.monsterHrid : "";
  const actionHrid = typeof quest.actionHrid === "string" ? quest.actionHrid : "";
  const isCombat =
    Boolean(monsterHrid) ||
    quest.type === "/quest_type/monster" ||
    quest.type === "/quest_types/monster";
  const hrid = isCombat ? monsterHrid : actionHrid;
  const actionTypeHrid = isCombat ? "/action_types/combat" : catalog.actionToType.get(hrid) || "";

  if (
    typeof quest.category === "string" &&
    quest.category.length > 0 &&
    quest.category !== "/quest_category/random_task"
  ) {
    return { matched: false, reasons: [], tokenCount, hrid, actionTypeHrid };
  }

  if (
    quest.status === "/quest_status/completed" ||
    quest.status === "/quest_status/claimed"
  ) {
    return { matched: false, reasons: [], tokenCount, hrid, actionTypeHrid };
  }

  const hasTargetRules =
    cfg.actionTypes.length > 0 || cfg.zoneHrids.length > 0 || cfg.targetHrids.length > 0;
  const hasTokenRule = cfg.minTaskTokens !== null && cfg.minTaskTokens > 0;

  if (!hasTargetRules && !hasTokenRule) {
    return { matched: false, reasons: [], tokenCount, hrid, actionTypeHrid };
  }

  const skillHit = Boolean(actionTypeHrid) && cfg.actionTypes.includes(actionTypeHrid);
  let zoneHit = false;
  if (isCombat && hrid && cfg.zoneHrids.length > 0) {
    for (const zoneHrid of cfg.zoneHrids) {
      if (
        catalog.zoneToMonsters.get(zoneHrid)?.has(hrid) ||
        catalog.monsterToZones.get(hrid)?.has(zoneHrid)
      ) {
        zoneHit = true;
        break;
      }
    }
  }
  const targetHitExact = Boolean(hrid) && cfg.targetHrids.includes(hrid);
  const targetHit = skillHit || zoneHit || targetHitExact;
  const tokenHit = hasTokenRule && tokenCount >= (cfg.minTaskTokens as number);

  let matched = false;
  if (hasTargetRules && hasTokenRule) {
    matched = cfg.tokenMode === "any" ? targetHit || tokenHit : targetHit && tokenHit;
  } else if (hasTargetRules) {
    matched = targetHit;
  } else {
    matched = tokenHit;
  }

  if (!matched) {
    return { matched: false, reasons: [], tokenCount, hrid, actionTypeHrid };
  }

  const reasons: LockMatchReason[] = [];
  if (skillHit) reasons.push("skill");
  if (zoneHit) reasons.push("zone");
  if (targetHitExact) reasons.push("target");
  if (tokenHit) reasons.push("tokens");

  return { matched: true, reasons, tokenCount, hrid, actionTypeHrid };
}

export function advanceCardLockPhase(
  current: CardLockPhase,
  clickKind: GuardedActionKind,
  nowMs: number,
  cooldownMs = 3000,
  confirmMs = 3000
): CardLockAdvanceResult {
  if (current.stage === "confirm" && current.kind === clickKind && nowMs <= current.expiresAt) {
    return {
      allow: true,
      nextPhase: { stage: "armed" },
      event: "confirmed_allow",
    };
  }

  if (current.stage === "cooldown" && current.kind === clickKind) {
    if (nowMs < current.unlockAt) {
      return {
        allow: false,
        nextPhase: current,
        event: "still_cooling",
      };
    }
    return {
      allow: false,
      nextPhase: {
        stage: "confirm",
        kind: clickKind,
        expiresAt: nowMs + confirmMs,
      },
      event: "opened_confirm",
    };
  }

  return {
    allow: false,
    nextPhase: {
      stage: "cooldown",
      kind: clickKind,
      unlockAt: nowMs + cooldownMs,
    },
    event: "started_cooldown",
  };
}

export function enterConfirmPhase(
  current: CardLockPhase,
  nowMs: number,
  confirmMs = 3000
): CardLockPhase {
  if (current.stage === "cooldown" && nowMs >= current.unlockAt) {
    return {
      stage: "confirm",
      kind: current.kind,
      expiresAt: nowMs + confirmMs,
    };
  }
  return current;
}

export function classifyTaskCardButton(meta: TaskCardButtonMeta): GuardedActionKind | null {
  if (meta.isLiteNode || meta.disabled) return null;
  const cls = meta.className || "";
  if (cls.includes("Button_disabled")) return null;
  if (cls.includes("Button_success") || cls.includes("Button_buy")) return null;

  const text = (meta.text || "").trim();
  if (BACK_BTN_RE.test(text) || REROLL_EXPAND_BTN_RE.test(text)) return null;
  if (meta.inDiscardContainer) return null;

  if (meta.inRerollOptions || REROLL_CONFIRM_BTN_RE.test(text)) {
    return "reroll";
  }

  if (
    meta.inButtonsContainer &&
    !meta.inDiscardContainer &&
    !meta.inRerollOptions &&
    (cls.includes("Button_warning") || DISCARD_CONFIRM_BTN_RE.test(text))
  ) {
    return "discard";
  }

  return null;
}
