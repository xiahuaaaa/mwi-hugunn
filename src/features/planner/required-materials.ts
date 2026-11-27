import type { FeatureModule, KernelContext } from "../../core/types";
import { computeProductionMaterialRequirements, type MaterialRequirementEntry } from "./material-limit";
import {
  buildLocalizedNameLookup,
  findSelectedLoadout,
  type LocalizedNameLookup,
  parsePositiveActionCount,
  resolveDetailAction,
} from "./planner-utils";

const BADGE_CLASS = "mwi-lite-req-mat";
const UPGRADE_BADGE_CLASS = "mwi-lite-req-mat-upgrade";

function formatCompactOrExact(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v >= 1e9) return `${(v / 1e9).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (v >= 1e7) return `${(v / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  return v.toLocaleString("en-US");
}

function formatPerAction(n: number): string {
  if (Math.abs(n - Math.round(n)) < 1e-9) {
    return Math.round(n).toLocaleString("en-US");
  }
  return Number(n.toFixed(2)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function parseItemCellHrid(cell: Element): string {
  const uses = cell.querySelectorAll("use");
  for (const u of uses) {
    if (u.closest("[data-mwi-lite]")) continue;
    const href = u.getAttribute("href") || u.getAttribute("xlink:href") || "";
    const hashIdx = href.indexOf("#");
    if (hashIdx < 0) continue;
    const key = href.slice(hashIdx + 1).trim();
    if (key) return `/items/${key}`;
  }
  return "";
}

function readSelectedUpgradeEnhancement(upgradeContainer: Element | null): number {
  if (!upgradeContainer) return 0;
  const enhEl = upgradeContainer.querySelector('[class*="Item_enhancementLevel"]');
  const text = (enhEl?.textContent || "").trim();
  const match = text.match(/\+(\d+)/);
  if (!match) return 0;
  const level = Number(match[1]);
  return Number.isInteger(level) && level > 0 ? level : 0;
}

function applyBadgeContent(
  el: HTMLElement,
  entry: MaterialRequirementEntry,
  ctx: KernelContext
): void {
  const reqFmt = formatCompactOrExact(entry.required);
  const missFmt = formatCompactOrExact(entry.missing);
  const perFmt = formatPerAction(entry.perAction);
  const reqExact = entry.required.toLocaleString("en-US");
  const availExact = entry.available.toLocaleString("en-US");
  const missExact = entry.missing.toLocaleString("en-US");

  if (entry.missing > 0) {
    el.dataset.state = "miss";
    el.textContent = ctx.i18n.t(`需 ${reqFmt} · 缺 ${missFmt}`, `Need ${reqFmt} · Miss ${missFmt}`);
  } else {
    el.dataset.state = "ok";
    el.textContent = ctx.i18n.t(`需 ${reqFmt} · 充足`, `Need ${reqFmt} · OK`);
  }

  el.title = ctx.i18n.t(
    `单次: ${perFmt} · 共需: ${reqExact} · 库存: ${availExact} · 缺口: ${missExact}`,
    `Per craft: ${perFmt} · Total: ${reqExact} · Have: ${availExact} · Missing: ${missExact}`
  );
}

function clearBadges(detail: HTMLElement): void {
  detail.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
}

export function createRequiredMaterialsModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let abortController: AbortController | null = null;
  let refreshTimer: number | null = null;
  let cachedClientRef: any = null;
  let cachedLookup: LocalizedNameLookup | null = null;
  let boundInputs = new WeakSet<HTMLInputElement>();
  let boundDetails = new WeakSet<HTMLElement>();

  const getLookup = (): LocalizedNameLookup | null => {
    if (!ctx) return null;
    const clientData = ctx.gameData.getClientData();
    if (!clientData) return null;
    if (!cachedLookup || cachedClientRef !== clientData) {
      cachedClientRef = clientData;
      cachedLookup = buildLocalizedNameLookup(ctx);
    }
    return cachedLookup;
  };

  const renderDetail = () => {
    if (!ctx) return;
    const detail = document.querySelector<HTMLElement>('[class*="SkillActionDetail_skillActionDetail"]');
    if (!detail) return;

    const mainInput = detail.querySelector<HTMLInputElement>(
      '[class*="maxActionCountInput"] input[class*="Input_input"]'
    );
    if (!mainInput) return;

    if (abortController) {
      const { signal } = abortController;
      if (!boundInputs.has(mainInput)) {
        boundInputs.add(mainInput);
        mainInput.addEventListener("input", renderDetail, { signal });
        mainInput.addEventListener("change", renderDetail, { signal });
      }
      if (!boundDetails.has(detail)) {
        boundDetails.add(detail);
        detail.addEventListener("click", () => scheduleRefresh(40), { signal });
      }
    }

    const targetCount = parsePositiveActionCount(mainInput);
    const clientData = ctx.gameData.getClientData();
    const lookup = getLookup();
    const resolved = clientData && lookup ? resolveDetailAction(detail, clientData, lookup) : null;
    const action = resolved?.action || null;

    if (targetCount === null || !action || action.function !== "/action_functions/production") {
      const emptySig = `empty|${resolved?.actionHrid || ""}|${targetCount ?? "none"}`;
      if (detail.dataset.mwiReqSig !== emptySig || detail.querySelector(`.${BADGE_CLASS}`)) {
        clearBadges(detail);
        detail.dataset.mwiReqSig = emptySig;
      }
      return;
    }

    const { loadoutId, loadout } = findSelectedLoadout(
      detail,
      action.type || "",
      ctx.gameData.getCharacterLoadouts()
    );
    const upgradeContainer = detail.querySelector<HTMLElement>(
      '[class*="SkillActionDetail_upgradeItemSelectorInput"]'
    );
    const upgradeEnh = readSelectedUpgradeEnhancement(upgradeContainer);
    const upgradeItemHash =
      upgradeEnh > 0 && typeof action.upgradeItemHrid === "string" && action.upgradeItemHrid
        ? `::/item_locations/inventory::${action.upgradeItemHrid}::${upgradeEnh}`
        : undefined;

    const result = computeProductionMaterialRequirements(
      {
        actionDetail: action,
        clientData,
        characterItems: ctx.gameData.getCharacterItems(),
        drinkSlotsMap: ctx.gameData.getActionTypeDrinkSlots(),
        loadout,
        upgradeItemHash,
      },
      targetCount
    );

    if (result.items.length === 0) {
      const emptySig = `none|${resolved?.actionHrid || ""}|${targetCount}`;
      if (detail.dataset.mwiReqSig !== emptySig || detail.querySelector(`.${BADGE_CLASS}`)) {
        clearBadges(detail);
        detail.dataset.mwiReqSig = emptySig;
      }
      return;
    }

    const reqGrid = detail.querySelector<HTMLElement>('[class*="SkillActionDetail_itemRequirements"]');
    const regularEntries = result.items.filter((it) => !it.isUpgradeItem);
    const upgradeEntry = result.items.find((it) => it.isUpgradeItem) || null;

    const itemCells: HTMLElement[] = [];
    if (reqGrid) {
      const children = reqGrid.children;
      for (let i = 0; i < children.length; i++) {
        const cls = children[i].className;
        if (typeof cls === "string" && cls.includes("SkillActionDetail_inputCount")) {
          const next = children[i + 1];
          if (next instanceof HTMLElement && !next.hasAttribute("data-mwi-lite")) {
            itemCells.push(next);
          }
        }
      }
    }

    const expectedBadges =
      Math.min(itemCells.length, regularEntries.length) + (upgradeEntry && upgradeContainer ? 1 : 0);
    const itemsSig = result.items
      .map((it) => `${it.itemHrid}:${it.enhancementLevel}:${it.required}:${it.available}:${it.missing}`)
      .join(",");
    const sig = `${resolved?.actionHrid || ""}|${targetCount}|${loadoutId ?? ""}|${upgradeEnh}|${ctx.i18n.getLang()}|${itemsSig}`;

    if (
      detail.dataset.mwiReqSig === sig &&
      detail.querySelectorAll(`.${BADGE_CLASS}`).length === expectedBadges
    ) {
      return;
    }
    detail.dataset.mwiReqSig = sig;

    const regularByHrid = new Map<string, MaterialRequirementEntry>();
    for (const entry of regularEntries) {
      if (!regularByHrid.has(entry.itemHrid)) {
        regularByHrid.set(entry.itemHrid, entry);
      }
    }

    for (let i = 0; i < itemCells.length; i++) {
      const cell = itemCells[i];
      const cellHrid = parseItemCellHrid(cell);
      const entry = (cellHrid ? regularByHrid.get(cellHrid) : undefined) || regularEntries[i];
      let badge = cell.querySelector<HTMLSpanElement>(`:scope > .${BADGE_CLASS}`);
      if (!entry) {
        badge?.remove();
        continue;
      }
      if (!badge) {
        badge = document.createElement("span");
        badge.className = BADGE_CLASS;
        badge.setAttribute("data-mwi-lite", "1");
        cell.appendChild(badge);
      }
      applyBadgeContent(badge, entry, ctx);
    }

    if (upgradeContainer) {
      let badge = upgradeContainer.querySelector<HTMLDivElement>(`:scope > .${UPGRADE_BADGE_CLASS}`);
      if (!upgradeEntry) {
        badge?.remove();
      } else {
        if (!badge) {
          badge = document.createElement("div");
          badge.className = `${BADGE_CLASS} ${UPGRADE_BADGE_CLASS}`;
          badge.setAttribute("data-mwi-lite", "1");
          upgradeContainer.appendChild(badge);
        }
        applyBadgeContent(badge, upgradeEntry, ctx);
      }
    }
  };

  const scheduleRefresh = (delayMs = 50) => {
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      renderDetail();
    }, delayMs);
  };

  return {
    id: "planner-required-materials",
    nameZh: "制作材料总需求与缺口",
    nameEn: "Required Materials & Shortage",
    descriptionZh:
      "在生产动作详情中实时显示制作 X 次所需材料总量与当前库存缺口（含工匠茶减耗与升级基底物品）",
    descriptionEn:
      "Show total required materials and current inventory shortage for X crafts inside SkillActionDetail (with Artisan Tea and upgrade base)",
    category: "planner",
    defaultEnabled: true,
    routes: ["production", "tasks"],

    init(context) {
      ctx = context;
      abortController = new AbortController();
      boundInputs = new WeakSet<HTMLInputElement>();
      boundDetails = new WeakSet<HTMLElement>();

      const unregStyle = context.addStyle(
        "planner-required-materials-css",
        `
        .${BADGE_CLASS} {
          display: inline-block;
          margin-left: 6px;
          font-size: 11px;
          line-height: 1.3;
          font-weight: 700;
          font-family: var(--mwi-px-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          vertical-align: middle;
          cursor: help;
        }
        .${BADGE_CLASS}[data-state="ok"] {
          color: var(--mwi-px-green, #4ade80);
        }
        .${BADGE_CLASS}[data-state="miss"] {
          color: #f87171;
        }
        [class*="SkillActionDetail_upgradeItemSelectorInput"]:has(> .${UPGRADE_BADGE_CLASS}) {
          flex-wrap: wrap;
        }
        .${UPGRADE_BADGE_CLASS} {
          display: block;
          flex: 1 0 100%;
          width: 100%;
          margin-left: 0;
          margin-top: 3px;
        }
        `
      );

      const trigger = () => scheduleRefresh();
      const unsubs = [
        context.gameData.on("items_updated", trigger),
        context.gameData.on("character_initialized", () => {
          cachedLookup = null;
          scheduleRefresh();
        }),
        context.gameData.on("consumables_updated", trigger),
        context.gameData.on("buffs_updated", trigger),
        context.wsBus.on("consumable_buffs_updated", trigger),
        context.wsBus.on("actions_updated", trigger),
      ];

      return () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        abortController?.abort();
        abortController = null;
        unsubs.forEach((u) => u());
        unregStyle();
        document.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
        document
          .querySelectorAll<HTMLElement>('[class*="SkillActionDetail_skillActionDetail"]')
          .forEach((el) => {
            delete el.dataset.mwiReqSig;
          });
        boundInputs = new WeakSet<HTMLInputElement>();
        boundDetails = new WeakSet<HTMLElement>();
        cachedClientRef = null;
        cachedLookup = null;
        ctx = null;
      };
    },

    onDom() {
      renderDetail();
    },
  };
}
