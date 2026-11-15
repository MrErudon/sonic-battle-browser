import Phaser from "phaser";
import { ArenaScene } from "./scenes/ArenaScene";

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 960,
  height: 640,
  backgroundColor: "#10151e",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [ArenaScene],
});
