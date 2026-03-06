'use strict';

const BOARD_SIZE = 8;
const GEM_TYPES = [0, 1, 2, 3, 4, 5];
const CLEAR_DELAY_MS = 260;
const DROP_DELAY_MS = 170;
const WRAPPED_PULSE_DELAY_MS = 120;
const SCORE_PER_GEM = 10;
const BIG_CLEAR_SHAKE_THRESHOLD = 8;

const boardEl = document.getElementById('board');
const fxEl = document.getElementById('fx');
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
    orientation, // 'row' | 'col'
  };
}

function createWrappedCandy(color) {
  return {
    kind: 'wrapped',
    color,
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

function clearFxLayer() {
  if (!fxEl) return;
  fxEl.innerHTML = '';
}

function addBeamFx(kind, row, col) {
  if (!fxEl) return;
  const cell = boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  if (!cell) return;

  const boardRect = boardEl.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();

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
  if (!fxEl) return;
  const cell = boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  if (!cell) return;

  const boardRect = boardEl.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();

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
  if (!fxEl) return;
  const cell = boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  if (!cell) return;

  const boardRect = boardEl.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();

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
}

async function animateClear(matches, fxOverrides = null) {
  if (matches.size >= BIG_CLEAR_SHAKE_THRESHOLD) {
    boardEl.classList.add('board-shake');
  }

  spawnFxForClearSet(matches, fxOverrides);

  matches.forEach((key) => {
    const { row, col } = parseKey(key);
    const el = boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
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
    if (!board[row][col]) return;
    board[row][col] = null;
    removedCount += 1;
  });

  score += removedCount * SCORE_PER_GEM;
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
    return { clearSet, fx, colorBombOverrides };
  }

  if (hasColorBomb && otherCandy) {
    const bombKey = keyOf(colorBombCell.row, colorBombCell.col);
    clearSet.add(bombKey);
    fx.pulses.push({ row: colorBombCell.row, col: colorBombCell.col });
    // When a color bomb is involved, it should clear the OTHER candy's color.
    colorBombOverrides.set(bombKey, otherCandy.color);

    if (otherCandy.kind === 'striped') {
      const cells = collectCellsByColor(otherCandy.color, colorBombCell);
      cells.forEach((cell, index) => {
        const current = board[cell.row][cell.col];
        if (!current || current.kind === 'colorBomb') return;
        const orientation = index % 2 === 0 ? 'row' : 'col';
        board[cell.row][cell.col] = createStripedCandy(otherCandy.color, orientation);
        clearSet.add(keyOf(cell.row, cell.col));
      });
      return { clearSet, fx, colorBombOverrides };
    }

    if (otherCandy.kind === 'wrapped') {
      const cells = collectCellsByColor(otherCandy.color, colorBombCell);
      cells.forEach((cell) => {
        const current = board[cell.row][cell.col];
        if (!current || current.kind === 'colorBomb') return;
        board[cell.row][cell.col] = createWrappedCandy(otherCandy.color);
        clearSet.add(keyOf(cell.row, cell.col));
      });
      // Simplification: converted wrapped candies trigger one wrapped explosion each.
      // Skipping their built-in second pulse keeps this combo readable/perf-safe on 8x8.
      return { clearSet, fx, colorBombOverrides, suppressWrappedSecondPulse: true };
    }

    const colorCells = collectColorCells(otherCandy.color);
    colorCells.forEach((cell) => {
      clearSet.add(keyOf(cell.row, cell.col));
    });
    return { clearSet, fx, colorBombOverrides };
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
    }

    const clearSet = clearContext.clearSet;
    const wrappedCenters = clearContext.wrappedCenters;

    if (clearSet.size === 0) {
      break;
    }

    // Pulse 1
    await animateClear(clearSet, clearContext.fx);
    removeMatches(clearSet);

    // Pulse 2 for wrapped candies (before gravity), Candy-Crush-ish.
    const secondInitial = new Set(clearContext.secondPulseInitial || []);
    if (!clearContext.suppressWrappedSecondPulse) {
      wrappedCenters.forEach((centerKey) => {
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
      const secondSet = secondContext.clearSet;
      if (secondSet.size > 0) {
        await animateClear(secondSet, clearContext.secondPulseFx || null);
        removeMatches(secondSet);
      }
    }

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

  const comboContext = buildComboClearContext(from, to);
  if (comboContext) {
    moves += 1;
    updateHud();
    await resolveCascades(to, comboContext);
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
  clearFxLayer();
}

boardEl.addEventListener('click', (event) => {
  onGemClick(event).catch(() => {
    isLocked = false;
  });
});

resetBtn.addEventListener('click', resetGame);

resetGame();
