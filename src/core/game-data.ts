import { decompressFromUTF16 } from "./lz-utf16";
import type { ActionTypeBuffSources, GameDataAPI, LabyrinthMeta } from "./types";
import { wsBus } from "./ws-bus";

function mergeMarketListings(currentListings: any[] = [], updatedListings: any[] = []): any[] {
  if (!updatedListings.length) return [...currentListings];
  const map = new Map<number | string, any>();
  for (const item of currentListings) {
    if (item && item.id != null) map.set(item.id, item);
  }
  for (const item of updatedListings) {
    if (!item || item.id == null) continue;
    map.set(item.id, item);
  }
  const merged: any[] = [];
  for (const l of map.values()) {
    if (!l) continue;
    if (l.status === "/market_listing_status/cancelled" || l.status === "/market_listing_status/expired") continue;
    if (l.status === "/market_listing_status/filled" && (l.unclaimedCoinCount || 0) <= 0 && (l.unclaimedItemCount || 0) <= 0) {
      continue;
    }
    merged.push(l);
  }
  return merged;
}

class InMemoryGameData implements GameDataAPI {
  private initialized = false;
  private clientData: any | null = null;
  private lastInitClientRaw: string | null = null;
  private characterData: any | null = null;
  private characterItems: any[] = [];
  private characterActions: any[] = [];
  private characterSkills: any[] = [];
  private characterQuests: any[] = [];
  private houseRooms = new Map<string, any>();
  private characterAbilities: any[] = [];
  private abilityCombatTriggersMap: Record<string, any> = {};
  private drinkSlotsMap = new Map<string, any[]>();
  private personalBuffs: Record<string, any> = {};
  private guildActionBuffs: Record<string, any[]> = {};
  private mooPassBuffs: Record<string, any[]> = {};
  private communityBuffs: Record<string, any[]> = {};
  private houseBuffs: Record<string, any[]> = {};
  private achievementBuffs: Record<string, any[]> = {};
  private consumableBuffs: Record<string, any[]> = {};
  private equipmentBuffs: Record<string, any[]> = {};
  private equipmentTaskActionBuffs: any[] = [];
  private characterLoadouts: Record<string, any> = {};
  private hasInitCharBuffs = false;
  private labyrinthData: any | null = null;
  private labyrinthPathCap = 0;
  private labyrinthMaxAttempts = 0;
  private labyrinthFullAutoFloor = 0;
  private labyrinthSkipThresholds: Record<string, number> = {};
  private hasLabyrinthSetting = false;
  private labyrinthRev = 0;
  private battleData: any | null = null;
  private listeners = new Map<string, Set<(data?: any) => void>>();
  private cachedCore: any | null = null;
  private cachedCoreEl: Element | null = null;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.tryDecodeLocalInitClientData();

    wsBus.on("init_client_data", (data) => {
      if (data && data.itemDetailMap) {
        this.clientData = data;
        this.emit("client_data_ready", data);
      }
    });

    wsBus.on("init_character_data", (data) => {
      if (!data?.character?.id) return;
      this.characterData = data;
      this.characterItems = Array.isArray(data.characterItems) ? [...data.characterItems] : [];
      this.characterActions = Array.isArray(data.characterActions) ? [...data.characterActions] : [];
      this.characterSkills = Array.isArray(data.characterSkills) ? [...data.characterSkills] : [];
      this.characterQuests = Array.isArray(data.characterQuests) ? [...data.characterQuests] : [];
      this.characterAbilities = Array.isArray(data.characterAbilities) ? [...data.characterAbilities] : [];
      this.abilityCombatTriggersMap = data.abilityCombatTriggersMap ? { ...data.abilityCombatTriggersMap } : {};

      this.houseRooms.clear();
      if (data.characterHouseRoomMap) {
        for (const [hrid, val] of Object.entries(data.characterHouseRoomMap)) {
          this.houseRooms.set(hrid, val);
        }
      }

      this.drinkSlotsMap.clear();
      if (data.actionTypeDrinkSlotsMap) {
        for (const [k, v] of Object.entries(data.actionTypeDrinkSlotsMap)) {
          this.drinkSlotsMap.set(k, Array.isArray(v) ? v : []);
        }
      }

      this.personalBuffs = data.personalActionTypeBuffsMap || {};
      this.guildActionBuffs = data.guildActionTypeBuffsMap || {};
      this.mooPassBuffs = data.mooPassActionTypeBuffsMap || {};
      this.communityBuffs = data.communityActionTypeBuffsMap || {};
      this.houseBuffs = data.houseActionTypeBuffsMap || {};
      this.achievementBuffs = data.achievementActionTypeBuffsMap || {};
      this.consumableBuffs = data.consumableActionTypeBuffsMap || {};
      this.equipmentBuffs = data.equipmentActionTypeBuffsMap || {};
      this.equipmentTaskActionBuffs = Array.isArray(data.equipmentTaskActionBuffs)
        ? data.equipmentTaskActionBuffs
        : [];
      this.characterLoadouts = data.characterLoadoutMap || {};
      this.hasInitCharBuffs = true;

      this.labyrinthData = data.labyrinth ?? null;
      this.labyrinthPathCap = 0;
      this.labyrinthMaxAttempts = 0;
      this.labyrinthFullAutoFloor = 0;
      this.labyrinthSkipThresholds = {};
      this.hasLabyrinthSetting = false;
      this.labyrinthRev++;
      const cap = data.characterInfo?.labyrinthPathCap;
      if (typeof cap === "number" && cap > 0) this.labyrinthPathCap = cap;
      if (data.characterSetting) {
        this.applyLabyrinthSetting(data.characterSetting);
      }

      this.tryDecodeLocalInitClientData();
      this.emit("character_initialized", data);
    });

