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
