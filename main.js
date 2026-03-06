'use strict';

const BOARD_SIZE = 8;
const GEM_TYPES = [0, 1, 2, 3, 4, 5];
const CLEAR_DELAY_MS = 260;
const DROP_DELAY_MS = 170;
const SCORE_PER_GEM = 10;
const BIG_CLEAR_SHAKE_THRESHOLD = 8;

const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const movesEl = document.getElementById('moves');
const resetBtn = document.getElementById('resetBtn');

let board = [];
let selected = null;
let score = 0;
let moves = 0;
let isLocked = false;

function randGem() {
  return GEM_TYPES[Math.floor(Math.random() * GEM_TYPES.length)];
}

function createNormalCandy(color = randGem()) {
  return {
    kind: 'normal',
    color,
  };
}

function createStripedCandy(color, orientation) {
  return {
    kind: 'striped',
    color,
    orientation,
  };
}

function createColorBomb(color) {
  return {
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

function updateHud() {
  scoreEl.textContent = String(score);
  movesEl.textContent = String(moves);
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
  } else if (candy.kind === 'colorBomb') {
    classes.push('gem--color-bomb');
  }

  if (selected && selected.row === row && selected.col === col) {
    classes.push('selected');
  }

  return classes.join(' ');
}

function renderBoard() {
  let html = '';
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const candy = board[row][col];
      const label = candy
        ? `Candy at row ${row + 1}, col ${col + 1}`
        : `Empty at row ${row + 1}, col ${col + 1}`;
      html += `<button class="${gemClasses(row, col)}" data-row="${row}" data-col="${col}" aria-label="${label}"></button>`;
    }
  }
  boardEl.innerHTML = html;
}

function findMatches() {
  const matched = new Set();
  const groups = [];

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
          groups.push({ direction: 'horizontal', length: streak, color: prevColor, cells });
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
          groups.push({ direction: 'vertical', length: streak, color: prevColor, cells });
        }
        streak = 1;
      }
    }
  }

  return { matched, groups };
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function animateClear(matches) {
  if (matches.size >= BIG_CLEAR_SHAKE_THRESHOLD) {
    boardEl.classList.add('board-shake');
  }

  matches.forEach((key) => {
    const { row, col } = parseKey(key);
    const el = boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (el) {
      el.classList.add('clearing');
    }
  });

  await wait(CLEAR_DELAY_MS);
  boardEl.classList.remove('board-shake');
}

function removeMatches(matches) {
  matches.forEach((key) => {
    const { row, col } = parseKey(key);
    board[row][col] = null;
  });

  score += matches.size * SCORE_PER_GEM;
  updateHud();
}

function dropAndFill() {
  for (let col = 0; col < BOARD_SIZE; col += 1) {
    const compacted = [];
    for (let row = BOARD_SIZE - 1; row >= 0; row -= 1) {
      const candy = board[row][col];
      if (candy !== null) {
        compacted.push(candy);
      }
    }

    while (compacted.length < BOARD_SIZE) {
      compacted.push(createNormalCandy());
    }

    for (let row = BOARD_SIZE - 1, i = 0; row >= 0; row -= 1, i += 1) {
      board[row][col] = compacted[i];
    }
  }
}

function pickSpawnCell(group, preferredCell, occupied) {
  const candidates = [];

  if (preferredCell && group.cells.some((cell) => cell.row === preferredCell.row && cell.col === preferredCell.col)) {
    candidates.push(preferredCell);
  }

  const middleCell = group.cells[Math.floor(group.cells.length / 2)];
  if (middleCell) {
    candidates.push(middleCell);
  }

  candidates.push(...group.cells);

  const seen = new Set();
  for (const cell of candidates) {
    const key = keyOf(cell.row, cell.col);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (!occupied.has(key)) {
      return cell;
    }
  }

  return null;
}

