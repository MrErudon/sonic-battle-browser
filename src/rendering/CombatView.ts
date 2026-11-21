import Phaser from "phaser";
import { projectArena } from "../core/arena";
import { attackPhase, facingVector, type CombatFighter } from "../core/combat";
/** Original procedural trails and impact spokes; never drives simulation. */
export class CombatView {
    private trails: Phaser.GameObjects.Graphics[];
    constructor(private scene: Phaser.Scene) {
        this.trails = [scene.add.graphics(), scene.add.graphics()];
    }
    sync(fighters: readonly CombatFighter[], delta: number): void {
        fighters.forEach((f, i) => {
            const color = i === 0 ? 0x55dced : 0xffbf69;
            const g = this.trails[i];
            g.clear();
            if (f.action.type !== "attack")
                return;
            const a = f.action, phase = attackPhase(a), d = facingVector(a.facing);
            const p = projectArena(f.x, f.y);
            g.setDepth(p.y + 0.02);
            const tip = projectArena(f.x + d.x * a.stats.reach, f.y + d.y * a.stats.reach);
            const z = f.z + a.stats.bottom + a.stats.height / 2;
            const active = phase === "active";
            g.lineStyle(active ? (a.kind === "heavy" ? 10 : 6) : 2, phase === "recovery" ? 0x9fb3c8 : color, active ? 1 : 0.5);
            g.lineBetween(p.x, p.y - z, tip.x, tip.y - z);
            if (active)
                g.strokeCircle(tip.x, tip.y - z, a.kind === "heavy" ? 14 : 8);
        });
    }
    destroy(): void { this.clear(); this.trails.forEach(g => g.destroy()); }
    clear(): void {
        this.trails.forEach(trail => trail.clear());
    }
}