    wsBus.on("actions_updated", (data) => {
      if (this.characterData && Array.isArray(data?.endCharacterActions)) {
        for (const action of data.endCharacterActions) {
          this.characterActions = this.characterActions.filter((a) => a.id !== action.id);
          if (action.isDone === false) {
            this.characterActions.push(action);
          }
        }
      }
      this.emit("actions_updated", data);
    });

    wsBus.on("action_completed", (data) => {
      if (this.characterData) {
        const action = data?.endCharacterAction;
        if (action && action.isDone === false) {
          const idx = this.characterActions.findIndex((a) => a.id === action.id);
          if (idx !== -1) this.characterActions[idx] = action;
        }

        if (Array.isArray(data?.endCharacterItems)) {
          for (const endItem of data.endCharacterItems) {
            const idx = this.characterItems.findIndex((i) => i.id === endItem.id);
            if (idx !== -1) {
              if (endItem.count === 0) this.characterItems.splice(idx, 1);
              else this.characterItems[idx] = { ...this.characterItems[idx], ...endItem };
            } else if (endItem.count > 0) {
              this.characterItems.push(endItem);
            }
          }
        }

        if (Array.isArray(data?.endCharacterSkills)) {
          for (const sk of data.endCharacterSkills) {
            const existing = this.characterSkills.find((s) => s.skillHrid === sk.skillHrid);
            if (existing) {
              existing.experience = sk.experience;
              if (sk.level !== undefined) existing.level = sk.level;
            }
          }
        }
      }

      if (Array.isArray(data?.endCharacterItems)) this.emit("items_updated", data);
      if (Array.isArray(data?.endCharacterSkills)) this.emit("skills_updated", data);
      this.emit("action_completed", data);
    });

    wsBus.on("items_updated", (data) => {
      if (this.characterData && Array.isArray(data?.endCharacterItems)) {
        for (const item of data.endCharacterItems) {
          const idx = this.characterItems.findIndex((i) => i.id === item.id);
          if (idx !== -1) {
            if (item.count === 0) this.characterItems.splice(idx, 1);
            else this.characterItems[idx] = { ...this.characterItems[idx], ...item };
          } else if (item.count > 0) {
            this.characterItems.push(item);
          }
        }
      }
      if (Array.isArray(data?.endCharacterItems)) this.emit("items_updated", data);
    });

    wsBus.on("market_listings_updated", (data) => {
      if (!this.characterData || !Array.isArray(data?.endMarketListings)) return;
      const prev = Array.isArray(this.characterData.myMarketListings) ? this.characterData.myMarketListings : [];
      this.characterData.myMarketListings = mergeMarketListings(prev, data.endMarketListings);
      this.emit("market_listings_updated", this.characterData.myMarketListings);
    });

    wsBus.on("action_type_consumable_slots_updated", (data) => {
      if (data?.actionTypeDrinkSlotsMap) {
        for (const [k, v] of Object.entries(data.actionTypeDrinkSlotsMap)) {
          this.drinkSlotsMap.set(k, Array.isArray(v) ? v : []);
        }
        this.emit("consumables_updated", data);
      }
    });

