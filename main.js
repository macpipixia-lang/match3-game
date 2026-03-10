'use strict';

const CONFIG = (typeof window !== 'undefined' && window.MATCH3_CONFIG) ? window.MATCH3_CONFIG : null;
const BOARD_SIZE = CONFIG?.boardSize ?? 8;
const GEM_TYPES = CONFIG?.gemTypes ?? [0, 1, 2, 3, 4, 5];
const CLEAR_DELAY_MS = CONFIG?.timing?.clearDelayMs ?? 260;
const DROP_DELAY_MS = CONFIG?.timing?.dropDelayMs ?? 170;
const WRAPPED_PULSE_DELAY_MS = CONFIG?.timing?.wrappedPulseDelayMs ?? 120;
const TARGET_HIGHLIGHT_DELAY_MS = CONFIG?.timing?.targetHighlightDelayMs ?? 120;
const COMBO_WAVE_DELAY_MS = CONFIG?.timing?.comboWaveDelayMs ?? 90;
const SCORE_PER_GEM = CONFIG?.scoring?.scorePerGem ?? 10;
const BIG_CLEAR_SHAKE_THRESHOLD = CONFIG?.thresholds?.bigClearShake ?? 8;
const TARGET_HIGHLIGHT_THRESHOLD = CONFIG?.thresholds?.targetHighlight ?? 8;
const AUDIO_STORAGE_KEY = CONFIG?.storageKeys?.audioEnabled ?? 'match3.audioEnabled';
const DEBUG_STORAGE_KEY = CONFIG?.storageKeys?.debugEnabled ?? 'match3.debugEnabled';
const PERF_STORAGE_KEY = CONFIG?.storageKeys?.perfEnabled ?? 'match3.perfEnabled';
const LEVEL_STORAGE_KEY = CONFIG?.storageKeys?.levelIndex ?? 'match3.levelIndex';
const BEST_SCORE_STORAGE_KEY = CONFIG?.storageKeys?.bestScore ?? 'match3.bestScore';
const SFX_SOURCES = CONFIG?.sfxSources ?? {
  clear: 'assets/sfx/clear.mp3',
  swap: 'assets/sfx/swap.mp3',
  invalid: 'assets/sfx/invalid.mp3',
  combo: 'assets/sfx/combo.mp3',
};
const LEVELS = CONFIG?.levels ?? [
  { targetScore: 900, moveLimit: 16 },
  { targetScore: 1300, moveLimit: 18 },
  { targetScore: 1750, moveLimit: 20 },
];
const GEM_COLOR_META = {
  '0': { label: '红', className: 'gem--0' },
  '1': { label: '蓝', className: 'gem--1' },
  '2': { label: '绿', className: 'gem--2' },
  '3': { label: '黄', className: 'gem--3' },
  '4': { label: '紫', className: 'gem--4' },
  '5': { label: '粉', className: 'gem--5' },
};

const boardEl = document.getElementById('board');
const piecesEl = document.getElementById('pieces');
const fxEl = document.getElementById('fx');
const scoreEl = document.getElementById('score');
const targetScoreEl = document.getElementById('targetScore');
const goalsEl = document.getElementById('goals');
const levelEl = document.getElementById('level');
const bestScoreEl = document.getElementById('bestScore');
const movesEl = document.getElementById('moves');
const moveLimitEl = document.getElementById('moveLimit');
const resetBtn = document.getElementById('resetBtn');
const audioBtn = document.getElementById('audioBtn');
const debugBtn = document.getElementById('debugBtn');
const perfBtn = document.getElementById('perfBtn');
const comboToastEl = document.getElementById('comboToast');
const levelOverlayEl = document.getElementById('levelOverlay');
const overlayTitleEl = document.getElementById('overlayTitle');
const overlayBodyEl = document.getElementById('overlayBody');
const overlayActionBtn = document.getElementById('overlayActionBtn');
const boardWrapEl = boardEl ? boardEl.closest('.board-wrap') : null;

let board = [];
let blockers = []; // { kind: 'ice'|'lock'|'stone', hp?: number } | null
let selected = null;
let score = 0;
let moves = 0;
let isLocked = false;
let audioEnabled = false;
let debugEnabled = false;
let perfEnabled = false;
let comboToastTimer = 0;
let comboToastRaf = 0;
let goalsRenderRaf = 0;
let pendingGoalsRenderLevel = null;
let lastGoalsMarkup = '';
let currentLevelIndex = 0;
let bestScore = 0;
let pendingOutcome = null;
let boardAnimationDepth = 0;

// DOM cache for performance: create 8x8 invisible cell buttons once.
let cellEls = null; // HTMLElement[BOARD_SIZE][BOARD_SIZE]
let cachedBoardWrapRect = null;
let cachedCellRects = null;
let cachedCellPositions = null; // { x, y }[BOARD_SIZE][BOARD_SIZE] relative to board-wrap
let cachedStepX = null;
let cachedStepY = null;
let cachedFallbackStepX = 62;
let cachedFallbackStepY = 62;

// Pieces overlay: each candy is its own absolutely-positioned element.
let candyIdSeq = 0;
const pieceElsById = new Map(); // id -> HTMLElement

const missingSfx = new Set();
const sfxPool = new Map();

