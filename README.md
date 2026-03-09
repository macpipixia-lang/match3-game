# match3-game

一个用原生 HTML/CSS/JS 写的消消乐（Match-3）小游戏，离线可玩。

A simple match-3 (消消乐) game built with vanilla HTML/CSS/JS. Works fully offline.

---

## 本地运行 / Run locally

1. 直接用浏览器打开 `index.html`。
2. 全程离线运行（不需要本地服务、不需要依赖）。

1. Open `index.html` in any modern browser.
2. Play offline (no server or dependencies required).

---

## 关卡 / Levels

- 游戏包含内置分数目标关卡（无地图模式），每关有 `targetScore` 和 `moveLimit`。
- 每次有效交换会消耗 1 步，达到目标分数立即过关；步数用尽且未达标则失败。
- 过关显示 `Next`，失败显示 `Retry`。
- 当前关卡索引和历史最高分会持久化到 `localStorage`。

- The game includes built-in score-target levels (no map), each with `targetScore` and `moveLimit`.
- Every valid swap uses 1 move. Hitting target score wins immediately; running out of moves loses the level.
- End overlay shows `Next` on win and `Retry` on loss.
- Current level index and best score are persisted in `localStorage`.

---

## 特殊糖果 / Special candies

- **四连（直线 4 个）**：生成 **条纹糖**。
  - 横向四连 → 生成 **竖条纹糖**（触发时清一整列）
  - 纵向四连 → 生成 **横条纹糖**（触发时清一整行）
- **五消（T/L 形）**：生成 **包装糖**。
  - 触发时以自身为中心 **3x3 爆炸两次**。
- **五连及以上（直线 5+）**：生成 **彩虹炸弹（Color Bomb）**。
  - 彩虹炸弹与任意糖果交换：清除全盘该颜色（包含同色特殊糖）。
- **连携交换 / Combo Swaps**
  - 彩虹炸弹 + 彩虹炸弹：清空全盘。
  - 彩虹炸弹 + 条纹糖：将目标颜色全部转为条纹糖并立即触发。
  - 彩虹炸弹 + 包装糖：将目标颜色全部转为包装糖并触发（为保证流畅度，做了轻量化脉冲处理）。
  - 条纹糖 + 条纹糖：在交换点清一整行 + 一整列。
  - 条纹糖 + 包装糖：在交换点形成更强十字清除（中心 3 行 + 3 列）。
  - 包装糖 + 包装糖：在交换点触发更大的多段爆炸（5x5）。

- **Match exactly 4 in a line**: creates a **striped candy**.
  - Horizontal 4-match → **vertical-striped** candy (clears a column when activated)
  - Vertical 4-match → **horizontal-striped** candy (clears a row when activated)
- **Match 5 in a T/L shape**: creates a **Wrapped Candy**.
  - When activated, it explodes twice in a 3x3 area.
- **Match 5+ in a straight line**: creates a **Color Bomb**.
  - Swap the Color Bomb with any candy to clear all candies of that color (including specials).
- **Combo Swaps**
  - Color Bomb + Color Bomb: clears the entire board.
  - Color Bomb + Striped: converts all candies of that color into striped candies, then activates them.
  - Color Bomb + Wrapped: converts all candies of that color into wrapped candies, then activates them (with a lighter pulse handling for smoother performance).
  - Striped + Striped: clears one full row and one full column at the swap center.
  - Striped + Wrapped: clears a stronger cross (3 centered rows + 3 centered columns).
  - Wrapped + Wrapped: triggers a larger multi-stage blast (5x5).

---

## 资源 / Assets

- 糖果图片使用本地 SVG：`assets/`（无外链、无下载）。
- 音效为可选占位：HUD 提供 Sound 开关；若放入 `assets/sfx/*.mp3`（如 `clear.mp3` / `swap.mp3` / `invalid.mp3` / `combo.mp3`）会自动尝试播放，缺失文件时会静默跳过。

Candy pieces are local SVGs in `assets/` (no external downloads).
- SFX is optional placeholder wiring: the HUD includes a Sound toggle. If `assets/sfx/*.mp3` files exist (`clear.mp3`, `swap.mp3`, `invalid.mp3`, `combo.mp3`), the game will try to play them; missing files are skipped gracefully.

---

## Debug mode

A **Debug** toggle is available in the HUD.

- When **Debug: On**, every time you reset the game the board is regenerated and then **20 random distinct cells** are converted into random special candies (striped row/col, wrapped, or color bomb).
- The state is persisted in `localStorage` under `match3.debugEnabled`.
- Toggling Debug **always triggers an immediate reset**.

---

## 更新记录 / Changelog

把每次更新的功能都列到readme.md上，包括这句话。

> Notes: 这里用“时间从旧到新”的方式记录关键更新，方便快速回顾最近加了什么。

- **Early baseline / 初始版本**
  - Offline-first：直接打开 `index.html` 即可游玩（无依赖、无需本地服务）。
  - Built-in levels：目标分数 + 步数限制，胜利/失败覆盖层（Next/Retry），进度与最高分持久化。
  - Special candies & combo swaps：条纹糖 / 包装糖 / 彩虹炸弹，以及多种组合交换效果。

- **UI / 交互统一（UI unify）**
  - 统一 HUD/按钮与提示的交互体验，减少不同状态下的 UI 分裂。
  - 修正提示层（toast/overlay）在复杂动画/大消除场景下的层级显示问题（toast z-index fix）。

- **调试能力（Debug toggle + seed specials）**
  - 增加 Debug 开关：开启后 reset 会随机播种 **20 个特殊糖**，便于快速测试连锁和组合交换。

- **美术与标识（art icons + wrapped indicator）**
  - 引入更清晰的图标/素材呈现。
  - 包装糖（Wrapped）增加更明显的外观指示（wrapped indicator）。

- **粒子与特效（sparkles particles + FX cache）**
  - 增加 sparkles 粒子效果，提升消除反馈。
  - FX geometry cache：缓存特效几何/路径等计算结果，减少重复开销。

- **性能优化（performance: DOM caching + FLIP drop）**
  - DOM caching：缓存常用 DOM 查询/引用，降低频繁操作成本。
  - FLIP drop：下落/补位使用 FLIP 思路减少布局抖动，提升动画流畅度。
  - 大范围消除场景的性能优化（perf big clear，如果存在）。

- **逻辑修复（clear/fill fixes）**
  - out-of-bounds clear fix：修复清除逻辑在边界/越界情况下的异常。
  - refill fall（如果仍适用）：补充新糖果并自然下落填充空位，保证盘面稳定。
  - clear fixes：修复多段清除/连锁触发下的状态与表现一致性。

- **重力一致性分支合并（gravity-unified-dev）**
  - pieces overlay true gravity：棋子覆盖层/渲染与“真实重力”一致，避免视觉与逻辑不同步。
  - column order fix：修复列处理顺序导致的落子/补位异常。
  - keep translation during clear animations：清除动画期间保持位移/transform，避免跳变。
