// Credit: Pure labyrinth route planning (wantRoute & shroud selection) adapted from mwi-muninn (xiahuaaaa).
// Zero DOM, zero WebSocket — strictly pure computation.

export interface Room {
  readonly roomType?: string;
  readonly skillHrid?: string;
  readonly monsterHrid?: string;
  readonly recommendedLevel?: number;
  readonly isCleared?: boolean;
  readonly failCount?: number;
  readonly entryCount?: number;
}

export interface Coord {
  readonly x: number;
  readonly y: number;
}

export interface LabState {
  readonly floor: number;
  /** rooms[y][x]; null = hidden (fog). */
  readonly rooms: readonly (readonly (Room | null)[] | null)[];
  readonly path: readonly Coord[];
  readonly shroud: number;
  readonly pathCap: number;
  readonly maxAttempts: number;
  /** Official automation skip thresholds keyed by snake_case room key (e.g. "alchemy" -> 77). */
  readonly skipThresholds?: Readonly<Record<string, number>>;
  /** Character base skill levels keyed by skillHrid (e.g. "/skills/alchemy" -> 110). */
  readonly skillLevels?: Readonly<Record<string, number>>;
  /** Flat skill level bonuses from equipped labyrinth tea/coffee crates keyed by skillHrid. */
  readonly crateBuffs?: Readonly<Record<string, number>>;
  /** "x,y" keys rejected or timed out when queueing on this floor. */
  readonly blocked?: ReadonlySet<string>;
  /** "x,y" keys where a shroud was tried and rejected on this floor. */
  readonly noShroud?: ReadonlySet<string>;
}

export interface RouteConfig {
  /** Skill keys (e.g. "milking") to always clear. */
  wantSkills: string[];
  /** Monster keys (e.g. "mimic") to always clear. */
  wantMonsters: string[];
  /** Path cost of entering an unwanted skilling / combat / hidden room. */
  costAvoidSkilling: number;
  costAvoidCombat: number;
  costHidden: number;
}

export const SKILL_KEYS = [
  "milking",
  "foraging",
  "woodcutting",
  "cheesesmithing",
  "crafting",
  "tailoring",
  "cooking",
  "brewing",
  "alchemy",
  "enhancing",
] as const;

export const MONSTER_KEYS = [
  "mimic",
  "shadow_archer",
  "pyre_hunter",
  "frost_sniper",
  "siren",
  "salamander",
  "dryad",
  "giant_scorpion",
  "giant_mantis",
  "cyclops",
] as const;

export const DEFAULT_ROUTE_CONFIG: RouteConfig = {
  wantSkills: ["milking", "foraging", "woodcutting", "cooking", "brewing", "alchemy"],
  wantMonsters: ["mimic"],
  costAvoidSkilling: 6,
  costAvoidCombat: 8,
  costHidden: 4,
};

export type RoomClass = "cleared" | "hidden" | "want" | "avoid" | "exit";

const TREASURE = "/labyrinth_room_types/treasure";
const DESCEND = "/labyrinth_room_types/descend";
const SKILLING = "/labyrinth_room_types/skilling";
const COMBAT = "/labyrinth_room_types/combat";
const DIRS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
] as const;

const VALID_SKILL_SET = new Set<string>(SKILL_KEYS);
const VALID_MONSTER_SET = new Set<string>(MONSTER_KEYS);

export const coordKey = (x: number, y: number): string => `${x},${y}`;
const tail = (hrid?: string): string => (hrid ? hrid.slice(hrid.lastIndexOf("/") + 1) : "");

export function parseLabyrinthPath(raw: unknown): Coord[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((c): c is Coord => Number.isInteger(c?.x) && Number.isInteger(c?.y));
  } catch {
    return [];
  }
}

