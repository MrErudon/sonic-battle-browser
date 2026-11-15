import Phaser from "phaser";
import { ARENA, projectArena } from "../core/arena";
import { NO_INPUT, STEP } from "../core/movement";
import { createCombatFighter, stepCombat, type AttackKind } from "../core/combat";
import { FighterView } from "../rendering/FighterView";
import { CombatView } from "../rendering/CombatView";

export class ArenaScene extends Phaser.Scene {
  private player = createCombatFighter("P1", -100, 0, "e");
  private opponent = createCombatFighter("P2", 100, 0, "w");
  private combatView!: CombatView;
  private views!: [FighterView, FighterView];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private accumulator = 0;
  private jumpQueued = false;
  private attackQueued?: AttackKind;
  private resetQueued = false;
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
    this.add.text(24, 24, "COMBAT FOUNDATION · M01.3", { color: "#e9f5ff", fontSize: "22px" }).setDepth(1000);
    this.add.text(24, 56, "WASD / Arrows: move   Space: jump   J: light   K: heavy   R: reset", { color: "#9fb3c8", fontSize: "16px" }).setDepth(1000);
    this.add.text(24, 574, "P1 CYAN: player    P2 AMBER: training target · Face the target to hit\nWhite: hitstun · Gray: recovery · Original training robots / provisional tuning", { color: "#9fb3c8", fontSize: "14px", lineSpacing: 8 }).setDepth(1000);
    this.player = createCombatFighter("P1", -100, 0, "e");
    this.opponent = createCombatFighter("P2", 100, 0, "w");
    this.accumulator = 0;
    this.jumpQueued = false;
    this.attackQueued = undefined;
    this.resetQueued = false;
    this.combatView = new CombatView(this);
    this.views = [new FighterView(this, 0x55dced, "P1"), new FighterView(this, 0xffbf69, "P2")];
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,J,K,R") as typeof this.keys;
    // DOM capture preserves taps even when both edges precede the next render.
    // Coalesce pending presses; consume once on the next simulation tick.
    const queueJump = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === "Space") this.jumpQueued = true;
      // First attack wins if several edges arrive before a simulation tick.
      if (event.code === "KeyJ") this.attackQueued ??= "light";
      if (event.code === "KeyK") this.attackQueued ??= "heavy";
      if (event.code === "KeyR") this.resetQueued = true;
    };
    const clearInput = () => {
      this.input.keyboard?.resetKeys();
      this.jumpQueued = false;
      this.attackQueued = undefined;
      this.resetQueued = false;
      this.accumulator = 0;
    };
    this.game.events.on(Phaser.Core.Events.BLUR, clearInput);
    window.addEventListener("keydown", queueJump);
    window.addEventListener("blur", clearInput);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("keydown", queueJump);
      window.removeEventListener("blur", clearInput);
      this.game.events.off(Phaser.Core.Events.BLUR, clearInput);
      clearInput();
      this.combatView.clear();
    });
  }

  update(time: number, delta: number): void {
    const k = this.keys;
    const x = Number(k.D.isDown || k.RIGHT.isDown) - Number(k.A.isDown || k.LEFT.isDown);
    const y = Number(k.S.isDown || k.DOWN.isDown) - Number(k.W.isDown || k.UP.isDown);
    // Bound catch-up after stalls; never simulate a tab's entire absence.
    this.accumulator += Math.min(delta / 1000, 0.1);
    while (this.accumulator + 1e-10 >= STEP) {
      if (this.resetQueued) {
        this.player = createCombatFighter("P1", -100, 0, "e");
        this.opponent = createCombatFighter("P2", 100, 0, "w");
        this.combatView.clear();
        this.jumpQueued = false;
        this.attackQueued = undefined;
        this.resetQueued = false;
      }
      this.combatView.hit(stepCombat([this.player, this.opponent], [{ x, y, jump: this.jumpQueued, attack: this.attackQueued }, NO_INPUT]));
      this.jumpQueued = false;
      this.attackQueued = undefined;
      this.accumulator -= STEP;
    }
    this.views[0].sync(this.player, time);
    this.views[1].sync(this.opponent, time);
    this.combatView.sync([this.player, this.opponent], delta);
  }
}
