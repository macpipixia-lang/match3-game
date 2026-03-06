'use strict';

const BOARD_SIZE = 8;
// Candy types (also mapped to CSS classes gem--0..gem--5)
const GEM_TYPES = [0, 1, 2, 3, 4, 5];
const CLEAR_DELAY_MS = 220;
const DROP_DELAY_MS = 180;
const SCORE_PER_GEM = 10;

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
      let gem;
      do {
        gem = randGem();
      } while (
        (col >= 2 && board[row][col - 1] === gem && board[row][col - 2] === gem) ||
        (row >= 2 && board[row - 1][col] === gem && board[row - 2][col] === gem)
      );
      board[row][col] = gem;
    }
  }
}

function updateHud() {
  scoreEl.textContent = String(score);
  movesEl.textContent = String(moves);
}

function gemClasses(row, col) {
  const classes = ['gem'];
  if (selected && selected.row === row && selected.col === col) {
    classes.push('selected');
  }
  return classes.join(' ');
}

function renderBoard() {
  let html = '';
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const gem = board[row][col];
      html += `<button class="${gemClasses(row, col)} gem--${gem}" data-row="${row}" data-col="${col}" aria-label="Candy at row ${row + 1}, col ${col + 1}"></button>`;
    }
  }
  boardEl.innerHTML = html;
}

function findMatches() {
  const matched = new Set();

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    let streak = 1;
    for (let col = 1; col <= BOARD_SIZE; col += 1) {
      const same = col < BOARD_SIZE && board[row][col] === board[row][col - 1];
      if (same) {
        streak += 1;
      } else {
        if (streak >= 3) {
          for (let i = col - streak; i < col; i += 1) {
            matched.add(`${row},${i}`);
          }
        }
        streak = 1;
      }
    }
  }

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    let streak = 1;
    for (let row = 1; row <= BOARD_SIZE; row += 1) {
      const same = row < BOARD_SIZE && board[row][col] === board[row - 1][col];
      if (same) {
        streak += 1;
      } else {
        if (streak >= 3) {
          for (let i = row - streak; i < row; i += 1) {
            matched.add(`${i},${col}`);
          }
        }
        streak = 1;
      }
    }
  }

  return matched;
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function animateClear(matches) {
  matches.forEach((key) => {
    const [row, col] = key.split(',');
    const el = boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (el) {
      el.classList.add('clearing');
    }
  });
  await wait(CLEAR_DELAY_MS);
}

function removeMatches(matches) {
  matches.forEach((key) => {
    const [row, col] = key.split(',').map(Number);
    board[row][col] = null;
  });
  score += matches.size * SCORE_PER_GEM;
  updateHud();
}

function dropAndFill() {
  for (let col = 0; col < BOARD_SIZE; col += 1) {
    const compacted = [];
    for (let row = BOARD_SIZE - 1; row >= 0; row -= 1) {
      const gem = board[row][col];
      if (gem !== null) {
        compacted.push(gem);
      }
    }

    while (compacted.length < BOARD_SIZE) {
      compacted.push(randGem());
    }

    for (let row = BOARD_SIZE - 1, i = 0; row >= 0; row -= 1, i += 1) {
      board[row][col] = compacted[i];
    }
  }
}

async function resolveCascades() {
  while (true) {
    const matches = findMatches();
    if (matches.size === 0) {
      break;
    }
    await animateClear(matches);
    removeMatches(matches);
    dropAndFill();
    renderBoard();
    await wait(DROP_DELAY_MS);
  }
}

async function trySwap(from, to) {
  isLocked = true;
  swapCells(from, to);
  renderBoard();

  const matches = findMatches();
  if (matches.size === 0) {
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
  await resolveCascades();
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
