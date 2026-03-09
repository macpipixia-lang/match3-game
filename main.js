'use strict';

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
const AUDIO_STORAGE_KEY = 'match3.audioEnabled';
const DEBUG_STORAGE_KEY = 'match3.debugEnabled';
const LEVEL_STORAGE_KEY = 'match3.levelIndex';
const BEST_SCORE_STORAGE_KEY = 'match3.bestScore';
const SFX_SOURCES = {
  clear: 'assets/sfx/clear.mp3',
  swap: 'assets/sfx/swap.mp3',
  invalid: 'assets/sfx/invalid.mp3',
  combo: 'assets/sfx/combo.mp3',
};
const LEVELS = [
  { targetScore: 900, moveLimit: 16 },
  { targetScore: 1300, moveLimit: 18 },
  { targetScore: 1750, moveLimit: 20 },
];

const boardEl = document.getElementById('board');
const piecesEl = document.getElementById('pieces');
const fxEl = document.getElementById('fx');
const scoreEl = document.getElementById('score');
const targetScoreEl = document.getElementById('targetScore');
const levelEl = document.getElementById('level');
const bestScoreEl = document.getElementById('bestScore');
const movesEl = document.getElementById('moves');
const moveLimitEl = document.getElementById('moveLimit');
const resetBtn = document.getElementById('resetBtn');
const audioBtn = document.getElementById('audioBtn');
const debugBtn = document.getElementById('debugBtn');
const comboToastEl = document.getElementById('comboToast');
const levelOverlayEl = document.getElementById('levelOverlay');
const overlayTitleEl = document.getElementById('overlayTitle');
const overlayBodyEl = document.getElementById('overlayBody');
const overlayActionBtn = document.getElementById('overlayActionBtn');

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
    kind: 'normal',
    color,
  };
}

function createStripedCandy(color, orientation) {
  return {
    id: nextCandyId(),
    kind: 'striped',
    color,
    orientation, // 'row' | 'col'
  };
}

function createWrappedCandy(color) {
  return {
    id: nextCandyId(),
    kind: 'wrapped',
    color,
  };
}

function createColorBomb(color) {
  return {
    id: nextCandyId(),
    kind: 'colorBomb',
    color,
  };
}

function keyOf(row, col) {
  return `${row},${col}`;
}

function parseKey(key) {
  const [row, col] = key.split(',').map(Number);
  return { row, col };
}

function inBounds(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function isColorBomb(candy) {
  return Boolean(candy && candy.kind === 'colorBomb');
}

function isSpecialCandy(candy) {
  return Boolean(candy && candy.kind !== 'normal');
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

  const specialKinds = ['striped-row', 'striped-col', 'wrapped', 'colorBomb'];

  for (let idx = 0; idx < count; idx += 1) {
    const { row, col } = picks[idx];
    const existing = board[row][col];
    if (!existing) {
      continue;
    }

    const color = existing.color;
    const kind = specialKinds[Math.floor(Math.random() * specialKinds.length)];

    if (kind === 'striped-row') {
      board[row][col] = createStripedCandy(color, 'row');
    } else if (kind === 'striped-col') {
      board[row][col] = createStripedCandy(color, 'col');
    } else if (kind === 'wrapped') {
      board[row][col] = createWrappedCandy(color);
    } else {
      // Color bomb uses the current color too (useful for matching logic / targeting).
      board[row][col] = createColorBomb(color);
    }
  }
}

function updateHud() {
  scoreEl.textContent = String(score);
  movesEl.textContent = String(moves);
  const level = LEVELS[currentLevelIndex];
  if (targetScoreEl) targetScoreEl.textContent = String(level.targetScore);
  if (moveLimitEl) moveLimitEl.textContent = String(level.moveLimit);
  if (levelEl) levelEl.textContent = String(currentLevelIndex + 1);
  if (bestScoreEl) bestScoreEl.textContent = String(bestScore);
}

function gemClasses(row, col) {
  const classes = ['gem'];
  const candy = board[row][col];

  if (!candy) {
    return classes.join(' ');
  }

  classes.push(`gem--${candy.color}`);

  if (candy.kind === 'striped') {
    classes.push('gem--striped');
    classes.push(candy.orientation === 'row' ? 'gem--striped-row' : 'gem--striped-col');
  } else if (candy.kind === 'wrapped') {
    classes.push('gem--wrapped');
  } else if (candy.kind === 'colorBomb') {
    classes.push('gem--color-bomb');
  }

  if (selected && selected.row === row && selected.col === col) {
    classes.push('selected');
  }

  return classes.join(' ');
}

function ensureBoardDom() {
  if (cellEls) return;
  cellEls = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));

  const frag = document.createDocumentFragment();
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cell';
      btn.dataset.row = String(row);
      btn.dataset.col = String(col);
      btn.setAttribute('aria-hidden', 'true');
      cellEls[row][col] = btn;
      frag.appendChild(btn);
    }
  }
  boardEl.innerHTML = '';
  boardEl.appendChild(frag);

  if (!cachedBoardWrapRect) {
    cacheBoardGeometry();
  }
}

function cacheBoardGeometry() {
  if (!cellEls) return;
  const wrap = boardEl.closest('.board-wrap');
  cachedBoardWrapRect = wrap ? wrap.getBoundingClientRect() : boardEl.getBoundingClientRect();

  if (!cachedCellRects) {
    cachedCellRects = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  }
  if (!cachedCellPositions) {
    cachedCellPositions = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  }

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const rect = cellEls[row][col].getBoundingClientRect();
      cachedCellRects[row][col] = rect;
      cachedCellPositions[row][col] = {
        x: rect.left - cachedBoardWrapRect.left,
        y: rect.top - cachedBoardWrapRect.top,
      };
    }
  }

  const p00 = cachedCellPositions?.[0]?.[0];
  const p01 = cachedCellPositions?.[0]?.[1];
  const p10 = cachedCellPositions?.[1]?.[0];
  if (p00 && p01) cachedStepX = p01.x - p00.x;
  if (p00 && p10) cachedStepY = p10.y - p00.y;
}

window.addEventListener('resize', () => {
  if (cellEls) cacheBoardGeometry();
});

