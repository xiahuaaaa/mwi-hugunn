import type { WsBus, WsHandler } from "./types";

declare const unsafeWindow: (Window & typeof globalThis) | undefined;

export function getPageWindow(): Window & typeof globalThis {
  try {
    if (typeof unsafeWindow !== "undefined" && unsafeWindow) {
      return unsafeWindow;
    }
  } catch {
    // Ignore
  }
  return window;
}

const SKIP_DEDUP_TYPES = new Set([
  "action_completed",
  "items_updated",
  "market_item_order_books_updated",
  "market_listings_updated",
  "actions_updated",
  "quests_updated",
  "skills_updated",
  "house_rooms_updated",
  "action_type_consumable_slots_updated",
  "consumable_buffs_updated",
  "personal_buffs_updated",
  "character_info_updated",
  "setting_updated",
  "labyrinth_updated",
  "labyrinth_room_progress",
  "new_battle",
  "battle_updated",
  "battle_unit_fetched",
  "loot_opened",
]);

class PassiveWsBus implements WsBus {
  private installed = false;
  private listeners = new Map<string, Set<WsHandler>>();
  private anyListeners = new Set<WsHandler>();
  private seenEvents = new WeakSet<MessageEvent>();
  private recentHashes = new Map<string, number>();
  private messageCount = 0;

  install(): void {
    if (this.installed) return;
    this.installed = true;

    const pageWin = getPageWindow();
    const bus = this;

    // 1) Wrap page WebSocket constructor passively (read-only message listener)
    try {
      const wrapCtor = (OrigWS: typeof WebSocket | undefined) => {
        if (!OrigWS || (OrigWS as any).__mwiLiteWrapped) return OrigWS;
        const isNative = /\[native code\]/.test(Function.prototype.toString.call(OrigWS));
        if (!isNative) return OrigWS;

        class LiteWrappedWebSocket extends OrigWS {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            bus.attachSocket(this);
          }
        }
        (LiteWrappedWebSocket as any).__mwiLiteWrapped = true;
        return LiteWrappedWebSocket;
      };

      let currentWS = wrapCtor(pageWin.WebSocket);
      const desc = Object.getOwnPropertyDescriptor(pageWin, "WebSocket");
      if (!desc || desc.configurable) {
        Object.defineProperty(pageWin, "WebSocket", {
          configurable: true,
          enumerable: true,
          get() {
            return currentWS;
          },
          set(nextWs: typeof WebSocket) {
            currentWS = wrapCtor(nextWs);
          },
        });
      }
    } catch {
      // Fallback handled by MessageEvent.prototype.data hook below
    }

    // 2) Fallback hook on page MessageEvent.prototype.data for pre-existing or already-wrapped sockets
    try {
      const pageMsgProto = (pageWin.MessageEvent || MessageEvent).prototype;
      const dataDesc = Object.getOwnPropertyDescriptor(pageMsgProto, "data");
      if (dataDesc && typeof dataDesc.get === "function") {
        const originalGet = dataDesc.get;
        Object.defineProperty(pageMsgProto, "data", {
          configurable: true,
          enumerable: dataDesc.enumerable ?? true,
          get() {
            const msg = originalGet.call(this);
            const target = (this as MessageEvent).currentTarget;
            if (target && bus.isGameSocket(target as WebSocket) && !bus.seenEvents.has(this)) {
              bus.seenEvents.add(this);
              bus.handleRawMessage(msg);
            }
            return msg;
          },
        });
      }
    } catch {
      // Ignore if non-configurable
    }
  }

  private attachSocket(socket: WebSocket): void {
    if ((socket as any).__mwiLiteAttached) return;
    (socket as any).__mwiLiteAttached = true;
    socket.addEventListener("message", (ev: MessageEvent) => {
      if (!this.isGameSocket(socket)) return;
      if (this.seenEvents.has(ev)) return;
      this.seenEvents.add(ev);
      this.handleRawMessage(ev.data);
    });
  }

  private isGameSocket(socket: unknown): boolean {
    const url = (socket as WebSocket | null)?.url;
    if (!url || typeof url !== "string") return false;
    return (
      url.includes("api.milkywayidle.com/ws") ||
      url.includes("api-test.milkywayidle.com/ws") ||
      url.includes("milkywayidlecn.com/ws")
    );
  }

  private handleRawMessage(raw: unknown): void {
    if (typeof raw !== "string" || raw.length < 2 || raw[0] !== "{") return;

    // Fast type pre-check before duplicate filtering
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const msgType = parsed?.type;
    if (typeof msgType !== "string" || !msgType) return;

    if (!SKIP_DEDUP_TYPES.has(msgType)) {
      const hash = raw.slice(0, 110) + ":" + raw.length;
      const now = Date.now();
      const prev = this.recentHashes.get(hash);
      if (prev && now - prev < 500) return;
      this.recentHashes.set(hash, now);
      if (this.recentHashes.size > 120) {
        for (const [k, ts] of this.recentHashes) {
          if (now - ts > 4000) this.recentHashes.delete(k);
        }
      }
    }

    this.messageCount++;

    const set = this.listeners.get(msgType);
    if (set) {
      for (const fn of set) {
        try {
          fn(parsed, msgType);
        } catch (err) {
          console.error(`[MWI Lite wsBus] handler error (${msgType}):`, err);
        }
      }
    }

    for (const fn of this.anyListeners) {
      try {
        fn(parsed, msgType);
      } catch (err) {
        console.error("[MWI Lite wsBus] any-handler error:", err);
      }
    }
  }

  on(messageType: string, handler: WsHandler): () => void {
    let set = this.listeners.get(messageType);
    if (!set) {
      set = new Set();
      this.listeners.set(messageType, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  onAny(handler: WsHandler): () => void {
    this.anyListeners.add(handler);
    return () => this.anyListeners.delete(handler);
  }

  isInstalled(): boolean {
    return this.installed;
  }

  getMessageCount(): number {
    return this.messageCount;
  }
}

export const wsBus: WsBus = new PassiveWsBus();
