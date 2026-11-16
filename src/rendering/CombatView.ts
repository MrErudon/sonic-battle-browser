import Phaser from "phaser";
import { projectArena } from "../core/arena";
import { attackPhase, facingVector, type CombatFighter, type HitEvent } from "../core/combat";

/** Original procedural trails, impact spokes and HUD; never drives simulation. */
export class CombatView {
  private hud: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[];
  private trails: Phaser.GameObjects.Graphics[];
  private sparks: { hit: HitEvent; age: number; graphic: Phaser.GameObjects.Graphics }[] = [];
  constructor(private scene: Phaser.Scene) {
    this.hud = scene.add.graphics().setDepth(1000);
    this.labels = [24, 616].map(x => scene.add.text(x, 88, "", { fontSize: "14px", color: "#e9f5ff" }).setDepth(1001));
    this.trails = [scene.add.graphics(), scene.add.graphics()];
  }
  hit(events: HitEvent[]): void {
    for (const hit of events) this.sparks.push({ hit, age: 0, graphic: this.scene.add.graphics() });
  }
  sync(fighters: readonly CombatFighter[], delta: number): void {
    this.hud.clear();
    fighters.forEach((f, i) => {
      const x = i === 0 ? 24 : 616, color = i === 0 ? 0x55dced : 0xffbf69;
      this.hud.fillStyle(0x10151e).fillRect(x, 110, 320, 16);
      this.hud.fillStyle(color).fillRect(x, 110, 320 * f.health / f.stats.maxHealth, 16);
      this.labels[i].setText(`${f.id}   ${f.health} / ${f.stats.maxHealth} HP${f.health === 0 ? "   KO" : ""}`);
      const g = this.trails[i]; g.clear();
      if (f.action.type !== "attack") return;
      const a = f.action, phase = attackPhase(a), d = facingVector(a.facing);
      const p = projectArena(f.x, f.y);
      g.setDepth(p.y + 0.02);
      const tip = projectArena(f.x + d.x * a.stats.reach, f.y + d.y * a.stats.reach);
      const z = f.z + a.stats.bottom + a.stats.height / 2;
      const active = phase === "active";
      g.lineStyle(active ? (a.kind === "heavy" ? 10 : 6) : 2, phase === "recovery" ? 0x9fb3c8 : color, active ? 1 : 0.5);
      g.lineBetween(p.x, p.y - z, tip.x, tip.y - z);
      if (active) g.strokeCircle(tip.x, tip.y - z, a.kind === "heavy" ? 14 : 8);
    });
    this.sparks = this.sparks.filter(s => {
      s.age += Math.min(delta, 100);
      if (s.age >= 180) { s.graphic.destroy(); return false; }
      const p = projectArena(s.hit.x, s.hit.y), radius = 5 + s.age / 9;
      const g = s.graphic; g.clear().setDepth(p.y + 0.1).lineStyle(3, 0xffffff, 1 - s.age / 180);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        g.lineBetween(p.x + Math.cos(a) * radius * 0.4, p.y - s.hit.z + Math.sin(a) * radius * 0.4,
          p.x + Math.cos(a) * radius, p.y - s.hit.z + Math.sin(a) * radius);
      }
      return true;
    });
  }
  clear(): void {
    this.sparks.forEach(s => s.graphic.destroy());
    this.sparks = [];
  }
}
