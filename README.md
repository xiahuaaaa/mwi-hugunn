# MWI · Hugunn — Milky Way Idle 高性能轻量聚合增强插件

> **Hugunn**（取意自北欧神话奥丁的「思之鸦」Huginn 变体）：轻盈迅捷、只听不发、洞悉市场与迷宫全局情报。

将日常高频使用的 MWI 油猴功能提炼重构成 **单文件、零 `@require` 外部依赖、微内核架构** 的高性能插件，与自研公会试炼插件 `WI-guild-trial-sync` 配合使用。

## 一、核心架构（Micro-Kernel + 路由门控）

- **单一被动 WebSocket 总线（`src/core/ws-bus.ts`）**：全局仅安装 1 个只读 WebSocket 代理，每帧仅 `JSON.parse` 一次按 `type` 分发；严格遵守官方合规红线（0 `ws.send` 调用）。
- **单一内存游戏数据与角色状态（`src/core/game-data.ts`）**：全生命周期仅解压一次 `initClientData`，绝不将数 MB 静态字典写入 `GM_setValue`。
- **IndexedDB 行情与成交量缓存（`src/core/market-store.ts`）**：`marketplace.json`（30m TTL）与 `q7.nainai.eu.org` 1/3/5 天成交量/均价（5m TTL）统一存 IndexedDB，GM 存储占用控制在 `< 30 KB`（仅存功能开关和计算器清单）。
- **单观察器 + rAF 合并 + 面板路由门控（`src/core/dom-scheduler.ts`）**：全局只有 **1 个** `MutationObserver`，自动跳过插件自身 `[data-mwi-lite]` 节点避免循环，并在非当前面板时休眠对应业务模块。
- **迷宫蒙特卡洛按需 Worker（`src/features/combat/labyrinth-rate.ts`）**：平时挂机创建 **0 个 Web Worker**；仅进入迷宫时按需启动 1 个真实蒙特卡洛 Worker + 500 条 LRU 结果缓存，离开迷宫 60 秒自动 `terminate()` 销毁。

## 二、包含功能（20 个可独立开关模块）

### 市场与经济 (`market`)
1. **市场快捷导航与强化档位跳转 (`market-shortcuts-nav`)**：
   - 市场标题下方展示固定/最近浏览物品快捷栏（无缝继承原 Sunny `sunnyMwi_market_shortcuts_v1` 固定配置），支持 `📌` 固定当前物品/+等级及 `⚙` 调整显示上限；
   - 查看可强化装备时在图标左侧显示 `0 / 5 / 7 / 8 / 10 / 12` 强化等级一键跳转栏。
2. **我的挂单魔法排序 (`market-magic-sort`)**：支持按时间/名称/价格排序与可收取订单置顶高亮。
3. **市场交易量与均价 (`market-volume-display`)**：展示 1 天 / 3 天 / 5 天成交量、均价、买卖盘比例及 7 日价格区间（可拖动、双击归位）。
4. **市场快捷操作与排队估算 (`market-quick-ops`)**：自动填竞争价、合法价格档位微调（`N-1 压价` / `+1档`）、`Max`/`÷2`/`×2`、最优价队列深度与挂单账龄估算。
5. **悬浮窗估价与开箱 EV (`economy-tooltip-ev`)**：物品 Ask/Bid 单价与堆叠总价、宝箱开箱期望收益（含税）、地下城/任务代币最优兑换比。
6. **实时净资产统计 (`economy-networth`)**：金币 + 仓库 + 装备 + 在途挂单（2 秒节流计算，点击看明细）。

