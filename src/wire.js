// Wires the game to the browser environment.
// This file is intentionally small so we can later unit-test game logic by swapping dependencies.

import { startMatch3 } from "./game.js";

export function wireGame({ document, window, storage }) {
  let stop = null;

  return {
    start() {
      // startMatch3 returns an optional cleanup function (future-proof).
      stop = startMatch3({ document, window, storage }) || null;
    },
    destroy() {
      if (typeof stop === "function") stop();
      stop = null;
    },
  };
}