function planSpecialSpawns(groups, preferredCell) {
  const plans = new Map();
  const occupied = new Set();

  const sortedGroups = [...groups].sort((a, b) => b.length - a.length);

  for (const group of sortedGroups) {
    let spawnedCandy = null;

    if (group.length >= 5) {
      spawnedCandy = createColorBomb(group.color);
    } else if (group.length === 4) {
      const orientation = group.direction === 'horizontal' ? 'col' : 'row';
      spawnedCandy = createStripedCandy(group.color, orientation);
    }

    if (!spawnedCandy) {
      continue;
    }

    const spawnCell = pickSpawnCell(group, preferredCell, occupied);
    if (!spawnCell) {
      continue;
    }

    const key = keyOf(spawnCell.row, spawnCell.col);
    const existing = plans.get(key);
    const newPriority = spawnedCandy.kind === 'colorBomb' ? 2 : 1;
    const existingPriority = existing ? (existing.kind === 'colorBomb' ? 2 : 1) : 0;

    if (!existing || newPriority > existingPriority) {
      plans.set(key, spawnedCandy);
    }
    occupied.add(key);
  }

  return plans;
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

function expandClearSet(initialClear, protectedCells = new Set(), colorBombOverrides = new Map()) {
  const result = new Set();
  const activated = new Set();
  const queue = [...initialClear];

  while (queue.length > 0) {
    const key = queue.pop();
    if (result.has(key) || protectedCells.has(key)) {
      continue;
    }

    result.add(key);
    const { row, col } = parseKey(key);
    if (!inBounds(row, col)) {
      continue;
    }

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
    }

    if (candy.kind === 'colorBomb') {
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

  return result;
}

function applySpawnPlans(spawnPlans) {
  spawnPlans.forEach((candy, key) => {
    const { row, col } = parseKey(key);
    board[row][col] = candy;
  });
}

function buildColorBombSwapContext(from, to) {
  const fromCandy = board[from.row][from.col];
  const toCandy = board[to.row][to.col];

  const clearSet = new Set();
  const colorBombOverrides = new Map();

  if (!fromCandy || !toCandy) {
    return { clearSet, colorBombOverrides };
  }

  if (isColorBomb(fromCandy) && isColorBomb(toCandy)) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        if (board[row][col]) {
          clearSet.add(keyOf(row, col));
        }
      }
    }
    return { clearSet, colorBombOverrides };
  }

  const bombCell = isColorBomb(fromCandy) ? from : to;
  const otherCandy = isColorBomb(fromCandy) ? toCandy : fromCandy;

  const bombKey = keyOf(bombCell.row, bombCell.col);
  clearSet.add(bombKey);

  if (!otherCandy) {
    return { clearSet, colorBombOverrides };
  }
  colorBombOverrides.set(bombKey, otherCandy.color);

  const colorCells = collectColorCells(otherCandy.color);
  colorCells.forEach((cell) => {
    clearSet.add(keyOf(cell.row, cell.col));
  });

  return { clearSet, colorBombOverrides };
}

async function resolveCascades(preferredSpawnCell, initialForcedContext = null) {
  let preferred = preferredSpawnCell;
  let forcedContext = initialForcedContext;

  while (true) {
    let clearSet;
    let spawnPlans = new Map();

    if (forcedContext) {
      const forcedClear = forcedContext.clearSet || new Set();
      const forcedOverrides = forcedContext.colorBombOverrides || new Map();
      clearSet = expandClearSet(forcedClear, new Set(), forcedOverrides);
      forcedContext = null;
    } else {
      const { matched, groups } = findMatches();
      if (matched.size === 0) {
        break;
      }

      spawnPlans = planSpecialSpawns(groups, preferred);
      preferred = null;

      const protectedCells = new Set(spawnPlans.keys());
      const baseClear = new Set([...matched].filter((key) => !protectedCells.has(key)));
      clearSet = expandClearSet(baseClear, protectedCells);
    }

    if (clearSet.size === 0) {
      break;
    }

    await animateClear(clearSet);
    removeMatches(clearSet);
    applySpawnPlans(spawnPlans);
    dropAndFill();
    renderBoard();
    await wait(DROP_DELAY_MS);
  }
}

async function trySwap(from, to) {
  isLocked = true;
  swapCells(from, to);
  renderBoard();

  const fromCandy = board[from.row][from.col];
  const toCandy = board[to.row][to.col];
  const swappedWithColorBomb = isColorBomb(fromCandy) || isColorBomb(toCandy);

  if (swappedWithColorBomb) {
    moves += 1;
    updateHud();
    const forcedContext = buildColorBombSwapContext(from, to);
    await resolveCascades(to, forcedContext);
    selected = null;
    isLocked = false;
    return;
  }

  const { matched } = findMatches();

  if (matched.size === 0) {
    await wait(120);
    swapCells(from, to);
    selected = null;
    renderBoard();

    const a = boardEl.querySelector(`[data-row="${from.row}"][data-col="${from.col}"]`);
    const b = boardEl.querySelector(`[data-row="${to.row}"][data-col="${to.col}"]`);

    if (a) {
      a.classList.add('invalid');
    }
    if (b) {
      b.classList.add('invalid');
    }

    await wait(220);
    isLocked = false;
    return;
  }

  moves += 1;
  updateHud();
  selected = null;
  await resolveCascades(to, null);
  isLocked = false;
}

async function onGemClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (!target.classList.contains('gem') || isLocked) {
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
  generateBoardWithoutMatches();
  updateHud();
  renderBoard();
}

boardEl.addEventListener('click', (event) => {
  onGemClick(event).catch(() => {
    isLocked = false;
  });
});

resetBtn.addEventListener('click', resetGame);

resetGame();