    wsBus.on("personal_buffs_updated", (data) => {
      if (data?.personalActionTypeBuffsMap) {
        this.personalBuffs = data.personalActionTypeBuffsMap;
        this.hasInitCharBuffs = true;
        this.emit("personal_buffs_updated", data);
        this.emit("buffs_updated", data);
      }
    });

    wsBus.on("moo_pass_buffs_updated", (data) => {
      if (data?.mooPassActionTypeBuffsMap) {
        this.mooPassBuffs = data.mooPassActionTypeBuffsMap;
        this.hasInitCharBuffs = true;
        this.emit("buffs_updated", data);
      }
    });

    wsBus.on("community_buffs_updated", (data) => {
      if (data?.communityActionTypeBuffsMap) {
        this.communityBuffs = data.communityActionTypeBuffsMap;
        this.hasInitCharBuffs = true;
        this.emit("buffs_updated", data);
      }
    });

    wsBus.on("guild_buffs_updated", (data) => {
      if (data?.guildActionTypeBuffsMap) {
        this.guildActionBuffs = data.guildActionTypeBuffsMap;
        this.hasInitCharBuffs = true;
        this.emit("buffs_updated", data);
      }
    });

    wsBus.on("achievement_buffs_updated", (data) => {
      if (data?.achievementActionTypeBuffsMap) {
        this.achievementBuffs = data.achievementActionTypeBuffsMap;
        this.hasInitCharBuffs = true;
        this.emit("buffs_updated", data);
      }
    });

    wsBus.on("consumable_buffs_updated", (data) => {
      if (data?.consumableActionTypeBuffsMap) {
        this.consumableBuffs = data.consumableActionTypeBuffsMap;
        this.hasInitCharBuffs = true;
        this.emit("buffs_updated", data);
      }
    });

    wsBus.on("equipment_buffs_updated", (data) => {
      if (data?.equipmentActionTypeBuffsMap) {
        this.equipmentBuffs = data.equipmentActionTypeBuffsMap;
        this.hasInitCharBuffs = true;
      }
      if (Array.isArray(data?.equipmentTaskActionBuffs)) {
        this.equipmentTaskActionBuffs = data.equipmentTaskActionBuffs;
      }
      this.emit("buffs_updated", data);
    });

    wsBus.on("loadouts_updated", (data) => {
      if (data?.characterLoadoutMap) {
        this.characterLoadouts = data.characterLoadoutMap;
        this.emit("buffs_updated", data);
      }
    });

    wsBus.on("house_rooms_updated", (data) => {
      if (this.characterData && data?.characterHouseRoomMap) {
        for (const [k, v] of Object.entries(data.characterHouseRoomMap)) {
          this.houseRooms.set(k, v);
        }
      }
      if (data?.houseActionTypeBuffsMap) {
        this.houseBuffs = data.houseActionTypeBuffsMap;
        this.hasInitCharBuffs = true;
      }
      this.emit("house_rooms_updated", data);
      this.emit("buffs_updated", data);
    });

    wsBus.on("abilities_updated", (data) => {
      if (this.characterData) {
        if (Array.isArray(data?.characterAbilities)) {
          this.characterAbilities = [...data.characterAbilities];
        }
        if (data?.abilityCombatTriggersMap) {
          this.abilityCombatTriggersMap = { ...data.abilityCombatTriggersMap };
        }
      }
      this.emit("abilities_updated", data);
    });

    wsBus.on("skills_updated", (data) => {
      if (this.characterData) {
        const delta = Array.isArray(data?.endCharacterSkills)
          ? data.endCharacterSkills
          : Array.isArray(data?.characterSkills)
            ? data.characterSkills
            : null;
        if (delta && delta.length > 0) {
          for (const sk of delta) {
            if (!sk?.skillHrid) continue;
            const idx = this.characterSkills.findIndex((s) => s.skillHrid === sk.skillHrid);
            if (idx !== -1) this.characterSkills[idx] = { ...this.characterSkills[idx], ...sk };
            else this.characterSkills.push(sk);
          }
        }
      }
      this.emit("skills_updated", data);
    });