function updateBoardDom() {
  ensureBoardDom();
  // Cells are used only for layout + geometry (actual pieces live in #pieces).
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const btn = cellEls[row][col];
      btn.className = 'cell';
    }
  }
}

function positionForCell(row, col) {
  ensureBoardDom();
  if (!cachedCellPositions) cacheBoardGeometry();

  const base = cachedCellPositions?.[Math.max(0, Math.min(BOARD_SIZE - 1, row))]?.[col];
  const top = cachedCellPositions?.[0]?.[col];

  if (!base || !top) {
    // Fallback: assume grid starts at (0,0) relative to wrap.
    const cellSize = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--cell-size')) || 56;
    const gap = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--gap')) || 6;
    const step = cellSize + gap;
    return { x: col * step, y: row * step };
  }

  if (row >= 0 && row < BOARD_SIZE) {
    return { x: base.x, y: base.y };
  }

  const stepY = Number.isFinite(cachedStepY) && cachedStepY !== 0 ? cachedStepY : base.y - top.y;
  return {
    x: top.x,
    y: top.y + stepY * row,
  };
}

function ensurePieceEl(candyId, row, col) {
  if (!piecesEl) {
    throw new Error('#pieces layer missing');
  }

  let el = pieceElsById.get(candyId);
  if (el) return el;

  // Prevent a 1-frame flash at (0,0) when the element is first appended.
  // New gems are absolutely positioned at top/left 0 by default until we set transform.
  el = document.createElement('button');
  el.type = 'button';
  el.className = 'gem';
  el.dataset.id = String(candyId);
  el.dataset.row = String(row);
  el.dataset.col = String(col);
  el.style.visibility = 'hidden';

  // Set an initial transform synchronously before attaching to the DOM.
  const pos = positionForCell(row, col);
  el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;

  el.setAttribute('aria-label', `Candy at row ${row + 1}, col ${col + 1}`);
  piecesEl.appendChild(el);
  pieceElsById.set(candyId, el);
  return el;
}

function syncPiecesDom({ durationMs = 0 } = {}) {
  ensureBoardDom();
  if (!piecesEl) return;

  const seen = new Set();

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const candy = board[row][col];
      if (!candy) continue;
      seen.add(candy.id);

      const el = ensurePieceEl(candy.id, row, col);
      el.dataset.row = String(row);
      el.dataset.col = String(col);

      const specialLabel = candy?.kind === 'wrapped' ? ' (Wrapped candy)' : '';
      el.setAttribute('aria-label', `Candy at row ${row + 1}, col ${col + 1}${specialLabel}`);
      el.className = gemClasses(row, col);

      el.style.transitionProperty = 'transform, opacity, filter';
      el.style.transitionDuration = `${durationMs}ms`;
      el.style.transitionTimingFunction = 'cubic-bezier(0.18, 0.85, 0.32, 1)';

      const pos = positionForCell(row, col);
      el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      el.style.visibility = 'visible';
    }
  }

  // Remove stale piece elements (should be rare).
  for (const [id, el] of pieceElsById.entries()) {
    if (seen.has(id)) continue;
    el.classList.add('clearing');
    window.setTimeout(() => {
      el.remove();
      pieceElsById.delete(id);
    }, CLEAR_DELAY_MS);
  }
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

async function animateFlip(updateFn, durationMs) {
  // Pieces are absolutely positioned; simply updating transforms yields the animation.
  updateFn();
  renderBoard({ durationMs });
  await wait(durationMs);
}


function renderBoard({ durationMs = 0 } = {}) {
  updateBoardDom();
  syncPiecesDom({ durationMs });
}

function findMatches() {
  // Straight-line matches only. Shape (T/L) is derived by analyzing connected components in the matched set.
  const matched = new Set();
  const lineGroups = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    let streak = 1;
    for (let col = 1; col <= BOARD_SIZE; col += 1) {
      const currentColor = col < BOARD_SIZE ? getMatchColor(board[row][col]) : null;
      const prevColor = getMatchColor(board[row][col - 1]);
      const same = currentColor !== null && currentColor === prevColor;

      if (same) {
        streak += 1;
      } else {
        if (streak >= 3 && prevColor !== null) {
          const start = col - streak;
          const cells = [];
          for (let i = start; i < col; i += 1) {
            const key = keyOf(row, i);
            matched.add(key);
            cells.push({ row, col: i });
          }
          lineGroups.push({ direction: 'horizontal', length: streak, color: prevColor, cells });
        }
        streak = 1;
      }
    }
  }

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    let streak = 1;
    for (let row = 1; row <= BOARD_SIZE; row += 1) {
      const currentColor = row < BOARD_SIZE ? getMatchColor(board[row][col]) : null;
      const prevColor = getMatchColor(board[row - 1][col]);
      const same = currentColor !== null && currentColor === prevColor;

      if (same) {
        streak += 1;
      } else {
        if (streak >= 3 && prevColor !== null) {
          const start = row - streak;
          const cells = [];
          for (let i = start; i < row; i += 1) {
            const key = keyOf(i, col);
            matched.add(key);
            cells.push({ row: i, col });
          }
          lineGroups.push({ direction: 'vertical', length: streak, color: prevColor, cells });
        }
        streak = 1;
      }
    }
  }

  return { matched, lineGroups };
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function safeGetLocalStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota/privacy mode errors.
  }
}

function updateAudioButton() {
  if (!audioBtn) return;
  audioBtn.setAttribute('aria-pressed', audioEnabled ? 'true' : 'false');
  audioBtn.textContent = audioEnabled ? 'Sound: On' : 'Sound: Off';
}

function loadAudioPreference() {
  audioEnabled = safeGetLocalStorage(AUDIO_STORAGE_KEY) === '1';
  updateAudioButton();
}

function updateDebugButton() {
  if (!debugBtn) return;
  debugBtn.setAttribute('aria-pressed', debugEnabled ? 'true' : 'false');
  debugBtn.textContent = debugEnabled ? 'Debug: On' : 'Debug: Off';
}

function loadDebugPreference() {
  debugEnabled = safeGetLocalStorage(DEBUG_STORAGE_KEY) === '1';
  updateDebugButton();
}

