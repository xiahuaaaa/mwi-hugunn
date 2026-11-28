import type { FeatureModule, KernelContext } from "../../core/types";
import {
  normalizeMarketList,
  resolveMarketListNavState,
  type MarketNavTarget,
} from "./market-list-nav-engine";

export const MARKET_LIST_NAV_MODULE_ID = "market-list-nav";

const NAV_BAR_ID = "mwi-lite-market-list-nav";

interface MarketplaceHost {
  handleViewOrderBook(itemHrid: string, enhancementLevel: number): void;
  handleViewItemSummary(itemHrid: string): void;
}

function isElementVisible(el: Element | null): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  const htmlEl = el as HTMLElement;
  return htmlEl.style.display !== "none" && !htmlEl.hidden && htmlEl.offsetParent !== null;
}

function findVisibleMarketPanel(): HTMLElement | null {
  const panels = document.querySelectorAll<HTMLElement>('[class*="MarketplacePanel_marketplacePanel"]');
  for (let i = 0; i < panels.length; i++) {
    if (isElementVisible(panels[i])) return panels[i];
  }
  return null;
}

function extractItemHrid(root: Element): string | null {
  const uses = root.querySelectorAll("use");
  let fallback: string | null = null;
  for (let i = 0; i < uses.length; i++) {
    const useEl = uses[i];
    if (useEl.closest("[data-mwi-lite]")) continue;
    const href =
      useEl.getAttribute("href") ||
      useEl.getAttribute("xlink:href") ||
      (useEl as SVGUseElement).href?.baseVal ||
      "";
    const hashIndex = href.indexOf("#");
    if (hashIndex < 0) continue;
    const slug = href.slice(hashIndex + 1).trim();
    if (!slug) continue;
    const hrid = `/items/${slug}`;
    if (href.includes("items_sprite")) return hrid;
    if (fallback === null) fallback = hrid;
  }
  return fallback;
}

function findVisibleCurrentItem(panel: HTMLElement): {
  el: HTMLElement;
  itemHrid: string;
  level: number;
} | null {
  const nodes = panel.querySelectorAll<HTMLElement>('[class*="MarketplacePanel_currentItem"]');
  for (let i = 0; i < nodes.length; i++) {
    const cur = nodes[i];
    if (!isElementVisible(cur)) continue;
    const itemHrid = extractItemHrid(cur);
    if (!itemHrid) continue;
    const enhEl = cur.querySelector('[class*="Item_enhancementLevel"]');
    const level = enhEl ? Number((enhEl.textContent || "").replace(/\+/g, "").trim()) || 0 : 0;
    return { el: cur, itemHrid, level };
  }
  return null;
}

function findActiveMarketItemsContainer(itemSelection: HTMLElement): HTMLElement | null {
  for (let i = 0; i < itemSelection.children.length; i++) {
    const child = itemSelection.children[i] as HTMLElement;
    if (child.hasAttribute("data-mwi-lite")) continue;
    if (child.matches('[class*="MarketplacePanel_marketItems"]')) {
      return child;
    }
  }

  const tabsContainer = itemSelection.querySelector<HTMLElement>(
    '[class*="MarketplacePanel_itemSelectionTabsContainer"]:not([class*="MarketplacePanel_hide"])'
  );
  if (!tabsContainer) return null;

  const candidates = tabsContainer.querySelectorAll<HTMLElement>('[class*="MarketplacePanel_marketItems"]');
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidate.closest("[data-mwi-lite]")) continue;
    if (candidate.hidden || candidate.style.display === "none") continue;
    const hiddenAncestor = candidate.closest(
      '[class*="TabPanel_hidden"], [class*="MarketplacePanel_hide"], [hidden]'
    );
    if (hiddenAncestor && tabsContainer.contains(hiddenAncestor)) continue;
    return candidate;
  }

  return null;
}

function isHiddenWithin(node: HTMLElement, boundary: HTMLElement): boolean {
  let cur: HTMLElement | null = node;
  while (cur && cur !== boundary) {
    if (cur.hidden || cur.style.display === "none") return true;
    cur = cur.parentElement;
  }
  return false;
}

