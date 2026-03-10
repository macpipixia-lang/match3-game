import { wireGame } from "./wire.js";

export function createGame() {
  return wireGame({
    document,
    window,
    storage: window.localStorage,
  });
}