function clampLevelIndex(index) {
  if (!Number.isInteger(index)) return 0;
  if (index < 0) return 0;
  if (index >= LEVELS.length) return LEVELS.length - 1;
  return index;
}

function loadProgress() {
  const storedLevel = Number.parseInt(safeGetLocalStorage(LEVEL_STORAGE_KEY) || '', 10);
  const storedBest = Number.parseInt(safeGetLocalStorage(BEST_SCORE_STORAGE_KEY) || '', 10);
  currentLevelIndex = clampLevelIndex(Number.isNaN(storedLevel) ? 0 : storedLevel);
  bestScore = Number.isNaN(storedBest) ? 0 : Math.max(0, storedBest);
}

function saveProgress() {
  safeSetLocalStorage(LEVEL_STORAGE_KEY, String(currentLevelIndex));
  safeSetLocalStorage(BEST_SCORE_STORAGE_KEY, String(bestScore));
}

function hideLevelOverlay() {
  if (!levelOverlayEl) return;
  levelOverlayEl.classList.add('hidden');
}

function showLevelOverlay(win) {
  if (!levelOverlayEl || !overlayTitleEl || !overlayBodyEl || !overlayActionBtn) return;

  const level = LEVELS[currentLevelIndex];
  const remaining = Math.max(0, level.moveLimit - moves);
  levelOverlayEl.classList.remove('hidden');

  if (win) {
    overlayTitleEl.textContent = 'Level Complete';
    overlayBodyEl.textContent = `Score ${score} reached target ${level.targetScore}. Moves left: ${remaining}.`;
    overlayActionBtn.textContent = 'Next';
  } else {
    overlayTitleEl.textContent = 'Level Failed';
    overlayBodyEl.textContent = `Score ${score} / ${level.targetScore}. Try again.`;
    overlayActionBtn.textContent = 'Retry';
  }
}

function evaluateTurnOutcome() {
  const level = LEVELS[currentLevelIndex];
  if (score >= level.targetScore) {
    pendingOutcome = 'win';
    return true;
  }
  if (moves >= level.moveLimit) {
    pendingOutcome = 'lose';
    return true;
  }
  return false;
}

function applyScoreProgress() {
  if (score > bestScore) {
    bestScore = score;
    saveProgress();
    updateHud();
  }
}

function concludeLevelIfNeeded() {
  if (!evaluateTurnOutcome()) {
    return false;
  }

  isLocked = true;
  applyScoreProgress();
  showLevelOverlay(pendingOutcome === 'win');
  return true;
}

function createSfxInstance(name) {
  const src = SFX_SOURCES[name];
  if (!src || missingSfx.has(name)) {
    return null;
  }

  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.addEventListener(
    'error',
    () => {
      missingSfx.add(name);
      sfxPool.delete(name);
    },
    { once: true },
  );
  sfxPool.set(name, audio);
  return audio;
}

function playSfx(name) {
  if (!audioEnabled) return;
  if (missingSfx.has(name)) return;

  const audio = sfxPool.get(name) || createSfxInstance(name);
  if (!audio) return;

  try {
    audio.currentTime = 0;
    const playResult = audio.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => {
        // Browser may block autoplay until user gesture; ignore silently.
      });
    }
  } catch {
    // Missing files / blocked playback should not break gameplay.
  }
}

function clearFxLayer() {
  if (!fxEl) return;
  fxEl.innerHTML = '';
}

const SPARKLE_MAX_PER_WAVE = 120;

function hueForGemColor(color) {
  // Map our 0..5 palette to a visually distinct hue range.
  // (Hand-tuned for “candy” colors; no external deps.)
  switch (color) {
    case 0:
      return 6; // red
    case 1:
      return 212; // blue
    case 2:
      return 152; // green
    case 3:
      return 44; // amber
    case 4:
      return 278; // purple
    case 5:
      return 330; // pink
    default:
      return 60;
  }
}

function addSparklesFx(row, col, count, { hue = 60, power = 1 } = {}) {
  if (!fxEl || !cachedBoardWrapRect || !cachedCellRects) return 0;
  if (!count || count <= 0) return 0;

  const boardRect = cachedBoardWrapRect;
  const cellRect = cachedCellRects[row][col];

  const baseX = cellRect.left - boardRect.left + cellRect.width / 2;
  const baseY = cellRect.top - boardRect.top + cellRect.height / 2;

  const maxOffset = Math.max(6, cellRect.width * 0.18);
  const maxTravel = Math.max(18, cellRect.width * 0.55) * power;

  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const s = document.createElement('div');
    s.className = 'sparkle';

    const startX = baseX + (Math.random() * 2 - 1) * maxOffset;
    const startY = baseY + (Math.random() * 2 - 1) * maxOffset;

    const ang = Math.random() * Math.PI * 2;
    const dist = (0.35 + Math.random() * 0.75) * maxTravel;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;

    const size = (2.2 + Math.random() * 2.4) * (0.95 + power * 0.25);
    // Keep duration within CLEAR_DELAY_MS so the layer reset doesn't cut the tail.
    const dur = (170 + Math.random() * 90) * (1 / (0.9 + power * 0.1));

    s.style.left = `${startX}px`;
    s.style.top = `${startY}px`;
    s.style.setProperty('--dx', `${dx.toFixed(2)}px`);
    s.style.setProperty('--dy', `${dy.toFixed(2)}px`);
    s.style.setProperty('--s', `${size.toFixed(2)}px`);
    s.style.setProperty('--dur', `${dur.toFixed(0)}ms`);
    s.style.setProperty('--h', String(hue));

    // Auto-cleanup to avoid FX DOM growth during combo chains.
    s.addEventListener(
      'animationend',
      () => {
        s.remove();
      },
      { once: true },
    );

    frag.appendChild(s);
  }
  fxEl.appendChild(frag);
  return count;
}