export function readActiveMarketList(panel: HTMLElement): readonly string[] {
  const itemSelection = panel.querySelector<HTMLElement>('[class*="MarketplacePanel_itemSelection"]');
  if (!itemSelection) return [];

  const container = findActiveMarketItemsContainer(itemSelection);
  if (!container) return [];

  const itemNodes = container.querySelectorAll<HTMLElement>('[class*="Item_itemContainer"]');
  const rawHrids: string[] = [];
  for (let i = 0; i < itemNodes.length; i++) {
    const node = itemNodes[i];
    if (node.closest("[data-mwi-lite]")) continue;
    if (isHiddenWithin(node, container)) continue;
    const hrid = extractItemHrid(node);
    if (hrid) rawHrids.push(hrid);
  }

  return normalizeMarketList(rawHrids);
}

function findMarketplaceHost(panel: HTMLElement): MarketplaceHost | null {
  const fKey = Reflect.ownKeys(panel).find(
    (k) => typeof k === "string" && (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
  );
  let fiber: any = fKey ? (panel as any)[fKey] : null;
  for (let depth = 0; fiber && depth < 64; depth++, fiber = fiber.return) {
    const host = fiber.stateNode;
    if (
      host &&
      typeof host === "object" &&
      typeof host.handleViewOrderBook === "function" &&
      typeof host.handleViewItemSummary === "function"
    ) {
      return host as MarketplaceHost;
    }
  }
  return null;
}

export function createMarketListNavModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unregOrderBooks: (() => void) | null = null;
  let capturedList: readonly string[] = [];
  let lastRenderSig = "";
  let currentPrevTarget: MarketNavTarget | null = null;
  let currentNextTarget: MarketNavTarget | null = null;
  let pendingSyncTimer: number | null = null;

  const canEnhance = (itemHrid: string): boolean => {
    const detail = ctx?.gameData.getClientData()?.itemDetailMap?.[itemHrid];
    return Array.isArray(detail?.enhancementCosts) && detail.enhancementCosts.length > 0;
  };

  const clearPendingSync = () => {
    if (pendingSyncTimer !== null) {
      window.clearTimeout(pendingSyncTimer);
      pendingSyncTimer = null;
    }
  };

  const removeNavBar = () => {
    document.getElementById(NAV_BAR_ID)?.remove();
    currentPrevTarget = null;
    currentNextTarget = null;
    lastRenderSig = "";
  };

  const navigateToTarget = (target: MarketNavTarget): boolean => {
    const panel = findVisibleMarketPanel();
    const marketHost = panel ? findMarketplaceHost(panel) : null;

    if (target.level === null) {
      if (marketHost) {
        marketHost.handleViewItemSummary(target.itemHrid);
        return true;
      }
      const core = ctx?.gameData.getReactGameCore();
      if (typeof core?.handleGoToMarketplace === "function") {
        core.handleGoToMarketplace(target.itemHrid, 0);
        return true;
      }
      return false;
    }

    if (marketHost) {
      marketHost.handleViewOrderBook(target.itemHrid, target.level);
      return true;
    }
    const core = ctx?.gameData.getReactGameCore();
    if (typeof core?.handleGoToMarketplace === "function") {
      core.handleGoToMarketplace(target.itemHrid, target.level);
      return true;
    }
    return false;
  };

  const handleNavClick = (dir: "prev" | "next", btn: HTMLButtonElement) => {
    const target = dir === "prev" ? currentPrevTarget : currentNextTarget;
    if (!target || btn.disabled) return;
    btn.disabled = true;
    try {
      if (navigateToTarget(target)) {
        clearPendingSync();
        pendingSyncTimer = window.setTimeout(() => {
          pendingSyncTimer = null;
          ctx?.domScheduler.scheduleRun(false);
        }, 60);
      }
    } finally {
      btn.disabled = (dir === "prev" ? currentPrevTarget : currentNextTarget) === null;
    }
  };

  const formatTargetLabel = (target: MarketNavTarget): string => {
    const name = ctx?.i18n.getItemName(target.itemHrid) || target.itemHrid.replace("/items/", "");
    if (target.level === null) {
      return `${name} · ${ctx?.i18n.t("全", "All") ?? "All"}`;
    }
    return canEnhance(target.itemHrid) ? `${name} +${target.level}` : name;
  };

  const createNavBar = (): HTMLDivElement => {
    const bar = document.createElement("div");
    bar.id = NAV_BAR_ID;
    bar.setAttribute("data-mwi-lite", "1");
    bar.setAttribute("role", "group");

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "mwi-lite-mln-btn";
    prevBtn.dataset.dir = "prev";
    prevBtn.textContent = "<";
    prevBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handleNavClick("prev", prevBtn);
    });

    const posEl = document.createElement("span");
    posEl.className = "mwi-lite-mln-pos";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "mwi-lite-mln-btn";
    nextBtn.dataset.dir = "next";
    nextBtn.textContent = ">";
    nextBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handleNavClick("next", nextBtn);
    });

    bar.append(prevBtn, posEl, nextBtn);
    return bar;
  };

  const syncDom = () => {
    if (!ctx) return;
    const panel = findVisibleMarketPanel();
    if (!panel) {
      removeNavBar();
      return;
    }

    const itemSelection = panel.querySelector<HTMLElement>('[class*="MarketplacePanel_itemSelection"]');
    if (itemSelection) {
      const selectionVisible =
        !itemSelection.matches('[class*="MarketplacePanel_hidden"]') && isElementVisible(itemSelection);
      const liveList = readActiveMarketList(panel);
      if (selectionVisible || liveList.length > 0) {
        capturedList = liveList;
      }
    }

    const isSummaryView = isElementVisible(panel.querySelector('[class*="MarketplacePanel_itemSummaryTable"]'));
    const isOrderBookView = isElementVisible(panel.querySelector('[class*="MarketplacePanel_orderBooksContainer"]'));
    const curItem = findVisibleCurrentItem(panel);
    if (!curItem || (!isSummaryView && !isOrderBookView)) {
      removeNavBar();
      return;
    }

    const currentLevel = isSummaryView ? null : curItem.level;
    const navState = resolveMarketListNavState(capturedList, curItem.itemHrid, currentLevel, canEnhance);
    if (!navState.visible) {
      removeNavBar();
      return;
    }

    if (!curItem.el.style.position) {
      curItem.el.style.position = "relative";
    }

    let navEl = document.getElementById(NAV_BAR_ID) as HTMLDivElement | null;
    if (!navEl) {
      navEl = createNavBar();
    }

    if (navEl.parentElement !== curItem.el) {
      curItem.el.appendChild(navEl);
    }

    currentPrevTarget = navState.prev;
    currentNextTarget = navState.next;

    const prevKey = navState.prev ? `${navState.prev.itemHrid}:${navState.prev.level ?? "all"}` : "";
    const nextKey = navState.next ? `${navState.next.itemHrid}:${navState.next.level ?? "all"}` : "";
    const sig = `${navState.index}/${navState.total}|${prevKey}|${nextKey}|${ctx.i18n.getLang()}`;
    if (sig === lastRenderSig) return;
    lastRenderSig = sig;

    const prevBtn = navEl.querySelector<HTMLButtonElement>('button[data-dir="prev"]');
    const nextBtn = navEl.querySelector<HTMLButtonElement>('button[data-dir="next"]');
    const posEl = navEl.querySelector<HTMLSpanElement>(".mwi-lite-mln-pos");

    if (posEl) {
      posEl.textContent = `${navState.index + 1}/${navState.total}`;
    }

    if (prevBtn) {
      prevBtn.disabled = navState.prev === null;
      const prevTitle = navState.prev
        ? ctx.i18n.t(`上一项: ${formatTargetLabel(navState.prev)}`, `Prev: ${formatTargetLabel(navState.prev)}`)
        : ctx.i18n.t("已是列表第一项", "First item in list");
      prevBtn.title = prevTitle;
      prevBtn.setAttribute("aria-label", prevTitle);
    }

    if (nextBtn) {
      nextBtn.disabled = navState.next === null;
      const nextTitle = navState.next
        ? ctx.i18n.t(`下一项: ${formatTargetLabel(navState.next)}`, `Next: ${formatTargetLabel(navState.next)}`)
        : ctx.i18n.t("已是列表最后一项", "Last item in list");
      nextBtn.title = nextTitle;
      nextBtn.setAttribute("aria-label", nextTitle);
    }
  };

  return {
    id: MARKET_LIST_NAV_MODULE_ID,
    nameZh: "市场列表快捷翻页 (< >)",
    nameEn: "Market List Quick Nav (< >)",
    descriptionZh:
      "在市场商品详情图标左右下侧添加 < / > 按钮并在图标左下角叠加进度，按当前搜索或分类列表顺序同强化等级切换相邻物品（默认关闭）",
    descriptionEn:
      "Adds < / > buttons on the lower sides of the marketplace item icon with a corner progress overlay to step through the active search or category list at the same enhancement level (disabled by default)",
    category: "market",
    defaultEnabled: false,
    routes: ["market"],

    init(context) {
      ctx = context;

      unregStyle = ctx.addStyle(
        MARKET_LIST_NAV_MODULE_ID,
        `
        #${NAV_BAR_ID} {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 8;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
        }
        #${NAV_BAR_ID} .mwi-lite-mln-btn {
          position: absolute;
          bottom: 0;
          width: 28px;
          height: 28px;
          min-width: 28px;
          min-height: 28px;
          padding: 0;
          pointer-events: auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%));
          border: 1px solid var(--mwi-px-border, #8eb1ff);
          border-radius: 0;
          box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a);
          color: #f8fafc;
          font-family: var(--mwi-px-mono, monospace);
          font-size: 13px;
          font-weight: 800;
          line-height: 1;
          cursor: pointer;
          box-sizing: border-box;
        }
        #${NAV_BAR_ID} .mwi-lite-mln-btn[data-dir="prev"] {
          right: calc(100% + 6px);
        }
        #${NAV_BAR_ID} .mwi-lite-mln-btn[data-dir="next"] {
          left: calc(100% + 4px);
        }
        #${NAV_BAR_ID} .mwi-lite-mln-btn:hover:not(:disabled) {
          background: var(--mwi-px-btn-hover, linear-gradient(180deg, #405eb3 0%, #2b4385 100%));
          border-color: var(--mwi-px-border-bright, #d5e5ff);
        }
        #${NAV_BAR_ID} .mwi-lite-mln-btn:disabled {
          opacity: 0.38;
          cursor: not-allowed;
        }
        #${NAV_BAR_ID} .mwi-lite-mln-pos {
          position: absolute;
          left: 1px;
          bottom: 1px;
          padding: 0 3px;
          background: rgba(7, 11, 22, 0.84);
          border: 1px solid rgba(142, 177, 255, 0.55);
          border-radius: 0;
          color: var(--mwi-px-border-bright, #d5e5ff);
          font-size: 10px;
          font-weight: 800;
          line-height: 13px;
          letter-spacing: -0.2px;
          text-shadow: 1px 1px 0 #070b16;
          white-space: nowrap;
          pointer-events: none;
          user-select: none;
          z-index: 9;
        }
        @media (max-width: 760px) {
          #${NAV_BAR_ID} .mwi-lite-mln-btn {
            width: 22px;
            height: 22px;
            min-width: 22px;
            min-height: 22px;
            font-size: 11px;
          }
        }
        `
      );

      unregOrderBooks = ctx.wsBus.on("market_item_order_books_updated", () => {
        clearPendingSync();
        pendingSyncTimer = window.setTimeout(() => {
          pendingSyncTimer = null;
          ctx?.domScheduler.scheduleRun(false);
        }, 40);
      });

      return () => {
        clearPendingSync();
        unregOrderBooks?.();
        unregOrderBooks = null;
        unregStyle?.();
        unregStyle = null;
        removeNavBar();
        capturedList = [];
        ctx = null;
      };
    },

    onDom() {
      syncDom();
    },
  };
}
