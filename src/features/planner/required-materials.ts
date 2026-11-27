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
const COUNT_BADGE_CLASS = "mwi-lite-req-count";
const UPGRADE_BADGE_CLASS = "mwi-lite-req-upgrade";
const HIDDEN_ATTR = "data-mwi-req-hidden";

interface RegularRow {
  readonly inputEl: HTMLElement;
  readonly itemCell: HTMLElement;
}

function formatCompactOrExact(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v >= 1e9) return `${(v / 1e9).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
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

function buildTooltip(entry: MaterialRequirementEntry, targetCount: number, ctx: KernelContext): string {
  const perFmt = formatPerAction(entry.perAction);
  const reqExact = entry.required.toLocaleString("en-US");
  const availExact = entry.available.toLocaleString("en-US");
  const missExact = entry.missing.toLocaleString("en-US");
  return ctx.i18n.t(
    `单次: ${perFmt} × ${targetCount} · 共需: ${reqExact} · 库存: ${availExact} · 缺口: ${missExact}`,
    `Per craft: ${perFmt} × ${targetCount} · Total: ${reqExact} · Have: ${availExact} · Missing: ${missExact}`
  );
}

function applyCountContent(
  el: HTMLElement,
  entry: MaterialRequirementEntry,
  targetCount: number,
  ctx: KernelContext
): void {
  const reqFmt = formatCompactOrExact(entry.required);
  if (entry.missing > 0) {
    const missFmt = formatCompactOrExact(entry.missing);
    const missTag = ctx.i18n.t(`缺${missFmt}`, `-${missFmt}`);
    el.dataset.state = "miss";
    el.textContent = `\u00a0/ ${reqFmt} (${missTag})\u00a0`;
  } else {
    el.dataset.state = "ok";
    el.textContent = `\u00a0/ ${reqFmt}\u00a0`;
  }
  el.title = buildTooltip(entry, targetCount, ctx);
}

function applyUpgradeContent(
  el: HTMLElement,
  entry: MaterialRequirementEntry,
  targetCount: number,
  ctx: KernelContext
): void {
  const availFmt = formatCompactOrExact(entry.available);
  const reqFmt = formatCompactOrExact(entry.required);
  if (entry.missing > 0) {
    const missFmt = formatCompactOrExact(entry.missing);
    const missTag = ctx.i18n.t(`缺${missFmt}`, `-${missFmt}`);
    el.dataset.state = "miss";
    el.textContent = `${availFmt} / ${reqFmt} (${missTag})`;
  } else {
    el.dataset.state = "ok";
    el.textContent = `${availFmt} / ${reqFmt}`;
  }
  el.title = buildTooltip(entry, targetCount, ctx);
}

function clearBadges(root: ParentNode): void {
  root.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
  root.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((el) => el.removeAttribute(HIDDEN_ATTR));
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
      if (
        detail.dataset.mwiReqSig !== emptySig ||
        detail.querySelector(`.${BADGE_CLASS}`) ||
        detail.querySelector(`[${HIDDEN_ATTR}]`)
      ) {
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
    const buffSources = ctx.gameData.getActionTypeBuffSources();

    const result = computeProductionMaterialRequirements(
      {
        actionDetail: action,
        clientData,
        characterItems: ctx.gameData.getCharacterItems(),
        drinkSlotsMap: ctx.gameData.getActionTypeDrinkSlots(),
        loadout,
        upgradeItemHash,
        activeConsumableBuffs: buffSources.consumable?.[action.type || ""],
      },
      targetCount
    );

    if (result.items.length === 0) {
      const emptySig = `none|${resolved?.actionHrid || ""}|${targetCount}`;
      if (
        detail.dataset.mwiReqSig !== emptySig ||
        detail.querySelector(`.${BADGE_CLASS}`) ||
        detail.querySelector(`[${HIDDEN_ATTR}]`)
      ) {
        clearBadges(detail);
        detail.dataset.mwiReqSig = emptySig;
      }
      return;
    }

    const reqGrid = detail.querySelector<HTMLElement>('[class*="SkillActionDetail_itemRequirements"]');
    const regularEntries = result.items.filter((it) => !it.isUpgradeItem);
    const upgradeEntry = result.items.find((it) => it.isUpgradeItem) || null;

    const regularRows: RegularRow[] = [];
    if (reqGrid) {
      const children = Array.from(reqGrid.children);
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!(child instanceof HTMLElement) || child.hasAttribute("data-mwi-lite")) continue;
        if (typeof child.className === "string" && child.className.includes("SkillActionDetail_inputCount")) {
          let j = i + 1;
          while (
            j < children.length &&
            children[j] instanceof HTMLElement &&
            children[j].hasAttribute("data-mwi-lite")
          ) {
            j++;
          }
          const itemCell = children[j];
          if (itemCell instanceof HTMLElement) {
            regularRows.push({ inputEl: child, itemCell });
          }
        }
      }
    }

    const expectedRegular = Math.min(regularRows.length, regularEntries.length);
    const expectedBadges = expectedRegular + (upgradeEntry && upgradeContainer ? 1 : 0);
    const itemsSig = result.items
      .map(
        (it) =>
          `${it.itemHrid}:${it.enhancementLevel}:${it.perAction.toFixed(4)}:${it.required}:${it.available}:${it.missing}`
      )
      .join(",");
    const sig = `${resolved?.actionHrid || ""}|${targetCount}|${loadoutId ?? ""}|${upgradeEnh}|${ctx.i18n.getLang()}|${itemsSig}`;

    if (
      detail.dataset.mwiReqSig === sig &&
      detail.querySelectorAll(`.${BADGE_CLASS}`).length === expectedBadges &&
      detail.querySelectorAll(`[${HIDDEN_ATTR}="1"]`).length === expectedRegular
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

    const activeInputs = new Set<Element>();
    const activeCountSpans = new Set<Element>();

    for (let i = 0; i < regularRows.length; i++) {
      const { inputEl, itemCell } = regularRows[i];
      const cellHrid = parseItemCellHrid(itemCell);
      const entry = (cellHrid ? regularByHrid.get(cellHrid) : undefined) || regularEntries[i];
      const next = inputEl.nextElementSibling;
      let span =
        next instanceof HTMLSpanElement && next.classList.contains(COUNT_BADGE_CLASS) ? next : null;

      if (!entry) {
        inputEl.removeAttribute(HIDDEN_ATTR);
        span?.remove();
        continue;
      }

      inputEl.setAttribute(HIDDEN_ATTR, "1");
      activeInputs.add(inputEl);
      if (!span) {
        span = document.createElement("span");
        span.className = `${BADGE_CLASS} ${COUNT_BADGE_CLASS}`;
        span.setAttribute("data-mwi-lite", "1");
        inputEl.insertAdjacentElement("afterend", span);
      }
      applyCountContent(span, entry, targetCount, ctx);
      activeCountSpans.add(span);
    }

    detail.querySelectorAll(`.${COUNT_BADGE_CLASS}`).forEach((el) => {
      if (!activeCountSpans.has(el)) el.remove();
    });
    detail.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((el) => {
      if (!activeInputs.has(el)) el.removeAttribute(HIDDEN_ATTR);
    });

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
        applyUpgradeContent(badge, upgradeEntry, targetCount, ctx);
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
        [${HIDDEN_ATTR}="1"] {
          display: none !important;
        }
        .${BADGE_CLASS}[data-state="ok"] {
          color: var(--mwi-px-green, #4ade80);
        }
        .${BADGE_CLASS}[data-state="miss"] {
          color: #f87171;
        }
        .${COUNT_BADGE_CLASS} {
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          font-weight: 700;
          cursor: help;
        }
        [class*="SkillActionDetail_upgradeItemSelectorInput"]:has(> .${UPGRADE_BADGE_CLASS}) {
          flex-wrap: wrap;
        }
        .${UPGRADE_BADGE_CLASS} {
          display: block;
          flex: 1 0 100%;
          width: 100%;
          margin-top: 3px;
          font-size: 11px;
          line-height: 1.3;
          font-weight: 700;
          font-family: var(--mwi-px-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          cursor: help;
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
        clearBadges(document);
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
