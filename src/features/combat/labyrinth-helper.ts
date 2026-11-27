// Credit: Labyrinth recommended-route & shroud UX adapted from mwi-muninn (xiahuaaaa), refactored for 1:1 human-click compliance.
import type { FeatureModule, KernelContext, PanelRoute } from "../../core/types";
import {
  computeCrateSkillBuffs,
  coordKey,
  DEFAULT_ROUTE_CONFIG,
  filterShroudPicks,
  MONSTER_KEYS,
  normalizeRouteConfig,
  parseLabyrinthPath,
  pickNextShroudTarget,
  shroudable,
  SKILL_KEYS,
  wantRoute,
  type Coord,
  type LabState,
  type Room,
  type RouteConfig,
} from "./labyrinth-route-engine";

const STORAGE_KEY = "labyrinth_helper_pref_v1";
const LEGACY_MUNINN_KEY = "mwi-muninn";
const PANEL_ID = "mwi-lite-lab-helper-panel";
const ENTRY_CLASS = "mwi-lite-lab-entry";
const ROUTE_BTN_CLASS = "mwi-lite-lab-route-btn";
const SHROUD_BAR_CLASS = "mwi-lite-lab-shroud-bar";
const GRID_SEL = '[class*="LabyrinthPanel_roomGrid"]';
const ATTR_ROUTE_STEP = "data-mwi-lab-step";
const ATTR_SHROUD_PICK = "data-mwi-lab-shroud";
const ACTION_TIMEOUT_MS = 2200;

interface HelperSettings {
  collapsed: boolean;
  migratedLegacy: boolean;
  cfg: RouteConfig;
}

interface PendingAction {
  kind: "queue" | "shroud";
  x: number;
  y: number;
  key: string;
  deadline: number;
  timerId: number;
}

const ITEM_LABELS: Record<string, [string, string]> = {
  milking: ["挤奶", "Milking"],
  foraging: ["采摘", "Foraging"],
  woodcutting: ["伐木", "Woodcutting"],
  cheesesmithing: ["奶酪锻造", "Cheesesmithing"],
  crafting: ["制作", "Crafting"],
  tailoring: ["缝纫", "Tailoring"],
  cooking: ["烹饪", "Cooking"],
  brewing: ["冲泡", "Brewing"],
  alchemy: ["炼金", "Alchemy"],
  enhancing: ["强化", "Enhancing"],
  mimic: ["宝箱怪", "Mimic"],
  shadow_archer: ["暗影弓手", "Shadow Archer"],
  pyre_hunter: ["火焰猎手", "Pyre Hunter"],
  frost_sniper: ["霜冻狙击手", "Frost Sniper"],
  siren: ["海妖", "Siren"],
  salamander: ["火蜥蜴", "Salamander"],
  dryad: ["树精", "Dryad"],
  giant_scorpion: ["巨蝎", "Giant Scorpion"],
  giant_mantis: ["巨螳螂", "Giant Mantis"],
  cyclops: ["独眼巨人", "Cyclops"],
};

// Mirrored purple-raven 16x16 pixel icon matching Hugunn's SNES aesthetic.
const MUNINN_ICON_PATHS =
  '<path fill="#070b16" d="M6 1h5v1H6zM5 2h1v1H5zM11 2h1v1H11zM4 3h1v1H4zM12 3h1v1H12zM4 4h1v1H4zM12 4h3v1H12zM3 5h1v1H3zM10 5h1v1H10zM15 5h1v1H15zM3 6h1v1H3zM10 6h1v1H10zM15 6h1v1H15zM2 7h1v1H2zM10 7h5v1H10zM2 8h1v1H2zM10 8h1v1H10zM1 9h1v1H1zM9 9h1v1H9zM1 10h1v1H1zM4 10h2v1H4zM8 10h1v1H8zM2 11h2v1H2zM6 11h3v1H6z"/><path fill="#121c3b" d="M9 5h1v1H9zM3 7h1v1H3zM3 8h2v1H3zM9 8h1v1H9zM2 9h3v1H2zM8 9h1v1H8zM2 10h2v1H2zM6 10h2v1H6z"/><path fill="#5b2a86" d="M8 3h1v1H8zM7 4h2v1H7zM10 4h1v1H10zM7 5h2v1H7zM5 6h2v1H5zM9 6h1v1H9zM5 7h3v1H5zM9 7h1v1H9zM6 8h3v1H6zM6 9h2v1H6z"/><path fill="#9b5de5" d="M6 2h4v1H6zM5 3h1v1H5zM5 4h1v1H5zM4 5h2v1H4zM4 6h1v1H4zM7 6h2v1H7zM4 7h1v1H4zM8 7h1v1H8zM5 8h1v1H5zM5 9h1v1H5z"/><path fill="#d8b4fe" d="M10 2h1v1H10zM6 3h2v1H6zM6 4h1v1H6zM6 5h1v1H6z"/><path fill="#f0abfc" d="M11 3h1v1H11zM9 4h1v1H9zM11 4h1v1H11z"/><path fill="#ffffff" d="M9 3h2v1H9z"/><path fill="#fde047" d="M2 0h1v1H2zM11 5h4v1H11zM14 11h1v1H14z"/><path fill="#f59e0b" d="M11 6h2v1H11zM5 12h1v1H5zM8 12h1v1H8zM4 13h2v1H4zM8 13h2v1H8z"/><path fill="#b45309" d="M13 6h2v1H13z"/>';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function muninnIconSvg(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true" style="display:inline-block;flex:0 0 auto;image-rendering:pixelated"><g transform="matrix(-1 0 0 1 16 0)">${MUNINN_ICON_PATHS}</g></svg>`;
}

