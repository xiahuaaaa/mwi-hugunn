// Credit: Task lock/highlight workflow inspired by Toolasha & Ranged Way Idle.
import type { FeatureModule, KernelContext } from "../../core/types";
import {
  advanceCardLockPhase,
  buildLockCatalog,
  classifyTaskCardButton,
  countActiveRules,
  DEFAULT_LOCK_CONFIG,
  enterConfirmPhase,
  evaluateQuestLock,
  extractTaskTokenReward,
  normalizeLockConfig,
  type CardLockPhase,
  type GuardedActionKind,
  type LockCatalog,
  type LockCatalogSkill,
  type LockMatchReason,
  type TaskQuestSnapshot,
  type TaskRerollLockConfig,
} from "./task-reroll-lock-engine";

export const TASK_REROLL_LOCK_MODULE_ID = "planner-task-reroll-lock";

const STORAGE_PREFIX = "task_reroll_lock_v1_";
const SLOT_COUNT_SEL = '[class*="TasksPanel_taskSlotCount"]';
const TASK_LIST_SEL = '[class*="TasksPanel_taskList"]';
const TASK_CARD_SEL = '[class*="RandomTask_randomTask"]';
const TASK_ACTION_SEL = '[class*="RandomTask_action"]';
const TASK_NAME_SEL = '[class*="RandomTask_name"]';
const TASK_REWARDS_SEL = '[class*="RandomTask_rewards"]';
const FREEZE_OVERLAY_ID = "mwi-lite-task-freeze-overlay";

const HEADER_BAR_CLASS = "mwi-lite-reroll-lock-bar";
const HEADER_BTN_CLASS = "mwi-lite-reroll-lock-btn";
const CARD_BADGE_CLASS = "mwi-lite-reroll-lock-badge";
const CARD_BANNER_CLASS = "mwi-lite-reroll-lock-banner";
const MODAL_ID = "mwi-lite-reroll-lock-modal";

const COOLDOWN_MS = 3000;
const CONFIRM_MS = 3000;
const TICK_MS = 250;
const BACK_BTN_RE = /^(返回|Back)$/i;

type ModalTab = "selected" | "skills" | "zones" | "targets";

interface CardRuntimeState {
  questKey: string;
  phase: CardLockPhase;
  timerId: number | null;
}