function addBeamFx(kind, row, col) {
  if (!fxEl || !cachedBoardWrapRect || !cachedCellRects) return;

  const boardRect = cachedBoardWrapRect;
  const cellRect = cachedCellRects[row][col];

  const beam = document.createElement('div');
  beam.className = `beam ${kind}`;

  if (kind === 'row') {
    beam.style.left = '10px';
    beam.style.right = '10px';
    beam.style.top = `${cellRect.top - boardRect.top + cellRect.height * 0.15}px`;
  } else {
    beam.style.top = '10px';
    beam.style.bottom = '10px';
    beam.style.left = `${cellRect.left - boardRect.left + cellRect.width * 0.15}px`;
  }

  fxEl.appendChild(beam);
}

function addPulseFx(row, col) {
  if (!fxEl || !cachedBoardWrapRect || !cachedCellRects) return;

  const boardRect = cachedBoardWrapRect;
  const cellRect = cachedCellRects[row][col];

  const pulse = document.createElement('div');
  pulse.className = 'pulse';
  const size = Math.max(cellRect.width, cellRect.height) * 1.2;
  pulse.style.width = `${size}px`;
  pulse.style.height = `${size}px`;
  pulse.style.left = `${cellRect.left - boardRect.left + cellRect.width / 2 - size / 2}px`;
  pulse.style.top = `${cellRect.top - boardRect.top + cellRect.height / 2 - size / 2}px`;

  fxEl.appendChild(pulse);
}

function addWrappedBlastFx(row, col) {
  if (!fxEl || !cachedBoardWrapRect || !cachedCellRects) return;

  const boardRect = cachedBoardWrapRect;
  const cellRect = cachedCellRects[row][col];

  const blast = document.createElement('div');
  blast.className = 'wrapped-blast';
  const size = Math.max(cellRect.width, cellRect.height) * 3.2;
  blast.style.width = `${size}px`;
  blast.style.height = `${size}px`;
  blast.style.left = `${cellRect.left - boardRect.left + cellRect.width / 2 - size / 2}px`;
  blast.style.top = `${cellRect.top - boardRect.top + cellRect.height / 2 - size / 2}px`;

  fxEl.appendChild(blast);
}

function spawnFxForClearSet(matches, fxOverrides = null) {
  clearFxLayer();

  const rowBeams = new Set(fxOverrides?.rowBeams || []);
  const colBeams = new Set(fxOverrides?.colBeams || []);
  const pulses = [...(fxOverrides?.pulses || [])];
  const wrappedBlasts = [...(fxOverrides?.wrappedBlasts || [])];

  const clearCount = matches.size;

  matches.forEach((key) => {
    const { row, col } = parseKey(key);
    const candy = board[row][col];
    if (!candy) return;

    if (candy.kind === 'striped') {
      if (candy.orientation === 'row') rowBeams.add(row);
      if (candy.orientation === 'col') colBeams.add(col);
    } else if (candy.kind === 'colorBomb') {
      pulses.push({ row, col });
    } else if (candy.kind === 'wrapped') {
      wrappedBlasts.push({ row, col });
    }
  });

  rowBeams.forEach((row) => addBeamFx('row', row, 0));
  colBeams.forEach((col) => addBeamFx('col', 0, col));
  pulses.forEach((p) => addPulseFx(p.row, p.col));
  wrappedBlasts.forEach((p) => addWrappedBlastFx(p.row, p.col));

  // Lightweight sparkle particles for every cleared cell.
  // Performance rule: keep each wave under a hard DOM budget.
  let budget = SPARKLE_MAX_PER_WAVE;
  let basePerCell = 3;
  if (clearCount >= 8) basePerCell = 4;
  if (clearCount >= 12) basePerCell = 5;

  // Guarantee we don't exceed the wave budget.
  const perCellCap = Math.max(1, Math.floor(budget / Math.max(1, clearCount)));
  basePerCell = Math.min(basePerCell, perCellCap);

  matches.forEach((key) => {
    if (budget <= 0) return;

    const { row, col } = parseKey(key);
    const candy = board[row][col];
    if (!candy) return;

    const hue = hueForGemColor(candy.color);
    const isSpecial = candy.kind !== 'normal';

    let wanted = basePerCell;
    if (isSpecial) wanted += 3;
    if (clearCount >= BIG_CLEAR_SHAKE_THRESHOLD) wanted += 1;

    wanted = Math.min(wanted, 10);
    const actual = Math.min(wanted, budget);
    const power = isSpecial ? 1.55 : clearCount >= 10 ? 1.25 : 1;

    budget -= addSparklesFx(row, col, actual, { hue, power });
  });
}

async function animateClear(matches, fxOverrides = null) {
  if (matches.size >= BIG_CLEAR_SHAKE_THRESHOLD) {
    boardEl.classList.add('board-shake');
  }

  spawnFxForClearSet(matches, fxOverrides);

  matches.forEach((key) => {
    const { row, col } = parseKey(key);
    if (!inBounds(row, col)) return;
    const candy = board?.[row]?.[col];
    const el = candy ? pieceElsById.get(candy.id) : null;
    if (el) {
      el.classList.add('clearing');
    }
  });

  await wait(CLEAR_DELAY_MS);
  boardEl.classList.remove('board-shake');
  clearFxLayer();
}

function removeMatches(matches) {
  let removedCount = 0;

  matches.forEach((key) => {
    const { row, col } = parseKey(key);
    if (!inBounds(row, col)) return;
    if (!board[row][col]) return;
    board[row][col] = null;
    removedCount += 1;
  });

  score += removedCount * SCORE_PER_GEM;
  updateHud();
  applyScoreProgress();
}

function dropAndFill() {
  // Mutates board to its post-gravity state and returns info for newly spawned candies.
  // Spawn rows are negative so pieces can start above the board and fall in.
  const spawns = [];

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    const existing = [];
    for (let row = BOARD_SIZE - 1; row >= 0; row -= 1) {
      const candy = board[row][col];
      if (candy !== null) {
        // Scan bottom → top, but keep candies in top → bottom order so gravity compaction
        // is stable (no vertical flipping/shuffling of existing pieces).
        existing.unshift(candy);
      }
    }

    const missing = BOARD_SIZE - existing.length;
    const newCandies = Array.from({ length: missing }, () => createNormalCandy());

    const finalColumn = [...newCandies, ...existing].slice(0, BOARD_SIZE);

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      board[row][col] = finalColumn[row] ?? null;
    }

    for (let i = 0; i < newCandies.length; i += 1) {
      const candy = newCandies[i];
      const finalRow = i;
      const spawnRow = i - missing; // e.g. missing=3 => rows -3,-2,-1
      spawns.push({ candy, col, finalRow, spawnRow });
    }
  }

  return spawns;
}