function loadSettings(ctx: KernelContext): HelperSettings {
  const saved = ctx.storage.get<Partial<HelperSettings> | null>(STORAGE_KEY, null);
  if (saved && typeof saved === "object" && saved.cfg) {
    return {
      collapsed: typeof saved.collapsed === "boolean" ? saved.collapsed : true,
      migratedLegacy: Boolean(saved.migratedLegacy),
      cfg: normalizeRouteConfig(saved.cfg),
    };
  }

  // One-time migration from standalone mwi-muninn localStorage settings
  let migratedCfg: RouteConfig = {
    ...DEFAULT_ROUTE_CONFIG,
    wantSkills: [...DEFAULT_ROUTE_CONFIG.wantSkills],
    wantMonsters: [...DEFAULT_ROUTE_CONFIG.wantMonsters],
  };
  let collapsed = true;
  let migrated = false;
  try {
    const raw = localStorage.getItem(LEGACY_MUNINN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (parsed.cfg) migratedCfg = normalizeRouteConfig(parsed.cfg);
        if (typeof parsed.collapsed === "boolean") collapsed = parsed.collapsed;
        migrated = true;
      }
    }
  } catch {
    // Ignore malformed legacy storage
  }

  const next: HelperSettings = { collapsed, migratedLegacy: migrated, cfg: migratedCfg };
  ctx.storage.set(STORAGE_KEY, next);
  return next;
}

function cellOf(x: number, y: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`${GRID_SEL} [data-room-x="${x}"][data-room-y="${y}"]`);
}

function findShroudButton(): HTMLButtonElement | null {
  for (const box of document.querySelectorAll('[class*="LabyrinthPanel_supplyWithButton"]')) {
    if ((box.querySelector("use")?.getAttribute("href") || "").includes("shroud")) {
      return box.querySelector<HTMLButtonElement>("button");
    }
  }
  return null;
}

function isShroudButtonArmed(btn: HTMLButtonElement | null): boolean {
  if (!btn) return false;
  const txt = (btn.textContent || "").trim();
  return txt === "X" || txt === "×" || /取消|Cancel/i.test(txt);
}

/**
 * Trigger a single labyrinth room queue toggle using standard DOM PointerEvents
 * directly inside a 1:1 human click handler (zero React Fiber DFS, zero ws.send).
 */
function triggerCellQueue(x: number, y: number): "ok" | "refused" | "missing" {
  const el = cellOf(x, y);
  if (!el) return "missing";
  // No interaction class at all: game refuses room (e.g. skip threshold).
  if (!/LabyrinthPanel_interaction/.test(el.className)) return "refused";
  if (!/LabyrinthPanel_interactionClickable/.test(el.className)) return "missing";
  const r = el.getBoundingClientRect();
  const opts: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
  };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, buttons: 1 }));
  window.requestAnimationFrame(() => {
    const cur = cellOf(x, y) || el;
    cur.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
  });
  return "ok";
}

function describeRoom(ctx: KernelContext, room: Room | null | undefined, c: Coord): string {
  const coord = `(${c.x},${c.y})`;
  if (!room) return `${coord} ${ctx.i18n.t("未探索", "Hidden")}`;
  if (room.roomType === "/labyrinth_room_types/treasure") return `${coord} ${ctx.i18n.t("宝藏", "Treasure")}`;
  if (room.roomType === "/labyrinth_room_types/skilling" && room.skillHrid) {
    const key = room.skillHrid.slice(room.skillHrid.lastIndexOf("/") + 1);
    const pair = ITEM_LABELS[key];
    const name = pair ? ctx.i18n.t(pair[0], pair[1]) : ctx.i18n.getSkillName(room.skillHrid);
    return `${coord} ${name}${room.recommendedLevel ? ` Lv.${room.recommendedLevel}` : ""}`;
  }
  if (room.roomType === "/labyrinth_room_types/combat" && room.monsterHrid) {
    const key = room.monsterHrid.slice(room.monsterHrid.lastIndexOf("/") + 1);
    const pair = ITEM_LABELS[key];
    const name = pair ? ctx.i18n.t(pair[0], pair[1]) : ctx.i18n.getMonsterName(room.monsterHrid);
    return `${coord} ${name}${room.recommendedLevel ? ` Lv.${room.recommendedLevel}` : ""}`;
  }
  return coord;
}