const FALLBACK_SKILL_ZH: Readonly<Record<string, string>> = {
  "/action_types/milking": "挤奶",
  "/action_types/foraging": "采摘",
  "/action_types/woodcutting": "伐木",
  "/action_types/cheesesmithing": "奶酪锻造",
  "/action_types/crafting": "制作",
  "/action_types/tailoring": "缝纫",
  "/action_types/cooking": "烹饪",
  "/action_types/brewing": "冲泡",
  "/action_types/alchemy": "炼金",
  "/action_types/enhancing": "强化",
  "/action_types/combat": "战斗",
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function findRealGameElement<T extends Element = HTMLElement>(doc: Document, selector: string): T | null {
  const els = doc.querySelectorAll<T>(selector);
  for (const el of els) {
    if (!el.closest(`#${FREEZE_OVERLAY_ID}`) && !el.closest("[data-mwi-lite]")) {
      return el;
    }
  }
  return null;
}

function isQuestObject(val: unknown): val is TaskQuestSnapshot {
  if (!val || typeof val !== "object") return false;
  const q = val as Record<string, unknown>;
  return (
    typeof q.actionHrid === "string" ||
    typeof q.monsterHrid === "string" ||
    typeof q.category === "string"
  );
}

function readQuestFromFiberNode(el: Element | null): TaskQuestSnapshot | null {
  if (!el) return null;
  const fiberKey = Reflect.ownKeys(el).find(
    (k) => typeof k === "string" && (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
  );
  if (!fiberKey) return null;
  let fiber: any = (el as any)[fiberKey];
  for (let depth = 0; fiber && depth < 16; depth++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (isQuestObject(props?.characterQuest)) return props.characterQuest;
    if (isQuestObject(fiber.stateNode?.props?.characterQuest)) {
      return fiber.stateNode.props.characterQuest;
    }
  }
  return null;
}

function readQuestFromCardFiber(card: Element): TaskQuestSnapshot | null {
  const candidates: Array<Element | null> = [
    card,
    card.firstElementChild,
    card.querySelector(TASK_NAME_SEL),
    card.querySelector("button"),
  ];
  const visited = new Set<Element>();
  for (const el of candidates) {
    if (!el || visited.has(el)) continue;
    visited.add(el);
    const quest = readQuestFromFiberNode(el);
    if (quest) return quest;
  }
  return null;
}

function readDomCardTokenCount(card: Element): number | null {
  const rewards = card.querySelector(TASK_REWARDS_SEL);
  if (!rewards) return null;

  const uses = rewards.querySelectorAll("use");
  for (const u of uses) {
    const href = u.getAttribute("href") || u.getAttribute("xlink:href") || "";
    if (!href.includes("task_token")) continue;

    const closestContainer = u.closest('[class*="Item_itemContainer"]');
    const closestItem = u.closest('[class*="Item_item"]');
    let container: Element | null =
      closestContainer && closestContainer !== rewards && rewards.contains(closestContainer)
        ? closestContainer
        : closestItem && closestItem !== rewards && rewards.contains(closestItem)
          ? closestItem
          : null;
    if (!container) {
      let cur: Element | null = u.parentElement;
      while (cur && cur.parentElement && cur.parentElement !== rewards) {
        cur = cur.parentElement;
      }
      container = cur && cur.parentElement === rewards ? cur : null;
    }
    if (!container) continue;

    const countEl = container.querySelector('[class*="Item_count"]');
    const rawText = (countEl?.textContent || "").trim() || container.textContent || "";
    const m = rawText.replace(/,/g, "").match(/(\d+)/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }

  return null;
}

function readCleanTaskNameText(nameEl: Element): string {
  let raw = "";
  for (const node of nameEl.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      raw += node.nodeValue || "";
    } else if (node instanceof Element && !node.hasAttribute("data-mwi-lite")) {
      raw += node.textContent || "";
    }
  }
  return (raw || nameEl.textContent || "").trim();
}

export function createTaskRerollLockModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let destroyed = false;
  let abortController: AbortController | null = null;
  let unregStyle: (() => void) | null = null;
  let unsubs: Array<() => void> = [];
  let pendingSyncTimer: number | null = null;
  let pendingSyncDueAt = 0;

  let config: TaskRerollLockConfig = DEFAULT_LOCK_CONFIG;
  let loadedCharScope: string | null = null;

  let cachedClientRef: any = null;
  let cachedCatalog: LockCatalog | null = null;

  let modalEl: HTMLDivElement | null = null;
  let modalOpen = false;
  let modalTab: ModalTab = "skills";
  let modalQuery = "";
  let lastRenderedTab: ModalTab | null = null;
  let lastRenderedQuery = "";

  const cardStates = new Map<HTMLElement, CardRuntimeState>();

  const resolveCharacterId = (): string | null => {
    const raw = ctx?.gameData.getCharacterId();
    if (raw === null || raw === undefined) return null;
    const str = String(raw).trim();
    return str.length > 0 ? str : null;
  };

  const getCatalog = (): LockCatalog => {
    const clientData = ctx?.gameData.getClientData() ?? null;
    if (!cachedCatalog || cachedClientRef !== clientData) {
      cachedClientRef = clientData;
      cachedCatalog = buildLockCatalog(clientData);
    }
    return cachedCatalog;
  };

  const getLocalizedSkillName = (skill: LockCatalogSkill): string => {
    if (!ctx) return skill.name;
    const translated =
      ctx.i18n.getName(skill.actionTypeHrid, "actionTypeNames") ||
      ctx.i18n.getName(skill.skillHrid, "skillNames");
    if (translated) return translated;
    if (ctx.i18n.isZh() && FALLBACK_SKILL_ZH[skill.actionTypeHrid]) {
      return FALLBACK_SKILL_ZH[skill.actionTypeHrid];
    }
    return skill.name || ctx.i18n.getSkillName(skill.skillHrid) || skill.actionTypeHrid;
  };

  const getLocalizedActionName = (actionHrid: string, fallbackName = ""): string => {
    if (!ctx) return fallbackName || actionHrid;
    const translated = ctx.i18n.getName(actionHrid, "actionNames");
    if (translated) return translated;
    return fallbackName || ctx.i18n.getActionName(actionHrid) || actionHrid;
  };

  const getLocalizedMonsterName = (monsterHrid: string, fallbackName = ""): string => {
    if (!ctx) return fallbackName || monsterHrid;
    const translated = ctx.i18n.getName(monsterHrid, "monsterNames");
    if (translated) return translated;
    if (fallbackName) return fallbackName;
    const clientData = ctx.gameData.getClientData();
    const detail =
      clientData?.combatMonsterDetailMap?.[monsterHrid] ||
      clientData?.monsterDetailMap?.[monsterHrid];
    if (typeof detail?.name === "string" && detail.name.trim()) return detail.name.trim();
    return ctx.i18n.getMonsterName(monsterHrid) || monsterHrid;
  };

  const clearCardState = (card: HTMLElement) => {
    const state = cardStates.get(card);
    if (state) {
      if (state.timerId !== null) window.clearTimeout(state.timerId);
      cardStates.delete(card);
    }
    card.querySelector(`.${CARD_BANNER_CLASS}`)?.remove();
  };

  const clearAllCardStates = () => {
    for (const [card, state] of cardStates.entries()) {
      if (state.timerId !== null) window.clearTimeout(state.timerId);
      card.querySelector(`.${CARD_BANNER_CLASS}`)?.remove();
    }
    cardStates.clear();
  };

  const syncCharacterConfig = (): boolean => {
    if (!ctx) return false;
    const charId = resolveCharacterId();
    if (charId === null) {
      if (loadedCharScope !== null) return false;
      return false;
    }
    if (loadedCharScope === charId) return false;

    loadedCharScope = charId;
    clearAllCardStates();
    const raw = ctx.storage.get<unknown>(`${STORAGE_PREFIX}${charId}`, null);
    config = normalizeLockConfig(raw);
    return true;
  };

  const saveConfig = (next: TaskRerollLockConfig, opts?: { skipListRender?: boolean }) => {
    config = normalizeLockConfig(next);
    if (!ctx) return;
    const charId = resolveCharacterId();
    if (charId !== null) {
      loadedCharScope = charId;
      ctx.storage.set(`${STORAGE_PREFIX}${charId}`, config);
    }
    syncHeaderButton();
    syncCards();
    if (modalOpen) renderModalContent(Boolean(opts?.skipListRender));
  };

  const readQuestFromCard = (card: Element): TaskQuestSnapshot | null => {
    const fromFiber = readQuestFromCardFiber(card);
    if (fromFiber) return fromFiber;
    if (!ctx) return null;

    const nameEl = card.querySelector(TASK_NAME_SEL);
    if (!nameEl) return null;
    const fullText = readCleanTaskNameText(nameEl);
    const match = fullText.match(/^(.+?)\s*-\s*(.+)$/);
    if (!match) return null;

    const skillPrefix = match[1].trim();
    const targetRaw = match[2].trim();
    const isCombat = skillPrefix === "Defeat" || skillPrefix === "击败";
    const targetClean = isCombat ? targetRaw.replace(/Z\d+$/i, "").trim().toLowerCase() : targetRaw.toLowerCase();
    const domTokens = readDomCardTokenCount(card);
    const clientData = ctx.gameData.getClientData();
    const quests = ctx.gameData.getCharacterQuests();

    const candidates: TaskQuestSnapshot[] = [];
    for (const q of quests) {
      if (!q || typeof q !== "object") continue;
      if (isCombat) {
        if (!q.monsterHrid) continue;
        const localized = getLocalizedMonsterName(q.monsterHrid).trim().toLowerCase();
        const rawName = (
          clientData?.combatMonsterDetailMap?.[q.monsterHrid]?.name ||
          clientData?.monsterDetailMap?.[q.monsterHrid]?.name ||
          ""
        )
          .trim()
          .toLowerCase();
        if (localized === targetClean || rawName === targetClean) {
          candidates.push(q);
        }
      } else {
        if (!q.actionHrid) continue;
        const localized = getLocalizedActionName(q.actionHrid).trim().toLowerCase();
        const rawName = (clientData?.actionDetailMap?.[q.actionHrid]?.name || "").trim().toLowerCase();
        if (localized === targetClean || rawName === targetClean) {
          candidates.push(q);
        }
      }
    }

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const active = candidates.filter(
      (q) => q.status !== "/quest_status/completed" && q.status !== "/quest_status/claimed"
    );
    const pool = active.length > 0 ? active : candidates;
    if (domTokens !== null) {
      const tokenMatched = pool.find((q) => extractTaskTokenReward(q) === domTokens);
      if (tokenMatched) return tokenMatched;
    }
    return pool[0];
  };

  const formatReasonLabels = (reasons: readonly LockMatchReason[], tokenCount: number): string => {
    if (!ctx) return "";
    const labels: string[] = [];
    for (const reason of reasons) {
      if (reason === "skill") labels.push(ctx.i18n.t("技能", "Skill"));
      else if (reason === "zone") labels.push(ctx.i18n.t("区域", "Zone"));
      else if (reason === "target") labels.push(ctx.i18n.t("目标", "Target"));
      else if (reason === "tokens") {
        labels.push(ctx.i18n.t(`代币 ${tokenCount}`, `Tokens ${tokenCount}`));
      }
    }
    return labels.join(" + ");
  };

  const renderCardBanner = (card: HTMLElement, phase: CardLockPhase, nowMs: number) => {
    if (!ctx || phase.stage === "armed") {
      card.querySelector(`.${CARD_BANNER_CLASS}`)?.remove();
      return;
    }

    let banner = card.querySelector<HTMLDivElement>(`.${CARD_BANNER_CLASS}`);
    if (!banner) {
      banner = document.createElement("div");
      banner.className = CARD_BANNER_CLASS;
      banner.setAttribute("data-mwi-lite", "1");
      card.appendChild(banner);
    }

    const actionZh = phase.kind === "discard" ? "放弃" : "重置";
    const actionEn = phase.kind === "discard" ? "discard" : "reroll";

    if (phase.stage === "cooldown") {
      const sec = Math.max(1, Math.ceil((phase.unlockAt - nowMs) / 1000));
      banner.dataset.stage = "cooldown";
      banner.textContent = ctx.i18n.t(
        `已锁定 · ${actionZh}冷却 ${sec}s`,
        `Locked · ${actionEn} cooldown ${sec}s`
      );
      return;
    }

    const sec = Math.max(1, Math.ceil((phase.expiresAt - nowMs) / 1000));
    banner.dataset.stage = "confirm";
    banner.textContent = ctx.i18n.t(
      `${sec}s 内再次点击确认${actionZh}`,
      `Click again within ${sec}s to confirm ${actionEn}`
    );
  };

  const scheduleCardTick = (card: HTMLElement) => {
    const state = cardStates.get(card);
    if (!state) return;
    if (state.timerId !== null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    const tick = () => {
      if (destroyed || !card.isConnected) {
        clearCardState(card);
        return;
      }
      const cur = cardStates.get(card);
      if (!cur) return;
      cur.timerId = null;

      const now = Date.now();
      if (cur.phase.stage === "cooldown" && now >= cur.phase.unlockAt) {
        cur.phase = enterConfirmPhase(cur.phase, now, CONFIRM_MS);
      }

      if (cur.phase.stage === "confirm" && now > cur.phase.expiresAt) {
        clearCardState(card);
        return;
      }

      renderCardBanner(card, cur.phase, now);
      cur.timerId = window.setTimeout(tick, TICK_MS);
    };

    state.timerId = window.setTimeout(tick, TICK_MS);
  };

  const syncHeaderButton = () => {
    if (!ctx) return;
    const slotCount = findRealGameElement(document, SLOT_COUNT_SEL);
    if (!slotCount) return;

    let bar = slotCount.querySelector<HTMLSpanElement>(`.${HEADER_BAR_CLASS}`);
    let btn = bar?.querySelector<HTMLButtonElement>(`.${HEADER_BTN_CLASS}`) || null;
    if (!bar) {
      bar = document.createElement("span");
      bar.className = HEADER_BAR_CLASS;
      bar.setAttribute("data-mwi-lite", "1");

      btn = document.createElement("button");
      btn.type = "button";
      btn.className = `Button_button__1Fe9z Button_small__3fqC7 ${HEADER_BTN_CLASS}`;
      btn.setAttribute("data-mwi-lite", "1");
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openModal();
      });

      bar.appendChild(btn);
      slotCount.appendChild(bar);
    }

    if (!btn) return;
    const ruleCount = countActiveRules(config);
    const label =
      ruleCount > 0
        ? ctx.i18n.t(`刷新锁 (${ruleCount})`, `Reroll Lock (${ruleCount})`)
        : ctx.i18n.t("刷新锁", "Reroll Lock");
    const active = ruleCount > 0 ? "1" : "0";
    const title = ctx.i18n.t(
      "配置目标任务刷新锁（按角色独立保存）",
      "Configure Task Reroll Lock rules (saved per character)"
    );

    if (btn.textContent !== label) btn.textContent = label;
    if (btn.dataset.active !== active) btn.dataset.active = active;
    if (btn.title !== title) btn.title = title;
  };

  const syncCards = () => {
    if (!ctx) return;
    const taskList = findRealGameElement(document, TASK_LIST_SEL);
    if (!taskList) return;

    const catalog = getCatalog();
    const lang = ctx.i18n.getLang();
    const cards = Array.from(taskList.children).filter((el): el is HTMLElement =>
      el.matches(TASK_CARD_SEL)
    );

    const activeCards = new Set<HTMLElement>(cards);
    for (const card of Array.from(cardStates.keys())) {
      if (!activeCards.has(card) || !card.isConnected) {
        clearCardState(card);
      }
    }

    for (const card of cards) {
      const quest = readQuestFromCard(card);
      const result = evaluateQuestLock(quest, config, catalog);
      const questKey = String(quest?.id ?? result.hrid);

      const state = cardStates.get(card);
      if (state && (!result.matched || state.questKey !== questKey)) {
        clearCardState(card);
      }

      const sig = result.matched
        ? `1|${lang}|${result.reasons.join(",")}|${result.tokenCount}|${result.hrid}`
        : "0";
      const existingBadge = card.querySelector<HTMLSpanElement>(`.${CARD_BADGE_CLASS}`);
      const hasLockAttr = card.getAttribute("data-mwi-reroll-lock") === "1";

      if (
        card.dataset.mwiLockSig === sig &&
        hasLockAttr === result.matched &&
        Boolean(existingBadge) === result.matched
      ) {
        continue;
      }

      card.dataset.mwiLockSig = sig;
      if (!result.matched) {
        card.removeAttribute("data-mwi-reroll-lock");
        existingBadge?.remove();
        continue;
      }

      card.setAttribute("data-mwi-reroll-lock", "1");
      const reasonText = formatReasonLabels(result.reasons, result.tokenCount);
      const badgeText = ctx.i18n.t("已锁定", "LOCKED");
      const badgeTitle = ctx.i18n.t(
        `任务刷新锁已命中：${reasonText}`,
        `Task Reroll Lock matched: ${reasonText}`
      );

      let badge = existingBadge;
      if (!badge) {
        badge = document.createElement("span");
        badge.className = CARD_BADGE_CLASS;
        badge.setAttribute("data-mwi-lite", "1");
        const nameEl = card.querySelector(TASK_NAME_SEL);
        if (nameEl?.parentElement) {
          nameEl.insertAdjacentElement("afterend", badge);
        } else {
          const actionHost = card.querySelector(TASK_ACTION_SEL);
          (actionHost || card).appendChild(badge);
        }
      }
      if (badge.textContent !== badgeText) badge.textContent = badgeText;
      if (badge.title !== badgeTitle) badge.title = badgeTitle;
    }
  };

  const syncAll = () => {
    if (!ctx || destroyed) return;
    syncCharacterConfig();
    syncHeaderButton();
    syncCards();
  };

  const scheduleSync = (delayMs = 60) => {
    if (destroyed) return;
    const dueAt = Date.now() + delayMs;
    if (pendingSyncTimer !== null) {
      if (dueAt >= pendingSyncDueAt) return;
      window.clearTimeout(pendingSyncTimer);
      pendingSyncTimer = null;
    }
    pendingSyncDueAt = dueAt;
    pendingSyncTimer = window.setTimeout(() => {
      pendingSyncTimer = null;
      pendingSyncDueAt = 0;
      if (ctx?.domScheduler.getActiveRoute() === "tasks" || findRealGameElement(document, TASK_LIST_SEL)) {
        syncAll();
      }
    }, delayMs);
  };

  const handleDocumentClickCapture = (ev: MouseEvent) => {
    if (!ctx || destroyed) return;
    const target = ev.target instanceof Element ? ev.target : null;
    const btn = target?.closest("button");
    if (!btn) return;
    if (btn.closest(`#${FREEZE_OVERLAY_ID}`) || btn.closest("[data-mwi-lite]")) return;

    const card = btn.closest<HTMLElement>(TASK_CARD_SEL);
    if (!card) return;

    const text = (btn.textContent || "").trim();
    if (BACK_BTN_RE.test(text)) {
      clearCardState(card);
      return;
    }

    const kind: GuardedActionKind | null = classifyTaskCardButton({
      isLiteNode: btn.hasAttribute("data-mwi-lite") || Boolean(btn.closest("[data-mwi-lite]")),
      disabled: btn.disabled || btn.className.includes("Button_disabled"),
      className: typeof btn.className === "string" ? btn.className : "",
      text,
      inRerollOptions: Boolean(btn.closest('[class*="rerollOptionsContainer"]')),
      inDiscardContainer: Boolean(btn.closest('[class*="discardButtonContainer"]')),
      inButtonsContainer: Boolean(btn.closest('[class*="buttonsContainer"]')),
    });
    if (!kind) return;

    syncCharacterConfig();
    const quest = readQuestFromCard(card);
    const match = evaluateQuestLock(quest, config, getCatalog());
    if (!match.matched) {
      clearCardState(card);
      return;
    }

    const questKey = String(quest?.id ?? match.hrid);
    const existing = cardStates.get(card);
    let currentPhase: CardLockPhase = { stage: "armed" };
    if (existing) {
      if (existing.questKey === questKey) {
        currentPhase = existing.phase;
      } else {
        clearCardState(card);
      }
    }

    const now = Date.now();
    const outcome = advanceCardLockPhase(currentPhase, kind, now, COOLDOWN_MS, CONFIRM_MS);
    if (outcome.allow) {
      clearCardState(card);
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    const state = cardStates.get(card);
    if (state) {
      state.questKey = questKey;
      state.phase = outcome.nextPhase;
    } else {
      cardStates.set(card, {
        questKey,
        phase: outcome.nextPhase,
        timerId: null,
      });
    }

    card.setAttribute("data-mwi-reroll-lock", "1");
    renderCardBanner(card, outcome.nextPhase, now);
    scheduleCardTick(card);
    scheduleSync(0);
  };

  const toggleRule = (bucket: "actionTypes" | "zoneHrids" | "targetHrids", value: string) => {
    const cur = config[bucket];
    const nextList = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    saveConfig({ ...config, [bucket]: nextList });
  };

  const matchesSearch = (queryLower: string, parts: string[]): boolean => {
    if (!queryLower) return true;
    for (const part of parts) {
      if (part.toLowerCase().includes(queryLower)) return true;
    }
    return false;
  };

  const renderModalBodyList = (listEl: HTMLElement) => {
    if (!ctx) return;
    const catalog = getCatalog();
    const q = modalQuery.trim().toLowerCase();
    const prevScrollTop = listEl.scrollTop;
    const preserveScroll = modalTab === lastRenderedTab && q === lastRenderedQuery;

    const skillByType = new Map(catalog.skills.map((s) => [s.actionTypeHrid, s]));
    const zoneByHrid = new Map(catalog.zones.map((z) => [z.actionHrid, z]));
    const targetByHrid = new Map(catalog.targets.map((t) => [t.hrid, t]));

    const renderSkillsHtml = (withHeading: boolean): string => {
      const items = catalog.skills
        .map((skill) => ({
          skill,
          label: getLocalizedSkillName(skill),
          selected: config.actionTypes.includes(skill.actionTypeHrid),
        }))
        .filter((it) => matchesSearch(q, [it.label, it.skill.name, it.skill.actionTypeHrid]));

      if (items.length === 0) return "";
      const grid = `
        <div class="mwi-rl-grid">
          ${items
            .map(
              (it) =>
                `<button type="button" class="mwi-rl-chip" data-selected="${it.selected ? "1" : "0"}" data-bucket="actionTypes" data-value="${escapeHtml(it.skill.actionTypeHrid)}" title="${escapeHtml(it.skill.actionTypeHrid)}"><span>${escapeHtml(it.label)}</span>${it.selected ? '<span class="mwi-rl-chip-check">✓</span>' : ""}</button>`
            )
            .join("")}
        </div>
      `;
      if (!withHeading) return grid;
      return `
        <div class="mwi-rl-section">
          <div class="mwi-rl-section-title">${escapeHtml(ctx!.i18n.t("技能", "Skills"))} (${items.length})</div>
          ${grid}
        </div>
      `;
    };

    const renderZonesHtml = (): string => {
      const filtered = catalog.zones
        .map((zone) => {
          const label = getLocalizedActionName(zone.actionHrid, zone.name);
          const monsterNames = zone.monsterHrids.map((m) => getLocalizedMonsterName(m));
          const tooltip =
            monsterNames.length > 0
              ? `${label}: ${monsterNames.join(", ")}`
              : `${label} (${zone.actionHrid})`;
          const selected = config.zoneHrids.includes(zone.actionHrid);
          return { zone, label, monsterNames, tooltip, selected };
        })
        .filter((it) =>
          matchesSearch(q, [it.label, it.zone.name, it.zone.actionHrid, ...it.monsterNames])
        );

      if (filtered.length === 0) return "";
      const combatZones = filtered.filter((it) => !it.zone.isDungeon);
      const dungeons = filtered.filter((it) => it.zone.isDungeon);

      const renderZoneGroup = (title: string, group: typeof filtered): string => {
        if (group.length === 0) return "";
        return `
          <div class="mwi-rl-section">
            <div class="mwi-rl-section-title">${escapeHtml(title)} (${group.length})</div>
            <div class="mwi-rl-grid mwi-rl-grid-wide">
              ${group
                .map((it) => {
                  const countText = ctx!.i18n.t(
                    `${it.zone.monsterHrids.length}怪`,
                    `${it.zone.monsterHrids.length}m`
                  );
                  return `<button type="button" class="mwi-rl-chip" data-selected="${it.selected ? "1" : "0"}" data-bucket="zoneHrids" data-value="${escapeHtml(it.zone.actionHrid)}" title="${escapeHtml(it.tooltip)}"><span>${escapeHtml(it.label)}</span><span class="mwi-rl-chip-meta">${escapeHtml(countText)}</span></button>`;
                })
                .join("")}
            </div>
          </div>
        `;
      };

      return (
        renderZoneGroup(ctx!.i18n.t("战斗区域", "Combat Zones"), combatZones) +
        renderZoneGroup(ctx!.i18n.t("地下城", "Dungeons"), dungeons)
      );
    };

    const renderTargetsHtml = (): string => {
      const filteredTargets = catalog.targets
        .map((target) => {
          const label =
            target.kind === "monster"
              ? getLocalizedMonsterName(target.hrid, target.name)
              : getLocalizedActionName(target.hrid, target.name);
          const skill = skillByType.get(target.actionTypeHrid);
          const badge = skill
            ? getLocalizedSkillName(skill)
            : target.kind === "monster"
              ? ctx!.i18n.t("战斗", "Combat")
              : target.actionTypeHrid;
          const selected = config.targetHrids.includes(target.hrid);
          return { target, label, badge, selected };
        })
        .filter((it) => matchesSearch(q, [it.label, it.target.name, it.target.hrid, it.badge]));

      if (filteredTargets.length === 0) return "";

      const grouped = new Map<string, typeof filteredTargets>();
      for (const item of filteredTargets) {
        const key = item.target.actionTypeHrid || "other";
        let arr = grouped.get(key);
        if (!arr) {
          arr = [];
          grouped.set(key, arr);
        }
        arr.push(item);
      }

      const sectionsHtml: string[] = [];
      for (const [actionTypeHrid, items] of grouped.entries()) {
        const skill = skillByType.get(actionTypeHrid);
        const title = skill ? getLocalizedSkillName(skill) : actionTypeHrid;
        sectionsHtml.push(`
          <div class="mwi-rl-section">
            <div class="mwi-rl-section-title">${escapeHtml(title)} (${items.length})</div>
            <div class="mwi-rl-grid mwi-rl-grid-wide">
              ${items
                .map(
                  (it) =>
                    `<button type="button" class="mwi-rl-chip" data-selected="${it.selected ? "1" : "0"}" data-bucket="targetHrids" data-value="${escapeHtml(it.target.hrid)}" title="${escapeHtml(it.target.hrid)}"><span>${escapeHtml(it.label)}</span><span class="mwi-rl-chip-meta">${escapeHtml(it.badge)}</span></button>`
                )
                .join("")}
            </div>
          </div>
        `);
      }
      return sectionsHtml.join("");
    };

    let html = "";
    if (modalTab === "selected") {
      const sections: string[] = [];

      const selSkills = config.actionTypes
        .map((hrid) => {
          const skill = skillByType.get(hrid);
          const label = skill ? getLocalizedSkillName(skill) : hrid;
          return { hrid, label, rawName: skill?.name || "" };
        })
        .filter((it) => matchesSearch(q, [it.label, it.rawName, it.hrid]));

      if (selSkills.length > 0) {
        sections.push(`
          <div class="mwi-rl-section">
            <div class="mwi-rl-section-title">${escapeHtml(ctx.i18n.t("已选技能类型", "Selected Skills"))} (${selSkills.length})</div>
            <div class="mwi-rl-grid">
              ${selSkills
                .map(
                  (it) =>
                    `<button type="button" class="mwi-rl-chip" data-selected="1" data-bucket="actionTypes" data-value="${escapeHtml(it.hrid)}" title="${escapeHtml(it.hrid)}"><span>${escapeHtml(it.label)}</span><span class="mwi-rl-chip-x">×</span></button>`
                )
                .join("")}
            </div>
          </div>
        `);
      }

      const selZones = config.zoneHrids
        .map((hrid) => {
          const zone = zoneByHrid.get(hrid);
          const label = getLocalizedActionName(hrid, zone?.name || "");
          return { hrid, label, rawName: zone?.name || "", isDungeon: Boolean(zone?.isDungeon) };
        })
        .filter((it) => matchesSearch(q, [it.label, it.rawName, it.hrid]));

      if (selZones.length > 0) {
        sections.push(`
          <div class="mwi-rl-section">
            <div class="mwi-rl-section-title">${escapeHtml(ctx.i18n.t("已选区域 / 地下城", "Selected Zones / Dungeons"))} (${selZones.length})</div>
            <div class="mwi-rl-grid">
              ${selZones
                .map(
                  (it) =>
                    `<button type="button" class="mwi-rl-chip" data-selected="1" data-bucket="zoneHrids" data-value="${escapeHtml(it.hrid)}" title="${escapeHtml(it.hrid)}"><span>${escapeHtml(it.label)}</span><span class="mwi-rl-chip-meta">${escapeHtml(it.isDungeon ? ctx!.i18n.t("副本", "Dgn") : ctx!.i18n.t("区域", "Zone"))}</span></button>`
                )
                .join("")}
            </div>
          </div>
        `);
      }

      const selTargets = config.targetHrids
        .map((hrid) => {
          const target = targetByHrid.get(hrid);
          const isMonster = target ? target.kind === "monster" : hrid.startsWith("/monsters/");
          const label = isMonster
            ? getLocalizedMonsterName(hrid, target?.name || "")
            : getLocalizedActionName(hrid, target?.name || "");
          const skill = target ? skillByType.get(target.actionTypeHrid) : undefined;
          const badge = skill ? getLocalizedSkillName(skill) : isMonster ? ctx!.i18n.t("怪物", "Monster") : "";
          return { hrid, label, rawName: target?.name || "", badge };
        })
        .filter((it) => matchesSearch(q, [it.label, it.rawName, it.hrid, it.badge]));

      if (selTargets.length > 0) {
        sections.push(`
          <div class="mwi-rl-section">
            <div class="mwi-rl-section-title">${escapeHtml(ctx.i18n.t("已选动作 / 怪物", "Selected Actions / Monsters"))} (${selTargets.length})</div>
            <div class="mwi-rl-grid mwi-rl-grid-wide">
              ${selTargets
                .map(
                  (it) =>
                    `<button type="button" class="mwi-rl-chip" data-selected="1" data-bucket="targetHrids" data-value="${escapeHtml(it.hrid)}" title="${escapeHtml(it.hrid)}"><span>${escapeHtml(it.label)}</span><span class="mwi-rl-chip-meta">${escapeHtml(it.badge)}</span></button>`
                )
                .join("")}
            </div>
          </div>
        `);
      }

      if (sections.length === 0) {
        const emptyMsg = config.minTaskTokens
          ? ctx.i18n.t(
              `未选择具体目标；当前仅按代币 ≥ ${config.minTaskTokens} 锁定任务。`,
              `No target rules selected. Currently locking tasks with ≥ ${config.minTaskTokens} tokens.`
            )
          : ctx.i18n.t(
              "暂未选择保护规则，请在「技能」「区域 / 地下城」或「动作 / 怪物」中点选，或在上方设置最低代币阈值。",
              "No lock rules yet. Pick skills, zones/dungeons, actions/monsters, or set a minimum token threshold above."
            );
        html = `<div class="mwi-rl-empty">${escapeHtml(emptyMsg)}</div>`;
      } else {
        html = sections.join("");
      }
    } else if (q.length > 0) {
      const combined = [
        renderSkillsHtml(true),
        renderZonesHtml(),
        renderTargetsHtml(),
      ].filter(Boolean);
      html =
        combined.length > 0
          ? combined.join("")
          : `<div class="mwi-rl-empty">${escapeHtml(ctx.i18n.t("无匹配技能、区域或动作/怪物", "No matching skills, zones, or actions/monsters"))}</div>`;
    } else if (modalTab === "skills") {
      html =
        renderSkillsHtml(false) ||
        `<div class="mwi-rl-empty">${escapeHtml(ctx.i18n.t("无匹配技能", "No matching skills"))}</div>`;
    } else if (modalTab === "zones") {
      html =
        renderZonesHtml() ||
        `<div class="mwi-rl-empty">${escapeHtml(ctx.i18n.t("无匹配区域或地下城", "No matching zones or dungeons"))}</div>`;
    } else {
      html =
        renderTargetsHtml() ||
        `<div class="mwi-rl-empty">${escapeHtml(ctx.i18n.t("无匹配动作或怪物", "No matching actions or monsters"))}</div>`;
    }

    listEl.innerHTML = html;
    listEl.scrollTop = preserveScroll ? prevScrollTop : 0;
    lastRenderedTab = modalTab;
    lastRenderedQuery = q;
  };

  const renderModalContent = (skipListRender = false) => {
    if (!ctx || !modalEl) return;
    const ruleCount = countActiveRules(config);
    const charId = resolveCharacterId();
    const charName = ctx.gameData.getCharacterName();
    const scopeLabel =
      charId === null
        ? ctx.i18n.t("未识别角色（初始化后自动保存）", "Character pending (saves after init)")
        : charName
          ? `${charName} (#${charId})`
          : `#${charId}`;

    const statusEl = modalEl.querySelector<HTMLElement>(".mwi-rl-status");
    if (statusEl) {
      const countTxt =
        ruleCount > 0
          ? ctx.i18n.t(`已启用 ${ruleCount} 条规则`, `${ruleCount} active rules`)
          : ctx.i18n.t("未启用规则", "No active rules");
      statusEl.textContent = `${ctx.i18n.t("角色", "Char")}: ${scopeLabel} · ${countTxt}`;
    }

    const clearBtn = modalEl.querySelector<HTMLButtonElement>(".mwi-rl-clear-btn");
    if (clearBtn) {
      clearBtn.disabled = ruleCount === 0;
    }

    const tokenInput = modalEl.querySelector<HTMLInputElement>(".mwi-rl-token-input");
    if (tokenInput && document.activeElement !== tokenInput) {
      tokenInput.value = config.minTaskTokens ? String(config.minTaskTokens) : "";
    }

    const modeWrap = modalEl.querySelector<HTMLElement>(".mwi-rl-token-mode-wrap");
    if (modeWrap) {
      const hasTargetRules =
        config.actionTypes.length > 0 || config.zoneHrids.length > 0 || config.targetHrids.length > 0;
      const nLabel = config.minTaskTokens ? String(config.minTaskTokens) : "N";
      if (hasTargetRules) {
        modeWrap.innerHTML = `
          <button type="button" class="mwi-rl-mode-btn" data-mode="require" data-active="${config.tokenMode === "require" ? "1" : "0"}">${escapeHtml(ctx.i18n.t(`命中目标且代币 ≥ ${nLabel}`, `Target + ≥ ${nLabel} tokens`))}</button>
          <button type="button" class="mwi-rl-mode-btn" data-mode="any" data-active="${config.tokenMode === "any" ? "1" : "0"}">${escapeHtml(ctx.i18n.t(`命中目标或代币 ≥ ${nLabel}`, `Target or ≥ ${nLabel} tokens`))}</button>
        `;
      } else {
        const infoText = config.minTaskTokens
          ? ctx.i18n.t(
              `仅按代币 ≥ ${config.minTaskTokens} 锁定任意任务`,
              `Lock any task with ≥ ${config.minTaskTokens} tokens`
            )
          : ctx.i18n.t(
              "未设目标时，设置正整数即可按代币数单独锁定",
              "Set a positive number to lock by token count alone"
            );
        modeWrap.innerHTML = `<span class="mwi-rl-token-hint">${escapeHtml(infoText)}</span>`;
      }
    }

    const selectedTargetCount =
      config.actionTypes.length + config.zoneHrids.length + config.targetHrids.length;
    const catalog = getCatalog();
    const tabLabels: Record<ModalTab, string> = {
      selected: ctx.i18n.t(`已选 (${selectedTargetCount})`, `Selected (${selectedTargetCount})`),
      skills: ctx.i18n.t(`技能 (${catalog.skills.length})`, `Skills (${catalog.skills.length})`),
      zones: ctx.i18n.t(`区域 / 地下城 (${catalog.zones.length})`, `Zones / Dungeons (${catalog.zones.length})`),
      targets: ctx.i18n.t(`动作 / 怪物 (${catalog.targets.length})`, `Actions / Monsters (${catalog.targets.length})`),
    };
    modalEl.querySelectorAll<HTMLButtonElement>(".mwi-rl-tab").forEach((tabBtn) => {
      const tab = tabBtn.dataset.tab as ModalTab | undefined;
      if (!tab) return;
      tabBtn.dataset.active = tab === modalTab ? "1" : "0";
      tabBtn.textContent = tabLabels[tab];
    });

    if (!skipListRender) {
      const listEl = modalEl.querySelector<HTMLElement>(".mwi-rl-list");
      if (listEl) renderModalBodyList(listEl);
    }
  };

  const ensureModal = (): HTMLDivElement => {
    const lang = ctx!.i18n.getLang();
    if (modalEl && modalEl.isConnected && modalEl.dataset.lang === lang) return modalEl;
    modalEl?.remove();
    modalEl = null;
    lastRenderedTab = null;
    lastRenderedQuery = "";
    document.getElementById(MODAL_ID)?.remove();

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.dataset.lang = lang;
    modal.setAttribute("data-mwi-lite", "1");
    modal.innerHTML = `
      <div class="mwi-rl-card" role="dialog" aria-modal="true">
        <div class="mwi-rl-header">
          <div>
            <div class="mwi-rl-title">${escapeHtml(ctx!.i18n.t("目标任务刷新锁", "Task Reroll Lock"))}</div>
            <div class="mwi-rl-status"></div>
          </div>
          <div class="mwi-rl-head-actions">
            <button type="button" class="mwi-rl-clear-btn">${escapeHtml(ctx!.i18n.t("清空全部", "Clear All"))}</button>
            <button type="button" class="mwi-rl-close-btn">${escapeHtml(ctx!.i18n.t("关闭", "Close"))}</button>
          </div>
        </div>
        <div class="mwi-rl-controls">
          <div class="mwi-rl-token-row">
            <label class="mwi-rl-token-label">
              <span>${escapeHtml(ctx!.i18n.t("最低任务代币", "Min Task Tokens"))}</span>
              <input type="number" min="0" step="1" class="mwi-rl-token-input" placeholder="${escapeHtml(ctx!.i18n.t("不限", "Off"))}" />
            </label>
            <div class="mwi-rl-token-mode-wrap"></div>
          </div>
          <div class="mwi-rl-search-row">
            <input type="search" class="mwi-rl-search" placeholder="${escapeHtml(ctx!.i18n.t("搜索技能、区域、动作、怪物或 HRID...", "Search skills, zones, actions, monsters, or HRID..."))}" />
          </div>
          <div class="mwi-rl-tabs">
            <button type="button" class="mwi-rl-tab" data-tab="selected"></button>
            <button type="button" class="mwi-rl-tab" data-tab="skills"></button>
            <button type="button" class="mwi-rl-tab" data-tab="zones"></button>
            <button type="button" class="mwi-rl-tab" data-tab="targets"></button>
          </div>
        </div>
        <div class="mwi-rl-list"></div>
        <div class="mwi-rl-footer">${escapeHtml(
          ctx!.i18n.t(
            "命中活跃任务将绿框高亮；点击重置或放弃确认时，先冷却 3 秒再开启 3 秒确认窗口。",
            "Matched active tasks glow green; reroll or discard confirms trigger a 3s cooldown before a 3s confirmation window."
          )
        )}</div>
      </div>
    `;

    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) {
        closeModal();
        return;
      }
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;

      if (target.closest(".mwi-rl-close-btn")) {
        closeModal();
        return;
      }
      if (target.closest(".mwi-rl-clear-btn")) {
        saveConfig(DEFAULT_LOCK_CONFIG);
        return;
      }

      const tabBtn = target.closest<HTMLButtonElement>(".mwi-rl-tab");
      if (tabBtn?.dataset.tab) {
        modalTab = tabBtn.dataset.tab as ModalTab;
        renderModalContent();
        return;
      }

      const modeBtn = target.closest<HTMLButtonElement>(".mwi-rl-mode-btn");
      if (modeBtn?.dataset.mode === "require" || modeBtn?.dataset.mode === "any") {
        saveConfig(
          { ...config, tokenMode: modeBtn.dataset.mode },
          { skipListRender: modalTab !== "selected" }
        );
        return;
      }

      const chip = target.closest<HTMLButtonElement>(".mwi-rl-chip");
      if (chip) {
        const bucket = chip.dataset.bucket;
        const value = chip.dataset.value;
        if (
          value &&
          (bucket === "actionTypes" || bucket === "zoneHrids" || bucket === "targetHrids")
        ) {
          toggleRule(bucket, value);
        }
      }
    });

    const tokenInput = modal.querySelector<HTMLInputElement>(".mwi-rl-token-input");
    tokenInput?.addEventListener("input", () => {
      const raw = tokenInput.value.trim();
      const parsed = raw ? Number(raw) : NaN;
      const minTaskTokens =
        Number.isFinite(parsed) && Math.floor(parsed) >= 1 ? Math.floor(parsed) : null;
      saveConfig({ ...config, minTaskTokens }, { skipListRender: modalTab !== "selected" });
    });

    const searchInput = modal.querySelector<HTMLInputElement>(".mwi-rl-search");
    searchInput?.addEventListener("input", () => {
      modalQuery = searchInput.value;
      const listEl = modal.querySelector<HTMLElement>(".mwi-rl-list");
      if (listEl) renderModalBodyList(listEl);
    });

    document.body.appendChild(modal);
    modalEl = modal;
    return modal;
  };

  const openModal = () => {
    if (!ctx || destroyed) return;
    syncCharacterConfig();
    modalQuery = "";
    lastRenderedTab = null;
    lastRenderedQuery = "";
    modalTab =
      config.actionTypes.length + config.zoneHrids.length + config.targetHrids.length > 0
        ? "selected"
        : "skills";
    const modal = ensureModal();
    const searchInput = modal.querySelector<HTMLInputElement>(".mwi-rl-search");
    if (searchInput) searchInput.value = "";
    modalOpen = true;
    modal.classList.add("open");
    renderModalContent();
  };

  const closeModal = () => {
    modalOpen = false;
    modalEl?.classList.remove("open");
  };

  return {
    id: TASK_REROLL_LOCK_MODULE_ID,
    nameZh: "目标任务刷新锁",
    nameEn: "Task Reroll Lock",
    descriptionZh:
      "按技能、区域/地下城、具体动作/怪物与代币阈值高亮锁定目标任务，3 秒防连点冷却 + 3 秒确认窗口拦截误点重置与放弃（按角色独立保存）",
    descriptionEn:
      "Highlight matching tasks by skill, zone/dungeon, action/monster, or token threshold and guard reroll/discard confirms with a 3s cooldown + 3s confirm window (per character)",
    category: "planner",
    defaultEnabled: true,
    routes: ["tasks"],

    init(context) {
      ctx = context;
      destroyed = false;
      loadedCharScope = null;
      config = DEFAULT_LOCK_CONFIG;
      cachedClientRef = null;
      cachedCatalog = null;
      abortController = new AbortController();

      syncCharacterConfig();

      unregStyle = context.addStyle(
        "planner-task-reroll-lock",
        `
        .${HEADER_BAR_CLASS} {
          display: inline-flex;
          align-items: center;
          margin-left: 6px;
          vertical-align: middle;
        }
        .${HEADER_BTN_CLASS} {
          padding: 2px 8px !important;
          font-size: 11.5px !important;
          font-weight: 700 !important;
          font-family: var(--mwi-px-mono, monospace) !important;
          font-variant-numeric: tabular-nums !important;
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%)) !important;
          color: #f8fafc !important;
          border: 1px solid var(--mwi-px-border, #9dbbff) !important;
          border-radius: 0 !important;
          box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a) !important;
          cursor: pointer;
          white-space: nowrap;
        }
        .${HEADER_BTN_CLASS}:hover {
          background: var(--mwi-px-btn-hover, linear-gradient(180deg, #405eb3 0%, #2b4385 100%)) !important;
        }
        .${HEADER_BTN_CLASS}[data-active="1"] {
          border-color: var(--mwi-px-green-soft, #86efac) !important;
          background: var(--mwi-px-btn-green, linear-gradient(180deg, #1f6d43 0%, #165132 100%)) !important;
          color: #dcfce7 !important;
        }
        ${TASK_CARD_SEL}[data-mwi-reroll-lock="1"] {
          position: relative !important;
          outline: 2px solid var(--mwi-px-green, #4ade80) !important;
          outline-offset: -2px !important;
          box-shadow: 0 0 0 2px #070b16, 0 0 12px rgba(74, 222, 128, 0.28) !important;
        }
        .${CARD_BADGE_CLASS} {
          display: inline-flex;
          align-items: center;
          padding: 1px 6px;
          margin-left: 6px;
          border-radius: 0;
          background: linear-gradient(180deg, #1f6d43 0%, #124228 100%);
          border: 1px solid var(--mwi-px-green-soft, #86efac);
          box-shadow: 0 0 0 1px #070b16;
          color: #dcfce7;
          font-size: 10.5px;
          font-weight: 800;
          font-family: var(--mwi-px-mono, monospace);
          line-height: 1.3;
          white-space: nowrap;
          pointer-events: none;
          user-select: none;
        }
        .${CARD_BANNER_CLASS} {
          margin-top: 6px;
          padding: 4px 8px;
          border-radius: 0;
          font-size: 11.5px;
          font-weight: 800;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          text-align: center;
          border: 1px solid var(--mwi-px-green-soft, #86efac);
          background: linear-gradient(180deg, #14532d 0%, #0b2f1a 100%);
          color: #dcfce7;
          box-shadow: 0 0 0 1px #070b16;
          pointer-events: none;
        }
        .${CARD_BANNER_CLASS}[data-stage="confirm"] {
          border-color: var(--mwi-px-gold, #fde047);
          background: linear-gradient(180deg, #7c580c 0%, #4d3506 100%);
          color: #fef08a;
        }
        #${MODAL_ID} {
          position: fixed;
          inset: 0;
          z-index: 9910;
          background: rgba(5, 8, 18, 0.78);
          display: none;
          align-items: center;
          justify-content: center;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        }
        #${MODAL_ID}.open {
          display: flex;
        }
        #${MODAL_ID} .mwi-rl-card {
          width: min(720px, 94vw);
          max-height: 84vh;
          display: flex;
          flex-direction: column;
          background: var(--mwi-px-panel-bg, linear-gradient(180deg, #121c3b 0%, #0c1228 100%));
          color: var(--mwi-px-text, #e2e8f0);
          border: 2px solid var(--mwi-px-border-bright, #d5e5ff);
          border-radius: 0;
          box-shadow: var(--mwi-px-shadow-panel, 0 0 0 2px #060913);
          overflow: hidden;
        }
        #${MODAL_ID} .mwi-rl-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 16px;
          border-bottom: 2px solid var(--mwi-px-border-inner, #4f6fc4);
          background: var(--mwi-px-head-bg, linear-gradient(180deg, #1d2c5e 0%, #141f46 100%));
        }
        #${MODAL_ID} .mwi-rl-title {
          font-size: 15px;
          font-weight: 800;
          color: #ffffff;
          text-shadow: 2px 2px 0 #070b16;
        }
        #${MODAL_ID} .mwi-rl-status {
          font-size: 11.5px;
          color: var(--mwi-px-sub, #9dbbff);
          margin-top: 2px;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
        }
        #${MODAL_ID} .mwi-rl-head-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        #${MODAL_ID} .mwi-rl-clear-btn {
          padding: 3px 9px;
          border-radius: 0;
          border: 1px solid var(--mwi-px-border, #9dbbff);
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%));
          box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a);
          color: #f8fafc;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
        }
        #${MODAL_ID} .mwi-rl-clear-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        #${MODAL_ID} .mwi-rl-close-btn {
          background: linear-gradient(180deg, #7f1d1d 0%, #581313 100%);
          border: 1px solid #fca5a5;
          box-shadow: 0 0 0 1px #080d1a, inset 1px 1px 0 #f87171;
          color: #ffffff;
          border-radius: 0;
          padding: 3px 9px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 700;
        }
        #${MODAL_ID} .mwi-rl-controls {
          padding: 10px 16px 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-bottom: 1px solid var(--mwi-px-border-inner, #4f6fc4);
          background: #0d1530;
        }
        #${MODAL_ID} .mwi-rl-token-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px;
          padding: 7px 10px;
          background: var(--mwi-px-card-bg, linear-gradient(180deg, #17244d 0%, #0e1634 100%));
          border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
        }
        #${MODAL_ID} .mwi-rl-token-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 700;
          color: var(--mwi-px-gold, #fde047);
        }
        #${MODAL_ID} .mwi-rl-token-input {
          width: 82px;
          padding: 3px 6px;
          border-radius: 0;
          border: 1px solid var(--mwi-px-border, #9dbbff);
          background: #070d1f;
          color: #f8fafc;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 12px;
        }
        #${MODAL_ID} .mwi-rl-token-mode-wrap {
          display: inline-flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }
        #${MODAL_ID} .mwi-rl-mode-btn {
          padding: 3px 8px;
          border-radius: 0;
          border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
          background: #142047;
          color: var(--mwi-px-sub, #9dbbff);
          font-size: 11px;
          font-weight: 700;
          font-family: var(--mwi-px-mono, monospace);
          cursor: pointer;
        }
        #${MODAL_ID} .mwi-rl-mode-btn[data-active="1"] {
          border-color: var(--mwi-px-gold, #fde047);
          background: var(--mwi-px-btn-gold, linear-gradient(180deg, #7c580c 0%, #523907 100%));
          color: #fef08a;
        }
        #${MODAL_ID} .mwi-rl-token-hint {
          font-size: 11px;
          color: var(--mwi-px-muted, #7f95cc);
        }
        #${MODAL_ID} .mwi-rl-search {
          width: 100%;
          box-sizing: border-box;
          padding: 6px 10px;
          border-radius: 0;
          border: 1px solid var(--mwi-px-border, #9dbbff);
          background: #070d1f;
          color: #f8fafc;
          font-size: 12.5px;
        }
        #${MODAL_ID} .mwi-rl-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding-bottom: 8px;
        }
        #${MODAL_ID} .mwi-rl-tab {
          padding: 4px 10px;
          border-radius: 0;
          border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
          background: #132046;
          color: var(--mwi-px-sub, #9dbbff);
          font-size: 11.5px;
          font-weight: 700;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          cursor: pointer;
        }
        #${MODAL_ID} .mwi-rl-tab[data-active="1"] {
          border-color: var(--mwi-px-border-bright, #d5e5ff);
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%));
          color: #ffffff;
          box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a);
        }
        #${MODAL_ID} .mwi-rl-list {
          padding: 12px 16px;
          overflow-y: auto;
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        #${MODAL_ID} .mwi-rl-section-title {
          font-size: 11.5px;
          font-weight: 800;
          color: var(--mwi-px-gold, #fde047);
          margin-bottom: 6px;
          text-shadow: 1px 1px 0 #070b16;
        }
        #${MODAL_ID} .mwi-rl-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(126px, 1fr));
          gap: 6px;
        }
        #${MODAL_ID} .mwi-rl-grid-wide {
          grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
        }
        #${MODAL_ID} .mwi-rl-chip {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding: 5px 8px;
          border-radius: 0;
          border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
          background: var(--mwi-px-card-bg, linear-gradient(180deg, #17244d 0%, #0e1634 100%));
          box-shadow: 0 0 0 1px #070b16;
          color: #e2e8f0;
          font-size: 12px;
          font-weight: 600;
          text-align: left;
          cursor: pointer;
        }
        #${MODAL_ID} .mwi-rl-chip:hover {
          border-color: var(--mwi-px-border, #9dbbff);
        }
        #${MODAL_ID} .mwi-rl-chip[data-selected="1"] {
          border-color: var(--mwi-px-green-soft, #86efac);
          background: var(--mwi-px-btn-green, linear-gradient(180deg, #1f6d43 0%, #165132 100%));
          color: #dcfce7;
        }
        #${MODAL_ID} .mwi-rl-chip-meta {
          font-size: 10.5px;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          color: var(--mwi-px-sub, #9dbbff);
          flex-shrink: 0;
        }
        #${MODAL_ID} .mwi-rl-chip[data-selected="1"] .mwi-rl-chip-meta,
        #${MODAL_ID} .mwi-rl-chip-check,
        #${MODAL_ID} .mwi-rl-chip-x {
          color: #bbf7d0;
          font-weight: 800;
          flex-shrink: 0;
        }
        #${MODAL_ID} .mwi-rl-empty {
          padding: 20px 12px;
          text-align: center;
          font-size: 12px;
          color: var(--mwi-px-muted, #7f95cc);
          border: 1px dashed var(--mwi-px-border-inner, #4f6fc4);
          background: #091024;
        }
        #${MODAL_ID} .mwi-rl-footer {
          padding: 8px 16px;
          border-top: 1px solid var(--mwi-px-border-inner, #4f6fc4);
          background: #091024;
          font-size: 11px;
          color: var(--mwi-px-muted, #7f95cc);
        }
        `
      );

      const { signal } = abortController;
      document.addEventListener("click", handleDocumentClickCapture, { capture: true, signal });
      document.addEventListener(
        "keydown",
        (ev) => {
          if (ev.key === "Escape" && modalOpen) {
            closeModal();
          }
        },
        { signal }
      );

      unsubs = [
        context.gameData.on("character_initialized", () => {
          syncCharacterConfig();
          clearAllCardStates();
          if (modalOpen) renderModalContent();
          scheduleSync(40);
        }),
        context.gameData.on("quests_updated", () => {
          scheduleSync(40);
        }),
        context.gameData.on("client_data_ready", () => {
          cachedCatalog = null;
          if (modalOpen) renderModalContent();
          scheduleSync(40);
        }),
        context.domScheduler.onRouteChange((nextRoute) => {
          if (nextRoute !== "tasks") {
            clearAllCardStates();
            closeModal();
          } else {
            syncAll();
          }
        }),
      ];

      return () => {
        destroyed = true;
        if (pendingSyncTimer !== null) {
          window.clearTimeout(pendingSyncTimer);
          pendingSyncTimer = null;
        }
        pendingSyncDueAt = 0;
        lastRenderedTab = null;
        lastRenderedQuery = "";
        clearAllCardStates();
        abortController?.abort();
        abortController = null;
        unsubs.forEach((u) => u());
        unsubs = [];
        unregStyle?.();
        unregStyle = null;
        closeModal();
        modalEl?.remove();
        modalEl = null;
        document
          .querySelectorAll(`.${HEADER_BAR_CLASS}, .${CARD_BADGE_CLASS}, .${CARD_BANNER_CLASS}`)
          .forEach((el) => el.remove());
        document.querySelectorAll<HTMLElement>(TASK_CARD_SEL).forEach((card) => {
          card.removeAttribute("data-mwi-reroll-lock");
          delete card.dataset.mwiLockSig;
        });
        cachedClientRef = null;
        cachedCatalog = null;
        loadedCharScope = null;
        ctx = null;
      };
    },

    onDom() {
      syncAll();
    },
  };
}