function collectColorCells(color) {
  const cells = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const candy = board[row][col];
      if (candy && candy.color === color) {
        cells.push({ row, col });
      }
    }
  }
  return cells;
}

function get4Neighbors(cell) {
  return [
    { row: cell.row - 1, col: cell.col },
    { row: cell.row + 1, col: cell.col },
    { row: cell.row, col: cell.col - 1 },
    { row: cell.row, col: cell.col + 1 },
  ].filter((n) => inBounds(n.row, n.col));
}

function buildMatchedComponents(matchedSet) {
  const visited = new Set();
  const components = [];

  for (const key of matchedSet) {
    if (visited.has(key)) continue;
    const start = parseKey(key);
    const startCandy = board[start.row][start.col];
    if (!startCandy) {
      visited.add(key);
      continue;
    }

    const color = startCandy.color;
    const comp = [];
    const stack = [start];
    visited.add(key);

    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      for (const n of get4Neighbors(cur)) {
        const nk = keyOf(n.row, n.col);
        if (!matchedSet.has(nk) || visited.has(nk)) continue;
        const c = board[n.row][n.col];
        if (!c || c.color !== color) continue;
        visited.add(nk);
        stack.push(n);
      }
    }

    components.push({ color, cells: comp });
  }

  return components;
}

function countInDirection(set, row, col, dr, dc) {
  let r = row + dr;
  let c = col + dc;
  let count = 0;
  while (set.has(keyOf(r, c))) {
    count += 1;
    r += dr;
    c += dc;
  }
  return count;
}

function analyzeComponent(component) {
  const cellSet = new Set(component.cells.map((c) => keyOf(c.row, c.col)));

  let hasStraight5 = false;
  let hasStraight4 = false;
  let bestStraight5Cell = null;
  let bestStraight4Group = null;

  let wrappedIntersection = null;

  for (const cell of component.cells) {
    const left = countInDirection(cellSet, cell.row, cell.col, 0, -1);
    const right = countInDirection(cellSet, cell.row, cell.col, 0, 1);
    const up = countInDirection(cellSet, cell.row, cell.col, -1, 0);
    const down = countInDirection(cellSet, cell.row, cell.col, 1, 0);

    const hLen = 1 + left + right;
    const vLen = 1 + up + down;

    if (hLen >= 5 || vLen >= 5) {
      hasStraight5 = true;
      bestStraight5Cell = cell;
    }

    if (!hasStraight5 && (hLen === 4 || vLen === 4)) {
      hasStraight4 = true;
      if (!bestStraight4Group || (hLen === 4 && bestStraight4Group.direction !== 'horizontal') || (vLen === 4 && bestStraight4Group.direction !== 'vertical')) {
        if (hLen === 4) {
          bestStraight4Group = { direction: 'horizontal', cell };
        } else if (vLen === 4) {
          bestStraight4Group = { direction: 'vertical', cell };
        }
      }
    }

    // Wrapped: needs both a horizontal run >=3 and vertical run >=3 sharing a cell.
    if (hLen >= 3 && vLen >= 3) {
      wrappedIntersection = cell;
    }
  }

  const isWrappedShape = component.cells.length >= 5 && Boolean(wrappedIntersection) && !hasStraight5;

  return {
    cellSet,
    hasStraight5,
    hasStraight4,
    bestStraight5Cell,
    bestStraight4Group,
    isWrappedShape,
    wrappedIntersection,
  };
}

function chooseSpawnCell(preferredCell, component, analysis) {
  if (preferredCell && analysis.cellSet.has(keyOf(preferredCell.row, preferredCell.col))) {
    return preferredCell;
  }
  if (analysis.isWrappedShape && analysis.wrappedIntersection) {
    return analysis.wrappedIntersection;
  }
  if (analysis.bestStraight5Cell) {
    return analysis.bestStraight5Cell;
  }
  if (analysis.bestStraight4Group) {
    return analysis.bestStraight4Group.cell;
  }
  return component.cells[Math.floor(component.cells.length / 2)] || null;
}

function planSpecialSpawnsFromMatched(matchedSet, preferredCell) {
  const plans = new Map();

  const components = buildMatchedComponents(matchedSet);

  for (const component of components) {
    const analysis = analyzeComponent(component);

    let spawnedCandy = null;
    let priority = 0;

    if (analysis.hasStraight5) {
      spawnedCandy = createColorBomb(component.color);
      priority = 3;
    } else if (analysis.isWrappedShape) {
      spawnedCandy = createWrappedCandy(component.color);
      priority = 2;
    } else if (analysis.hasStraight4) {
      const direction = analysis.bestStraight4Group?.direction;
      // Rule: horizontal 4-match => vertical-striped => clears column.
      //       vertical 4-match   => horizontal-striped => clears row.
      const orientation = direction === 'horizontal' ? 'col' : 'row';
      spawnedCandy = createStripedCandy(component.color, orientation);
      priority = 1;
    }

    if (!spawnedCandy) continue;

    const spawnCell = chooseSpawnCell(preferredCell, component, analysis);
    if (!spawnCell) continue;

    const k = keyOf(spawnCell.row, spawnCell.col);
    const existing = plans.get(k);
    const existingPriority = existing ? (existing.kind === 'colorBomb' ? 3 : existing.kind === 'wrapped' ? 2 : 1) : 0;
    if (!existing || priority > existingPriority) {
      plans.set(k, spawnedCandy);
    }
  }

  return plans;
}