export function createLabyrinthHelperModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let settings: HelperSettings | null = null;
  let destroyed = false;

  // Per-floor ephemeral state (reset on floor change or leaving labyrinth)
  let currentFloor = 0;
  const blocked = new Set<string>();
  const noShroud = new Set<string>();
  let pending: PendingAction | null = null;

  // Shroud 1:1 batch picking state
  let pickingShrouds = false;
  let shroudPicks: Coord[] = [];
  let shroudSkipped = 0;
  let stopPickListener: (() => void) | null = null;
  let bypassPickSwallow = false;
  let shroudArmRaf = 0;

  // Cached route computation
  let routeCache = { sig: "", route: [] as Coord[] };
  let statusText = "";

  // DOM elements (all tagged data-mwi-lite="1")
  let entryBtn: HTMLButtonElement | null = null;
  let panelEl: HTMLElement | null = null;
  let statusEl: HTMLElement | null = null;
  let routeBtn: HTMLButtonElement | null = null;
  let shroudBar: HTMLElement | null = null;
  let lastShroudSig = "";

  const saveSettings = () => {
    if (ctx && settings) ctx.storage.set(STORAGE_KEY, settings);
  };

  const clearPending = () => {
    if (pending) {
      window.clearTimeout(pending.timerId);
      pending = null;
    }
    if (shroudArmRaf) {
      window.cancelAnimationFrame(shroudArmRaf);
      shroudArmRaf = 0;
    }
  };

  const stopPicking = () => {
    pickingShrouds = false;
    shroudPicks = [];
    shroudSkipped = 0;
    stopPickListener?.();
    stopPickListener = null;
    clearMapMarks(ATTR_SHROUD_PICK);
  };

  const clearMapMarks = (attr: string) => {
    document.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => {
      el.removeAttribute(attr);
    });
  };

  const getLabState = (): LabState | null => {
    if (!ctx) return null;
    const lab = ctx.gameData.getLabyrinthData();
    if (!lab?.isActive || !Array.isArray(lab.roomData) || !lab.roomData.length) return null;
    const meta = ctx.gameData.getLabyrinthMeta();
    const skillLevels: Record<string, number> = {};
    for (const sk of ctx.gameData.getCharacterSkills()) {
      if (sk?.skillHrid) skillLevels[sk.skillHrid] = Number(sk.level) || 1;
    }
    const crateBuffs = computeCrateSkillBuffs(
      lab.teaCrateItemHrid,
      lab.coffeeCrateItemHrid,
      ctx.gameData.getClientData()?.labyrinthCrateDetailMap
    );
    return {
      floor: lab.currentFloor || 1,
      rooms: lab.roomData,
      path: parseLabyrinthPath(lab.pathData),
      shroud: lab.shroudCount || 0,
      pathCap: meta.pathCap,
      maxAttempts: meta.maxAttempts,
      skipThresholds: meta.skipThresholds,
      skillLevels: Object.keys(skillLevels).length > 0 ? skillLevels : undefined,
      crateBuffs,
      blocked,
      noShroud,
    };
  };

  const syncFloor = (labState: LabState | null): number => {
    const floor = labState?.floor || 0;
    if (floor !== currentFloor) {
      currentFloor = floor;
      blocked.clear();
      noShroud.clear();
      clearPending();
      stopPicking();
      routeCache = { sig: "", route: [] };
    }
    return floor;
  };

  /**
   * Safeguard against stale/mismatched client state by also blocking any cell that the live game DOM
   * marks as unrevealed fog (`fogRoom`), above official skip threshold (`roomLevelWarning`), or
   * refused adjacent to cleared cells (no `LabyrinthPanel_interaction*` class).
   */
  const collectEffectiveBlocked = (labState: LabState): ReadonlySet<string> => {
    if (!document.querySelector(GRID_SEL)) {
      return blocked;
    }
    const rooms = labState.rooms;
    const n = rooms.length;
    const pathFull = labState.path.length >= labState.pathCap;
    const isCleared = (x: number, y: number) => Boolean(rooms[y]?.[x]?.isCleared);
    const queued = new Set(labState.path.map((c) => coordKey(c.x, c.y)));
    let merged: Set<string> | null = null;
    const addBlocked = (k: string) => {
      if (!merged) merged = new Set(blocked);
      merged.add(k);
    };
    for (let y = 0; y < n; y++) {
      const row = rooms[y];
      if (!row) continue;
      for (let x = 0; x < n; x++) {
        const room = row[x];
        if (!room || room.isCleared) continue;
        const k = coordKey(x, y);
        if (blocked.has(k) || queued.has(k)) continue;
        const el = cellOf(x, y);
        if (!el) continue;
        if (
          /LabyrinthPanel_fogRoom/.test(el.className) ||
          el.querySelector('[class*="LabyrinthPanel_roomLevelWarning"]') !== null
        ) {
          addBlocked(k);
          continue;
        }
        if (pathFull) continue;
        const touchesCleared =
          isCleared(x + 1, y) || isCleared(x - 1, y) || isCleared(x, y + 1) || isCleared(x, y - 1);
        if (touchesCleared && !/LabyrinthPanel_interaction/.test(el.className)) {
          addBlocked(k);
        }
      }
    }
    return merged || blocked;
  };

  const buildRoomsSignature = (rooms: LabState["rooms"]): string => {
    const parts: string[] = [];
    for (let y = 0; y < rooms.length; y++) {
      const row = rooms[y];
      if (!row) {
        parts.push("-");
        continue;
      }
      for (let x = 0; x < row.length; x++) {
        const r = row[x];
        if (!r || (!r.isCleared && !r.roomType)) {
          parts.push(".");
        } else if (r.isCleared) {
          parts.push("C");
        } else {
          parts.push(`${r.roomType?.[22] || "?"}:${r.skillHrid || r.monsterHrid || ""}:${r.recommendedLevel || 0}:${r.failCount || 0}`);
        }
      }
    }
    return parts.join(",");
  };

  const getSuggestedRoute = (labState: LabState | null): Coord[] => {
    if (!labState || !settings || !ctx) return [];
    const meta = ctx.gameData.getLabyrinthMeta();
    const effectiveBlocked = collectEffectiveBlocked(labState);
    const pathSig = labState.path.map((c) => coordKey(c.x, c.y)).join(";");
    const blockedSig = Array.from(effectiveBlocked).sort().join(";");
    const skipSig = Object.entries(meta.skipThresholds)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(",");
    const skillSig = labState.skillLevels
      ? Object.entries(labState.skillLevels)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}:${v}`)
          .join(",")
      : "";
    const crateSig = labState.crateBuffs
      ? Object.entries(labState.crateBuffs)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}:${v}`)
          .join(",")
      : "";
    const roomsSig = buildRoomsSignature(labState.rooms);
    const cfgSig = `${settings.cfg.wantSkills.join(",")}|${settings.cfg.wantMonsters.join(",")}`;
    const sig = `${meta.rev}|${labState.floor}|${pathSig}|${labState.pathCap}|${labState.maxAttempts}|${skipSig}|${skillSig}|${crateSig}|${roomsSig}|${blockedSig}|${cfgSig}`;
    if (sig !== routeCache.sig) {
      routeCache = { sig, route: wantRoute({ ...labState, blocked: effectiveBlocked }, settings.cfg) };
    }
    return routeCache.route;
  };

  const settlePending = (labState: LabState | null): boolean => {
    if (!pending || !labState) return false;
    const p = pending;
    const room = labState.rooms[p.y]?.[p.x];
    const cleared = Boolean(room?.isCleared);
    const done =
      p.kind === "queue"
        ? cleared || labState.path.some((c) => c.x === p.x && c.y === p.y)
        : cleared;

    if (done) {
      clearPending();
      if (p.kind === "shroud") {
        // Reconcile remaining shroud picks immediately
        const filtered = filterShroudPicks(shroudPicks, labState.rooms, noShroud);
        shroudPicks = filtered.remaining;
        if (shroudPicks.length === 0) {
          const skipSuffix = shroudSkipped ? ctx!.i18n.t(`（跳过 ${shroudSkipped} 个）`, ` (${shroudSkipped} skipped)`) : "";
          setStatus(ctx!.i18n.t(`斗篷使用完成${skipSuffix}`, `Shrouds complete${skipSuffix}`));
          stopPicking();
        } else {
          setStatus(ctx!.i18n.t(`已罩住 (${p.x},${p.y})，剩 ${shroudPicks.length} 个`, `Shrouded (${p.x},${p.y}), ${shroudPicks.length} left`));
        }
      } else {
        setStatus(ctx!.i18n.t(`已排入 (${p.x},${p.y})`, `Queued (${p.x},${p.y})`));
      }
      return true;
    }

    if (Date.now() >= p.deadline) {
      clearPending();
      if (p.kind === "queue") {
        blocked.add(p.key);
        routeCache.sig = "";
        setStatus(ctx!.i18n.t(`(${p.x},${p.y}) 未响应，已跳过并重选`, `(${p.x},${p.y}) timed out, skipped`));
      } else {
        noShroud.add(p.key);
        shroudSkipped++;
        shroudPicks = shroudPicks.filter((c) => coordKey(c.x, c.y) !== p.key);
        // Disarm lingering "X" shroud selection if still armed
        const sb = findShroudButton();
        if (isShroudButtonArmed(sb)) sb?.click();
        if (shroudPicks.length === 0) {
          stopPicking();
        }
        setStatus(ctx!.i18n.t(`(${p.x},${p.y}) 游戏未接受斗篷，已跳过`, `(${p.x},${p.y}) rejected shroud, skipped`));
      }
      return true;
    }
    return false;
  };

  const setStatus = (text: string) => {
    statusText = text;
    if (statusEl && statusEl.textContent !== text) statusEl.textContent = text;
    if (entryBtn && ctx) {
      const nextTitle = `${ctx.i18n.t("迷宫助手", "Labyrinth Helper")}${text ? ` · ${text}` : ""}`;
      if (entryBtn.title !== nextTitle) entryBtn.title = nextTitle;
    }
  };

  const armPendingTimeout = (kind: PendingAction["kind"], c: Coord) => {
    clearPending();
    const key = coordKey(c.x, c.y);
    const deadline = Date.now() + ACTION_TIMEOUT_MS;
    const timerId = window.setTimeout(() => {
      if (destroyed) return;
      const st = getLabState();
      if (settlePending(st)) refreshUi();
    }, ACTION_TIMEOUT_MS + 40);
    pending = { kind, x: c.x, y: c.y, key, deadline, timerId };
  };

  /** Strictly 1 human click -> 1 room queued. */
  const handleQueueNextClick = () => {
    if (!ctx || destroyed || pending) return;
    const labState = getLabState();
    syncFloor(labState);
    if (!labState) {
      setStatus(ctx.i18n.t("未进入迷宫", "No active labyrinth"));
      refreshUi();
      return;
    }

    // Try current recommended head; if the game refuses (skip threshold), mark blocked & replan immediately.
    for (let guard = 0; guard < 12; guard++) {
      const route = getSuggestedRoute(labState);
      if (!route.length) {
        setStatus(
          labState.path.length >= labState.pathCap
            ? ctx.i18n.t("路径已满", "Path full")
            : ctx.i18n.t("无推荐目标房间", "No wanted rooms reachable")
        );
        refreshUi();
        return;
      }
      const next = route[0];
      const res = triggerCellQueue(next.x, next.y);
      if (res === "refused") {
        blocked.add(coordKey(next.x, next.y));
        routeCache.sig = "";
        continue;
      }
      if (res === "missing") {
        setStatus(ctx.i18n.t(`无法点击 (${next.x},${next.y})`, `Room (${next.x},${next.y}) not clickable`));
        refreshUi();
        return;
      }
      armPendingTimeout("queue", next);
      setStatus(ctx.i18n.t(`排队 (${next.x},${next.y})…`, `Queueing (${next.x},${next.y})…`));
      refreshUi();
      return;
    }
    refreshUi();
  };

  const togglePickRoom = (x: number, y: number) => {
    if (!ctx) return;
    const labState = getLabState();
    if (!labState) return;
    const idx = shroudPicks.findIndex((c) => c.x === x && c.y === y);
    if (idx >= 0) {
      shroudPicks.splice(idx, 1);
    } else {
      if (!shroudable(labState.rooms[y]?.[x])) return;
      if (shroudPicks.length >= labState.shroud) {
        setStatus(ctx.i18n.t(`最多选择 ${labState.shroud} 个房间（受斗篷数限制）`, `Max ${labState.shroud} rooms (shroud limit)`));
        refreshUi();
        return;
      }
      shroudPicks.push({ x, y });
    }
    setStatus(
      shroudPicks.length > 0
        ? ctx.i18n.t(`已选 ${shroudPicks.length} 个斗篷目标，点击下方按钮逐个使用`, `${shroudPicks.length} picked; click button to use 1 by 1`)
        : ctx.i18n.t("点击地图房间选择斗篷目标", "Click map rooms to pick shroud targets")
    );
    refreshUi();
  };

  const startPickingShrouds = () => {
    if (!ctx || destroyed) return;
    const labState = getLabState();
    syncFloor(labState);
    if (!labState || labState.shroud <= 0) {
      setStatus(ctx.i18n.t("没有可用斗篷", "No shrouds owned"));
      refreshUi();
      return;
    }
    pickingShrouds = true;
    shroudPicks = [];
    shroudSkipped = 0;
    noShroud.clear();

    stopPickListener?.();
    const swallow = (ev: Event) => {
      if (bypassPickSwallow || !pickingShrouds) return;
      const target = ev.target instanceof Element ? ev.target : null;
      const cell = target?.closest<HTMLElement>(`${GRID_SEL} [data-room-x][data-room-y]`);
      if (!cell) return;
      ev.stopImmediatePropagation();
      ev.preventDefault();
      if (ev.type === "pointerdown") {
        togglePickRoom(Number(cell.dataset.roomX), Number(cell.dataset.roomY));
      }
    };
    const evTypes = ["pointerdown", "mousedown", "click"] as const;
    for (const t of evTypes) window.addEventListener(t, swallow, true);
    stopPickListener = () => {
      for (const t of evTypes) window.removeEventListener(t, swallow, true);
    };

    setStatus(ctx.i18n.t("点击地图房间选择斗篷目标", "Click map rooms to pick shroud targets"));
    refreshUi();
  };

  /** Strictly 1 human click -> 1 shroud used on next picked target. */
  const handleUseNextShroudClick = () => {
    if (!ctx || destroyed || pending) return;
    const labState = getLabState();
    syncFloor(labState);
    if (!labState) return;

    const filtered = filterShroudPicks(shroudPicks, labState.rooms, noShroud);
    shroudPicks = filtered.remaining;
    shroudSkipped += filtered.skippedCount;

    if (shroudPicks.length === 0) {
      setStatus(ctx.i18n.t("没有待使用的斗篷目标", "No shroud targets left"));
      stopPicking();
      refreshUi();
      return;
    }
    if (labState.shroud <= 0) {
      setStatus(ctx.i18n.t("斗篷不足", "Out of shrouds"));
      stopPicking();
      refreshUi();
      return;
    }

    const target = pickNextShroudTarget(shroudPicks, labState.rooms);
    if (!target) return;
    const shroudBtn = findShroudButton();
    if (!shroudBtn || shroudBtn.disabled || !cellOf(target.x, target.y)) {
      setStatus(ctx.i18n.t("未找到原生斗篷按钮或目标房间", "Shroud button or target cell unavailable"));
      refreshUi();
      return;
    }

    armPendingTimeout("shroud", target);
    setStatus(ctx.i18n.t(`使用斗篷 (${target.x},${target.y})…`, `Shrouding (${target.x},${target.y})…`));
    refreshUi();

    const clickTargetCell = () => {
      const cell = cellOf(target.x, target.y);
      if (!cell) return;
      bypassPickSwallow = true;
      try {
        cell.click();
      } finally {
        bypassPickSwallow = false;
      }
    };

    // If shroud is already armed ("X"), click target directly; otherwise arm via native click and wait 1..10 rAFs (~16ms).
    if (isShroudButtonArmed(shroudBtn)) {
      clickTargetCell();
      return;
    }
    shroudBtn.click();
    let frames = 0;
    const waitArmed = () => {
      shroudArmRaf = 0;
      if (destroyed || !pending || pending.kind !== "shroud") return;
      frames++;
      const curBtn = findShroudButton();
      if (isShroudButtonArmed(curBtn) || frames >= 10) {
        clickTargetCell();
        return;
      }
      shroudArmRaf = window.requestAnimationFrame(waitArmed);
    };
    shroudArmRaf = window.requestAnimationFrame(waitArmed);
  };

  const renderPanelContent = () => {
    if (!panelEl || !settings || !ctx) return;
    const { cfg } = settings;
    const renderChecks = (keys: readonly string[], selected: readonly string[], group: "wantSkills" | "wantMonsters") =>
      keys
        .map((k) => {
          const pair = ITEM_LABELS[k];
          const label = pair ? ctx!.i18n.t(pair[0], pair[1]) : k;
          const checked = selected.includes(k) ? " checked" : "";
          return `<label><input type="checkbox" data-group="${group}" value="${k}"${checked}><span>${label}</span></label>`;
        })
        .join("");

    panelEl.innerHTML = `
      <div class="mwi-lh-head">
        <b>${ctx.i18n.t("迷宫推荐路线偏好", "Labyrinth Route Prefs")}</b>
        <button type="button" class="mwi-lh-close" data-act="close" aria-label="Close">×</button>
      </div>
      <div class="mwi-lh-sub">${ctx.i18n.t("要做的生活房", "Wanted Skilling Rooms")}</div>
      <div class="mwi-lh-grid">${renderChecks(SKILL_KEYS, cfg.wantSkills, "wantSkills")}</div>
      <div class="mwi-lh-sub">${ctx.i18n.t("要打的怪物", "Wanted Monsters")}</div>
      <div class="mwi-lh-grid">${renderChecks(MONSTER_KEYS, cfg.wantMonsters, "wantMonsters")}</div>
      <div class="mwi-lh-status"></div>
    `;
    statusEl = panelEl.querySelector<HTMLElement>(".mwi-lh-status");
    if (statusEl) statusEl.textContent = statusText;
  };

  const positionPanel = () => {
    if (!panelEl || !entryBtn || !settings) return;
    const visible = !settings.collapsed && entryBtn.isConnected;
    const display = visible ? "block" : "none";
    if (panelEl.style.display !== display) panelEl.style.display = display;
    if (!visible) return;
    const er = entryBtn.getBoundingClientRect();
    const pr = panelEl.getBoundingClientRect();
    const left = Math.min(Math.max(4, er.left), Math.max(4, window.innerWidth - pr.width - 4));
    let top = er.bottom + 6;
    if (top + pr.height > window.innerHeight - 4) top = er.top - pr.height - 6;
    top = Math.min(Math.max(4, top), Math.max(4, window.innerHeight - pr.height - 4));
    panelEl.style.left = `${Math.round(left)}px`;
    panelEl.style.top = `${Math.round(top)}px`;
  };

  const ensurePanelAndEntry = () => {
    if (!ctx || !settings) return;
    const entryHost =
      document.querySelector<HTMLElement>('[class*="LabyrinthPanel_gridContainer"]') ??
      document.querySelector<HTMLElement>('[class*="LabyrinthPanel_labyrinthTab"]');
    if (!entryHost) {
      entryBtn?.remove();
      if (panelEl) panelEl.style.display = "none";
      return;
    }

    if (!entryBtn) {
      entryBtn = document.createElement("button");
      entryBtn.type = "button";
      entryBtn.className = ENTRY_CLASS;
      entryBtn.setAttribute("data-mwi-lite", "1");
      entryBtn.setAttribute("aria-label", "Labyrinth Route Preferences");
      entryBtn.innerHTML = muninnIconSvg(20);
      entryBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!settings) return;
        settings.collapsed = !settings.collapsed;
        saveSettings();
        positionPanel();
      });
    }
    if (entryBtn.parentElement !== entryHost) {
      entryHost.prepend(entryBtn);
    }

    if (!panelEl) {
      panelEl = document.createElement("div");
      panelEl.id = PANEL_ID;
      panelEl.setAttribute("data-mwi-lite", "1");
      panelEl.style.display = "none";
      panelEl.addEventListener("click", (e) => {
        const t = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-act]") : null;
        if (t?.dataset.act === "close" && settings) {
          settings.collapsed = true;
          saveSettings();
          positionPanel();
        }
      });
      panelEl.addEventListener("change", (e) => {
        const input = e.target instanceof HTMLInputElement ? e.target : null;
        if (!input || !settings) return;
        const group = input.dataset.group as "wantSkills" | "wantMonsters" | undefined;
        if (group !== "wantSkills" && group !== "wantMonsters") return;
        const nextSet = new Set(settings.cfg[group]);
        if (input.checked) nextSet.add(input.value);
        else nextSet.delete(input.value);
        settings.cfg[group] = Array.from(nextSet);
        saveSettings();
        routeCache.sig = "";
        refreshUi();
      });
      document.body.appendChild(panelEl);
      renderPanelContent();
    }
    positionPanel();
  };

  const syncRouteButton = (labState: LabState | null, route: Coord[]) => {
    if (!ctx) return;
    const host = document.querySelector<HTMLElement>('[class*="LabyrinthPanel_buttonsSection"]');
    if (!host || !labState) {
      routeBtn?.remove();
      routeBtn = null;
      return;
    }
    if (!routeBtn) {
      routeBtn = document.createElement("button");
      routeBtn.type = "button";
      routeBtn.className = ROUTE_BTN_CLASS;
      routeBtn.setAttribute("data-mwi-lite", "1");
      routeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleQueueNextClick();
      });
    }
    const buttonsGrid = host.querySelector<HTMLElement>(':scope > [class*="LabyrinthPanel_buttonsGrid"]');
    if (buttonsGrid) {
      if (routeBtn.nextElementSibling !== buttonsGrid) {
        buttonsGrid.before(routeBtn);
      }
    } else if (routeBtn.parentElement !== host) {
      host.appendChild(routeBtn);
    }

    const busy = pending !== null;
    const count = route.length;
    const disabled = busy || count === 0;
    const label = busy && pending?.kind === "queue"
      ? ctx.i18n.t(`排队中… (${count})`, `Queueing… (${count})`)
      : count > 0
        ? ctx.i18n.t(`排入下一个 (${count})`, `Queue Next (${count})`)
        : labState.path.length >= labState.pathCap
          ? ctx.i18n.t("路径已满", "Path Full")
          : ctx.i18n.t("排入推荐路线", "Queue Next");

    const nextRoomDesc = count > 0 ? describeRoom(ctx, labState.rooms[route[0].y]?.[route[0].x], route[0]) : "";
    const title = count > 0
      ? ctx.i18n.t(`点击排入下一格：${nextRoomDesc}（每次点击排 1 格）`, `Click to queue next: ${nextRoomDesc} (1 click = 1 room)`)
      : ctx.i18n.t("当前没有可排入的推荐目标房间", "No reachable wanted rooms to queue");

    if (routeBtn.textContent !== label) routeBtn.textContent = label;
    if (routeBtn.title !== title) routeBtn.title = title;
    if (routeBtn.disabled !== disabled) routeBtn.disabled = disabled;
    const readyFlag = count > 0 && !busy ? "1" : "0";
    if (routeBtn.dataset.ready !== readyFlag) routeBtn.dataset.ready = readyFlag;
  };

  const syncShroudBar = (labState: LabState | null) => {
    if (!ctx) return;
    const supplyHost = document.querySelector<HTMLElement>('[class*="LabyrinthPanel_supplyWithButton"]')?.parentElement ?? null;
    if (!supplyHost || !labState) {
      shroudBar?.remove();
      shroudBar = null;
      lastShroudSig = "";
      return;
    }

    if (pickingShrouds) {
      const filtered = filterShroudPicks(shroudPicks, labState.rooms, noShroud);
      shroudPicks = filtered.remaining;
      if (shroudPicks.length > labState.shroud) {
        shroudPicks = shroudPicks.slice(0, labState.shroud);
      }
    }

    if (!shroudBar) {
      shroudBar = document.createElement("div");
      shroudBar.className = SHROUD_BAR_CLASS;
      shroudBar.setAttribute("data-mwi-lite", "1");
      shroudBar.addEventListener("click", (e) => {
        const btn = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button[data-act]") : null;
        if (!btn || btn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === "pick") startPickingShrouds();
        else if (act === "use-next") handleUseNextShroudClick();
        else if (act === "cancel") {
          const sb = findShroudButton();
          if (isShroudButtonArmed(sb)) sb?.click();
          stopPicking();
          setStatus(ctx!.i18n.t("已取消斗篷选房", "Shroud picking cancelled"));
          refreshUi();
        }
      });
    }
    if (shroudBar.parentElement !== supplyHost || shroudBar.nextElementSibling !== null) {
      supplyHost.appendChild(shroudBar);
    }

    const busy = pending !== null;
    const shroudBusy = pending?.kind === "shroud";
    const picked = shroudPicks.length;
    const nextShroud = pickingShrouds ? pickNextShroudTarget(shroudPicks, labState.rooms) : null;
    const nextHint = nextShroud ? describeRoom(ctx, labState.rooms[nextShroud.y]?.[nextShroud.x], nextShroud) : "";

    const sig = `${pickingShrouds ? 1 : 0}|${picked}|${labState.shroud}|${busy ? 1 : 0}|${shroudBusy ? 1 : 0}|${nextHint}|${ctx.i18n.getLang()}`;
    if (sig === lastShroudSig) return;
    lastShroudSig = sig;

    if (!pickingShrouds) {
      const off = labState.shroud <= 0 || busy ? " disabled" : "";
      shroudBar.innerHTML = `<button type="button" class="mwi-lh-sbtn" data-act="pick"${off}>${ctx.i18n.t("批量使用斗篷", "Batch Shroud")}</button>`;
    } else {
      const useOff = picked === 0 || labState.shroud <= 0 || busy ? " disabled" : "";
      const ready = picked > 0 && labState.shroud > 0 && !busy ? ' data-ready="1"' : "";
      const useLabel = shroudBusy
        ? ctx.i18n.t(`使用中… (${picked})`, `Using… (${picked})`)
        : ctx.i18n.t(`使用下一个 (${picked})`, `Use Next (${picked})`);
      const tip = ctx.i18n.t(`点地图选房 (≤${labState.shroud})`, `Pick rooms (≤${labState.shroud})`);
      const useTitle = nextHint
        ? ctx.i18n.t(`点击对 ${nextHint} 使用 1 个斗篷（1 点击 = 1 个）· ${tip}`, `Click to shroud ${nextHint} (1 click = 1 shroud) · ${tip}`)
        : tip;
      shroudBar.innerHTML =
        `<button type="button" class="mwi-lh-sbtn"${ready} data-act="use-next" title="${escapeHtml(useTitle)}"${useOff}>${escapeHtml(useLabel)}</button>` +
        `<button type="button" class="mwi-lh-sbtn mwi-lh-sbtn-sub" data-act="cancel">${escapeHtml(ctx.i18n.t("取消", "Cancel"))}</button>`;
    }
  };

  const syncMapMarks = (labState: LabState | null, route: Coord[]) => {
    if (!labState || !document.querySelector(GRID_SEL)) {
      clearMapMarks(ATTR_ROUTE_STEP);
      clearMapMarks(ATTR_SHROUD_PICK);
      return;
    }

    // 1. Shroud pick badges (right-top corner, yellow)
    if (pickingShrouds && shroudPicks.length > 0) {
      const wantShroud = new Map<HTMLElement, string>();
      shroudPicks.forEach((c, idx) => {
        const cell = cellOf(c.x, c.y);
        if (cell) wantShroud.set(cell, String(idx + 1));
      });
      document.querySelectorAll<HTMLElement>(`[${ATTR_SHROUD_PICK}]`).forEach((el) => {
        if (!wantShroud.has(el)) el.removeAttribute(ATTR_SHROUD_PICK);
      });
      for (const [el, label] of wantShroud) {
        if (el.getAttribute(ATTR_SHROUD_PICK) !== label) el.setAttribute(ATTR_SHROUD_PICK, label);
      }
      // Hide route badges while picking shrouds to keep map uncluttered
      clearMapMarks(ATTR_ROUTE_STEP);
      return;
    }

    clearMapMarks(ATTR_SHROUD_PICK);

    // 2. Recommended route preview badges (left-top corner, cyan; step 1 highlighted)
    const wantRouteMarks = new Map<HTMLElement, string>();
    route.forEach((c, idx) => {
      const cell = cellOf(c.x, c.y);
      if (cell) wantRouteMarks.set(cell, String(idx + 1));
    });
    document.querySelectorAll<HTMLElement>(`[${ATTR_ROUTE_STEP}]`).forEach((el) => {
      if (!wantRouteMarks.has(el)) el.removeAttribute(ATTR_ROUTE_STEP);
    });
    for (const [el, label] of wantRouteMarks) {
      if (el.getAttribute(ATTR_ROUTE_STEP) !== label) el.setAttribute(ATTR_ROUTE_STEP, label);
    }
  };

  const refreshUi = () => {
    if (!ctx || destroyed) return;
    if (ctx.domScheduler.getActiveRoute() !== "labyrinth") return;
    ensurePanelAndEntry();
    const labState = getLabState();
    syncFloor(labState);
    settlePending(labState);
    const route = getSuggestedRoute(labState);
    syncRouteButton(labState, route);
    syncShroudBar(labState);
    syncMapMarks(labState, route);
  };

  return {
    id: "combat-labyrinth-helper",
    nameZh: "迷宫推荐路线与斗篷助手",
    nameEn: "Labyrinth Route & Shroud Helper",
    descriptionZh: "在迷宫面板提供推荐路线「排入下一个」(1:1 点击)与「批量使用斗篷」(选房后逐个使用)，原位复用且纯只读总线驱动",
    descriptionEn: "1:1 Queue Next for recommended labyrinth routes and 1:1 batch shroud targeting, reusing original Muninn placements",
    category: "combat",
    defaultEnabled: true,
    routes: ["labyrinth"],

    init(context) {
      ctx = context;
      destroyed = false;
      settings = loadSettings(context);

      const unregStyle = context.addStyle(
        "combat-labyrinth-helper-css",
        `
        [class*="LabyrinthPanel_gridContainer"],
        [class*="LabyrinthPanel_labyrinthTab"] {
          position: relative;
        }
        .${ENTRY_CLASS} {
          position: absolute;
          left: 6px;
          top: 6px;
          z-index: 5;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          border-radius: 0;
          border: 1px solid var(--mwi-px-border, #9dbbff);
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%));
          box-shadow: 0 0 0 1px #080d1a, inset 1px 1px 0 #7096ee, inset -1px -1px 0 #152147;
          cursor: pointer;
          user-select: none;
        }
        .${ENTRY_CLASS}:hover {
          background: var(--mwi-px-btn-hover, linear-gradient(180deg, #405eb3 0%, #2b4385 100%));
          border-color: var(--mwi-px-border-bright, #d5e5ff);
        }
        .${ENTRY_CLASS}:active {
          transform: translateY(1px);
        }
        #${PANEL_ID} {
          position: fixed;
          top: 0;
          left: 0;
          z-index: 9500;
          width: 240px;
          padding: 8px;
          box-sizing: border-box;
          font: 12px/1.4 var(--mwi-px-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
          font-variant-numeric: tabular-nums;
          color: var(--mwi-px-text, #e2e8f0);
          background: var(--mwi-px-panel-bg, linear-gradient(180deg, #121c3b 0%, #0c1228 100%));
          border: 2px solid var(--mwi-px-border-bright, #d5e5ff);
          border-radius: 0;
          box-shadow: var(--mwi-px-shadow-panel, 0 0 0 2px #060913, 0 14px 36px rgba(0, 0, 0, 0.72), inset 0 0 0 2px #1c2b59, inset 0 0 0 4px #4f6fc4);
        }
        #${PANEL_ID} * {
          box-sizing: border-box;
        }
        #${PANEL_ID} .mwi-lh-head {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--mwi-px-gold, #fde047);
          padding-bottom: 4px;
          border-bottom: 1px solid var(--mwi-px-border-inner, #4f6fc4);
        }
        #${PANEL_ID} .mwi-lh-head b {
          flex: 1;
          font-size: 12px;
        }
        #${PANEL_ID} .mwi-lh-close {
          border: 1px solid #fca5a5;
          border-radius: 0;
          background: linear-gradient(180deg, #7f1d1d 0%, #581313 100%);
          color: #fee2e2;
          font: 700 12px/1 var(--mwi-px-mono, monospace);
          padding: 2px 6px;
          cursor: pointer;
        }
        #${PANEL_ID} .mwi-lh-sub {
          color: var(--mwi-px-sub, #9dbbff);
          margin-top: 6px;
          font-weight: 700;
        }
        #${PANEL_ID} .mwi-lh-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2px 6px;
          margin: 3px 0 4px;
        }
        #${PANEL_ID} .mwi-lh-grid label {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          cursor: pointer;
        }
        #${PANEL_ID} .mwi-lh-status {
          margin-top: 6px;
          min-height: 16px;
          color: var(--mwi-px-green-soft, #86efac);
          word-break: break-word;
          font-size: 11px;
        }
        .${ROUTE_BTN_CLASS} {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-top: 6px;
          height: 28px;
          padding: 0 12px;
          border-radius: 0;
          border: 1px solid var(--mwi-px-border, #9dbbff);
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%));
          box-shadow: 0 0 0 1px #080d1a, inset 1px 1px 0 #7096ee;
          color: #f8fafc;
          font: 700 12px/1 var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          cursor: pointer;
        }
        .${ROUTE_BTN_CLASS}[data-ready="1"] {
          border-color: var(--mwi-px-green-soft, #86efac);
          background: var(--mwi-px-btn-green, linear-gradient(180deg, #1f6d43 0%, #165132 100%));
          box-shadow: 0 0 0 1px #080d1a, inset 1px 1px 0 #4ade80;
          color: #f0fdf4;
        }
        .${ROUTE_BTN_CLASS}[data-ready="1"]:hover {
          background: var(--mwi-px-btn-green-hover, linear-gradient(180deg, #278452 0%, #1d643e 100%));
        }
        .${ROUTE_BTN_CLASS}:disabled {
          opacity: 0.52;
          cursor: not-allowed;
        }
        [class*="LabyrinthPanel_buttonsSection"]:has(> .${ROUTE_BTN_CLASS}) {
          display: grid !important;
          grid-template-columns: auto auto;
          column-gap: 6px;
          row-gap: 4px;
          align-items: start;
        }
        [class*="LabyrinthPanel_buttonsSection"]:has(> .${ROUTE_BTN_CLASS}) > [class*="LabyrinthPanel_label"] {
          grid-column: 1 / -1;
          justify-self: center;
        }
        [class*="LabyrinthPanel_buttonsSection"]:has(> .${ROUTE_BTN_CLASS}) > .${ROUTE_BTN_CLASS} {
          grid-column: 1;
          grid-row: 2;
          margin-top: 4px;
          width: fit-content;
          justify-self: end;
          height: 30px;
          align-self: start;
        }
        [class*="LabyrinthPanel_buttonsSection"]:has(> .${ROUTE_BTN_CLASS}) > [class*="LabyrinthPanel_buttonsGrid"] {
          grid-column: 2;
          grid-row: 2;
        }
        .${SHROUD_BAR_CLASS} {
          display: inline-flex;
          flex-wrap: nowrap;
          align-items: center;
          align-self: flex-end;
          gap: 4px;
          margin: 0 0 0 6px;
        }
        .${SHROUD_BAR_CLASS} .mwi-lh-sbtn {
          height: 24px;
          padding: 0 8px;
          border-radius: 0;
          border: 1px solid var(--mwi-px-border, #9dbbff);
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%));
          box-shadow: 0 0 0 1px #080d1a;
          color: #f8fafc;
          font: 700 11.5px/1 var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          cursor: pointer;
        }
        .${SHROUD_BAR_CLASS} .mwi-lh-sbtn[data-ready="1"] {
          border-color: var(--mwi-px-gold, #fde047);
          background: var(--mwi-px-btn-gold, linear-gradient(180deg, #7c580c 0%, #523907 100%));
          color: #fef08a;
        }
        .${SHROUD_BAR_CLASS} .mwi-lh-sbtn-sub {
          border-color: #64748b;
          background: linear-gradient(180deg, #27324a 0%, #1a2235 100%);
          color: #cbd5e1;
        }
        .${SHROUD_BAR_CLASS} .mwi-lh-sbtn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        [${ATTR_ROUTE_STEP}] {
          position: relative;
        }
        [${ATTR_ROUTE_STEP}="1"] {
          outline: 2px solid #38bdf8;
          outline-offset: -2px;
        }
        [${ATTR_ROUTE_STEP}]::before {
          content: attr(${ATTR_ROUTE_STEP});
          position: absolute;
          left: 1px;
          bottom: 1px;
          z-index: 4;
          padding: 0 3px;
          font: 700 10px/1.2 var(--mwi-px-mono, monospace);
          color: #e0f2fe;
          background: rgba(14, 116, 144, 0.92);
          border: 1px solid #38bdf8;
          pointer-events: none;
        }
        [${ATTR_ROUTE_STEP}="1"]::before {
          color: #082f49;
          background: #38bdf8;
        }
        [${ATTR_SHROUD_PICK}] {
          position: relative;
          outline: 2px solid var(--mwi-px-gold, #fde047);
          outline-offset: -2px;
        }
        [${ATTR_SHROUD_PICK}]::after {
          content: attr(${ATTR_SHROUD_PICK});
          position: absolute;
          left: 1px;
          bottom: 1px;
          z-index: 5;
          padding: 0 3px;
          font: 700 10.5px/1.2 var(--mwi-px-mono, monospace);
          color: #111827;
          background: var(--mwi-px-gold, #fde047);
          pointer-events: none;
        }
        `
      );

      const onLabUpdate = () => {
        if (destroyed) return;
        const st = getLabState();
        syncFloor(st);
        settlePending(st);
        if (ctx?.domScheduler.getActiveRoute() === "labyrinth") {
          refreshUi();
        }
      };

      const unsubs = [
        context.gameData.on("labyrinth_updated", onLabUpdate),
        context.gameData.on("skills_updated", onLabUpdate),
        context.gameData.on("client_data_ready", onLabUpdate),
        context.gameData.on("character_initialized", onLabUpdate),
        context.domScheduler.onRouteChange((nextRoute: PanelRoute) => {
          if (nextRoute !== "labyrinth") {
            clearPending();
            stopPicking();
            clearMapMarks(ATTR_ROUTE_STEP);
            if (panelEl) panelEl.style.display = "none";
          } else {
            refreshUi();
          }
        }),
      ];

      if (context.domScheduler.getActiveRoute() === "labyrinth") {
        refreshUi();
      }

      return () => {
        destroyed = true;
        clearPending();
        stopPicking();
        clearMapMarks(ATTR_ROUTE_STEP);
        unsubs.forEach((u) => u());
        unregStyle();
        entryBtn?.remove();
        panelEl?.remove();
        routeBtn?.remove();
        shroudBar?.remove();
        entryBtn = null;
        panelEl = null;
        statusEl = null;
        routeBtn = null;
        shroudBar = null;
        lastShroudSig = "";
        blocked.clear();
        noShroud.clear();
        routeCache = { sig: "", route: [] };
        currentFloor = 0;
        ctx = null;
      };
    },

    onDom(_doc, route) {
      if (route !== "labyrinth") return;
      refreshUi();
    },
  };
}
