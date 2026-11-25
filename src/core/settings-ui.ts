import { domScheduler } from "./dom-scheduler";
import { i18n } from "./i18n";
import { getHugunnIconSvg } from "./pixel-theme";
import { registry } from "./registry";
import { addStyle } from "./storage";
import type { FeatureCategory } from "./types";
import { HUGUNN_VERSION } from "./version";

declare const GM_registerMenuCommand: ((name: string, fn: () => void) => void) | undefined;

const SETTINGS_BTN_ID = "mwi-lite-settings-btn";
const SETTINGS_MODAL_ID = "mwi-lite-settings-modal";

const CATEGORY_LABELS: Record<FeatureCategory, [string, string]> = {
  market: ["市场与经济", "Market & Economy"],
  planner: ["规划与队列", "Planner & Queue"],
  combat: ["战斗与迷宫", "Combat & Labyrinth"],
};

export function mountSettingsUI(isWorkerActiveFn: () => boolean): void {
  addStyle(
    "settings-ui",
    `
    #${SETTINGS_BTN_ID} {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-left: 8px;
      padding: 3px 9px;
      border-radius: 0;
      border: 1px solid var(--mwi-px-border, #9dbbff);
      background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%));
      box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a);
      color: #f8fafc;
      font-size: 11.5px;
      font-weight: 700;
      font-family: var(--mwi-px-mono, monospace);
      cursor: pointer;
      user-select: none;
      line-height: 1.3;
    }
    #${SETTINGS_BTN_ID}:hover {
      background: var(--mwi-px-btn-hover, linear-gradient(180deg, #405eb3 0%, #2b4385 100%));
      color: #ffffff;
    }
    #${SETTINGS_BTN_ID}:active {
      transform: translateY(1px);
    }
    #${SETTINGS_BTN_ID}.mwi-lite-floating {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 9500;
      box-shadow: 0 0 0 2px #070b16, 0 4px 12px rgba(0, 0, 0, 0.6);
    }
    #${SETTINGS_MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 9900;
      background: rgba(5, 8, 18, 0.78);
      display: none;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    #${SETTINGS_MODAL_ID}.open {
      display: flex;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-card {
      width: min(640px, 92vw);
      max-height: 82vh;
      display: flex;
      flex-direction: column;
      background: var(--mwi-px-panel-bg, linear-gradient(180deg, #121c3b 0%, #0c1228 100%));
      color: #edf2ff;
      border: 2px solid var(--mwi-px-border-bright, #d5e5ff);
      border-radius: 0;
      box-shadow: var(--mwi-px-shadow-panel, 0 0 0 2px #060913);
      overflow: hidden;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 2px solid var(--mwi-px-border-inner, #4f6fc4);
      background: var(--mwi-px-head-bg, linear-gradient(180deg, #1d2c5e 0%, #141f46 100%));
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-title {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 15px;
      font-weight: 800;
      color: #ffffff;
      text-shadow: 2px 2px 0 #070b16;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-status {
      font-size: 11.5px;
      color: var(--mwi-px-sub, #9dbbff);
      margin-top: 2px;
      font-family: var(--mwi-px-mono, monospace);
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-close {
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
    #${SETTINGS_MODAL_ID} .mwi-lite-body {
      padding: 12px 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-group-title {
      font-size: 12px;
      font-weight: 800;
      color: var(--mwi-px-gold, #fde047);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      text-shadow: 1px 1px 0 #070b16;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 11px;
      border-radius: 0;
      background: var(--mwi-px-card-bg, linear-gradient(180deg, #17244d 0%, #0e1634 100%));
      border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
      box-shadow: 0 0 0 1px #070b16, inset 1px 1px 0 #293e7a;
      margin-bottom: 6px;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-row-name {
      font-size: 12.5px;
      font-weight: 700;
      color: #f1f5f9;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-row-desc {
      font-size: 11px;
      color: var(--mwi-px-sub, #9dbbff);
      margin-top: 2px;
    }
    #${SETTINGS_MODAL_ID} input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: #4ade80;
      cursor: pointer;
      flex-shrink: 0;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-credits {
      margin-top: 4px;
      padding: 8px 11px;
      background: #091024;
      border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
      font-size: 10.5px;
      line-height: 1.5;
      color: var(--mwi-px-muted, #7f95cc);
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-credits b {
      color: var(--mwi-px-sub, #9dbbff);
    }
    `
  );

  const renderModal = (): HTMLElement => {
    let modal = document.getElementById(SETTINGS_MODAL_ID);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = SETTINGS_MODAL_ID;
      modal.setAttribute("data-mwi-lite", "1");
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) modal?.classList.remove("open");
      });
      document.body.appendChild(modal);
    }

    const items = registry.list();
    const enabledCount = items.filter((i) => i.enabled).length;
    const workerTxt = isWorkerActiveFn()
      ? i18n.t("迷宫 Worker 运行中 (1 线程)", "Labyrinth Worker Active (1 thread)")
      : i18n.t("迷宫 Worker 休眠 (0 线程)", "Labyrinth Worker Idle (0 threads)");

    const groups: FeatureCategory[] = ["market", "planner", "combat"];
    const groupsHtml = groups
      .map((cat) => {
        const list = items.filter((x) => x.module.category === cat);
        if (!list.length) return "";
        const [zhCat, enCat] = CATEGORY_LABELS[cat];
        const rowsHtml = list
          .map(({ module, enabled }) => {
            const name = i18n.t(module.nameZh, module.nameEn);
            const desc = i18n.t(module.descriptionZh, module.descriptionEn);
            return `
              <label class="mwi-lite-row">
                <div>
                  <div class="mwi-lite-row-name">${name}</div>
                  <div class="mwi-lite-row-desc">${desc}</div>
                </div>
                <input type="checkbox" data-mwi-lite-toggle="${module.id}" ${enabled ? "checked" : ""} />
              </label>
            `;
          })
          .join("");
        return `<div><div class="mwi-lite-group-title">${i18n.t(zhCat, enCat)}</div>${rowsHtml}</div>`;
      })
      .join("");

    modal.innerHTML = `
      <div class="mwi-lite-card">
        <div class="mwi-lite-header">
          <div>
            <div class="mwi-lite-title">${getHugunnIconSvg(18)}<span>MWI · Hugunn v${HUGUNN_VERSION}</span></div>
            <div class="mwi-lite-status">
              ${i18n.t(`已启用 ${enabledCount}/${items.length} 模块`, `${enabledCount}/${items.length} modules enabled`)}
              · ${i18n.t("当前路由", "Route")}: <b>${domScheduler.getActiveRoute()}</b>
              · ${workerTxt}
            </div>
          </div>
          <button type="button" class="mwi-lite-close">${i18n.t("关闭", "Close")}</button>
        </div>
        <div class="mwi-lite-body">
          ${groupsHtml}
          <div class="mwi-lite-credits">
            <b>${i18n.t("致谢与上游原作者 (CC-BY-NC-SA-4.0 / MIT)：", "Credits & Upstream Authors (CC-BY-NC-SA-4.0 / MIT):")}</b><br/>
            ${i18n.t(
              "迷宫胜率引擎：dakonglong (@dakonlong3, #566829) & shykai (MWICombatSimulatorTest)；经济/净资产/强化/规划算法：Toolasha (Celasha) & MWITools (bot7420, shykai, DrDucky, Frotty, Truth_Light 等)；市场快捷/排序：Foreversunny (#577171)、adudu；交易量显示：baozhi、perfectpure & Q7 行情 API；掉落运气统计：Weierstras (#536205)；动作与任务参考：zqzhang1996 (MWI_Toolkit)。",
              "Labyrinth Clear Rate: dakonglong (@dakonlong3, #566829) & shykai (MWICombatSimulatorTest); Economy/Networth/Enhancing/Planner: Toolasha (Celasha) & MWITools (bot7420, shykai, DrDucky, Frotty, Truth_Light, et al.); Market Shortcuts/Sort: Foreversunny (#577171), adudu; Market Volume: baozhi, perfectpure & Q7 Market API; Loot Luck Stats: Weierstras (#536205); Task/Action helpers: zqzhang1996 (MWI_Toolkit)."
            )}
          </div>
        </div>
      </div>
    `;

    modal.querySelector(".mwi-lite-close")?.addEventListener("click", () => {
      modal?.classList.remove("open");
    });

    modal.querySelectorAll<HTMLInputElement>("input[data-mwi-lite-toggle]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = cb.getAttribute("data-mwi-lite-toggle");
        if (id) {
          registry.setEnabled(id, cb.checked);
          renderModal();
        }
      });
    });

    return modal;
  };

  const openSettings = () => {
    const modal = renderModal();
    modal.classList.add("open");
  };

  if (typeof GM_registerMenuCommand === "function") {
    try {
      GM_registerMenuCommand("✦ MWI · Hugunn 设置 / Settings", openSettings);
    } catch {
      // Ignore
    }
  }

  const ensureButton = () => {
    if (!document.body) return;
    let btn = document.getElementById(SETTINGS_BTN_ID) as HTMLButtonElement | null;
    const headerTarget =
      document.querySelector('[class*="Header_totalLevel"]') ||
      document.querySelector('[class*="Header_info"]') ||
      document.querySelector('[class*="Header_header"]');

    if (!btn) {
      btn = document.createElement("button");
      btn.id = SETTINGS_BTN_ID;
      btn.type = "button";
      btn.setAttribute("data-mwi-lite", "1");
      btn.innerHTML = `${getHugunnIconSvg(15)}<span>Hugunn</span>`;
      btn.title = i18n.t("打开 MWI · Hugunn 设置", "Open MWI · Hugunn Settings");
      btn.addEventListener("click", openSettings);
    }

    if (headerTarget && headerTarget.parentElement) {
      btn.classList.remove("mwi-lite-floating");
      if (btn.parentElement !== headerTarget.parentElement) {
        headerTarget.parentElement.insertBefore(btn, headerTarget.nextSibling);
      }
    } else if (!btn.isConnected) {
      btn.classList.add("mwi-lite-floating");
      document.body.appendChild(btn);
    }
  };

  domScheduler.registerDomHandler("core-settings-btn", undefined, () => {
    ensureButton();
  });
}
