// Credit: Quick Input Buttons inspired by Toolasha (Celasha, CC-BY-NC-SA-4.0).
import type { FeatureModule, KernelContext } from "../../core/types";
import { estimateActionTiming } from "./action-time-math";
import { computeMaterialLimit } from "./material-limit";
import {
  buildLocalizedNameLookup,
  formatActionCount,
  type LocalizedNameLookup,
  setReactInputValue,
} from "./planner-utils";

const QUICK_INPUTS_ID = "mwi-lite-quick-inputs";
const ADD_MODE_STORAGE_KEY = "planner_quick_inputs_add_mode_v1";
const HOUR_PRESETS = [0.5, 1, 2, 4, 8, 12, 24] as const;
const COUNT_PRESETS = [
  { label: "1", value: 1 },
  { label: "10", value: 10 },
  { label: "100", value: 100 },
  { label: "1K", value: 1000 },
  { label: "10K", value: 10000 },
] as const;

interface ActionResolveResult {
  actionHrid: string;
  action: any;
  isCombat: boolean;
}

interface MaxCraftResult {
  isInfinite: boolean;
  max: number;
  bottleneck: string;
}

function parseSpriteHint(detail: Element): string {
  const uses = detail.querySelectorAll("use");
  for (const u of uses) {
    if (u.closest("[data-mwi-lite]")) continue;
    const href = u.getAttribute("href") || u.getAttribute("xlink:href") || "";
    const hashIdx = href.indexOf("#");
    if (hashIdx < 0) continue;
    const key = href.slice(hashIdx + 1).trim();
    if (href.includes("skills_sprite") && key) {
      return `/action_types/${key}`;
    }
  }
  return "";
}

function resolveDetailAction(
  detail: Element,
  clientData: any,
  lookup: LocalizedNameLookup
): ActionResolveResult | null {
  const actionMap: Record<string, any> = clientData?.actionDetailMap || {};
  const nameEl = detail.querySelector('[class*="SkillActionDetail_name"]');
  const actionName = (nameEl?.textContent || "").trim();
  if (!actionName) return null;

  const isInCombatPanel = Boolean(detail.closest('[class*="CombatPanel_combatPanel"]'));
  const typeHint = isInCombatPanel ? "/action_types/combat" : parseSpriteHint(detail);
  const candidates = lookup.actionNameToHrids.get(actionName.toLowerCase()) || [];

  if (typeHint) {
    const exact = candidates.find((hrid) => actionMap[hrid]?.type === typeHint);
    if (exact && actionMap[exact]) {
      return {
        actionHrid: exact,
        action: actionMap[exact],
        isCombat: actionMap[exact].type === "/action_types/combat" || isInCombatPanel,
      };
    }
  }

  for (const hrid of candidates) {
    const act = actionMap[hrid];
    if (act) {
      return {
        actionHrid: hrid,
        action: act,
        isCombat: act.type === "/action_types/combat" || isInCombatPanel,
      };
    }
  }
  return null;
}

function findSelectedLoadout(
  detail: Element,
  actionType: string,
  characterLoadouts: Record<string, any>
): { loadoutId: number | null; loadout: any | null } {
  const dropdowns = detail.querySelectorAll('[class*="SkillActionDetail_loadoutDropdown"]');
  if (!dropdowns.length) return { loadoutId: null, loadout: null };

  let targetDropdown: Element | null = null;
  for (const dd of dropdowns) {
    const labelText = dd.querySelector('[class*="SkillActionDetail_label"]')?.textContent?.trim() || "";
    if (/配装|loadout/i.test(labelText)) {
      targetDropdown = dd;
      break;
    }
  }
  if (!targetDropdown) {
    targetDropdown = dropdowns[dropdowns.length - 1];
  }

  const selectedName =
    targetDropdown.querySelector('.MuiSelect-select')?.textContent?.trim() || "";
  if (!selectedName) return { loadoutId: null, loadout: null };

  for (const [idStr, ld] of Object.entries(characterLoadouts || {})) {
    if (!ld || ld.name !== selectedName) continue;
    if (actionType && ld.actionTypeHrid && ld.actionTypeHrid !== actionType) continue;
    const numId = Number(idStr || ld.id);
    if (Number.isFinite(numId) && numId > 0) {
      return { loadoutId: numId, loadout: ld };
    }
  }
  return { loadoutId: null, loadout: null };
}

function computeMaxCraftable(
  ctx: KernelContext,
  action: any,
  selectedLoadout: any | null,
  lookup: LocalizedNameLookup
): MaxCraftResult {
  const res = computeMaterialLimit({
    actionDetail: action,
    clientData: ctx.gameData.getClientData(),
    characterItems: ctx.gameData.getCharacterItems(),
    drinkSlotsMap: ctx.gameData.getActionTypeDrinkSlots(),
    loadout: selectedLoadout,
  });
  return {
    isInfinite: res.isInfinite,
    max: res.max,
    bottleneck: res.bottleneckHrid ? lookup.getItemName(res.bottleneckHrid) : "",
  };
}

