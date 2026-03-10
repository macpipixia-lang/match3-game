// Game configuration (non-module) so it can be loaded before main.js without a bundler.
// This is step 1 of engineering refactor: move all tunables out of main.js.

window.MATCH3_CONFIG = {
  // Board
  boardSize: 8,
  gemTypes: [0, 1, 2, 3, 4, 5],

  // Timing
  timing: {
    clearDelayMs: 260,
    dropDelayMs: 170,
    wrappedPulseDelayMs: 120,
    targetHighlightDelayMs: 120,
    comboWaveDelayMs: 90,
  },

  // Scoring / thresholds
  scoring: {
    scorePerGem: 10,
  },
  thresholds: {
    bigClearShake: 8,
    targetHighlight: 8,
  },

  // Persistence keys
  storageKeys: {
    audioEnabled: "match3.audioEnabled",
    debugEnabled: "match3.debugEnabled",
    levelIndex: "match3.levelIndex",
    bestScore: "match3.bestScore",
  },

  // Audio
  sfxSources: {
    clear: "assets/sfx/clear.mp3",
    swap: "assets/sfx/swap.mp3",
    invalid: "assets/sfx/invalid.mp3",
    combo: "assets/sfx/combo.mp3",
  },

  // Levels
  levels: [
    // Level 1: score-only (backward-compatible)
    { targetScore: 900, moveLimit: 16 },

    // Level 2: collect + clear ice
    {
      targetScore: 0,
      moveLimit: 18,
      goals: {
        collect: { "0": 10 },
        clearIce: 6,
      },
      blockers: [
        { kind: "ice", row: 2, col: 2, hp: 1 },
        { kind: "ice", row: 2, col: 5, hp: 1 },
        { kind: "ice", row: 3, col: 3, hp: 1 },
        { kind: "ice", row: 3, col: 4, hp: 1 },
        { kind: "ice", row: 4, col: 2, hp: 1 },
        { kind: "ice", row: 4, col: 5, hp: 1 },
      ],
    },

    // Level 3: clear locks + stone blockers
    {
      targetScore: 1200,
      moveLimit: 20,
      goals: {
        score: 1200,
        clearLocks: 4,
      },
      blockers: [
        { kind: "lock", row: 2, col: 1 },
        { kind: "lock", row: 2, col: 6 },
        { kind: "lock", row: 5, col: 1 },
        { kind: "lock", row: 5, col: 6 },
        { kind: "stone", row: 3, col: 0 },
        { kind: "stone", row: 3, col: 7 },
      ],
    },
  ],
};
