import type { FeatureModule, KernelContext } from "../../core/types";
import {
  analyzeChestOpen,
  parseLootOpenedPayload,
  type ChestCdfCache,
  type ChestOpenAnalysis,
  type ChestOpenEvent,
} from "./chest-luck-engine";
import {
  CombatPriceResolver,
  formatCombatPrice,
  formatLuckPercent,
  type CombatPriceMode,
} from "./combat-luck-engine";
import { escapeHtml } from "./combat-pixel-ui";

const PRICE_MODE_STORAGE_KEY = "combat_luck_price_mode_v1";
const CARD_CLASS = "mwi-lite-chest-luck-card";
const RARITY_ATTR = "data-mwi-chest-rarity";
const JACKPOT_ATTR = "data-mwi-chest-jackpot";
const STYLE_ID = "combat-chest-luck";

const CHEST_LUCK_STYLES = `
  [class*="Inventory_gainedItems"] [${RARITY_ATTR}="0"] {
    border: 1px solid rgba(112, 118, 134, 0.95) !important;
    background-color: rgba(96, 96, 109, 0.42) !important;
  }
  [class*="Inventory_gainedItems"] [${RARITY_ATTR}="1"] {
    border: 1px solid rgba(116, 178, 126, 0.95) !important;
    background-color: rgba(84, 132, 92, 0.44) !important;
  }
  [class*="Inventory_gainedItems"] [${RARITY_ATTR}="2"] {
    border: 1px solid rgba(120, 168, 226, 0.98) !important;
    background-color: rgba(92, 128, 172, 0.46) !important;
  }
  [class*="Inventory_gainedItems"] [${RARITY_ATTR}="3"] {
    border: 1px solid rgba(182, 128, 224, 0.98) !important;
    background-color: rgba(139, 102, 168, 0.48) !important;
  }
  [class*="Inventory_gainedItems"] [${RARITY_ATTR}="4"] {
    border: 1px solid rgba(235, 176, 104, 1) !important;
    background-color: rgba(196, 144, 86, 0.48) !important;
  }
  [class*="Inventory_gainedItems"] [${RARITY_ATTR}="5"] {
    border: 1px solid rgb(236, 118, 118) !important;
    background-color: rgba(189, 92, 92, 0.5) !important;
    box-shadow: 0 0 4px 1px rgba(236, 118, 118, 0.85), inset 0 0 0 1px rgba(255, 190, 190, 0.45) !important;
  }
  [class*="Inventory_gainedItems"] [${RARITY_ATTR}="6"] {
    border: 1px solid rgb(250, 238, 128) !important;
    background-color: rgba(224, 212, 110, 0.48) !important;
    box-shadow: 0 0 6px 2px rgba(250, 238, 128, 0.9), inset 0 0 0 1px rgba(255, 250, 200, 0.65) !important;
  }
  [class*="Inventory_gainedItems"] [${JACKPOT_ATTR}="1"] {
    box-shadow: 0 0 5px 1.5px rgba(253, 224, 71, 0.85), inset 0 0 0 1px rgba(254, 240, 138, 0.65) !important;
  }
  [class*="Inventory_gainedItems"] [${RARITY_ATTR}="5"][${JACKPOT_ATTR}="1"] {
    box-shadow: 0 0 6px 2px rgba(248, 113, 113, 0.95), 0 0 10px 2px rgba(253, 224, 71, 0.55) !important;
  }
  [class*="Inventory_gainedItems"] [${RARITY_ATTR}="6"][${JACKPOT_ATTR}="1"] {
    box-shadow: 0 0 8px 2.5px rgba(254, 240, 138, 1), inset 0 0 0 1px rgba(255, 255, 255, 0.8) !important;
  }

  .${CARD_CLASS} {
    width: 100%;
    max-width: 340px;
    box-sizing: border-box;
    margin: 10px auto 6px;
    padding: 8px 10px;
    border-radius: 0;
    background: var(--mwi-px-card-bg, linear-gradient(180deg, #17244d 0%, #0e1634 100%));
    border: 2px solid var(--mwi-px-border, #9dbbff);
    box-shadow: var(--mwi-px-shadow-card, 0 0 0 2px #070b16, inset 0 0 0 2px #293e7a, inset 0 1px 0 2px #5273c7);
    color: var(--mwi-px-text, #e2e8f0);
    font-family: var(--mwi-px-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    font-size: 11.5px;
    line-height: 1.35;
    font-variant-numeric: tabular-nums;
    text-align: left;
  }
  .${CARD_CLASS} * { box-sizing: border-box; }
  .${CARD_CLASS}-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 5px;
    margin-bottom: 6px;
    border-bottom: 1px solid #2b3f77;
  }
  .${CARD_CLASS}-luck {
    font-size: 13px;
    font-weight: 800;
    text-shadow: 1px 1px 0 #070b16;
  }
  .${CARD_CLASS}-mode {
    padding: 1px 5px;
    border: 1px solid #4f6fc4;
    background: #101937;
    color: var(--mwi-px-sub, #9dbbff);
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }
  .${CARD_CLASS}-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px 10px;
  }
  .${CARD_CLASS}-cell {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 3px 6px;
    background: rgba(10, 16, 36, 0.68);
    border: 1px solid #293e7a;
  }
  .${CARD_CLASS}-cell-wide {
    grid-column: 1 / -1;
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .${CARD_CLASS}-lbl {
    font-size: 10px;
    color: var(--mwi-px-sub, #9dbbff);
    font-weight: 600;
  }
  .${CARD_CLASS}-val {
    font-size: 12px;
    font-weight: 800;
    color: #f8fafc;
    white-space: nowrap;
  }
  .${CARD_CLASS}-sub {
    font-size: 10px;
    font-weight: 600;
    color: #94a3b8;
    margin-left: 3px;
  }
`;

