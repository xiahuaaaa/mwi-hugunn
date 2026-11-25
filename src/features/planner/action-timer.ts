import type { FeatureModule, KernelContext } from "../../core/types";
import { estimateActionTiming, type ActionTimingEstimate } from "./action-time-math";
import { computeMaterialLimit, type MaterialLimitResult } from "./material-limit";

const HEADER_TIMER_ID = "mwi-lite-action-timer";
const QUEUE_TAG_CLASS = "mwi-lite-queue-time-tag";

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0s";
  const s = Math.ceil(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(rem).padStart(2, "0")}s`;
  return `${rem}s`;
}

function formatFinishClock(secFromNow: number): string {
  if (!Number.isFinite(secFromNow) || secFromNow <= 0) return "";
  const end = new Date(Date.now() + secFromNow * 1000);
  const hh = String(end.getHours()).padStart(2, "0");
  const mm = String(end.getMinutes()).padStart(2, "0");
  const now = new Date();
  if (end.getDate() !== now.getDate() || end.getMonth() !== now.getMonth()) {
    return `${end.getMonth() + 1}/${end.getDate()} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

function formatTimingTooltip(
  ctx: KernelContext,
  est: ActionTimingEstimate,
  limit?: MaterialLimitResult | null
): string {
  const parts = [
    `${ctx.i18n.t("单次", "Attempt")}: ${est.perAttemptSec.toFixed(2)}s`,
    `${ctx.i18n.t("加速", "Speed")}: +${(est.actionSpeed * 100).toFixed(1)}%`,
  ];
  if (est.taskActionSpeed > 0) {
    parts.push(`${ctx.i18n.t("任务加速", "Task Spd")}: +${(est.taskActionSpeed * 100).toFixed(1)}%`);
  }
  if (est.efficiency > 0) {
    parts.push(`${ctx.i18n.t("效率", "Efficiency")}: +${(est.efficiency * 100).toFixed(1)}%`);
    parts.push(`${ctx.i18n.t("等效", "Eff")}: ${est.effectiveSecPerCount.toFixed(2)}s/${ctx.i18n.t("次", "act")}`);
  }
  if (est.materialLimited && limit && !limit.isInfinite) {
    const name = limit.bottleneckHrid ? ctx.i18n.getItemName(limit.bottleneckHrid) : "";
    parts.push(
      `${ctx.i18n.t("材料可做", "Materials allow")}: ${est.remainingActions.toLocaleString()} ${ctx.i18n.t("次", "acts")}` +
        (name ? ` (${ctx.i18n.t("瓶颈", "bottleneck")}: ${name})` : "")
    );
  }
  return parts.join(" · ");
}

/** Prefix for durations bounded by materials of an infinite action. */
function durationText(est: ActionTimingEstimate, sec: number): string {
  return `${est.materialLimited ? "~" : ""}${formatDuration(sec)}`;
}

// Material limits only change on inventory / drink / loadout / queue events, not every 1s tick.
const materialLimitCache = new Map<string, MaterialLimitResult>();

function clearMaterialLimitCache(): void {
  materialLimitCache.clear();
}

function buildActionEstimator(ctx: KernelContext, actions: readonly any[]) {
  const clientData = ctx.gameData.getClientData();
  const buffSources = ctx.gameData.getActionTypeBuffSources();
  const characterSkills = ctx.gameData.getCharacterSkills();
  const characterItems = ctx.gameData.getCharacterItems();
  const characterQuests = ctx.gameData.getCharacterQuests();
  const characterLoadouts = ctx.gameData.getCharacterLoadouts();
  const drinkSlotsMap = ctx.gameData.getActionTypeDrinkSlots();
  const currentActionLoadoutId = actions[0]?.characterLoadoutID ?? null;
  const nowMs = Date.now();

  const limitFor = (action: any, index: number): MaterialLimitResult | null => {
    if (action?.hasMaxCount && (action?.maxCount || 0) > 0) return null;
    const detail = clientData?.actionDetailMap?.[action?.actionHrid];
    if (!detail) return null;
    const loadoutId = action?.characterLoadoutID;
    const loadout =
      index > 0 &&
      typeof loadoutId === "number" &&
      loadoutId > 0 &&
      loadoutId !== currentActionLoadoutId &&
      characterLoadouts?.[loadoutId]
        ? characterLoadouts[loadoutId]
        : null;
    const key = `${action.actionHrid}|${loadout ? loadoutId : 0}|${action.primaryItemHash || ""}|${action.secondaryItemHash || ""}|${action.enhancingMaxLevel || 0}`;
    let res = materialLimitCache.get(key);
    if (!res) {
      res = computeMaterialLimit({
        actionDetail: detail,
        clientData,
        characterItems,
        drinkSlotsMap,
        loadout,
        actionInstance: action,
      });
      materialLimitCache.set(key, res);
    }
    return res;
  };

  const estimate = (action: any, index: number): ActionTimingEstimate => {
    const limit = limitFor(action, index);
    return estimateActionTiming({
      action,
      actionIndex: index,
      materialLimit: limit && !limit.isInfinite ? limit.max : null,
      currentActionLoadoutId,
      clientData,
      buffSources,
      characterSkills,
      characterItems,
      characterQuests,
      characterLoadouts,
      drinkSlotsMap,
      nowMs,
    });
  };
  return { estimate, limitFor };
}

