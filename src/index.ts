import {
  domScheduler,
  gameData,
  getPageWindow,
  marketStore,
  mountSettingsUI,
  registry,
  wsBus,
} from "./core";
import { mountPixelTheme } from "./core/pixel-theme";
import { HUGUNN_VERSION } from "./core/version";
import { combatModules, isLabyrinthWorkerActive } from "./features/combat";
import { marketModules } from "./features/market";
import { plannerModules } from "./features/planner";

const VERSION = HUGUNN_VERSION;

function bootstrap(): void {
  const pageWin = getPageWindow() as any;
  if (pageWin.__MWI_LITE_BOOTSTRAPPED__ || (window as any).__MWI_LITE_BOOTSTRAPPED__) {
    return;
  }
  pageWin.__MWI_LITE_BOOTSTRAPPED__ = true;
  (window as any).__MWI_LITE_BOOTSTRAPPED__ = true;

  // 1. Install single passive WebSocket bus at document-start before game opens WS
  wsBus.install();

  // 2. Initialize single in-memory gameData & IndexedDB marketStore
  gameData.init();
  marketStore.init();

  // 3. Register all feature modules across the 3 trimmed domains
  registry.registerAll([...marketModules, ...plannerModules, ...combatModules]);
  registry.initAll();

  // 4. Start global single rAF-batched MutationObserver + route gate, pixel theme & settings drawer
  mountPixelTheme();
  mountSettingsUI(isLabyrinthWorkerActive);
  domScheduler.start();

  // 5. Expose lightweight read-only diagnostic handle
  const diag = Object.freeze({
    name: "MWI · Hugunn",
    version: VERSION,
    getActiveRoute: () => domScheduler.getActiveRoute(),
    getModules: () =>
      registry.list().map(({ module, enabled }) => ({
        id: module.id,
        category: module.category,
        enabled,
      })),
    isWorkerActive: () => isLabyrinthWorkerActive(),
    getWsMessageCount: () => wsBus.getMessageCount(),
  });

  try {
    (window as any).__MWI_HUGUNN__ = diag;
    (window as any).__MWI_LITE_SUITE__ = diag;
    if (pageWin !== window) {
      pageWin.__MWI_HUGUNN__ = diag;
      pageWin.__MWI_LITE_SUITE__ = diag;
    }
  } catch {
    // Ignore read-only global constraints
  }
}

bootstrap();
