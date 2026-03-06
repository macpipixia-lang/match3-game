# match3-game

A simple match-3 game (消消乐) in vanilla HTML/CSS/JS.

## Run locally

1. Open `index.html` in any modern browser.
2. Play offline (no server or dependencies required).

## Special candies

- Match exactly 4 in a line: creates a striped candy.
- Horizontal 4-match creates a vertical-striped candy (clears a column when activated).
- Vertical 4-match creates a horizontal-striped candy (clears a row when activated).
- Match 5+ in a straight line: creates a color bomb.
- Swap a color bomb with any normal/special colored candy to clear all candies of that color.

## Assets

Candy pieces are local SVGs in `assets/` (no external downloads).
