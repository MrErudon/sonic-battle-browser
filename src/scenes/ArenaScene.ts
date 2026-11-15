import Phaser from "phaser";
import { ARENA, projectArena } from "../core/arena";
import { createFighter, NO_INPUT, STEP, stepFighter } from "../core/movement";
import { FighterView } from "../rendering/FighterView";

export class ArenaScene extends Phaser.Scene {
  private player = createFighter(-100, 0, "e");
  private opponent = createFighter(100, 0, "w");
  private views!: [FighterView, FighterView];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private accumulator = 0;
  private jumpQueued = false;
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
    this.add.text(24, 24, "FIGHTER MOVEMENT · M01.2", { color: "#e9f5ff", fontSize: "22px" }).setDepth(1000);
    this.add.text(24, 56, "WASD / Arrow keys: move   ·   Space: jump", { color: "#9fb3c8", fontSize: "16px" }).setDepth(1000);
    this.add.text(24, 574, "P1  CYAN: keyboard controlled     P2  AMBER: stationary\nOriginal training robots · Movement prototype · Combat follows in M01.3", { color: "#9fb3c8", fontSize: "14px", lineSpacing: 8 }).setDepth(1000);
    this.player = createFighter(-100, 0, "e");
    this.opponent = createFighter(100, 0, "w");
    this.accumulator = 0;
    this.jumpQueued = false;
    this.views = [new FighterView(this, 0x55dced, "P1"), new FighterView(this, 0xffbf69, "P2")];
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE") as typeof this.keys;
    const clearInput = () => {
      this.input.keyboard?.resetKeys();
      this.jumpQueued = false;
      this.accumulator = 0;
    };
    this.game.events.on(Phaser.Core.Events.BLUR, clearInput);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(Phaser.Core.Events.BLUR, clearInput));
  }

  update(time: number, delta: number): void {
    const k = this.keys;
    this.jumpQueued ||= Phaser.Input.Keyboard.JustDown(k.SPACE);
    const x = Number(k.D.isDown || k.RIGHT.isDown) - Number(k.A.isDown || k.LEFT.isDown);
    const y = Number(k.S.isDown || k.DOWN.isDown) - Number(k.W.isDown || k.UP.isDown);
    // Bound catch-up after stalls; never simulate a tab's entire absence.
    this.accumulator += Math.min(delta / 1000, 0.1);
    while (this.accumulator + 1e-10 >= STEP) {
      stepFighter(this.player, { x, y, jump: this.jumpQueued });
      stepFighter(this.opponent, NO_INPUT);
      this.jumpQueued = false;
      this.accumulator -= STEP;
    }
    this.views[0].sync(this.player, time);
    this.views[1].sync(this.opponent, time);
  }
}