export function createActionTimerModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unsubs: Array<() => void> = [];
  let intervalId: number | null = null;

  const updateHeaderBar = () => {
    if (!ctx) return;
    const actionNameEl = document.querySelector<HTMLElement>('div[class*="Header_actionName"]');
    if (!actionNameEl?.parentElement) return;

    let timerEl = document.getElementById(HEADER_TIMER_ID);
    const actions = [...ctx.gameData.getCharacterActions()].sort(
      (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)
    );
    const current = actions[0];

    if (!current || (actionNameEl.textContent || "").includes("Doing nothing") || (actionNameEl.textContent || "").includes("无")) {
      if (timerEl) timerEl.textContent = "";
      return;
    }

    if (!timerEl) {
      timerEl = document.createElement("span");
      timerEl.id = HEADER_TIMER_ID;
      timerEl.setAttribute("data-mwi-lite", "1");
      actionNameEl.parentElement.insertBefore(timerEl, actionNameEl.nextSibling);
    }

    const { estimate: estimateAt, limitFor } = buildActionEstimator(ctx, actions);
    const curEst = estimateAt(current, 0);
    if (curEst.perAttemptSec <= 0) {
      timerEl.textContent = "";
      timerEl.title = "";
      return;
    }

    let queueTotal = curEst.totalSec;
    let queueInf = curEst.isInfinite;
    let queueMat = curEst.materialLimited;
    for (let i = 1; i < actions.length; i++) {
      const est = estimateAt(actions[i], i);
      if (est.isInfinite) queueInf = true;
      if (est.materialLimited) queueMat = true;
      queueTotal += est.totalSec;
    }

    const curClock = formatFinishClock(curEst.totalSec);
    const curPart = curEst.isInfinite
      ? `∞ (${curEst.perAttemptSec.toFixed(2)}s)`
      : `${durationText(curEst, curEst.totalSec)}${curClock ? ` → ${curClock}` : ""}`;

    const totalClock = formatFinishClock(queueTotal);
    const queuePart =
      actions.length > 1
        ? queueInf
          ? ` | ${ctx.i18n.t("队列", "Q")}: ∞`
          : ` | ${ctx.i18n.t("总计", "Total")}: ${queueMat ? "~" : ""}${formatDuration(queueTotal)}${totalClock ? ` (${totalClock})` : ""}`
        : "";

    const nextText = `⏱ ${curPart}${queuePart}`;
    if (timerEl.textContent !== nextText) {
      timerEl.textContent = nextText;
    }
    const nextTitle = formatTimingTooltip(ctx, curEst, limitFor(current, 0));
    if (timerEl.title !== nextTitle) {
      timerEl.title = nextTitle;
    }
  };

  const updateQueuePopups = () => {
    const context = ctx;
    if (!context) return;
    const actions = [...context.gameData.getCharacterActions()].sort(
      (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)
    );
    if (!actions.length) return;

    const actionIndexById = new Map<number, number>();
    actions.forEach((a, idx) => {
      if (typeof a.id === "number") actionIndexById.set(a.id, idx);
    });

    const menu = document.querySelector('[class*="QueuedActions_queuedActionsEditMenu"]');
    if (menu) {
      const { estimate: estimateAt, limitFor } = buildActionEstimator(context, actions);
      const firstEst = estimateAt(actions[0], 0);
      let accSec = firstEst.totalSec;
      let hasInf = firstEst.isInfinite;
      const rows = menu.querySelectorAll('[class*="QueuedActions_action__"][data-action-id]');
      rows.forEach((row) => {
        const id = Number(row.getAttribute("data-action-id"));
        const idx = actionIndexById.get(id);
        if (idx === undefined) return;
        const est = estimateAt(actions[idx], idx);
        if (idx > 0) {
          accSec += est.totalSec;
          if (est.isInfinite) hasInf = true;
        }

        let tag = row.querySelector<HTMLElement>(`.${QUEUE_TAG_CLASS}`);
        if (!tag) {
          tag = document.createElement("span");
          tag.className = QUEUE_TAG_CLASS;
          tag.setAttribute("data-mwi-lite", "1");
          row.appendChild(tag);
        }
        const rowClock = hasInf ? "" : formatFinishClock(idx === 0 ? firstEst.totalSec : accSec);
        const txt = est.isInfinite
          ? `∞ (${est.perAttemptSec.toFixed(2)}s)`
          : `${durationText(est, est.totalSec)}${rowClock ? ` (${rowClock})` : ""}`;
        if (tag.textContent !== txt) tag.textContent = txt;
        const tip = formatTimingTooltip(context, est, limitFor(actions[idx], idx));
        if (tag.title !== tip) tag.title = tip;
      });
    }
  };

  const onMaterialsChanged = () => {
    clearMaterialLimitCache();
    syncTimers();
  };

  const onActionCompleted = () => {
    clearMaterialLimitCache();
    updateHeaderBar();
    updateQueuePopups();
  };

  const syncTimers = () => {
    if (document.hidden) {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      return;
    }
    updateHeaderBar();
    updateQueuePopups();
    if (intervalId === null) {
      intervalId = window.setInterval(() => {
        if (!document.hidden) {
          updateHeaderBar();
        }
      }, 1000);
    }
  };

  return {
    id: "planner-action-timer",
    nameZh: "动作完成时间与倒计时",
    nameEn: "Action Completion Time & Countdown",
    descriptionZh: "在顶部状态栏与队列面板显示当前及队列动作的剩余耗时与精确完成时刻（切后台自动休眠）",
    descriptionEn: "Show remaining countdown and finish wall-clock time on action bar and queue menu",
    category: "planner",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      unregStyle = ctx.addStyle(
        "planner-action-timer",
        `
        #${HEADER_TIMER_ID} {
          display: inline-flex;
          align-items: center;
          margin-left: 8px;
          padding: 1px 7px;
          border-radius: 0;
          border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
          background: var(--mwi-px-card-bg, linear-gradient(180deg, #17244d 0%, #0e1634 100%));
          box-shadow: 0 0 0 1px #070b16, inset 1px 1px 0 #293e7a;
          font-size: 11.5px;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          color: var(--mwi-px-accent, #93c5fd);
          font-weight: 700;
          white-space: nowrap;
        }
        .${QUEUE_TAG_CLASS} {
          margin-left: 6px;
          padding: 0 4px;
          border-radius: 0;
          border: 1px solid #354c8c;
          background: #101938;
          font-size: 10.5px;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          color: #bfdbfe;
          white-space: nowrap;
        }
        `
      );

      unsubs = [
        ctx.gameData.on("character_initialized", onMaterialsChanged),
        ctx.gameData.on("actions_updated", onMaterialsChanged),
        ctx.gameData.on("action_completed", onActionCompleted),
        ctx.gameData.on("items_updated", onMaterialsChanged),
        ctx.gameData.on("buffs_updated", onMaterialsChanged),
        ctx.gameData.on("skills_updated", syncTimers),
        ctx.gameData.on("house_rooms_updated", syncTimers),
        ctx.gameData.on("consumables_updated", onMaterialsChanged),
        ctx.gameData.on("personal_buffs_updated", syncTimers),
        ctx.gameData.on("quests_updated", syncTimers),
      ];
      document.addEventListener("visibilitychange", syncTimers);
      syncTimers();

      return () => {
        document.removeEventListener("visibilitychange", syncTimers);
        unsubs.forEach((u) => u());
        unsubs = [];
        unregStyle?.();
        unregStyle = null;
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        clearMaterialLimitCache();
        document.getElementById(HEADER_TIMER_ID)?.remove();
        document.querySelectorAll(`.${QUEUE_TAG_CLASS}`).forEach((el) => el.remove());
      };
    },

    onDom() {
      updateHeaderBar();
      updateQueuePopups();
    },
  };
}