function expandClearSet(initialClear, protectedCells = new Set(), colorBombOverrides = new Map()) {
  const result = new Set();
  const activated = new Set();
  const queue = [...initialClear];
  const wrappedCenters = new Set();

  while (queue.length > 0) {
    const key = queue.pop();
    const { row, col } = parseKey(key);

    // Special clears (wrapped/striped) can enqueue out-of-bounds coordinates at edges.
    // Ignore them early so we never carry invalid keys into animation/removal.
    if (!inBounds(row, col)) {
      continue;
    }

    if (result.has(key) || protectedCells.has(key)) {
      continue;
    }

    result.add(key);

    const candy = board[row][col];
    if (!candy || activated.has(key)) {
      continue;
    }

    if (candy.kind === 'striped') {
      activated.add(key);
      if (candy.orientation === 'row') {
        for (let c = 0; c < BOARD_SIZE; c += 1) {
          queue.push(keyOf(row, c));
        }
      } else {
        for (let r = 0; r < BOARD_SIZE; r += 1) {
          queue.push(keyOf(r, col));
        }
      }
    } else if (candy.kind === 'wrapped') {
      activated.add(key);
      wrappedCenters.add(key);
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          queue.push(keyOf(row + dr, col + dc));
        }
      }
    } else if (candy.kind === 'colorBomb') {
      activated.add(key);
      const targetColor = colorBombOverrides.has(key) ? colorBombOverrides.get(key) : candy.color;
      if (targetColor === null || targetColor === undefined) {
        continue;
      }
      const sameColorCells = collectColorCells(targetColor);
      sameColorCells.forEach((cell) => {
        queue.push(keyOf(cell.row, cell.col));
      });
    }
  }

  return { clearSet: result, wrappedCenters };
}

function applySpawnPlans(spawnPlans) {
  spawnPlans.forEach((candy, key) => {
    const { row, col } = parseKey(key);
    board[row][col] = candy;
  });
}

function collectCellsByColor(color, exclude = null) {
  const cells = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (exclude && exclude.row === row && exclude.col === col) continue;
      const candy = board[row][col];
      if (candy && candy.color === color) {
        cells.push({ row, col });
      }
    }
  }
  return cells;
}

function splitIntoWaves(cells, waveCount) {
  const waves = Array.from({ length: waveCount }, () => []);
  cells.forEach((cell, index) => {
    waves[index % waveCount].push(cell);
  });
  return waves.filter((wave) => wave.length > 0);
}

function comboWordFor(clearSize, cascadeDepth) {
  if (clearSize >= 18 || cascadeDepth >= 4) {
    return 'Divine';
  }
  if (clearSize >= 12 || cascadeDepth >= 3) {
    return 'Delicious';
  }
  if (clearSize >= 8 || cascadeDepth >= 2) {
    return 'Sweet';
  }
  return '';
}

function showComboToast(text) {
  if (!comboToastEl || !text) return;
  comboToastEl.textContent = text;
  comboToastEl.classList.remove('show');
  // Force restart of keyframes when combos happen back-to-back.
  void comboToastEl.offsetWidth;
  comboToastEl.classList.add('show');
  if (comboToastTimer) {
    window.clearTimeout(comboToastTimer);
  }
  comboToastTimer = window.setTimeout(() => {
    comboToastEl.classList.remove('show');
  }, 660);
}

async function animatePreClearTargeting(targetKeys) {
  if (!targetKeys || targetKeys.size < TARGET_HIGHLIGHT_THRESHOLD) return;

  const targetedEls = [];
  targetKeys.forEach((key) => {
    const { row, col } = parseKey(key);
    const el = cellEls[row][col];
    if (!el) return;
    el.classList.add('targeting');
    targetedEls.push(el);
  });

  if (targetedEls.length === 0) return;
  await wait(TARGET_HIGHLIGHT_DELAY_MS);
  targetedEls.forEach((el) => el.classList.remove('targeting'));
}

function buildRowAndColumnSet(center) {
  const clearSet = new Set();
  for (let c = 0; c < BOARD_SIZE; c += 1) {
    clearSet.add(keyOf(center.row, c));
  }
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    clearSet.add(keyOf(r, center.col));
  }
  return clearSet;
}

function buildTripleCrossSet(center) {
  const clearSet = new Set();
  for (let dr = -1; dr <= 1; dr += 1) {
    const row = center.row + dr;
    if (inBounds(row, center.col)) {
      for (let c = 0; c < BOARD_SIZE; c += 1) {
        clearSet.add(keyOf(row, c));
      }
    }
  }
  for (let dc = -1; dc <= 1; dc += 1) {
    const col = center.col + dc;
    if (inBounds(center.row, col)) {
      for (let r = 0; r < BOARD_SIZE; r += 1) {
        clearSet.add(keyOf(r, col));
      }
    }
  }
  return clearSet;
}

function buildSquareSet(center, radius) {
  const clearSet = new Set();
  for (let dr = -radius; dr <= radius; dr += 1) {
    for (let dc = -radius; dc <= radius; dc += 1) {
      const row = center.row + dr;
      const col = center.col + dc;
      if (inBounds(row, col)) {
        clearSet.add(keyOf(row, col));
      }
    }
  }
  return clearSet;
}