function perfNow() {
  return perfEnabled ? performance.now() : 0;
}

function perfLog(label, startMs, extra = '') {
  if (!perfEnabled || !startMs) return;
  const elapsed = performance.now() - startMs;
  const suffix = extra ? ` ${extra}` : '';
  console.log(`[perf] ${label} ${elapsed.toFixed(1)}ms${suffix}`);
}

function syncInteractionState() {
  const boardAnimating = isLocked || boardAnimationDepth > 0;
  boardWrapEl?.classList.toggle('board-wrap--animating', boardAnimating);
  document.body.classList.toggle('animating', boardAnimationDepth > 0);
  if (boardEl) {
    boardEl.setAttribute('aria-busy', boardAnimating ? 'true' : 'false');
  }
}

function setLocked(value) {
  isLocked = value;
  syncInteractionState();
}

function beginBoardAnimation() {
  boardAnimationDepth += 1;
  syncInteractionState();
}

function endBoardAnimation() {
  if (boardAnimationDepth > 0) {
    boardAnimationDepth -= 1;
  }
  syncInteractionState();
}

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

function getCollectGoalMeta(color) {
  const colorKey = String(color);
  return GEM_COLOR_META[colorKey] ?? {
    label: `颜色 ${colorKey}`,
    className: '',
  };
}