function renderCardHtml(analysis: ChestOpenAnalysis, ctx: KernelContext): string {
  const modeLabel =
    analysis.priceMode === "bid_net"
      ? ctx.i18n.t("买价税后", "Bid Net")
      : ctx.i18n.t("卖价", "Ask");

  const headerTitle =
    analysis.luck !== null
      ? `${ctx.i18n.t("本次运气", "Luck")} ${formatLuckPercent(analysis.luck)}`
      : ctx.i18n.t("开箱估值", "Loot Value");

  const headerColor = analysis.luck !== null ? analysis.luckColor : "#fde047";

  const cells: string[] = [
    `<div class="${CARD_CLASS}-cell">
      <span class="${CARD_CLASS}-lbl">${escapeHtml(ctx.i18n.t("实际价值", "Value"))}</span>
      <span class="${CARD_CLASS}-val" style="color:#fde047">${escapeHtml(formatCombatPrice(analysis.income))}</span>
    </div>`,
  ];

  if (analysis.hasDropModel) {
    const stdText = analysis.stddev > 0 ? `σ ${formatCombatPrice(analysis.stddev)}` : "";
    const stdSub = stdText ? `<span class="${CARD_CLASS}-sub">±${escapeHtml(formatCombatPrice(analysis.stddev))}</span>` : "";
    cells.push(
      `<div class="${CARD_CLASS}-cell" title="${escapeHtml(stdText)}">
        <span class="${CARD_CLASS}-lbl">${escapeHtml(ctx.i18n.t("期望价值", "Expected"))}</span>
        <span class="${CARD_CLASS}-val" style="color:#7dd3fc">${escapeHtml(formatCombatPrice(analysis.expectation))}${stdSub}</span>
      </div>`
    );

    const isPositive = analysis.delta >= 0;
    const deltaLabel = isPositive
      ? ctx.i18n.t("高于期望", "Above EV")
      : ctx.i18n.t("低于期望", "Below EV");
    const deltaColor = isPositive ? "#4ade80" : "#f87171";
    const deltaPrefix = isPositive ? "+" : "";
    const wideCls = analysis.cost > 0 ? "" : ` ${CARD_CLASS}-cell-wide`;
    cells.push(
      `<div class="${CARD_CLASS}-cell${wideCls}">
        <span class="${CARD_CLASS}-lbl">${escapeHtml(deltaLabel)}</span>
        <span class="${CARD_CLASS}-val" style="color:${deltaColor}">${escapeHtml(deltaPrefix + formatCombatPrice(analysis.delta))}</span>
      </div>`
    );
  }

  if (analysis.cost > 0) {
    const profitColor = analysis.profit >= 0 ? "#4ade80" : "#f87171";
    const costTip = `${ctx.i18n.t("钥匙成本", "Key Cost")}: ${formatCombatPrice(analysis.cost)}`;
    cells.push(
      `<div class="${CARD_CLASS}-cell" title="${escapeHtml(costTip)}">
        <span class="${CARD_CLASS}-lbl">${escapeHtml(ctx.i18n.t("扣除钥匙净利", "Net Profit"))}</span>
        <span class="${CARD_CLASS}-val" style="color:${profitColor}">${escapeHtml(formatCombatPrice(analysis.profit))}</span>
      </div>`
    );
  }

  return `
    <div class="${CARD_CLASS}-head">
      <span class="${CARD_CLASS}-luck" style="color:${headerColor}">${escapeHtml(headerTitle)}</span>
      <span class="${CARD_CLASS}-mode">${escapeHtml(modeLabel)}</span>
    </div>
    <div class="${CARD_CLASS}-grid">${cells.join("")}</div>
  `;
}

function clearModalEnhancements(doc: Document): void {
  doc.querySelectorAll(`.${CARD_CLASS}`).forEach((el) => el.remove());
  doc.querySelectorAll(`[${RARITY_ATTR}], [${JACKPOT_ATTR}]`).forEach((el) => {
    el.removeAttribute(RARITY_ATTR);
    el.removeAttribute(JACKPOT_ATTR);
  });
  doc.querySelectorAll<HTMLElement>("[data-mwi-chest-sig]").forEach((el) => {
    delete el.dataset.mwiChestSig;
  });
}

