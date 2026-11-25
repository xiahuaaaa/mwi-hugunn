import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

function buildHugunnIconDataUri() {
  const src = fs.readFileSync(path.resolve("src/core/pixel-theme.ts"), "utf8");
  const match = src.match(/export const HUGUNN_ICON_PATHS =\s*(['"`])([\s\S]*?)\1;/);
  if (!match) {
    throw new Error("Missing HUGUNN_ICON_PATHS in src/core/pixel-theme.ts");
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="32" height="32" shape-rendering="crispEdges">${match[2]}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

const iconDataUri = buildHugunnIconDataUri();
// Single source of truth for the userscript / Greasy Fork @version and the in-app version label.
const { version } = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+/.test(version || "")) {
  throw new Error(`Invalid package.json version: ${version}`);
}

const banner = `// ==UserScript==
// @name         MWI · Hugunn
// @name:zh-CN   MWI · Hugunn
// @namespace    https://milkywayidle.com/mwi-hugunn
// @version      ${version}
// @description  Tired of reinstalling a pile of laggy, mismatched scripts on every device? Fast! Lightweight! One script is all you need—come fight me if it's not! 15-in-1 MWI suite, zero deps & 100% read-only.
// @description:zh-CN 受够了换设备就重装一堆卡顿又杂乱的脚本？快速！轻量！一个就够！不好用你来打我！15合1 MWI 聚合插件（市场/规划/迷宫/战斗），零依赖纯只读。
// @author       adudu
// @copyright    Credits & Upstream Authors: dakonglong (@dakonlong3, Labyrinth Clear Rate Calculator #566829); Celasha & Toolasha contributors (bot7420, shykai, DrDucky, Frotty, Truth_Light, AlphB, qu, sentientmilk); Foreversunny (Sunny's MWI 增强 #577171); adudu; baozhi & perfectpure (交易量显示 #570243) & Q7 market API; Weierstras ([银河奶牛]康康运气 #536205); zqzhang1996 (MWI_Toolkit).
// @license      CC-BY-NC-SA-4.0
// @homepageURL  https://github.com/xiahuaaaa/mwi-hugunn
// @downloadURL  https://raw.githubusercontent.com/xiahuaaaa/mwi-hugunn/main/dist/mwi-hugunn.user.js
// @updateURL    https://raw.githubusercontent.com/xiahuaaaa/mwi-hugunn/main/dist/mwi-hugunn.user.js
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://test.milkywayidlecn.com/*
// @icon         ${iconDataUri}
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      q7.nainai.eu.org
// @connect      milkywayidle.com
// @connect      www.milkywayidle.com
// @connect      test.milkywayidle.com
// @connect      milkywayidlecn.com
// @connect      www.milkywayidlecn.com
// @connect      test.milkywayidlecn.com
// @connect      raw.githubusercontent.com
// @connect      shykai.github.io
// ==/UserScript==
`;

fs.mkdirSync(path.resolve("dist"), { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/mwi-hugunn.user.js",
  bundle: true,
  format: "iife",
  target: "es2022",
  charset: "utf8",
  legalComments: "none",
  minify: false,
  banner: { js: banner },
  define: { __HUGUNN_VERSION__: JSON.stringify(version) },
});

const outPath = path.resolve("dist/mwi-hugunn.user.js");
const stat = fs.statSync(outPath);
console.log(`Built ${outPath} v${version} (${(stat.size / 1024).toFixed(1)} KB)`);
