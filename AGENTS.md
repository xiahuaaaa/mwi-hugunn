# MWI · Hugunn Engineering Guidelines

Single-file, zero-`@require`, micro-kernel Tampermonkey userscript for Milky Way Idle (`dist/mwi-hugunn.user.js`). All new features, refactors, and bug fixes must follow these engineering standards.

## 1. Lightweight

- Keep `@require = 0` in [build.mjs](build.mjs): rely on native TypeScript, Web APIs, and small self-contained algorithms instead of heavy third-party runtime libraries (e.g., Chart.js, external math/FFT packages).
- Keep GM storage (`ctx.storage`) strictly for feature toggles, small user preferences, and bounded history logs (enforced max-entry caps). Keep large static client tables in memory (`gameData`) and market prices / history in `marketStore` (IndexedDB + TTL).
- Render compact badges or single-row summary bars inline by default; open complex tables or multi-player views on demand inside modals.

## 2. High Performance

- **Single `MutationObserver` (`new MutationObserver = 1`)**: route all DOM work through `domScheduler` + `FeatureModule.onDom` + `routes` gating; reuse existing DOM infrastructure instead of creating module-level observers.
- **Single Passive WebSocket Bus (`ws.send = 0`)**: parse each frame once in [ws-bus.ts](src/core/ws-bus.ts) and dispatch by `type`; keep socket listeners read-only.
- **Lazy Worker (`new Worker <= 1`)**: allocate heavy simulation workers on demand for active panels and `terminate()` them after leaving the panel.
- **Zero-thrash rendering**: update DOM on WS/user events or `onDom()` with content-signature short-circuiting so unchanged states skip DOM writes; tag every injected root node with `data-mwi-lite="1"` to avoid observer self-trigger loops.
- **Cache non-trivial computations**: memoize FFT CDFs, drop expectations/variances, valuation sweeps, recipe expansions, and simulations by input/epoch keys; keep `onDom()` hot paths O(1).
- **Unified 16-bit SNES Pixel UI Theme**: mount shared CSS variables via [pixel-theme.ts](src/core/pixel-theme.ts) (`--mwi-px-*`); all new and existing UIs must use sharp `0px` pixel corners, stepped Starlight RPG borders/shadows, beveled pixel buttons, `tabular-nums` monospace numeric columns, and `data-mwi-lite="1"` on injected roots.

## 3. High Cohesion

- Group business features under `src/features/{market,planner,combat}/`. Give each `FeatureModule` one clear responsibility and return a full `dispose()` cleanup in `init()` that removes styles, listeners, and injected DOM nodes when toggled off.
- **Separate pure computation from UI**: place non-trivial math, pricing, and domain rules in DOM-free engine modules within the same domain (e.g., `combat-luck-engine.ts`, `enhancement-math.ts`, `networth-valuation.ts`); keep UI modules focused on `KernelContext` wiring and rendering.
- **Prefer authoritative WS snapshots**: drive state from server messages (e.g., `new_battle`, `init_character_data`, `market_item_order_books_updated`) rather than fragile DOM regex scraping or cross-action inventory diffing.

## 4. Low Coupling

- **Strict one-way dependency graph**:
  - `src/features/<domain>/*` may import only from `src/core/*` (prefer `KernelContext` APIs) and helpers inside the same `<domain>/`;
  - Shared cross-domain capabilities belong in `src/core/` with minimal interfaces exported via [src/core/types.ts](src/core/types.ts); keep domain directories isolated from direct cross-domain imports;
  - `src/core/*` must stay independent of `src/features/*` (no reverse imports).
- **Fault isolation & safety**: guard nested WebSocket payload accesses with optional chaining and safe defaults so malformed/partial frames never break sibling listeners; HTML-escape all dynamic strings interpolated into `innerHTML`.

## 5. Verification & Release Gate

Run and verify all checks in `cd /Users/xhy/Developer/mwi-lite-suite && ...` before every commit:

1. **Build & bundle checks**:
   - `npm run typecheck && npm run build && node --check dist/mwi-hugunn.user.js` passes with zero errors;
   - `dist/mwi-hugunn.user.js` satisfies `@require = 0`, `new MutationObserver = 1`, `ws.send = 0`, `new Worker <= 1`.
2. **Dependency boundaries**:
   - `src/core/` contains zero imports from `features/`;
   - `src/features/<domain>/` contains zero cross-domain `features/` imports.
3. **Behavioral verification**:
   - Pure calculation engines pass in-memory Node numerical & edge-case assertions (leaving no temporary files in the repo);
   - UI / WS modules pass isolated page verification (clean `about:blank` + native `new MessageEvent('message', { data })`—always use native `MessageEvent`, since `Proxy` triggers `Illegal invocation` on extension getters) and zero-error load verification on `https://test.milkywayidle.com` without touching live accounts.

## 6. Versioning

Every update to the plugin (feature, fix, refactor, or any change that alters `dist/mwi-hugunn.user.js`) must bump the version before release:

- **JS version**: bump `"version"` in [package.json](package.json) — the single source of truth (semver: patch for fixes, minor for features, major for breaking changes).
- **Greasy Fork version**: the `// @version` userscript header and the in-app version label (settings dialog, diagnostic handle) are generated from `package.json` by [build.mjs](build.mjs) via `__HUGUNN_VERSION__` / [src/core/version.ts](src/core/version.ts). Never hardcode a version string elsewhere. Greasy Fork only ships an update when `@version` increases.
- Rebuild after bumping so `dist/mwi-hugunn.user.js` carries the new `@version`.