    wsBus.on("quests_updated", (data) => {
      if (this.characterData && Array.isArray(data?.endCharacterQuests)) {
        const map = new Map<number | string, any>();
        for (const q of this.characterQuests) {
          if (q?.id != null) map.set(q.id, q);
        }
        for (const q of data.endCharacterQuests) {
          if (q?.id != null) map.set(q.id, q);
        }
        this.characterQuests = Array.from(map.values());
      }
      this.emit("quests_updated", data);
    });

    wsBus.on("character_info_updated", (data) => {
      const cap = data?.characterInfo?.labyrinthPathCap;
      if (typeof cap === "number" && cap > 0 && cap !== this.labyrinthPathCap) {
        this.labyrinthPathCap = cap;
        this.labyrinthRev++;
        this.emit("labyrinth_updated", data);
      }
    });

    wsBus.on("setting_updated", (data) => {
      const set = data?.characterSetting;
      if (set) {
        this.applyLabyrinthSetting(set);
        this.labyrinthRev++;
        this.emit("labyrinth_updated", data);
      }
    });

    wsBus.on("labyrinth_updated", (data) => {
      if (data && typeof data === "object" && "labyrinth" in data) {
        this.labyrinthData = data.labyrinth ?? null;
      } else {
        this.labyrinthData = data ?? null;
      }
      this.labyrinthRev++;
      this.emit("labyrinth_updated", data);
    });

    wsBus.on("new_battle", (data) => {
      this.battleData = data;
      this.emit("new_battle", data);
    });