function buildComboClearContext(from, to) {
  const fromCandy = board[from.row][from.col];
  const toCandy = board[to.row][to.col];

  if (!fromCandy || !toCandy) {
    return null;
  }

  const hasColorBomb = isColorBomb(fromCandy) || isColorBomb(toCandy);
  const bothSpecial = isSpecialCandy(fromCandy) && isSpecialCandy(toCandy);
  if (!hasColorBomb && !bothSpecial) {
    return null;
  }

  const center = to;
  const clearSet = new Set();
  const colorBombCell = isColorBomb(fromCandy) ? from : isColorBomb(toCandy) ? to : null;
  const otherCell = colorBombCell && colorBombCell.row === from.row && colorBombCell.col === from.col ? to : from;
  const otherCandy = colorBombCell ? board[otherCell.row][otherCell.col] : null;
  const fx = {
    rowBeams: [],
    colBeams: [],
    pulses: [],
    wrappedBlasts: [],
  };
  const colorBombOverrides = new Map();

  if (isColorBomb(fromCandy) && isColorBomb(toCandy)) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        if (board[row][col]) clearSet.add(keyOf(row, col));
      }
    }
    fx.pulses.push({ row: from.row, col: from.col }, { row: to.row, col: to.col });
    return { clearSet, fx, colorBombOverrides, preClearTargets: new Set(clearSet) };
  }

  if (hasColorBomb && otherCandy) {
    const bombKey = keyOf(colorBombCell.row, colorBombCell.col);
    clearSet.add(bombKey);
    fx.pulses.push({ row: colorBombCell.row, col: colorBombCell.col });
    const preClearTargets = new Set([bombKey]);

    if (otherCandy.kind === 'striped') {
      const cells = collectCellsByColor(otherCandy.color, colorBombCell);
      cells.forEach((cell, index) => {
        const current = board[cell.row][cell.col];
        if (!current || current.kind === 'colorBomb') return;
        const orientation = index % 2 === 0 ? 'row' : 'col';
        board[cell.row][cell.col] = createStripedCandy(otherCandy.color, orientation);
        preClearTargets.add(keyOf(cell.row, cell.col));
      });
      colorBombOverrides.set(bombKey, null);
      const waveCount = cells.length >= 12 ? 3 : 2;
      const comboWaves = splitIntoWaves(cells, waveCount).map(
        (wave) => new Set(wave.map((cell) => keyOf(cell.row, cell.col))),
      );
      return { clearSet, fx, colorBombOverrides, comboWaves, preClearTargets };
    }

    if (otherCandy.kind === 'wrapped') {
      const cells = collectCellsByColor(otherCandy.color, colorBombCell);
      cells.forEach((cell) => {
        const current = board[cell.row][cell.col];
        if (!current || current.kind === 'colorBomb') return;
        board[cell.row][cell.col] = createWrappedCandy(otherCandy.color);
        preClearTargets.add(keyOf(cell.row, cell.col));
      });
      colorBombOverrides.set(bombKey, null);
      const waveCount = cells.length >= 12 ? 3 : 2;
      const comboWaves = splitIntoWaves(cells, waveCount).map(
        (wave) => new Set(wave.map((cell) => keyOf(cell.row, cell.col))),
      );
      // Converted wrapped candies already create broad area clears in each wave.
      return {
        clearSet,
        fx,
        colorBombOverrides,
        comboWaves,
        preClearTargets,
        suppressWaveWrappedSecondPulse: true,
      };
    }

    // When a color bomb is involved, it should clear the OTHER candy's color.
    colorBombOverrides.set(bombKey, otherCandy.color);
    const colorCells = collectColorCells(otherCandy.color);
    colorCells.forEach((cell) => {
      clearSet.add(keyOf(cell.row, cell.col));
      preClearTargets.add(keyOf(cell.row, cell.col));
    });
    return { clearSet, fx, colorBombOverrides, preClearTargets };
  }

  const kinds = [fromCandy.kind, toCandy.kind].sort().join('+');

  if (kinds === 'striped+striped') {
    const cross = buildRowAndColumnSet(center);
    cross.forEach((key) => clearSet.add(key));
    fx.rowBeams.push(center.row);
    fx.colBeams.push(center.col);
    return { clearSet, fx };
  }

  if (kinds === 'striped+wrapped') {
    const cross = buildTripleCrossSet(center);
    cross.forEach((key) => clearSet.add(key));
    for (let dr = -1; dr <= 1; dr += 1) {
      const row = center.row + dr;
      if (row >= 0 && row < BOARD_SIZE) fx.rowBeams.push(row);
    }
    for (let dc = -1; dc <= 1; dc += 1) {
      const col = center.col + dc;
      if (col >= 0 && col < BOARD_SIZE) fx.colBeams.push(col);
    }
    fx.wrappedBlasts.push({ row: center.row, col: center.col });
    return { clearSet, fx };
  }

  if (kinds === 'wrapped+wrapped') {
    const area = buildSquareSet(center, 2);
    const secondArea = buildSquareSet(center, 3);
    area.forEach((key) => clearSet.add(key));
    fx.wrappedBlasts.push({ row: center.row, col: center.col });
    fx.pulses.push({ row: center.row, col: center.col });
    return {
      clearSet,
      fx,
      secondPulseInitial: secondArea,
      secondPulseFx: {
        wrappedBlasts: [{ row: center.row, col: center.col }],
        pulses: [{ row: center.row, col: center.col }],
      },
    };
  }

  return null;
}