export function normalizeRouteConfig(raw: unknown): RouteConfig {
  const cfg: RouteConfig = {
    wantSkills: [...DEFAULT_ROUTE_CONFIG.wantSkills],
    wantMonsters: [...DEFAULT_ROUTE_CONFIG.wantMonsters],
    costAvoidSkilling: DEFAULT_ROUTE_CONFIG.costAvoidSkilling,
    costAvoidCombat: DEFAULT_ROUTE_CONFIG.costAvoidCombat,
    costHidden: DEFAULT_ROUTE_CONFIG.costHidden,
  };
  if (!raw || typeof raw !== "object") return cfg;
  const src = raw as Record<string, unknown>;
  if (Array.isArray(src.wantSkills)) {
    cfg.wantSkills = Array.from(
      new Set(src.wantSkills.filter((x): x is string => typeof x === "string" && VALID_SKILL_SET.has(x)))
    );
  }
  if (Array.isArray(src.wantMonsters)) {
    cfg.wantMonsters = Array.from(
      new Set(src.wantMonsters.filter((x): x is string => typeof x === "string" && VALID_MONSTER_SET.has(x)))
    );
  }
  if (typeof src.costAvoidSkilling === "number" && Number.isFinite(src.costAvoidSkilling) && src.costAvoidSkilling > 0) {
    cfg.costAvoidSkilling = src.costAvoidSkilling;
  }
  if (typeof src.costAvoidCombat === "number" && Number.isFinite(src.costAvoidCombat) && src.costAvoidCombat > 0) {
    cfg.costAvoidCombat = src.costAvoidCombat;
  }
  if (typeof src.costHidden === "number" && Number.isFinite(src.costHidden) && src.costHidden > 0) {
    cfg.costHidden = src.costHidden;
  }
  return cfg;
}

/** Matches official `isRoomVisible`: revealed iff non-null and either cleared or has a roomType (empty `{}` is fog). */
export function isRoomRevealed(room: Room | null | undefined): room is Room {
  return !!room && (Boolean(room.isCleared) || Boolean(room.roomType));
}

/** The game only accepts a shroud on a revealed, uncleared skilling or combat room. */
export function shroudable(room: Room | null | undefined): boolean {
  return isRoomRevealed(room) && !room.isCleared && (room.roomType === SKILLING || room.roomType === COMBAT);
}

/** Extract flat skill level bonuses from labyrinth tea & coffee crates (matches client `getCrateSkillBuffMap`). */
export function computeCrateSkillBuffs(
  teaCrateHrid: unknown,
  coffeeCrateHrid: unknown,
  crateDetailMap: Record<string, readonly any[]> | null | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!crateDetailMap || typeof crateDetailMap !== "object") return out;
  const applyList = (hrid: unknown) => {
    if (typeof hrid !== "string" || !hrid) return;
    const buffs = crateDetailMap[hrid];
    if (!Array.isArray(buffs)) return;
    for (const b of buffs) {
      const typeHrid: unknown = b?.typeHrid;
      if (typeof typeHrid !== "string" || !typeHrid.startsWith("/buff_types/") || !typeHrid.endsWith("_level")) {
        continue;
      }
      const skillKey = typeHrid.slice("/buff_types/".length, -"_level".length);
      if (!skillKey) continue;
      const skillHrid = `/skills/${skillKey}`;
      out[skillHrid] = (out[skillHrid] || 0) + (Number(b.flatBoost) || 0);
    }
  };
  applyList(teaCrateHrid);
  applyList(coffeeCrateHrid);
  return out;
}

/** Matches MWI client `getCombatLevel` formula exactly. */
export function computeCombatLevel(levels: {
  stamina: number;
  intelligence: number;
  attack: number;
  defense: number;
  melee: number;
  ranged: number;
  magic: number;
}): number {
  const sum =
    levels.stamina +
    levels.intelligence +
    levels.attack +
    levels.defense +
    Math.max(levels.melee, levels.ranged, levels.magic);
  const top = Math.max(levels.attack, levels.defense, levels.melee, levels.ranged, levels.magic);
  return Math.floor(0.1 * sum + 0.5 * top);
}

/** Matches MWI client `getEffectiveLevelForRoom` (base skill level + crate skill level buffs). */
export function getEffectiveLevelForRoom(
  room: Room | null | undefined,
  skillLevels?: Readonly<Record<string, number>>,
  crateBuffs?: Readonly<Record<string, number>>
): number {
  if (!room || !skillLevels) return 0;
  const eff = (hrid: string) => (skillLevels[hrid] || 1) + (crateBuffs?.[hrid] || 0);
  if (room.roomType === SKILLING && room.skillHrid) {
    return eff(room.skillHrid);
  }
  if (room.roomType === COMBAT) {
    return computeCombatLevel({
      stamina: eff("/skills/stamina"),
      intelligence: eff("/skills/intelligence"),
      attack: eff("/skills/attack"),
      defense: eff("/skills/defense"),
      melee: eff("/skills/melee"),
      ranged: eff("/skills/ranged"),
      magic: eff("/skills/magic"),
    });
  }
  return 0;
}