    wsBus.on("battle_updated", (data) => {
      this.emit("battle_updated", data);
    });
  }

  private tryDecodeLocalInitClientData(): any | null {
    try {
      const raw = localStorage.getItem("initClientData");
      if (!raw) return null;
      if (this.clientData && this.lastInitClientRaw === raw) return this.clientData;
      const jsonStr = decompressFromUTF16(raw);
      if (!jsonStr) return null;
      const parsed = JSON.parse(jsonStr);
      if (parsed && parsed.itemDetailMap) {
        this.lastInitClientRaw = raw;
        this.clientData = parsed;
        this.emit("client_data_ready", parsed);
        return parsed;
      }
    } catch {
      // Ignore partial write or invalid data
    }
    return null;
  }

  getClientData(): any | null {
    if (!this.clientData) {
      this.tryDecodeLocalInitClientData();
    }
    return this.clientData;
  }

  getCharacterData(): any | null {
    if (!this.characterData) {
      const core = this.getReactGameCore();
      if (core?.state?.character) {
        return core.state;
      }
    }
    return this.characterData;
  }

  getCharacterId(): number | string | null {
    return this.getCharacterData()?.character?.id ?? null;
  }

  getCharacterName(): string | null {
    return this.getCharacterData()?.character?.name ?? null;
  }

  getCharacterItems(): any[] {
    if (this.characterItems.length > 0) return this.characterItems;
    const core = this.getReactGameCore();
    if (core?.state?.characterItemMap instanceof Map) {
      return Array.from(core.state.characterItemMap.values());
    }
    return [];
  }

  getCharacterActions(): any[] {
    const core = this.getReactGameCore();
    if (Array.isArray(core?.state?.characterActions) && core.state.characterActions.length > 0) {
      return core.state.characterActions;
    }
    return this.characterActions;
  }

  getCharacterSkills(): any[] {
    if (this.characterSkills.length > 0) return this.characterSkills;
    const core = this.getReactGameCore();
    if (core?.state?.characterSkillMap instanceof Map) {
      return Array.from(core.state.characterSkillMap.values());
    }
    if (Array.isArray(core?.state?.characterSkills)) return core.state.characterSkills;
    return [];
  }

  getCharacterQuests(): any[] {
    if (this.characterData && this.characterQuests.length > 0) return this.characterQuests;
    const core = this.getReactGameCore();
    if (core?.state?.characterQuestMap instanceof Map) {
      return Array.from(core.state.characterQuestMap.values());
    }
    if (Array.isArray(core?.state?.characterQuests)) return core.state.characterQuests;
    return this.characterQuests;
  }

  getMarketListings(): any[] {
    const data = this.getCharacterData();
    if (this.characterData && Array.isArray(data?.myMarketListings)) return data.myMarketListings;
    const core = this.getReactGameCore();
    if (core?.state?.myMarketListingMap instanceof Map) {
      return Array.from(core.state.myMarketListingMap.values());
    }
    return [];
  }

  getHouseRooms(): Map<string, any> {
    if (this.houseRooms.size > 0) return this.houseRooms;
    const core = this.getReactGameCore();
    if (core?.state?.characterHouseRoomMap instanceof Map) {
      return core.state.characterHouseRoomMap;
    }
    if (core?.state?.characterHouseRoomDict && typeof core.state.characterHouseRoomDict === "object") {
      return new Map(Object.entries(core.state.characterHouseRoomDict));
    }
    return this.houseRooms;
  }

  getCharacterAbilities(): any[] {
    if (this.characterAbilities.length > 0) return this.characterAbilities;
    const core = this.getReactGameCore();
    if (core?.state?.characterAbilityMap instanceof Map) {
      return Array.from(core.state.characterAbilityMap.values());
    }
    if (Array.isArray(core?.state?.characterAbilities)) return core.state.characterAbilities;
    return this.characterAbilities;
  }

  getAbilityCombatTriggers(): Record<string, any> {
    if (Object.keys(this.abilityCombatTriggersMap).length > 0) return this.abilityCombatTriggersMap;
    const core = this.getReactGameCore();
    if (core?.state?.abilityCombatTriggersDict && typeof core.state.abilityCombatTriggersDict === "object") {
      return core.state.abilityCombatTriggersDict;
    }
    if (core?.state?.abilityCombatTriggersMap instanceof Map) {
      return Object.fromEntries(core.state.abilityCombatTriggersMap);
    }
    if (core?.state?.abilityCombatTriggersMap && typeof core.state.abilityCombatTriggersMap === "object") {
      return core.state.abilityCombatTriggersMap;
    }
    return this.abilityCombatTriggersMap;
  }

  getActionTypeDrinkSlots(): Map<string, any[]> {
    if (this.drinkSlotsMap.size > 0) return this.drinkSlotsMap;
    const core = this.getReactGameCore();
    if (core?.state?.actionTypeDrinkSlotsMap instanceof Map) {
      return core.state.actionTypeDrinkSlotsMap;
    }
    if (core?.state?.actionTypeDrinkSlotsDict && typeof core.state.actionTypeDrinkSlotsDict === "object") {
      const map = new Map<string, any[]>();
      for (const [k, v] of Object.entries(core.state.actionTypeDrinkSlotsDict)) {
        map.set(k, Array.isArray(v) ? v : []);
      }
      return map;
    }
    return this.drinkSlotsMap;
  }

  getPersonalBuffs(): Record<string, any> {
    if (this.hasInitCharBuffs) return this.personalBuffs;
    const core = this.getReactGameCore();
    return core?.state?.personalActionTypeBuffsDict || this.personalBuffs;
  }

  getGuildActionBuffs(): Record<string, any[]> {
    if (this.hasInitCharBuffs) return this.guildActionBuffs;
    const core = this.getReactGameCore();
    return core?.state?.guildActionTypeBuffsDict || this.guildActionBuffs;
  }

  getActionTypeBuffSources(): ActionTypeBuffSources {
    if (this.hasInitCharBuffs) {
      return {
        mooPass: this.mooPassBuffs,
        community: this.communityBuffs,
        house: this.houseBuffs,
        guild: this.guildActionBuffs,
        achievement: this.achievementBuffs,
        consumable: this.consumableBuffs,
        equipment: this.equipmentBuffs,
        personal: this.personalBuffs,
        equipmentTaskActionBuffs: this.equipmentTaskActionBuffs,
      };
    }
    const st = this.getReactGameCore()?.state;
    return {
      mooPass: st?.mooPassActionTypeBuffsDict || this.mooPassBuffs,
      community: st?.communityActionTypeBuffsDict || this.communityBuffs,
      house: st?.houseActionTypeBuffsDict || this.houseBuffs,
      guild: st?.guildActionTypeBuffsDict || this.guildActionBuffs,
      achievement: st?.achievementActionTypeBuffsDict || this.achievementBuffs,
      consumable: st?.consumableActionTypeBuffsDict || this.consumableBuffs,
      equipment: st?.equipmentActionTypeBuffsDict || this.equipmentBuffs,
      personal: st?.personalActionTypeBuffsDict || this.personalBuffs,
      equipmentTaskActionBuffs: Array.isArray(st?.equipmentTaskActionBuffs)
        ? st.equipmentTaskActionBuffs
        : this.equipmentTaskActionBuffs,
    };
  }

  getCharacterLoadouts(): Record<string, any> {
    if (Object.keys(this.characterLoadouts).length > 0) return this.characterLoadouts;
    const st = this.getReactGameCore()?.state;
    return st?.characterLoadoutDict || this.characterLoadouts;
  }

  getLabyrinthData(): any | null {
    const reactLab = this.getReactGameCore()?.state?.characterLabyrinth ?? null;
    if (!this.labyrinthData) return reactLab;
    if (reactLab && reactLab !== this.labyrinthData) {
      const memTs = Date.parse(this.labyrinthData.updatedAt || "");
      const reactTs = Date.parse(reactLab.updatedAt || "");
      if (
        (Number.isFinite(reactTs) && (!Number.isFinite(memTs) || reactTs > memTs)) ||
        (reactLab.characterID && this.labyrinthData.characterID && reactLab.characterID !== this.labyrinthData.characterID)
      ) {
        this.labyrinthData = reactLab;
        this.labyrinthRev++;
      }
    }
    return this.labyrinthData;
  }

  private extractSkipThresholds(setting: Record<string, any> | null | undefined): Record<string, number> {
    const out: Record<string, number> = {};
    if (!setting || typeof setting !== "object") return out;
    for (const [k, v] of Object.entries(setting)) {
      if (!k.startsWith("labyrinthSkip") || typeof v !== "number" || !Number.isFinite(v)) continue;
      const suffix = k.slice("labyrinthSkip".length);
      if (!suffix) continue;
      const snake = suffix
        .replace(/([A-Z])/g, "_$1")
        .replace(/^_/, "")
        .toLowerCase();
      if (snake) out[snake] = v;
    }
    return out;
  }

  private applyLabyrinthSetting(setting: Record<string, any>): void {
    this.labyrinthMaxAttempts = setting.labyrinthMaxAttemptsPerRoom ?? 1;
    this.labyrinthFullAutoFloor = setting.labyrinthFullAutoFloor || 0;
    this.labyrinthSkipThresholds = this.extractSkipThresholds(setting);
    this.hasLabyrinthSetting = true;
  }

  getLabyrinthMeta(): LabyrinthMeta {
    const st = this.getReactGameCore()?.state;
    const pathCap =
      this.labyrinthPathCap > 0
        ? this.labyrinthPathCap
        : Number(st?.characterInfo?.labyrinthPathCap) || 3;
    const maxAttempts = this.hasLabyrinthSetting
      ? this.labyrinthMaxAttempts
      : st?.characterSetting?.labyrinthMaxAttemptsPerRoom ?? 1;
    const fullAutoFloor = this.hasLabyrinthSetting
      ? this.labyrinthFullAutoFloor
      : st?.characterSetting?.labyrinthFullAutoFloor || 0;
    const skipThresholds = this.hasLabyrinthSetting
      ? this.labyrinthSkipThresholds
      : this.extractSkipThresholds(st?.characterSetting);
    return {
      pathCap,
      maxAttempts,
      fullAutoFloor,
      skipThresholds,
      rev: this.labyrinthRev,
    };
  }

  getBattleData(): any | null {
    return this.battleData;
  }

  getReactGameCore(forceRefresh = false): any | null {
    if (!forceRefresh && this.cachedCore && this.cachedCoreEl?.isConnected) {
      return this.cachedCore;
    }
    const el =
      document.querySelector('[class^="GamePage_gamePage"]') ||
      document.querySelector('[class*="GamePage_gamePage"]') ||
      document.querySelector('[class^="GamePage"]');
    if (!el) return null;

    const fiberKey = Reflect.ownKeys(el).find(
      (k) => typeof k === "string" && (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
    );
    if (!fiberKey) return null;

    let fiber: any = (el as any)[fiberKey];
    for (let depth = 0; fiber && depth < 24; depth++) {
      const sn = fiber.stateNode;
      if (
        sn &&
        typeof sn === "object" &&
        (sn.state?.character || sn.state?.skillingActionTypeBuffsDict || sn.props?.i18n || sn.handleMoveCharacterActionByOne)
      ) {
        this.cachedCoreEl = el;
        this.cachedCore = sn;
        return sn;
      }
      fiber = fiber.return;
    }
    return null;
  }

  on(event: string, handler: (data?: any) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  private emit(event: string, data?: any): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[MWI Lite gameData] listener error (${event}):`, err);
      }
    }
  }
}

export const gameData: GameDataAPI = new InMemoryGameData();
