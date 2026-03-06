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

## 特殊糖果 / Special candies

- **四连（直线 4 个）**：生成 **条纹糖**。
  - 横向四连 → 生成 **竖条纹糖**（触发时清一整列）
  - 纵向四连 → 生成 **横条纹糖**（触发时清一整行）
- **五连及以上（直线 5+）**：生成 **彩虹炸弹（Color Bomb）**。
  - 彩虹炸弹与任意糖果交换：清除全盘该颜色（包含同色特殊糖）。

- **Match exactly 4 in a line**: creates a **striped candy**.
  - Horizontal 4-match → **vertical-striped** candy (clears a column when activated)
  - Vertical 4-match → **horizontal-striped** candy (clears a row when activated)
- **Match 5+ in a straight line**: creates a **Color Bomb**.
  - Swap the Color Bomb with any candy to clear all candies of that color (including specials).

---

## 资源 / Assets

- 糖果图片使用本地 SVG：`assets/`（无外链、无下载）。

Candy pieces are local SVGs in `assets/` (no external downloads).
