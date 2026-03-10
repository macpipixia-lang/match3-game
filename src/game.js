// NOTE: This file is a lightly-wrapped version of the original main.js.
// Goal (step 1 of engineering refactor): make the game startable as a function with injected deps,
// without changing gameplay.

export function startMatch3({ document, window, storage }) {
  "use strict";

  const BOARD_SIZE = 8;
  const GEM_TYPES = [0, 1, 2, 3, 4, 5];
  const CLEAR_DELAY_MS = 260;
  const DROP_DELAY_MS = 170;
  const WRAPPED_PULSE_DELAY_MS = 120;
  const TARGET_HIGHLIGHT_DELAY_MS = 120;
  const COMBO_WAVE_DELAY_MS = 90;
  const SCORE_PER_GEM = 10;
  const BIG_CLEAR_SHAKE_THRESHOLD = 8;
  const TARGET_HIGHLIGHT_THRESHOLD = 8;
  const AUDIO_STORAGE_KEY = "match3.audioEnabled";
  const DEBUG_STORAGE_KEY = "match3.debugEnabled";
  const LEVEL_STORAGE_KEY = "match3.levelIndex";
  const BEST_SCORE_STORAGE_KEY = "match3.bestScore";
  const SFX_SOURCES = {
    clear: "assets/sfx/clear.mp3",
    swap: "assets/sfx/swap.mp3",
    invalid: "assets/sfx/invalid.mp3",
    combo: "assets/sfx/combo.mp3",
  };
  const LEVELS = [
    { targetScore: 900, moveLimit: 16 },
    { targetScore: 1300, moveLimit: 18 },
    { targetScore: 1750, moveLimit: 20 },
  ];

  const boardEl = document.getElementById("board");
  const piecesEl = document.getElementById("pieces");
  const fxEl = document.getElementById("fx");
  const scoreEl = document.getElementById("score");
  const targetScoreEl = document.getElementById("targetScore");
  const levelEl = document.getElementById("level");
  const bestScoreEl = document.getElementById("bestScore");
  const movesEl = document.getElementById("moves");
  const moveLimitEl = document.getElementById("moveLimit");
  const resetBtn = document.getElementById("resetBtn");
  const audioBtn = document.getElementById("audioBtn");
  const debugBtn = document.getElementById("debugBtn");
  const comboToastEl = document.getElementById("comboToast");
  const levelOverlayEl = document.getElementById("levelOverlay");
  const overlayTitleEl = document.getElementById("overlayTitle");
  const overlayBodyEl = document.getElementById("overlayBody");
  const overlayActionBtn = document.getElementById("overlayActionBtn");

  let board = [];
  let selected = null;
  let score = 0;
  let moves = 0;
  let isLocked = false;
  let audioEnabled = false;
  let debugEnabled = false;
  let comboToastTimer = 0;
  let currentLevelIndex = 0;
  let bestScore = 0;
  let pendingOutcome = null;

  // DOM cache for performance: create 8x8 invisible cell buttons once.
  let cellEls = null; // HTMLElement[BOARD_SIZE][BOARD_SIZE]
  let cachedBoardWrapRect = null;
  let cachedCellRects = null;
  let cachedCellPositions = null; // { x, y }[BOARD_SIZE][BOARD_SIZE] relative to board-wrap
  let cachedStepX = null;
  let cachedStepY = null;

  // Pieces overlay: each candy is its own absolutely-positioned element.
  let candyIdSeq = 0;
  const pieceElsById = new Map(); // id -> HTMLElement

  const missingSfx = new Set();
  const sfxPool = new Map();

  function randGem() {
    return GEM_TYPES[Math.floor(Math.random() * GEM_TYPES.length)];
  }

  function nextCandyId() {
    candyIdSeq += 1;
    return candyIdSeq;
  }

  function createNormalCandy(color = randGem()) {
    return {
      id: nextCandyId(),
      kind: "normal",
      color,
    };
  }

  function createStripedCandy(color, orientation) {
    return {
      id: nextCandyId(),
      kind: "striped",
      color,
      orientation, // 'row' | 'col'
    };
  }

  function createWrappedCandy(color) {
    return {
      id: nextCandyId(),
      kind: "wrapped",
      color,
    };
  }

  function createColorBomb(color) {
    return {
      id: nextCandyId(),
      kind: "colorBomb",
      color,
    };
  }

  function keyOf(row, col) {
    return `${row},${col}`;
  }

  function parseKey(key) {
    const [row, col] = key.split(",").map(Number);
    return { row, col };
  }

  function inBounds(row, col) {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
  }

  function isColorBomb(candy) {
    return Boolean(candy && candy.kind === "colorBomb");
  }

  function isSpecialCandy(candy) {
    return Boolean(candy && candy.kind !== "normal");
  }

  function getMatchColor(candy) {
    return candy ? candy.color : null;
  }

  function isAdjacent(a, b) {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
  }

  function swapCells(a, b) {
    const temp = board[a.row][a.col];
    board[a.row][a.col] = board[b.row][b.col];
    board[b.row][b.col] = temp;
  }

  function createEmptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  }

  function generateBoardWithoutMatches() {
    board = createEmptyBoard();

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        let color;
        do {
          color = randGem();
        } while (
          (col >= 2 && getMatchColor(board[row][col - 1]) === color && getMatchColor(board[row][col - 2]) === color) ||
          (row >= 2 && getMatchColor(board[row - 1][col]) === color && getMatchColor(board[row - 2][col]) === color)
        );
        board[row][col] = createNormalCandy(color);
      }
    }
  }

  function seedDebugSpecialCandies() {
    if (!debugEnabled) return;

    const totalCells = BOARD_SIZE * BOARD_SIZE;
    const count = Math.min(20, totalCells);
    const picks = [];

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        picks.push({ row, col });
      }
    }

    // Fisher-Yates shuffle.
    for (let i = picks.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = picks[i];
      picks[i] = picks[j];
      picks[j] = tmp;
    }

    const specialKinds = ["striped-row", "striped-col", "wrapped", "colorBomb"];

    for (let idx = 0; idx < count; idx += 1) {
      const { row, col } = picks[idx];
      const existing = board[row][col];
      if (!existing) {
        continue;
      }

      const color = existing.color;
      const kind = specialKinds[Math.floor(Math.random() * specialKinds.length)];

      if (kind === "striped-row") {
        board[row][col] = createStripedCandy(color, "row");
      } else if (kind === "striped-col") {
        board[row][col] = createStripedCandy(color, "col");
      } else if (kind === "wrapped") {
        board[row][col] = createWrappedCandy(color);
      } else {
        // Color bomb uses the current color too (useful for matching logic / targeting).
        board[row][col] = createColorBomb(color);
      }
    }
  }

  // --- The rest of original main.js follows ---
  // To keep this refactor safe, we include the original file contents verbatim below.
  // In the next step, we will split into modules (config/state/board/ui/fx/audio) without changing behavior.

  // BEGIN ORIGINAL main.js (from line ~220 onward)

  // We inject the original code by importing it as a string is not feasible without bundling.
  // Instead, we'll do stepwise refactors: for now we keep the original main.js as the runtime file.

  // For step 1, we simply delegate to the original global script if present.
  // If you loaded this module entrypoint, we expect you removed the old <script src="main.js">.
  // Therefore, we need to continue porting code. We'll finish the port in the next iteration.

  throw new Error(
    "startMatch3: port-in-progress. Please finish migrating the remaining main.js into src/game.js."
  );
}