/**
 * Matches MWI client `wouldRoomBeSkipped`:
 * returns true iff `(recommendedLevel - effectiveLevel) >= officialSkipThreshold`.
 */
export function wouldRoomBeSkipped(
  room: Room | null | undefined,
  skipThresholds?: Readonly<Record<string, number>>,
  skillLevels?: Readonly<Record<string, number>>,
  crateBuffs?: Readonly<Record<string, number>>
): boolean {
  if (!room || !skipThresholds || !skillLevels) return false;
  if (room.roomType !== SKILLING && room.roomType !== COMBAT) return false;
  const roomKey = room.roomType === SKILLING ? tail(room.skillHrid) : tail(room.monsterHrid);
  if (!roomKey) return false;
  const threshold = skipThresholds[roomKey];
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) return false;
  const effectiveLevel = getEffectiveLevelForRoom(room, skillLevels, crateBuffs);
  return (room.recommendedLevel || 0) - effectiveLevel >= threshold;
}

export function classifyRoom(room: Room | null | undefined, cfg: RouteConfig): RoomClass {
  if (!isRoomRevealed(room)) return "hidden";
  if (room.isCleared) return "cleared";
  if (room.roomType === DESCEND) return "exit";
  if (room.roomType === TREASURE) return "want";
  if (room.roomType === SKILLING) return cfg.wantSkills.includes(tail(room.skillHrid)) ? "want" : "avoid";
  if (room.roomType === COMBAT) return cfg.wantMonsters.includes(tail(room.monsterHrid)) ? "want" : "avoid";
  return "avoid";
}

interface Grid {
  n: number;
  cls: RoomClass[][];
  /** Cleared rooms connected to the start, plus rooms already queued (assumed cleared). */
  base: Set<string>;
  blocked: (x: number, y: number) => boolean;
  cost: (x: number, y: number) => number;
}

function buildGrid(s: LabState, cfg: RouteConfig): Grid {
  const n = s.rooms.length;
  const at = (x: number, y: number) => s.rooms[y]?.[x] ?? null;
  const cls = s.rooms.map((row) => Array.from({ length: n }, (_, x) => classifyRoom(row?.[x], cfg)));
  const queued = new Set(s.path.map((c) => coordKey(c.x, c.y)));
  const passable = (x: number, y: number) => cls[y][x] === "cleared" || queued.has(coordKey(x, y));
  const base = new Set<string>();
  if (n > 0) {
    const stack: Coord[] = [{ x: 0, y: 0 }];
    base.add(coordKey(0, 0));
    while (stack.length) {
      const c = stack.pop()!;
      for (const [dx, dy] of DIRS) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || y < 0 || x >= n || y >= n || base.has(coordKey(x, y)) || !passable(x, y)) continue;
        base.add(coordKey(x, y));
        stack.push({ x, y });
      }
    }
  }
  const blocked = (x: number, y: number) => {
    if (s.blocked?.has(coordKey(x, y))) return true;
    const r = at(x, y);
    // Unrevealed fog rooms are strictly impassable: never queue blind fog cells or route through fog to beacon islands.
    if (!isRoomRevealed(r)) return true;
    if (r.isCleared || r.roomType === TREASURE || r.roomType === DESCEND) return false;
    if ((r.failCount || 0) >= s.maxAttempts) return true;
    return wouldRoomBeSkipped(r, s.skipThresholds, s.skillLevels, s.crateBuffs);
  };
  const cost = (x: number, y: number) => {
    const c = cls[y][x];
    if (c === "cleared") return 0;
    if (c === "hidden") return cfg.costHidden;
    if (c === "avoid") return at(x, y)?.roomType === SKILLING ? cfg.costAvoidSkilling : cfg.costAvoidCombat;
    return 1;
  };
  return { n, cls, base, blocked, cost };
}

interface Route {
  cost: number;
  steps: Coord[];
}

/**
 * Dijkstra from the base set to every cell over integer cell ids (y * n + x).
 * Grid is at most 8x8 (64 cells), so linear scan over discovered nodes is faster than a heap.
 */