function parseCurrentInputCount(input: HTMLInputElement): number {
  const raw = input.value.trim();
  if (!raw || raw === "∞" || raw.toLowerCase() === "infinity") return 0;
  const n = Number(raw.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function createQuickInputsModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let addMode = false;
  let refreshTimer: number | null = null;
  let cachedClientRef: any = null;
  let cachedLookup: LocalizedNameLookup | null = null;

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

  const injectOrRefresh = () => {
    if (!ctx) return;
    const detail = document.querySelector<HTMLElement>('[class*="SkillActionDetail_skillActionDetail"]');
    if (!detail) return;

    const firstSection = detail.querySelector<HTMLElement>('[class*="maxActionCountInput"]');
    const mainInput = firstSection?.querySelector<HTMLInputElement>('input[class*="Input_input"]');
    if (!firstSection || !mainInput) return;

    const clientData = ctx.gameData.getClientData();
    const lookup = getLookup();
    const resolved = clientData && lookup ? resolveDetailAction(detail, clientData, lookup) : null;
    const actionHrid = resolved?.actionHrid || "";
    const action = resolved?.action || null;
    const isCombat = resolved
      ? resolved.isCombat
      : Boolean(detail.closest('[class*="CombatPanel_combatPanel"]'));

    const characterLoadouts = ctx.gameData.getCharacterLoadouts();
    const { loadoutId, loadout } = findSelectedLoadout(detail, action?.type || "", characterLoadouts);

    let effectiveSecPerCount = 0;
    if (!isCombat && actionHrid && clientData) {
      const currentActions = [...ctx.gameData.getCharacterActions()].sort(
        (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)
      );
      const currentFirstLoadoutId = currentActions[0]?.characterLoadoutID ?? null;
      const est = estimateActionTiming({
        action: loadoutId ? { actionHrid, characterLoadoutID: loadoutId } : { actionHrid },
        actionIndex: loadoutId ? 1 : 0,
        currentActionLoadoutId: currentFirstLoadoutId,
        clientData,
        buffSources: ctx.gameData.getActionTypeBuffSources(),
        characterSkills: ctx.gameData.getCharacterSkills(),
        characterItems: ctx.gameData.getCharacterItems(),
        characterQuests: ctx.gameData.getCharacterQuests(),
        characterLoadouts,
        drinkSlotsMap: ctx.gameData.getActionTypeDrinkSlots(),
      });
      effectiveSecPerCount = est.effectiveSecPerCount;
    }

    const maxResult =
      action && !isCombat && lookup
        ? computeMaxCraftable(ctx, action, loadout, lookup)
        : ({ isInfinite: true, max: Infinity, bottleneck: "" } satisfies MaxCraftResult);

    const sig = `${actionHrid}|${loadoutId ?? ""}|${effectiveSecPerCount.toFixed(3)}|${maxResult.isInfinite ? "inf" : maxResult.max}|${addMode ? 1 : 0}|${ctx.i18n.getLang()}`;
    let container = detail.querySelector<HTMLElement>(`#${QUICK_INPUTS_ID}`);
    if (container && container.dataset.mwiSig === sig) {
      return;
    }

    if (!container) {
      container = document.createElement("div");
      container.id = QUICK_INPUTS_ID;
      container.setAttribute("data-mwi-lite", "1");
      firstSection.insertAdjacentElement("afterend", container);
    }
    container.dataset.mwiSig = sig;
    container.textContent = "";

    const applyValue = (deltaOrTarget: number) => {
      const target = addMode ? parseCurrentInputCount(mainInput) + deltaOrTarget : deltaOrTarget;
      setReactInputValue(mainInput, Math.max(0, Math.floor(target)), false);
    };

    // Row 1: Hours presets (only for non-combat timed actions)
    if (!isCombat && effectiveSecPerCount > 0) {
      const hoursRow = document.createElement("div");
      hoursRow.className = "mwi-lite-qi-row";
      for (const h of HOUR_PRESETS) {
        const count = Math.max(1, Math.round((h * 3600) / effectiveSecPerCount));
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-qi-btn mwi-lite-qi-hour";
        btn.textContent = `${h}h`;
        btn.title = `${h}h ≈ ${count.toLocaleString()} ${ctx.i18n.t("次", "acts")} (${effectiveSecPerCount.toFixed(2)}s/${ctx.i18n.t("次", "act")})`;
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          applyValue(count);
        });
        hoursRow.appendChild(btn);
      }
      container.appendChild(hoursRow);
    }

    // Row 2: Add-mode (+) toggle + Count presets + Max
    const countRow = document.createElement("div");
    countRow.className = "mwi-lite-qi-row";

    const addToggle = document.createElement("button");
    addToggle.type = "button";
    addToggle.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-qi-btn mwi-lite-qi-add";
    addToggle.textContent = "+";
    addToggle.dataset.active = addMode ? "1" : "0";
    addToggle.title = addMode
      ? ctx.i18n.t("累加模式已开启：点击按钮累加数量", "Add Mode ON: click presets to add to current value")
      : ctx.i18n.t("点击开启累加模式 (+)", "Click to enable Add Mode (+)");
    addToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      addMode = !addMode;
      ctx?.storage.set(ADD_MODE_STORAGE_KEY, addMode);
      injectOrRefresh();
    });
    countRow.appendChild(addToggle);

    for (const preset of COUNT_PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-qi-btn";
      btn.textContent = addMode ? `+${preset.label}` : preset.label;
      btn.title = `${addMode ? "+" : ""}${preset.value.toLocaleString()}`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyValue(preset.value);
      });
      countRow.appendChild(btn);
    }

    const maxBtn = document.createElement("button");
    maxBtn.type = "button";
    maxBtn.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-qi-btn mwi-lite-qi-max";
    if (maxResult.isInfinite) {
      maxBtn.textContent = "∞";
      maxBtn.title = ctx.i18n.t("设为无限次 (∞)", "Set unlimited (∞)");
    } else {
      const formatted = formatActionCount(maxResult.max);
      maxBtn.textContent = `Max(${formatted})`;
      maxBtn.title = maxResult.bottleneck
        ? `${ctx.i18n.t("最大可做", "Max craftable")}: ${maxResult.max.toLocaleString()} · ${ctx.i18n.t("受限材料", "Bottleneck")}: ${maxResult.bottleneck}`
        : `${ctx.i18n.t("最大可做", "Max craftable")}: ${maxResult.max.toLocaleString()}`;
    }
    maxBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (maxResult.isInfinite) {
        const infBtn = firstSection.querySelector<HTMLButtonElement>('button:has([aria-label="Unlimited"])');
        if (infBtn && !infBtn.disabled) {
          infBtn.click();
        } else {
          setReactInputValue(mainInput, "∞", false);
        }
        return;
      }
      applyValue(maxResult.max);
    });
    countRow.appendChild(maxBtn);

    container.appendChild(countRow);
  };

  const scheduleRefresh = () => {
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      injectOrRefresh();
    }, 60);
  };

  return {
    id: "planner-quick-inputs",
    nameZh: "动作快捷数量输入",
    nameEn: "Quick Input Buttons",
    descriptionZh:
      "在技能/战斗详情数量框下方添加快捷小时(0.5h~24h)、固定次数(1~10K)、累加(+)与最大可做(Max)按钮。",
    descriptionEn:
      "Adds preset hour (0.5h–24h), count (1–10K), add (+) mode, and Max craftable buttons to action details.",
    category: "planner",
    defaultEnabled: true,
    routes: ["production", "combat", "tasks"],

    init(context) {
      ctx = context;
      addMode = context.storage.get<boolean>(ADD_MODE_STORAGE_KEY, false);
      const unregStyle = context.addStyle(
        "planner-quick-inputs-css",
        `
        #${QUICK_INPUTS_ID} {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin: 4px 0 6px 0;
        }
        #${QUICK_INPUTS_ID} .mwi-lite-qi-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px;
        }
        #${QUICK_INPUTS_ID} .mwi-lite-qi-btn {
          height: 22px !important;
          min-width: 26px !important;
          padding: 0 7px !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          font-family: var(--mwi-px-mono, monospace) !important;
          line-height: 20px !important;
          border-radius: 0 !important;
          border: 1px solid var(--mwi-px-border, #9dbbff) !important;
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%)) !important;
          color: var(--mwi-px-text, #e2e8f0) !important;
          box-shadow: 0 0 0 1px #080d1a !important;
          cursor: pointer !important;
        }
        #${QUICK_INPUTS_ID} .mwi-lite-qi-btn:hover {
          background: var(--mwi-px-btn-hover, linear-gradient(180deg, #405eb3 0%, #2b4385 100%)) !important;
          border-color: var(--mwi-px-border-bright, #d5e5ff) !important;
        }
        #${QUICK_INPUTS_ID} .mwi-lite-qi-hour {
          border-color: #60a5fa !important;
          color: #dbeafe !important;
        }
        #${QUICK_INPUTS_ID} .mwi-lite-qi-add[data-active="1"] {
          background: var(--mwi-px-btn-green, linear-gradient(180deg, #1f6d43 0%, #165132 100%)) !important;
          border-color: var(--mwi-px-green, #4ade80) !important;
          color: #f0fdf4 !important;
        }
        #${QUICK_INPUTS_ID} .mwi-lite-qi-max {
          background: var(--mwi-px-btn-gold, linear-gradient(180deg, #7c580c 0%, #523907 100%)) !important;
          border-color: var(--mwi-px-gold, #fde047) !important;
          color: #fef08a !important;
        }
        `
      );

      const unsubs = [
        context.gameData.on("items_updated", scheduleRefresh),
        context.gameData.on("character_initialized", () => {
          cachedLookup = null;
          scheduleRefresh();
        }),
        context.wsBus.on("actions_updated", scheduleRefresh),
        context.wsBus.on("consumable_buffs_updated", scheduleRefresh),
      ];

      return () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        unsubs.forEach((u) => u());
        unregStyle();
        cachedClientRef = null;
        cachedLookup = null;
        document.getElementById(QUICK_INPUTS_ID)?.remove();
        ctx = null;
      };
    },

    onDom() {
      injectOrRefresh();
    },
  };
}