### 规划与队列 (`planner`)
7. **动作完成时间与倒计时 (`planner-action-timer`)**：当前动作与队列剩余时间 + 精确完成时刻（切后台自动休眠）。
8. **队列设为下一步 (`planner-queue-next`)**：排队菜单注入「设为下一项」，1:1 人工点击安全触发原生队列移动。
9. **物品规划计算器 (`planner-item-calculator`)**：搜索添加目标物品、房屋升级规划、一键导入制造任务、递归配方与茶饮抵扣、双击缺口跳市场自动预填数量（不自动下单）。
10. **动作快捷数量输入 (`planner-quick-inputs`)**：在技能/战斗动作详情次数框下方添加快捷小时（`0.5h–24h`，按当前配装速率与效率自动换算）、固定数量（`1 / 10 / 100 / 1K / 10K`）、累加模式 (`+`) 与最大可做 (`Max`，含工匠茶减耗计算，采集/战斗为 `∞`）。
11. **技能页仓库库存显示 (`planner-skill-stock`)**：在挤奶、采摘、伐木、制作等技能页各动作卡片右下角直接显示当前仓库对应产出库存数量（多掉落区显示总计与悬停分项明细）。

### 战斗与迷宫 (`combat`)
10. **迷宫胜率与耗时模拟 (`combat-labyrinth-rate`)**：真实蒙特卡洛战斗模拟 + 生活/强化房胜率与含失败期望耗时、推层估算（按需 LazyWorker）。
11. **迷宫推荐路线与斗篷助手 (`combat-labyrinth-helper`)**：整合自 `mwi-muninn`（移除一键开图与自动连排），提供 `1 点击 = 1 房间` 的推荐路线「排入下一个」与 `1 点击 = 1 个` 的「批量使用斗篷」选房逐个使用，自动迁移旧版 `mwi-muninn` 偏好配置。
12. **战斗波次与轻量收益统计 (`combat-light-tracker`)**：战斗波次/场次、XP/h 与掉落估值（无 Chart.js）。
13. **开箱运气与稀有度高亮 (`combat-chest-luck`)**：开箱时在原版弹窗内原位展示本次开箱运气分位、期望价值与地下城宝箱扣除钥匙净利，并按掉落稀有度高亮物品边框。
14. **配装强化等级角标 (`combat-loadout-badge`)**：配装图标显示 `+N` 强化等级。
15. **角色战斗评分 (`combat-score`)**：角色资料面板显示综合战力评分（战斗房屋 + 技能书 + 装备价值）。

## 三、开发与构建

```bash
npm install
npm run typecheck
npm run build
# 生成产物：dist/mwi-hugunn.user.js（单文件零 @require，直接安装进 Tampermonkey）
```

## 四、Tampermonkey 切换清单

安装 `dist/mwi-hugunn.user.js` 后，在 Tampermonkey 面板中：
- **仅保留启用**：
  - `MWI · Hugunn`（本聚合插件）
  - `WI-guild-trial-sync`（公会试炼同步，保持独立）
- **可全部关闭的 7 个旧脚本**：
  1. `Toolasha-CN`
  2. `Sunny's MWI 增强`
  3. `迷宫胜率计算器`
  4. `MWI_Toolkit改`
  5. `[银河奶牛]康康运气_修复`
  6. `交易量显示`
  7. `MWI 我的挂单魔法排序`

## 五、致谢、原作者与开源协议 (Credits & Licenses)

本项目（**CC-BY-NC-SA-4.0**）的部分功能模块基于或对齐了 MWI 社区以下优秀开源脚本与作者的设计及公开算法，在此特别致谢并完整保留上游署名与协议声明：

| 模块 / 功能 | 参考 / 改编脚本 | 原作者 / 致谢 | 原协议 |
| :--- | :--- | :--- | :--- |
| 迷宫胜率与期望耗时模拟 (`labyrinth-engine.js`) | [Labyrinth Clear Rate Calculator / 迷宫胜率计算器](https://greasyfork.org/scripts/566829) & [MWICombatSimulatorTest](https://shykai.github.io/MWICombatSimulatorTest/dist/) | **`dakonglong` (`@dakonlong3`)**、**`shykai`**（及 `amvoidguy`、`truthligh` 等战斗模拟器贡献者） | `MIT` |
| 净资产估算、强化 Markov 期望、动作耗时与物品规划 | [Toolasha](https://greasyfork.org/scripts/562662) / [MWITools](https://greasyfork.org/scripts/494467) / [HouseCost](https://greasyfork.org/scripts/528870) | **`Celasha`**、`bot7420`、`shykai`、`DrDucky`、`Frotty`、`Truth_Light`、`AlphB`、`qu`、`sentientmilk` 等 | **`CC-BY-NC-SA-4.0`** |
| 市场快捷栏、强化档位跳转、市场快捷操作与挂单排序 | [Sunny's MWI 增强](https://greasyfork.org/scripts/577171) / MWI 我的挂单魔法排序 | **`Foreversunny`**、`adudu` | `MIT` |
| 市场交易量与 1/3/5 天均价 | [交易量显示](https://greasyfork.org/scripts/570243) & Q7 市场 API (`q7.nainai.eu.org`) | **`baozhi`**、`perfectpure`、感谢 **`Q7大厨神`** | **`CC-BY-NC-SA-4.0`** |
| 战斗掉落运气值 CDF 与欧非统计 | [[银河奶牛]康康运气](https://greasyfork.org/scripts/536205) | **`Weierstras`**（及修复版贡献者） | `MIT` |
| 任务/动作详情辅助设计参考 | [MWI_Toolkit](https://greasyfork.org/scripts/550483) | **`zqzhang1996`** | `MIT` |
| 迷宫推荐路线规划与斗篷辅助 (`labyrinth-route-engine.ts`) | [MWI · Muninn](https://github.com/xiahuaaaa/mwi-muninn) | **`xiahuaaaa` / `adudu`** | 同作者整合 |

> **合规声明**：任务面板中的所有游戏操作严格遵循 `1 click ≤ 1 server action`（工具栏 **领取下一个 / Claim Next** 每次点击仅领取 1 个就绪任务），绝不注入或伪造 `isTrusted` 事件或刻意绕过游戏防自动化检测。
