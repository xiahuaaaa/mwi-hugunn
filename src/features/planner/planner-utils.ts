import type { KernelContext } from "../../core/types";

/** Format large integer action/item counts concisely (e.g. 1.2K, 3.4M). */
export function formatActionCount(n: number): string {
  const v = Math.floor(n);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(v);
}

/** Programmatically update a React controlled HTMLInputElement and emit input/change events. */
export function setReactInputValue(
  input: HTMLInputElement,
  value: number | string,
  focusInput = true
): void {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  proto?.set?.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  if (focusInput) input.focus();
}

/** Resolve all candidate output item HRIDs for a non-combat action. */
export function resolveActionOutputHrids(actionHrid: string, clientData: any): string[] {
  const action = clientData?.actionDetailMap?.[actionHrid];
  if (!action || action.type === "/action_types/combat") return [];
  const itemMap = clientData?.itemDetailMap || {};
  const outputs: string[] = [];
  const pushUnique = (hrid: unknown) => {
    if (typeof hrid === "string" && itemMap[hrid] && !outputs.includes(hrid)) {
      outputs.push(hrid);
    }
  };

  if (Array.isArray(action.outputItems)) {
    for (const out of action.outputItems) {
      pushUnique(out?.itemHrid);
    }
  }
  // Gathering actions (milking/foraging/woodcutting) store outputs in dropTable
  if (outputs.length === 0 && Array.isArray(action.dropTable)) {
    for (const drop of action.dropTable) {
      pushUnique(drop?.itemHrid);
    }
  }
  if (outputs.length === 0) {
    const actionKey = actionHrid.split("/").pop() || "";
    if (actionKey) pushUnique(`/items/${actionKey}`);
  }
  return outputs;
}

/** Sum inventory stacks (/item_locations/inventory) by itemHrid. */
export function buildInventoryCountMap(context: KernelContext): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of context.gameData.getCharacterItems()) {
    if (!item?.itemHrid || !item.count || item.count <= 0) continue;
    if (item.itemLocationHrid && item.itemLocationHrid !== "/item_locations/inventory") continue;
    counts.set(item.itemHrid, (counts.get(item.itemHrid) || 0) + item.count);
  }
  return counts;
}

export interface LocalizedNameLookup {
  readonly actionNameToHrids: ReadonlyMap<string, readonly string[]>;
  readonly getItemName: (itemHrid: string) => string;
}

/**
 * Build localized name lookups from i18n resource bundles + clientData fallback.
 * Supports mapping localized UI action names (e.g. "木板") back to actionHrids.
 */
export function buildLocalizedNameLookup(context: KernelContext): LocalizedNameLookup {
  const actionNameToHrids = new Map<string, string[]>();
  const itemNameMap = new Map<string, string>();
  const clientData = context.gameData.getClientData();

  const addActionAlias = (rawName: unknown, hrid: string) => {
    if (typeof rawName !== "string" || !hrid) return;
    const key = rawName.trim().toLowerCase();
    if (!key) return;
    let list = actionNameToHrids.get(key);
    if (!list) {
      list = [];
      actionNameToHrids.set(key, list);
    }
    if (!list.includes(hrid)) list.push(hrid);
  };

  if (clientData?.actionDetailMap) {
    for (const [hrid, detail] of Object.entries<any>(clientData.actionDetailMap)) {
      addActionAlias(detail?.name, hrid);
    }
  }

  const core = context.gameData.getReactGameCore();
  const resources = core?.props?.i18n?.options?.resources;
  const activeLang = core?.props?.i18n?.language;
  if (resources) {
    for (const [lang, bundle] of Object.entries<any>(resources)) {
      const trans = bundle?.translation;
      if (trans?.actionNames) {
        for (const [hrid, name] of Object.entries(trans.actionNames)) {
          addActionAlias(name, hrid);
        }
      }
      if (trans?.itemNames && (!activeLang || lang === activeLang)) {
        for (const [hrid, name] of Object.entries(trans.itemNames)) {
          if (typeof name === "string" && name.trim()) {
            itemNameMap.set(hrid, name.trim());
          }
        }
      }
    }
  }

  const getItemName = (itemHrid: string): string => {
    return itemNameMap.get(itemHrid) || clientData?.itemDetailMap?.[itemHrid]?.name || itemHrid;
  };

  return { actionNameToHrids, getItemName };
}

export interface ActionResolveResult {
  actionHrid: string;
  action: any;
  isCombat: boolean;
}

function getDirectText(el: Element | null): string {
  if (!el) return "";
  let text = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue || "";
    }
  }
  const trimmed = text.trim();
  return trimmed || (el.textContent || "").trim();
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

export function resolveDetailAction(
  detail: Element,
  clientData: any,
  lookup: LocalizedNameLookup
): ActionResolveResult | null {
  const actionMap: Record<string, any> = clientData?.actionDetailMap || {};
  const nameEl = detail.querySelector('[class*="SkillActionDetail_name"]');
  const actionName = getDirectText(nameEl);
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

export function findSelectedLoadout(
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

export function parsePositiveActionCount(input: HTMLInputElement): number | null {
  const raw = input.value.trim();
  if (!raw || raw === "∞" || raw.toLowerCase() === "infinity") return null;
  const n = Number(raw.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
