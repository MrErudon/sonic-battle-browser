import Phaser from "phaser";
import { projectArena } from "../core/arena";
import { attackPhase, facingVector, type CombatFighter, type HitEvent } from "../core/combat";
/** Original procedural trails and impact spokes; never drives simulation. */
export class CombatView {
  private trails: Phaser.GameObjects.Graphics[];
  private sparks: { hit: HitEvent; age: number; graphic: Phaser.GameObjects.Graphics }[] = [];
  constructor(private scene: Phaser.Scene) {
    this.trails = [scene.add.graphics(), scene.add.graphics()];
  }
  hit(events: HitEvent[]): void {
    for (const hit of events) this.sparks.push({ hit, age: 0, graphic: this.scene.add.graphics() });
  }
  sync(fighters: readonly CombatFighter[], delta: number): void {
    fighters.forEach((f, i) => {
      const color = i === 0 ? 0x55dced : 0xffbf69;
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
      const blocked = s.hit.outcome === "block", broken = s.hit.outcome === "guard_break";
      const finisher = (s.hit.comboStage === "finisher" || s.hit.specialId === "power") && !blocked;
      const p = projectArena(s.hit.x, s.hit.y), radius = (finisher ? 10 : 5) + s.age / (finisher ? 6 : 9);
      const g = s.graphic; g.clear().setDepth(p.y + 0.1).lineStyle(finisher ? 5 : 3, broken ? 0xff657a : blocked ? 0x9aafff : finisher ? 0xffbf69 : s.hit.specialId === "projectile" ? 0xb6a2ff : s.hit.specialId === "dash" || s.hit.comboStage === "light_3" ? 0x55dced : 0xffffff, 1 - s.age / 180);
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
    this.trails.forEach(trail => trail.clear());
  }
}
