import Phaser from "phaser";
import { ARENA, projectArena } from "../core/arena";
import { COMBAT_KEYS, MatchController } from "../core/match";
import { FighterView } from "../rendering/FighterView";
import { CombatView } from "../rendering/CombatView";
import { MatchView } from "../rendering/MatchView";

export class ArenaScene extends Phaser.Scene {
  readonly match = new MatchController();
  private combatView!: CombatView;
  private views!: [FighterView, FighterView];
  private ui!: MatchView;
  private resetVersion = -1;
  private visualTime = 0;
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
    this.match.menu();
    this.match.setFocused(!document.hidden);
    this.combatView = new CombatView(this);
    this.views = [new FighterView(this, 0x55dced, "YOU"), new FighterView(this, 0xffbf69, "CPU")];
    this.ui = new MatchView(this.match);
    const keydown = (event: KeyboardEvent) => {
      if (event.code === "Escape" && !event.repeat && !this.match.helpOpen) {
        this.ui.openHelp(); return;
      }
      // Let native buttons and the help dialog retain Space/Enter activation.
      const interactive = event.target instanceof HTMLElement && !!event.target.closest("button, input, select, textarea, dialog");
      if (interactive && (this.match.helpOpen || event.code === "Space" || event.code === "Enter")) return;
      if (COMBAT_KEYS.has(event.code)) event.preventDefault();
      this.match.press(event.code, event.repeat);
    };
    const keyup = (event: KeyboardEvent) => this.match.release(event.code);
    const blur = () => this.match.setFocused(false);
    const focus = () => this.match.setFocused(!document.hidden);
    const visibility = () => this.match.setFocused(!document.hidden && document.hasFocus());
    this.game.events.on(Phaser.Core.Events.BLUR, blur);
    this.game.events.on(Phaser.Core.Events.FOCUS, focus);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
      this.game.events.off(Phaser.Core.Events.BLUR, blur);
      this.game.events.off(Phaser.Core.Events.FOCUS, focus);
      this.match.setFocused(false);
      this.combatView.clear(); this.ui.destroy();
    });
  }

  update(_time: number, delta: number): void {
    const hits = this.match.advance(delta);
    if (this.resetVersion !== this.match.resetVersion) {
      this.combatView.clear(); this.resetVersion = this.match.resetVersion; this.visualTime = 0;
    }
    if (this.match.acceptsInput) this.visualTime += Math.min(delta, 100);
    this.combatView.hit(hits);
    this.views[0].sync(this.match.fighters[0], this.visualTime, this.ui.debug);
    this.views[1].sync(this.match.fighters[1], this.visualTime, this.ui.debug);
    this.combatView.sync(this.match.fighters, this.match.paused ? 0 : delta);
    this.ui.sync();
  }
}
