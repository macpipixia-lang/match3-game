// Game configuration (non-module) so it can be loaded before main.js without a bundler.
// This is step 1 of engineering refactor: move all tunables out of main.js.

window.MATCH3_CONFIG = {
  boardSize: 8,
  gemTypes: [0, 1, 2, 3, 4, 5],
  levels: [
    { targetScore: 900, moveLimit: 16 },
    { targetScore: 1300, moveLimit: 18 },
    { targetScore: 1750, moveLimit: 20 },
  ],
};