function renderGoalGemIcon(color) {
  const { label, className } = getCollectGoalMeta(color);
  const classes = ['goal-chip__gem'];
  if (className) classes.push(className);
  return `<span class="${classes.join(' ')}" aria-hidden="true" title="${escapeHtml(label)}"></span>`;
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

function createEmptyBlockers() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function blockerAt(row, col) {
  if (!blockers?.[row]) return null;
  return blockers[row][col] || null;
}

function isStoneCell(row, col) {
  const b = blockerAt(row, col);
  return Boolean(b && b.kind === 'stone');
}

function isLockedCell(row, col) {
  const b = blockerAt(row, col);
  return Boolean(b && b.kind === 'lock');
}

function generateBoardWithoutMatches() {
  board = createEmptyBoard();

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (isStoneCell(row, col)) {
        board[row][col] = null;
        continue;
      }

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

let goalState = null;

function formatGoalsForHud(level) {
  const goals = level.goals || { score: level.targetScore };
  const parts = [];
  if (typeof goals.score === 'number') {
    parts.push(`分数 ${score}/${goals.score}`);
  }
  if (goals.collect) {
    Object.entries(goals.collect).forEach(([color, total]) => {
      const remaining = Math.max(0, (goalState?.collectRemaining?.[color] ?? total));
      const { label } = getCollectGoalMeta(color);
      parts.push(`收集${label}:${remaining}`);
    });
  }
  if (typeof goals.clearIce === 'number') {
    const remaining = Math.max(0, goalState?.iceRemaining ?? goals.clearIce);
    parts.push(`冰 ${remaining}`);
  }
  if (typeof goals.clearLocks === 'number') {
    const remaining = Math.max(0, goalState?.lockRemaining ?? goals.clearLocks);
    parts.push(`锁 ${remaining}`);
  }
  return parts.join(' · ');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderGoalChip({ label, value, meta = '', done = false, modifier = '', progress = null, iconMarkup = '' }) {
  const classes = ['goal-chip'];
  if (modifier) classes.push(`goal-chip--${modifier}`);
  if (done) classes.push('goal-chip--done');

  const progressMarkup = typeof progress === 'number'
    ? `<div class="goal-chip__progress" style="--progress:${progress.toFixed(2)}" aria-hidden="true"></div>`
    : '';
  const metaMarkup = meta ? `<span class="goal-chip__meta">${escapeHtml(meta)}</span>` : '';
  const labelMarkup = iconMarkup
    ? `<span class="goal-chip__label">${iconMarkup}<span>${escapeHtml(label)}</span></span>`
    : `<span class="goal-chip__label">${escapeHtml(label)}</span>`;

  return `
    <article class="${classes.join(' ')}">
      ${labelMarkup}
      <span class="goal-chip__value">${escapeHtml(value)}</span>
      ${progressMarkup}
      ${metaMarkup}
    </article>
  `;
}

function buildGoalsMarkup(level) {
  const goals = level.goals || { score: level.targetScore };
  const chips = [];

  if (typeof goals.score === 'number') {
    const progress = goals.score > 0 ? Math.min(100, (score / goals.score) * 100) : 100;
    chips.push(renderGoalChip({
      label: '分数目标',
      value: `${score} / ${goals.score}`,
      meta: score >= goals.score ? '已完成' : `还差 ${Math.max(0, goals.score - score)}`,
      done: score >= goals.score,
      modifier: 'score',
      progress,
    }));
  }

  if (goals.collect) {
    Object.entries(goals.collect).forEach(([color, total]) => {
      const remaining = Math.max(0, goalState?.collectRemaining?.[color] ?? total);
      const collected = Math.max(0, total - remaining);
      const { label } = getCollectGoalMeta(color);
      chips.push(renderGoalChip({
        label: `收集 ${label}`,
        value: `${remaining}`,
        meta: `${collected} / ${total}`,
        done: remaining === 0,
        iconMarkup: renderGoalGemIcon(color),
      }));
    });
  }

  if (typeof goals.clearIce === 'number') {
    const remaining = Math.max(0, goalState?.iceRemaining ?? goals.clearIce);
    chips.push(renderGoalChip({
      label: '清除冰块',
      value: `${remaining}`,
      meta: remaining === 0 ? '已完成' : `剩余 ${remaining}`,
      done: remaining === 0,
    }));
  }

  if (typeof goals.clearLocks === 'number') {
    const remaining = Math.max(0, goalState?.lockRemaining ?? goals.clearLocks);
    chips.push(renderGoalChip({
      label: '清除锁链',
      value: `${remaining}`,
      meta: remaining === 0 ? '已完成' : `剩余 ${remaining}`,
      done: remaining === 0,
    }));
  }

  return chips.join('');
}

function renderGoals(level) {
  if (!goalsEl) return;
  const markup = buildGoalsMarkup(level);
  if (markup === lastGoalsMarkup) return;
  goalsEl.innerHTML = markup;
  lastGoalsMarkup = markup;
}

function scheduleGoalsRender(level) {
  if (!goalsEl) return;
  pendingGoalsRenderLevel = level;
  if (goalsRenderRaf) return;
  goalsRenderRaf = window.requestAnimationFrame(() => {
    goalsRenderRaf = 0;
    const levelToRender = pendingGoalsRenderLevel || LEVELS[currentLevelIndex];
    pendingGoalsRenderLevel = null;
    renderGoals(levelToRender);
  });
}

function updateHud() {
  scoreEl.textContent = String(score);
  movesEl.textContent = String(moves);
  const level = LEVELS[currentLevelIndex];
  if (targetScoreEl) targetScoreEl.textContent = formatGoalsForHud(level);
  scheduleGoalsRender(level);
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

function readRootCssPx(name, fallback) {
  const value = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

function cacheFallbackGridMetrics() {
  const cellSize = readRootCssPx('--cell-size', 56);
  const gap = readRootCssPx('--gap', 6);
  cachedFallbackStepX = cellSize + gap;
  cachedFallbackStepY = cellSize + gap;
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
  cacheFallbackGridMetrics();
  if (cellEls) cacheBoardGeometry();
});

function updateBoardDom() {
  ensureBoardDom();
  // Cells are used for layout + geometry + obstacle backgrounds (actual pieces live in #pieces).
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const btn = cellEls[row][col];
      const b = blockerAt(row, col);
      const kind = b?.kind || '';
      if (btn.dataset.blockerKind === kind) continue;
      btn.dataset.blockerKind = kind;
      if (kind === 'stone') {
        btn.className = 'cell cell--stone';
      } else if (kind === 'ice') {
        btn.className = 'cell cell--ice';
      } else if (kind === 'lock') {
        btn.className = 'cell cell--lock';
      } else {
        btn.className = 'cell';
      }
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
    const step = Number.isFinite(cachedFallbackStepX) ? cachedFallbackStepX : 62;
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

function createPieceEl(candyId, row, col) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'gem';
  el.dataset.id = String(candyId);
  el.dataset.row = String(row);
  el.dataset.col = String(col);
  el.style.visibility = 'hidden';

  // Set initial position variables synchronously before attaching to the DOM.
  // Positioning is driven by CSS `transform: translate(var(--tx), var(--ty))` so animations don't override translation.
  const pos = positionForCell(row, col);
  const tx = `${pos.x}px`;
  const ty = `${pos.y}px`;
  el.style.setProperty('--tx', tx);
  el.style.setProperty('--ty', ty);
  el.dataset.tx = tx;
  el.dataset.ty = ty;
  el.setAttribute('aria-label', `Candy at row ${row + 1}, col ${col + 1}`);
  return el;
}

function ensurePieceEl(candyId, row, col, attachFrag = null) {
  if (!piecesEl) {
    throw new Error('#pieces layer missing');
  }

  let el = pieceElsById.get(candyId);
  if (el) return el;

  el = createPieceEl(candyId, row, col);
  if (attachFrag) {
    attachFrag.appendChild(el);
  } else {
    piecesEl.appendChild(el);
  }
  pieceElsById.set(candyId, el);
  return el;
}

function syncPiecesDom({ durationMs = 0 } = {}) {
  const perfStart = perfNow();
  ensureBoardDom();
  if (!piecesEl) return;
  const moveDuration = `${durationMs}ms`;
  if (piecesEl.dataset.moveDuration !== moveDuration) {
    piecesEl.style.setProperty('--move-duration', moveDuration);
    piecesEl.dataset.moveDuration = moveDuration;
  }

  const seen = new Set();
  const newPiecesFrag = document.createDocumentFragment();
  let createdCount = 0;

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const candy = board[row][col];
      if (!candy) continue;
      seen.add(candy.id);

      const existingEl = pieceElsById.get(candy.id);
      const el = existingEl || ensurePieceEl(candy.id, row, col, newPiecesFrag);
      if (!existingEl) createdCount += 1;
      const rowText = String(row);
      const colText = String(col);
      if (el.dataset.row !== rowText) el.dataset.row = rowText;
      if (el.dataset.col !== colText) el.dataset.col = colText;

      const specialLabel = candy?.kind === 'wrapped' ? ' (Wrapped candy)' : '';
      const ariaLabel = `Candy at row ${row + 1}, col ${col + 1}${specialLabel}`;
      if (el.getAttribute('aria-label') !== ariaLabel) {
        el.setAttribute('aria-label', ariaLabel);
      }
      const className = gemClasses(row, col);
      if (el.className !== className) {
        el.className = className;
      }
      const overlayKind = blockerAt(row, col)?.kind;
      const overlay = overlayKind === 'ice' || overlayKind === 'lock' ? overlayKind : '';
      if ((el.dataset.overlay || '') !== overlay) {
        if (overlay) {
          el.dataset.overlay = overlay;
        } else {
          delete el.dataset.overlay;
        }
      }

      const pos = positionForCell(row, col);
      const tx = `${pos.x}px`;
      const ty = `${pos.y}px`;
      if (el.dataset.tx !== tx) {
        el.style.setProperty('--tx', tx);
        el.dataset.tx = tx;
      }
      if (el.dataset.ty !== ty) {
        el.style.setProperty('--ty', ty);
        el.dataset.ty = ty;
      }
      if (el.style.visibility !== 'visible') el.style.visibility = 'visible';
      if (el.style.transitionDuration) el.style.transitionDuration = '';
    }
  }
  if (createdCount > 0) {
    piecesEl.appendChild(newPiecesFrag);
  }

  // Remove stale piece elements (should be rare).
  // Perf: batch removals into a single timer to avoid scheduling dozens of timeouts
  // during large clears / cascades.
  const stale = [];
  for (const [id, el] of pieceElsById.entries()) {
    if (seen.has(id)) continue;
    el.classList.add('clearing');
    stale.push({ id, el });
  }

  if (stale.length > 0) {
    window.setTimeout(() => {
      stale.forEach(({ id, el }) => {
        el.remove();
        pieceElsById.delete(id);
      });
    }, CLEAR_DELAY_MS);
  }
  perfLog('syncPiecesDom', perfStart, `duration=${durationMs} created=${createdCount} stale=${stale.length}`);
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

async function animateFlip(updateFn, durationMs) {
  beginBoardAnimation();
  try {
    // Pieces are absolutely positioned; simply updating transforms yields the animation.
    updateFn();
    renderBoard({ durationMs });
    await wait(durationMs);
  } finally {
    endBoardAnimation();
  }
}


function renderBoard({ durationMs = 0 } = {}) {
  updateBoardDom();
  syncPiecesDom({ durationMs });
}

function findMatches() {
  const perfStart = perfNow();
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

  perfLog('findMatches', perfStart, `matched=${matched.size} groups=${lineGroups.length}`);
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

function updatePerfButton() {
  if (!perfBtn) return;
  perfBtn.setAttribute('aria-pressed', perfEnabled ? 'true' : 'false');
  perfBtn.textContent = perfEnabled ? 'Perf: On' : 'Perf: Off';
}

function loadPerfPreference() {
  perfEnabled = safeGetLocalStorage(PERF_STORAGE_KEY) === '1';
  updatePerfButton();
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

function goalsSatisfied(level) {
  const goals = level.goals || { score: level.targetScore };

  if (typeof goals.score === 'number' && score < goals.score) {
    return false;
  }

  if (goals.collect && goalState?.collectRemaining) {
    for (const [color, total] of Object.entries(goals.collect)) {
      const remaining = goalState.collectRemaining[color] ?? total;
      if (remaining > 0) return false;
    }
  }

  if (typeof goals.clearIce === 'number') {
    if ((goalState?.iceRemaining ?? goals.clearIce) > 0) return false;
  }

  if (typeof goals.clearLocks === 'number') {
    if ((goalState?.lockRemaining ?? goals.clearLocks) > 0) return false;
  }

  return true;
}

function evaluateTurnOutcome() {
  const level = LEVELS[currentLevelIndex];

  if (goalsSatisfied(level)) {
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

  setLocked(true);
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

const FX_POOL_MAX = 160;
const PULSE_MAX_PER_CLEAR = 16;
const WRAPPED_BLAST_MAX_PER_CLEAR = 8;
const FX_SAMPLE_THRESHOLD = 20;
const DENSE_CLEAR_THRESHOLD = 20;
const DENSE_BEAM_LIMIT = 5;
const DENSE_PULSE_LIMIT = 6;
const DENSE_WRAPPED_LIMIT = 4;
const DENSE_SPARKLE_MAX_PER_CLEAR = 16;
const SPARKLE_SPLIT_FRAME_THRESHOLD = 20;

const fxPools = {
  sparkle: [],
  pulse: [],
  wrappedBlast: [],
  beamRow: [],
  beamCol: [],
};
const activeFxNodes = new Set();
let fxCleanupListenerBound = false;
let pendingSparkleRaf = 0;
let pendingSparkleBatchToken = 0;

function ensureFxCleanupListener() {
  if (!fxEl || fxCleanupListenerBound) return;
  fxEl.addEventListener('animationend', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!activeFxNodes.has(target)) return;
    releaseFxNode(target);
  });
  fxCleanupListenerBound = true;
}

function acquireFxNode(poolType, className) {
  const pool = fxPools[poolType];
  let el = pool.length > 0 ? pool.pop() : null;
  if (!el) {
    el = document.createElement('div');
    el.classList.add('fx-node');
    if (fxEl) fxEl.appendChild(el);
  }
  el.className = `fx-node ${className} fx-active`;
  el.dataset.fxPoolType = poolType;
  activeFxNodes.add(el);
  return el;
}

function releaseFxNode(el) {
  if (!activeFxNodes.has(el)) return;
  activeFxNodes.delete(el);
  el.classList.remove('fx-active');

  const poolType = el.dataset.fxPoolType;
  const pool = poolType ? fxPools[poolType] : null;
  if (!pool) return;
  if (pool.length >= FX_POOL_MAX) {
    el.remove();
    return;
  }

  el.removeAttribute('style');
  pool.push(el);
}

function cancelPendingSparkles() {
  pendingSparkleBatchToken += 1;
  if (!pendingSparkleRaf) return;
  window.cancelAnimationFrame(pendingSparkleRaf);
  pendingSparkleRaf = 0;
}

function clearFxLayer() {
  if (!fxEl) return;
  cancelPendingSparkles();
  ensureFxCleanupListener();
  if (activeFxNodes.size === 0) return;
  const nodes = Array.from(activeFxNodes);
  nodes.forEach((node) => releaseFxNode(node));
}

const SPARKLE_MAX_PER_WAVE = 120;

// Perf: cap sparkle DOM nodes for big clears.
// Keep particles (visual feedback) but prevent large clears from creating hundreds of nodes at once.
const SPARKLE_MAX_PER_CLEAR = 80;
const SPARKLE_SKIP_THRESHOLD = 24;

function createFxRandom(seed) {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runSparkleJobs(jobs, startIndex, endIndex) {
  if (!fxEl || !cachedBoardWrapRect || !cachedCellRects) return 0;
  ensureFxCleanupListener();

  const boardRect = cachedBoardWrapRect;
  let created = 0;

  for (let jobIndex = startIndex; jobIndex < endIndex; jobIndex += 1) {
    const job = jobs[jobIndex];
    const cellRect = cachedCellRects[job.row][job.col];
    if (!cellRect) continue;

    const baseX = cellRect.left - boardRect.left + cellRect.width / 2;
    const baseY = cellRect.top - boardRect.top + cellRect.height / 2;
    const maxOffset = Math.max(6, cellRect.width * 0.18);
    const maxTravel = Math.max(18, cellRect.width * 0.55) * job.power;
    const sizeScale = 0.95 + job.power * 0.25;
    const durationScale = 1 / (0.9 + job.power * 0.1);
    const rand = createFxRandom(job.seed);

    for (let i = 0; i < job.count; i += 1) {
      const sparkle = acquireFxNode('sparkle', 'sparkle');
      const startX = Math.round((baseX + (rand() * 2 - 1) * maxOffset) * 10) / 10;
      const startY = Math.round((baseY + (rand() * 2 - 1) * maxOffset) * 10) / 10;
      const angle = rand() * Math.PI * 2;
      const distance = (0.35 + rand() * 0.75) * maxTravel;
      const dx = Math.round(Math.cos(angle) * distance * 10) / 10;
      const dy = Math.round(Math.sin(angle) * distance * 10) / 10;
      const size = Math.round((2.2 + rand() * 2.4) * sizeScale * 10) / 10;
      const duration = Math.round((170 + rand() * 90) * durationScale);

      sparkle.style.cssText = `--x:${startX}px;--y:${startY}px;--dx:${dx}px;--dy:${dy}px;--s:${size}px;--dur:${duration}ms;--h:${job.hue};`;
      created += 1;
    }
  }

  return created;
}

function scheduleSparkleJobs(jobs, startIndex, endIndex) {
  if (startIndex >= endIndex) return;
  cancelPendingSparkles();
  const batchToken = pendingSparkleBatchToken;
  pendingSparkleRaf = window.requestAnimationFrame(() => {
    pendingSparkleRaf = 0;
    if (batchToken !== pendingSparkleBatchToken) return;
    runSparkleJobs(jobs, startIndex, endIndex);
  });
}

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

function addBeamFx(kind, row, col) {
  if (!fxEl || !cachedBoardWrapRect || !cachedCellRects) return;
  ensureFxCleanupListener();

  const boardRect = cachedBoardWrapRect;
  const cellRect = cachedCellRects[row][col];

  const poolType = kind === 'row' ? 'beamRow' : 'beamCol';
  const beam = acquireFxNode(poolType, `beam ${kind}`);

  if (kind === 'row') {
    beam.style.left = '10px';
    beam.style.right = '10px';
    beam.style.top = `${cellRect.top - boardRect.top + cellRect.height * 0.15}px`;
  } else {
    beam.style.top = '10px';
    beam.style.bottom = '10px';
    beam.style.left = `${cellRect.left - boardRect.left + cellRect.width * 0.15}px`;
  }
}

function addPulseFx(row, col) {
  if (!fxEl || !cachedBoardWrapRect || !cachedCellRects) return;
  ensureFxCleanupListener();

  const boardRect = cachedBoardWrapRect;
  const cellRect = cachedCellRects[row][col];

  const pulse = acquireFxNode('pulse', 'pulse');
  const size = Math.max(cellRect.width, cellRect.height) * 1.2;
  pulse.style.setProperty('--size', `${size.toFixed(2)}px`);
  pulse.style.setProperty('--x', `${(cellRect.left - boardRect.left + cellRect.width / 2 - size / 2).toFixed(2)}px`);
  pulse.style.setProperty('--y', `${(cellRect.top - boardRect.top + cellRect.height / 2 - size / 2).toFixed(2)}px`);
}

function addWrappedBlastFx(row, col) {
  if (!fxEl || !cachedBoardWrapRect || !cachedCellRects) return;
  ensureFxCleanupListener();

  const boardRect = cachedBoardWrapRect;
  const cellRect = cachedCellRects[row][col];

  const blast = acquireFxNode('wrappedBlast', 'wrapped-blast');
  const size = Math.max(cellRect.width, cellRect.height) * 3.2;
  blast.style.setProperty('--size', `${size.toFixed(2)}px`);
  blast.style.setProperty('--x', `${(cellRect.left - boardRect.left + cellRect.width / 2 - size / 2).toFixed(2)}px`);
  blast.style.setProperty('--y', `${(cellRect.top - boardRect.top + cellRect.height / 2 - size / 2).toFixed(2)}px`);
}

function sampleCells(cells, maxCount) {
  if (!cells || cells.length <= maxCount) return cells || [];
  if (maxCount <= 0) return [];
  const stride = Math.ceil(cells.length / maxCount);
  const sampled = [];
  for (let i = 0; i < cells.length; i += stride) {
    sampled.push(cells[i]);
    if (sampled.length >= maxCount) break;
  }
  return sampled;
}

function spawnFxForClearSet(matches, fxOverrides = null) {
  const perfStart = perfNow();
  clearFxLayer();

  const rowBeams = new Set(fxOverrides?.rowBeams || []);
  const colBeams = new Set(fxOverrides?.colBeams || []);
  let pulses = [...(fxOverrides?.pulses || [])];
  let wrappedBlasts = [...(fxOverrides?.wrappedBlasts || [])];

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

  if (matches.size >= FX_SAMPLE_THRESHOLD) {
    pulses = sampleCells(pulses, PULSE_MAX_PER_CLEAR);
    wrappedBlasts = sampleCells(wrappedBlasts, WRAPPED_BLAST_MAX_PER_CLEAR);
  }
  const rowBeamList = [...rowBeams];
  const colBeamList = [...colBeams];
  if (clearCount > DENSE_CLEAR_THRESHOLD) {
    pulses = sampleCells(pulses, DENSE_PULSE_LIMIT);
    wrappedBlasts = sampleCells(wrappedBlasts, DENSE_WRAPPED_LIMIT);
  }
  const sampledRows = clearCount > DENSE_CLEAR_THRESHOLD ? sampleCells(rowBeamList, DENSE_BEAM_LIMIT) : rowBeamList;
  const sampledCols = clearCount > DENSE_CLEAR_THRESHOLD ? sampleCells(colBeamList, DENSE_BEAM_LIMIT) : colBeamList;

  sampledRows.forEach((row) => addBeamFx('row', row, 0));
  sampledCols.forEach((col) => addBeamFx('col', 0, col));
  pulses.forEach((p) => addPulseFx(p.row, p.col));
  wrappedBlasts.forEach((p) => addWrappedBlastFx(p.row, p.col));

  // Lightweight sparkle particles for cleared cells.
  // Performance rule: keep each wave under a hard DOM budget.
  // For huge clears, sample cells so we stay smooth.
  let budget = Math.min(
    SPARKLE_MAX_PER_WAVE,
    clearCount > DENSE_CLEAR_THRESHOLD ? DENSE_SPARKLE_MAX_PER_CLEAR : SPARKLE_MAX_PER_CLEAR,
  );
  const startBudget = budget;
  const sparkleJobs = [];

  // Decide how many cells get sparkles for this clear.
  const matchKeys = [...matches];
  const shouldSample = clearCount >= SPARKLE_SKIP_THRESHOLD;
  let basePerCell = shouldSample ? 2 : 3;
  if (clearCount > DENSE_CLEAR_THRESHOLD) basePerCell = 1;
  if (!shouldSample && clearCount <= DENSE_CLEAR_THRESHOLD) {
    if (clearCount >= 8) basePerCell = 4;
    if (clearCount >= 12) basePerCell = 5;
  }

  // If we'd exceed our budget, sample every Nth cell.
  const estCellsAtBase = Math.max(1, Math.floor(budget / Math.max(1, basePerCell)));
  const step = Math.max(1, Math.ceil(clearCount / estCellsAtBase));
  const sparkleKeys = step === 1 ? matchKeys : matchKeys.filter((_, idx) => idx % step === 0);

  // Guarantee we don't exceed the budget.
  const perCellCap = Math.max(1, Math.floor(budget / Math.max(1, sparkleKeys.length)));
  basePerCell = Math.min(basePerCell, perCellCap);

  sparkleKeys.forEach((key) => {
    if (budget <= 0) return;

    const { row, col } = parseKey(key);
    const candy = board[row][col];
    if (!candy) return;

    const hue = hueForGemColor(candy.color);
    const isSpecial = candy.kind !== 'normal';

    let wanted = basePerCell;
    if (isSpecial) wanted += clearCount > DENSE_CLEAR_THRESHOLD ? 1 : 3;
    if (clearCount >= BIG_CLEAR_SHAKE_THRESHOLD && clearCount <= DENSE_CLEAR_THRESHOLD) wanted += 1;

    wanted = Math.min(wanted, 10);
    const actual = Math.min(wanted, budget);
    const power = clearCount > DENSE_CLEAR_THRESHOLD ? 0.95 : isSpecial ? 1.55 : clearCount >= 10 ? 1.25 : 1;

    sparkleJobs.push({
      row,
      col,
      count: actual,
      hue,
      power,
      seed: ((row + 1) * 73856093) ^ ((col + 1) * 19349663) ^ (actual * 83492791) ^ ((hue + 1) * 2654435761) ^ Math.round(power * 1000),
    });
    budget -= actual;
  });
  const splitIndex = clearCount >= SPARKLE_SPLIT_FRAME_THRESHOLD ? Math.ceil(sparkleJobs.length / 2) : sparkleJobs.length;
  runSparkleJobs(sparkleJobs, 0, splitIndex);
  scheduleSparkleJobs(sparkleJobs, splitIndex, sparkleJobs.length);
  perfLog('spawnFxForClearSet', perfStart, `clear=${clearCount} sparkBudget=${startBudget - budget}`);
}

async function animateClear(matches, fxOverrides = null) {
  const perfStart = perfNow();
  if (matches.size >= BIG_CLEAR_SHAKE_THRESHOLD) {
    boardEl.classList.add('board-shake');
  }

  spawnFxForClearSet(matches, fxOverrides);
  await nextFrame();

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
  perfLog('animateClear', perfStart, `clear=${matches.size}`);
}

function applyGoalProgressForCandy(candy) {
  const level = LEVELS[currentLevelIndex];
  const goals = level.goals || { score: level.targetScore };
  if (!goalState) return;

  if (goals.collect && candy && typeof candy.color === 'number') {
    const key = String(candy.color);
    if (Object.prototype.hasOwnProperty.call(goals.collect, key)) {
      const remaining = goalState.collectRemaining[key] ?? goals.collect[key];
      goalState.collectRemaining[key] = Math.max(0, remaining - 1);
    }
  }
}

function applyGoalProgressForBlockerCleared(kind) {
  if (!goalState) return;
  if (kind === 'ice') goalState.iceRemaining = Math.max(0, (goalState.iceRemaining ?? 0) - 1);
  if (kind === 'lock') goalState.lockRemaining = Math.max(0, (goalState.lockRemaining ?? 0) - 1);
}

function damageBlockerOnCell(row, col) {
  const b = blockerAt(row, col);
  if (!b) return;
  if (b.kind === 'stone') return;

  if (b.kind === 'ice') {
    b.hp = (b.hp ?? 1) - 1;
    if (b.hp <= 0) {
      blockers[row][col] = null;
      applyGoalProgressForBlockerCleared('ice');
    }
  } else if (b.kind === 'lock') {
    // One-hit lock.
    blockers[row][col] = null;
    applyGoalProgressForBlockerCleared('lock');
  }
}

function removeMatches(matches) {
  let removedCount = 0;

  matches.forEach((key) => {
    const { row, col } = parseKey(key);
    if (!inBounds(row, col)) return;
    if (isStoneCell(row, col)) return;

    const candy = board[row][col];
    if (!candy) return;

    applyGoalProgressForCandy(candy);
    damageBlockerOnCell(row, col);

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
    // Stones create segments; gravity + fill happens within each segment.
    const stoneRows = [];
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      if (isStoneCell(row, col)) {
        stoneRows.push(row);
        board[row][col] = null;
      }
    }

    const segmentStarts = [-1, ...stoneRows];
    const segmentEnds = [...stoneRows, BOARD_SIZE];

    for (let s = 0; s < segmentStarts.length; s += 1) {
      const start = segmentStarts[s];
      const end = segmentEnds[s];
      const rows = [];
      for (let r = start + 1; r <= end - 1; r += 1) rows.push(r);
      if (rows.length === 0) continue;

      const existing = [];
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        const candy = board[row][col];
        if (candy !== null) {
          existing.unshift(candy);
        }
      }

      const missing = rows.length - existing.length;
      const newCandies = Array.from({ length: missing }, () => createNormalCandy());
      const finalSegment = [...newCandies, ...existing].slice(0, rows.length);

      for (let i = 0; i < rows.length; i += 1) {
        board[rows[i]][col] = finalSegment[i] ?? null;
      }

      // Spawn animations: spawn above the top of this segment.
      for (let i = 0; i < newCandies.length; i += 1) {
        const candy = newCandies[i];
        const finalRow = rows[i];
        const spawnRow = rows[0] + (i - missing);
        spawns.push({ candy, col, finalRow, spawnRow });
      }
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
  if (comboToastRaf) {
    window.cancelAnimationFrame(comboToastRaf);
  }
  comboToastRaf = window.requestAnimationFrame(() => {
    comboToastRaf = window.requestAnimationFrame(() => {
      comboToastEl.classList.add('show');
    });
  });
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
  beginBoardAnimation();
  try {
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
        el.style.setProperty('--tx', `${pos.x}px`);
        el.style.setProperty('--ty', `${pos.y}px`);
        el.style.visibility = 'visible';
      }

      await nextFrame();
      for (const spawn of spawns) {
        const el = pieceElsById.get(spawn.candy.id);
        if (el && el.style.transitionDuration) {
          el.style.transitionDuration = '';
        }
      }
      renderBoard({ durationMs: DROP_DELAY_MS });
      await wait(DROP_DELAY_MS);

      for (const spawn of spawns) {
        const el = pieceElsById.get(spawn.candy.id);
        if (el) el.classList.remove('spawning');
      }
    }
  } finally {
    endBoardAnimation();
  }
}

async function trySwap(from, to) {
  // Lock/stone obstacles: prevent manual swaps.
  if (isStoneCell(from.row, from.col) || isStoneCell(to.row, to.col) || isLockedCell(from.row, from.col) || isLockedCell(to.row, to.col)) {
    playSfx('invalid');
    selected = null;
    setLocked(false);
    return;
  }

  setLocked(true);
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
      setLocked(false);
      return;
    }
    setLocked(false);
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
    setLocked(false);
    return;
  }

  moves += 1;
  updateHud();
  playSfx('swap');
  selected = null;
  await resolveCascades(to, null);
  if (concludeLevelIfNeeded()) {
    setLocked(false);
    return;
  }
  setLocked(false);
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

function initLevelGoals(level) {
  const goals = level.goals || { score: level.targetScore };
  goalState = {
    collectRemaining: {},
    iceRemaining: typeof goals.clearIce === 'number' ? goals.clearIce : 0,
    lockRemaining: typeof goals.clearLocks === 'number' ? goals.clearLocks : 0,
  };

  if (goals.collect) {
    for (const [color, total] of Object.entries(goals.collect)) {
      goalState.collectRemaining[color] = total;
    }
  }
}

function initLevelBlockers(level) {
  blockers = createEmptyBlockers();
  const defs = level.blockers || [];
  for (const def of defs) {
    if (!def) continue;
    const { row, col, kind } = def;
    if (!inBounds(row, col)) continue;
    if (kind === 'stone') {
      blockers[row][col] = { kind: 'stone' };
    } else if (kind === 'ice') {
      blockers[row][col] = { kind: 'ice', hp: def.hp ?? 1 };
    } else if (kind === 'lock') {
      blockers[row][col] = { kind: 'lock', hp: 1 };
    }
  }

  // Count initial obstacles for goals (if not explicitly set)
  const goals = level.goals || {};
  if (typeof goals.clearIce === 'number') {
    // Use configured target.
  } else {
    // Derive from board.
    let cnt = 0;
    for (let r = 0; r < BOARD_SIZE; r += 1) {
      for (let c = 0; c < BOARD_SIZE; c += 1) {
        if (blockerAt(r, c)?.kind === 'ice') cnt += 1;
      }
    }
    goalState.iceRemaining = cnt;
  }

  if (typeof goals.clearLocks === 'number') {
    // Use configured target.
  } else {
    let cnt = 0;
    for (let r = 0; r < BOARD_SIZE; r += 1) {
      for (let c = 0; c < BOARD_SIZE; c += 1) {
        if (blockerAt(r, c)?.kind === 'lock') cnt += 1;
      }
    }
    goalState.lockRemaining = cnt;
  }
}

function resetGame() {
  score = 0;
  moves = 0;
  selected = null;
  boardAnimationDepth = 0;
  setLocked(false);
  pendingOutcome = null;
  lastGoalsMarkup = '';
  if (goalsRenderRaf) {
    window.cancelAnimationFrame(goalsRenderRaf);
    goalsRenderRaf = 0;
  }
  pendingGoalsRenderLevel = null;

  const level = LEVELS[currentLevelIndex];
  initLevelGoals(level);
  initLevelBlockers(level);

  pieceElsById.clear();
  if (piecesEl) piecesEl.innerHTML = '';

  generateBoardWithoutMatches();
  seedDebugSpecialCandies();
  updateHud();
  renderBoard();
  clearFxLayer();
  hideLevelOverlay();
  if (comboToastEl) {
    if (comboToastRaf) {
      window.cancelAnimationFrame(comboToastRaf);
      comboToastRaf = 0;
    }
    comboToastEl.classList.remove('show');
  }
}

piecesEl?.addEventListener('click', (event) => {
  onGemClick(event).catch(() => {
    boardAnimationDepth = 0;
    setLocked(false);
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

if (perfBtn) {
  perfBtn.addEventListener('click', () => {
    perfEnabled = !perfEnabled;
    updatePerfButton();
    safeSetLocalStorage(PERF_STORAGE_KEY, perfEnabled ? '1' : '0');
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
loadPerfPreference();
cacheFallbackGridMetrics();
resetGame();

window.match3State = {
  get debugEnabled() {
    return debugEnabled;
  },
  get perfEnabled() {
    return perfEnabled;
  },
  get level() {
    return currentLevelIndex + 1;
  },
  get score() {
    return score;
  },
  get moves() {
    return moves;
  },
};
