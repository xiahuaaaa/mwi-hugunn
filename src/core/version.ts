// Single source of truth: injected from package.json "version" by build.mjs (esbuild `define`).
declare const __HUGUNN_VERSION__: string;

export const HUGUNN_VERSION: string =
  typeof __HUGUNN_VERSION__ === "string" ? __HUGUNN_VERSION__ : "dev";