export function createChestLuckModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let priceResolver: CombatPriceResolver | null = null;
  let unregStyle: (() => void) | null = null;
  let unsubs: Array<() => void> = [];

  let latestEvent: ChestOpenEvent | null = null;
  let nextEventId = 0;
  let priceBump = 0;
  let marketEpoch = "0";
  const cdfCache: ChestCdfCache = new Map();

  const readPriceMode = (): CombatPriceMode => {
    const saved = ctx?.storage.get<CombatPriceMode>(PRICE_MODE_STORAGE_KEY, "bid_net");
    return saved === "ask" ? "ask" : "bid_net";
  };

  const enhanceModal = (doc: Document): void => {
    if (!ctx || !latestEvent || !priceResolver) return;

    const gainedItemsEl = doc.querySelector<HTMLElement>('[class*="Inventory_gainedItems"]');
    if (!gainedItemsEl) return;
    const modalContent = gainedItemsEl.closest<HTMLElement>('[class*="Inventory_modalContent"]');
    if (!modalContent) return;

    const priceMode = readPriceMode();
    const clientData = ctx.gameData.getClientData();
    const sig = `${latestEvent.id}|${priceMode}|${marketEpoch}|${clientData ? 1 : 0}|${ctx.i18n.getLang()}`;
    const existingCard = modalContent.querySelector<HTMLElement>(`.${CARD_CLASS}`);
    if (existingCard && existingCard.dataset.sig === sig && gainedItemsEl.dataset.mwiChestSig === sig) {
      return;
    }

    const analysis = analyzeChestOpen(
      latestEvent,
      clientData,
      priceResolver,
      priceMode,
      marketEpoch,
      cdfCache
    );

    const tiles = Array.from(gainedItemsEl.children).filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        !el.hasAttribute("data-mwi-lite") &&
        !(typeof el.className === "string" && el.className.includes("Inventory_label"))
    );

    for (const tile of tiles) {
      const target = tile.querySelector<HTMLElement>('[class*="Item_item__"]') ?? tile;
      target.removeAttribute(RARITY_ATTR);
      target.removeAttribute(JACKPOT_ATTR);
    }

    const count = Math.min(tiles.length, analysis.items.length);
    for (let i = 0; i < count; i++) {
      const itemInfo = analysis.items[i];
      const target = tiles[i].querySelector<HTMLElement>('[class*="Item_item__"]') ?? tiles[i];
      target.setAttribute(RARITY_ATTR, String(itemInfo.tier));
      if (itemInfo.jackpot) {
        target.setAttribute(JACKPOT_ATTR, "1");
      }
    }
    gainedItemsEl.dataset.mwiChestSig = sig;

    const card = existingCard ?? doc.createElement("div");
    if (!existingCard) {
      card.className = CARD_CLASS;
      card.setAttribute("data-mwi-lite", "1");
    }
    if (card.dataset.sig !== sig) {
      card.dataset.sig = sig;
      card.innerHTML = renderCardHtml(analysis, ctx);
    }

    const closeBtn = Array.from(modalContent.children)
      .reverse()
      .find((el) => el.tagName === "BUTTON");
    if (closeBtn) {
      if (card.nextElementSibling !== closeBtn) {
        modalContent.insertBefore(card, closeBtn);
      }
    } else if (!card.isConnected) {
      modalContent.appendChild(card);
    }
  };

  return {
    id: "combat-chest-luck",
    nameZh: "开箱运气与稀有度高亮",
    nameEn: "Chest Opening Luck & Rarity",
    descriptionZh: "开箱时在原版弹窗内原位显示本次开箱运气分位、期望收益与净利，并按掉落稀有度高亮物品边框",
    descriptionEn: "In-place luck percentile, expected value, net profit, and rarity borders inside the native Opened Loot modal",
    category: "combat",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      priceResolver = new CombatPriceResolver(ctx.marketStore);
      marketEpoch = ctx.marketStore.isPricesLoaded() ? `loaded:${++priceBump}` : `init:${++priceBump}`;
      unregStyle = ctx.addStyle(STYLE_ID, CHEST_LUCK_STYLES);

      unsubs = [
        ctx.wsBus.on("loot_opened", (raw) => {
          const parsed = parseLootOpenedPayload(raw, ++nextEventId);
          if (!parsed) return;
          latestEvent = parsed;
          if (!ctx?.marketStore.isPricesLoaded()) {
            void ctx?.marketStore.ensurePricesLoaded();
          }
          ctx?.domScheduler.scheduleRun(false);
        }),
        ctx.marketStore.onPriceUpdate(() => {
          marketEpoch = `upd:${++priceBump}`;
          cdfCache.clear();
          enhanceModal(document);
        }),
        ctx.gameData.on("client_data_ready", () => {
          cdfCache.clear();
          enhanceModal(document);
        }),
      ];

      return () => {
        unsubs.forEach((u) => u());
        unsubs = [];
        unregStyle?.();
        unregStyle = null;
        cdfCache.clear();
        latestEvent = null;
        priceResolver = null;
        ctx = null;
        clearModalEnhancements(document);
      };
    },

    onDom(doc) {
      enhanceModal(doc);
    },
  };
}