async function resolveCascades(preferredSpawnCell, initialForcedContext = null) {
  let preferred = preferredSpawnCell;
  let forcedContext = initialForcedContext;
  let cascadeDepth = 0;

  async function runPulse(initialSet, options = {}) {
    const pulseContext = expandClearSet(initialSet, options.protectedCells || new Set(), options.colorBombOverrides || new Map());
    const pulseSet = pulseContext.clearSet;
    if (pulseSet.size === 0) {
      return 0;
    }

    const targetKeys = options.preClearTargets || pulseSet;
    await animatePreClearTargeting(targetKeys);

    cascadeDepth += 1;
    const comboWord = comboWordFor(pulseSet.size, cascadeDepth);
    if (comboWord) {
      showComboToast(comboWord);
      playSfx('combo');
    }

    await animateClear(pulseSet, options.fx || null);
    playSfx('clear');
    removeMatches(pulseSet);

    const secondInitial = new Set(options.secondPulseInitial || []);
    if (!options.suppressWrappedSecondPulse) {
      pulseContext.wrappedCenters.forEach((centerKey) => {
        const { row, col } = parseKey(centerKey);
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            secondInitial.add(keyOf(row + dr, col + dc));
          }
        }
      });
    }
    if (secondInitial.size > 0) {
      await wait(WRAPPED_PULSE_DELAY_MS);
      const secondContext = expandClearSet(secondInitial);
      if (secondContext.clearSet.size > 0) {
        await animateClear(secondContext.clearSet, options.secondPulseFx || null);
        playSfx('clear');
        removeMatches(secondContext.clearSet);
      }
    }

    return pulseSet.size;
  }

  while (true) {
    let clearContext;
    let spawnPlans = new Map();

    if (forcedContext) {
      const forcedClear = forcedContext.clearSet || new Set();
      const forcedOverrides = forcedContext.colorBombOverrides || new Map();
      clearContext = expandClearSet(forcedClear, new Set(), forcedOverrides);
      clearContext.fx = forcedContext.fx || null;
      clearContext.secondPulseInitial = forcedContext.secondPulseInitial || null;
      clearContext.secondPulseFx = forcedContext.secondPulseFx || null;
      clearContext.suppressWrappedSecondPulse = Boolean(forcedContext.suppressWrappedSecondPulse);
      clearContext.preClearTargets = forcedContext.preClearTargets || null;
      clearContext.comboWaves = forcedContext.comboWaves || null;
      clearContext.suppressWaveWrappedSecondPulse = Boolean(forcedContext.suppressWaveWrappedSecondPulse);
      forcedContext = null;
    } else {
      const { matched } = findMatches();
      if (matched.size === 0) {
        break;
      }

      spawnPlans = planSpecialSpawnsFromMatched(matched, preferred);
      preferred = null;

      const protectedCells = new Set(spawnPlans.keys());
      const baseClear = new Set([...matched].filter((key) => !protectedCells.has(key)));
      clearContext = expandClearSet(baseClear, protectedCells);
      clearContext.fx = null;
      clearContext.secondPulseInitial = null;
      clearContext.secondPulseFx = null;
      clearContext.suppressWrappedSecondPulse = false;
      clearContext.preClearTargets = null;
      clearContext.comboWaves = null;
      clearContext.suppressWaveWrappedSecondPulse = false;
    }

    const clearSet = clearContext.clearSet;

    if (clearSet.size === 0) {
      break;
    }

    await runPulse(clearSet, clearContext);

    if (clearContext.comboWaves && clearContext.comboWaves.length > 0) {
      for (const waveInitial of clearContext.comboWaves) {
        if (!waveInitial || waveInitial.size === 0) continue;
        await wait(COMBO_WAVE_DELAY_MS);
        await runPulse(waveInitial, {
          preClearTargets: new Set(waveInitial),
          suppressWrappedSecondPulse: clearContext.suppressWaveWrappedSecondPulse,
        });
      }
    }

    // True gravity: create new candies above the board and let *all* candies fall together.
    const spawns = (() => {
      applySpawnPlans(spawnPlans);
      return dropAndFill();
    })();

    // Set up newly spawned pieces above the board before animating into their final slots.
    for (const spawn of spawns) {
      const el = ensurePieceEl(spawn.candy.id, spawn.finalRow, spawn.col);
      const pos = positionForCell(spawn.spawnRow, spawn.col);
      el.classList.add('spawning');
      el.style.transitionDuration = '0ms';
      el.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(0.98)`;
      el.style.visibility = 'visible';
    }

    await nextFrame();
    renderBoard({ durationMs: DROP_DELAY_MS });
    await wait(DROP_DELAY_MS);

    for (const spawn of spawns) {
      const el = pieceElsById.get(spawn.candy.id);
      if (el) el.classList.remove('spawning');
    }
  }
}

async function trySwap(from, to) {
  isLocked = true;
  await animateFlip(() => {
    swapCells(from, to);
  }, 140);

  const comboContext = buildComboClearContext(from, to);
  if (comboContext) {
    moves += 1;
    updateHud();
    playSfx('swap');
    await resolveCascades(to, comboContext);
    selected = null;
    if (concludeLevelIfNeeded()) {
      return;
    }
    isLocked = false;
    return;
  }

  const { matched } = findMatches();

  if (matched.size === 0) {
    await animateFlip(() => {
      swapCells(from, to);
      selected = null;
    }, 140);

    const candyA = board?.[from.row]?.[from.col];
    const candyB = board?.[to.row]?.[to.col];

    const a = candyA ? pieceElsById.get(candyA.id) : null;
    const b = candyB ? pieceElsById.get(candyB.id) : null;

    if (a) {
      a.classList.add('invalid');
    }
    if (b) {
      b.classList.add('invalid');
    }
    playSfx('invalid');

    await wait(220);
    isLocked = false;
    return;
  }

  moves += 1;
  updateHud();
  playSfx('swap');
  selected = null;
  await resolveCascades(to, null);
  if (concludeLevelIfNeeded()) {
    return;
  }
  isLocked = false;
}

async function onGemClick(event) {
  const rawTarget = event.target;
  if (!(rawTarget instanceof HTMLElement)) {
    return;
  }

  const target = rawTarget.closest('button.gem');
  if (!target || isLocked) {
    return;
  }

  const row = Number(target.dataset.row);
  const col = Number(target.dataset.col);
  const clicked = { row, col };

  if (!selected) {
    selected = clicked;
    renderBoard();
    return;
  }

  if (selected.row === row && selected.col === col) {
    selected = null;
    renderBoard();
    return;
  }

  if (!isAdjacent(selected, clicked)) {
    selected = clicked;
    renderBoard();
    return;
  }

  const first = selected;
  selected = null;
  await trySwap(first, clicked);
}

function resetGame() {
  score = 0;
  moves = 0;
  selected = null;
  isLocked = false;
  pendingOutcome = null;

  pieceElsById.clear();
  if (piecesEl) piecesEl.innerHTML = '';

  generateBoardWithoutMatches();
  seedDebugSpecialCandies();
  updateHud();
  renderBoard();
  clearFxLayer();
  hideLevelOverlay();
  if (comboToastEl) {
    comboToastEl.classList.remove('show');
  }
}

piecesEl?.addEventListener('click', (event) => {
  onGemClick(event).catch(() => {
    isLocked = false;
  });
});

resetBtn.addEventListener('click', resetGame);
if (audioBtn) {
  audioBtn.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    updateAudioButton();
    safeSetLocalStorage(AUDIO_STORAGE_KEY, audioEnabled ? '1' : '0');
  });
}

if (debugBtn) {
  debugBtn.addEventListener('click', () => {
    debugEnabled = !debugEnabled;
    updateDebugButton();
    safeSetLocalStorage(DEBUG_STORAGE_KEY, debugEnabled ? '1' : '0');
    resetGame();
  });
}

if (overlayActionBtn) {
  overlayActionBtn.addEventListener('click', () => {
    if (pendingOutcome === 'win') {
      currentLevelIndex = (currentLevelIndex + 1) % LEVELS.length;
      saveProgress();
    }
    resetGame();
  });
}

loadProgress();
loadAudioPreference();
loadDebugPreference();
resetGame();