function computeRoutes(g: Grid): Map<string, Route> {
  const n = g.n;
  const cells = n * n;
  const dist = new Float64Array(cells).fill(Infinity);
  const prev = new Int16Array(cells).fill(-1);
  const done = new Uint8Array(cells);
  const inBase = new Uint8Array(cells);
  const order: number[] = [];
  for (const k of g.base) {
    const i = k.indexOf(",");
    const id = +k.slice(i + 1) * n + +k.slice(0, i);
    inBase[id] = 1;
    dist[id] = 0;
    order.push(id);
  }
  for (;;) {
    let cur = -1;
    let best = Infinity;
    for (const id of order) {
      if (!done[id] && dist[id] < best) {
        best = dist[id];
        cur = id;
      }
    }
    if (cur < 0) break;
    done[cur] = 1;
    const cx = cur % n;
    const cy = (cur - cx) / n;
    // The exit ends the floor, so never route through it.
    if (g.cls[cy][cx] === "exit") continue;
    for (const [dx, dy] of DIRS) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const id = y * n + x;
      if (done[id] || g.blocked(x, y)) continue;
      const d = best + (inBase[id] ? 0 : g.cost(x, y));
      if (d < dist[id]) {
        if (dist[id] === Infinity) order.push(id);
        dist[id] = d;
        prev[id] = cur;
      }
    }
  }
  const out = new Map<string, Route>();
  for (const id of order) {
    if (inBase[id]) continue;
    const steps: Coord[] = [];
    for (let c = id; c >= 0 && !inBase[c]; c = prev[c]) {
      steps.unshift({ x: c % n, y: (c - (c % n)) / n });
    }
    out.set(coordKey(id % n, (id - (id % n)) / n), { cost: dist[id], steps });
  }
  return out;
}

function nextWantSteps(s: LabState, cfg: RouteConfig): Coord[] | null {
  const g = buildGrid(s, cfg);
  if (g.n === 0) return null;
  for (const c of s.path) {
    if (g.cls[c.y]?.[c.x] === "exit") return null;
  }
  const remaining = s.pathCap - s.path.length;
  if (remaining <= 0) return null;

  const queued = new Set(s.path.map((c) => coordKey(c.x, c.y)));
  const rt = computeRoutes(g);
  let best: Route | null = null;
  let bestCost = Infinity;
  for (const [k, r] of rt) {
    if (queued.has(k)) continue;
    const sep = k.indexOf(",");
    const x = +k.slice(0, sep);
    const y = +k.slice(sep + 1);
    if (g.cls[y][x] !== "want") continue;
    if (r.cost < bestCost) {
      bestCost = r.cost;
      best = r;
    }
  }
  if (!best) return null;

  const steps: Coord[] = [];
  for (const c of best.steps) {
    if (g.cls[c.y][c.x] === "hidden") break;
    steps.push(c);
    if (steps.length >= remaining) break;
  }
  return steps.length > 0 ? steps : null;
}

/**
 * Recommended queue route: every reachable wanted room (plus required pass-through rooms),
 * in valid queue order up to `pathCap`. Never includes the exit, beacons, or shrouds.
 */
export function wantRoute(s: LabState, cfg: RouteConfig): Coord[] {
  const out: Coord[] = [];
  while (s.path.length + out.length < s.pathCap) {
    const steps = nextWantSteps({ ...s, path: [...s.path, ...out] }, cfg);
    if (!steps || steps.length === 0) break;
    out.push(...steps);
  }
  return out;
}

/**
 * Filter pending shroud picks against latest room state and pick the next target:
 * prefers a room adjacent to an already-cleared room so earlier picks unlock later ones.
 */
export function filterShroudPicks(
  picks: readonly Coord[],
  rooms: readonly (readonly (Room | null)[] | null)[],
  noShroud?: ReadonlySet<string>
): { remaining: Coord[]; skippedCount: number } {
  const remaining: Coord[] = [];
  let skippedCount = 0;
  for (const c of picks) {
    const room = rooms[c.y]?.[c.x];
    if (!shroudable(room)) continue;
    if (noShroud?.has(coordKey(c.x, c.y))) {
      skippedCount++;
      continue;
    }
    remaining.push(c);
  }
  return { remaining, skippedCount };
}

export function pickNextShroudTarget(
  picks: readonly Coord[],
  rooms: readonly (readonly (Room | null)[] | null)[]
): Coord | null {
  if (!picks.length) return null;
  const isCleared = (x: number, y: number) => !!rooms[y]?.[x]?.isCleared;
  return (
    picks.find((r) => DIRS.some(([dx, dy]) => isCleared(r.x + dx, r.y + dy))) ??
    picks[0]
  );
}
