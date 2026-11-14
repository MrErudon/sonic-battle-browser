import Phaser from "phaser";
import { ARENA, projectArena } from "../core/arena";

export class ArenaScene extends Phaser.Scene {
  constructor() { super("Arena"); }

  create(): void {
    const g = this.add.graphics();
    const w = ARENA.width / 2;
    const h = ARENA.depth / 2;
    const corners = [projectArena(-w, -h), projectArena(w, -h), projectArena(w, h), projectArena(-w, h)];
    g.fillStyle(0x293a4c, 1);
    g.lineStyle(4, 0x8ecae6, 1);
    g.fillPoints(corners.map(p => new Phaser.Geom.Point(p.x, p.y)), true);
    g.strokePoints(corners.map(p => new Phaser.Geom.Point(p.x, p.y)), true);
    g.lineStyle(1, 0x42586d, 0.7);
    for (let x = -w + 50; x < w; x += 50) {
      const a = projectArena(x, -h), b = projectArena(x, h);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let y = -h + 50; y < h; y += 50) {
      const a = projectArena(-w, y), b = projectArena(w, y);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    this.add.text(24, 24, "ARENA FOUNDATION · M01", { color: "#e9f5ff", fontSize: "22px" });
    this.add.text(24, 56, "Isometric arena rendering online. Fighters next.", { color: "#9fb3c8", fontSize: "16px" });
  }
}
