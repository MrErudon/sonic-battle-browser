import Phaser from 'phaser';
import { projectArena } from '../core/arena';
import { EFFECTS, EffectPool, eventEffect, type EffectId, type EffectInstance } from '../presentation/effects';
import type { QueuedEvent } from '../presentation/capture';
/** Replaceable procedural effect adapter; preallocated graphics never grow with hit count. */
export class EffectRegistry {
    private renderers = new Map<EffectId, (graphic: Phaser.GameObjects.Graphics, effect: EffectInstance, age: number) => void>();
    register(id: EffectId, render: (graphic: Phaser.GameObjects.Graphics, effect: EffectInstance, age: number) => void): void { if (!(id in EFFECTS))
        throw Error('Unknown effect ID'); this.renderers.set(id, render); }
    readonly pool = new EffectPool();
    private graphics: Phaser.GameObjects.Graphics[];
    constructor(scene: Phaser.Scene) { this.graphics = Array.from({ length: this.pool.capacity }, () => scene.add.graphics()); }
    consume(events: readonly QueuedEvent[], clock: number): void {
        for (const q of events) {
            const e = q.event, id = eventEffect(e);
            if (!id)
                continue;
            const p = e.type === 'contact' ? e.hit : e.type === 'projectile' ? e.projectile : e.type === 'ko' ? e : undefined;
            if (!p)
                continue;
            this.pool.add({ id, key: `${q.epoch}:${q.sequence}`, born: q.clock, x: p.x, y: p.y, z: p.z }, clock);
        }
    }
    sync(clock: number): void {
        this.pool.advance(clock);
        this.graphics.forEach((g, i) => {
            g.clear();
            const effect = this.pool.active[i];
            if (!effect)
                return;
            const custom = this.renderers.get(effect.id);
            if (custom) {
                custom(g, effect, clock - effect.born);
                return;
            }
            const spec = EFFECTS[effect.id], age = clock - effect.born, p = projectArena(effect.x, effect.y), fraction = Math.max(0, age / spec.ticks), radius = 4 + spec.radius * fraction;
            g.setDepth(p.y + .1).lineStyle(effect.id === 'impact.finisher' ? 4 : 2, spec.color, 1 - fraction);
            for (let n = 0; n < 8; n++) {
                const angle = n * Math.PI / 4;
                g.lineBetween(p.x + Math.cos(angle) * radius * .4, p.y - effect.z + Math.sin(angle) * radius * .4, p.x + Math.cos(angle) * radius, p.y - effect.z + Math.sin(angle) * radius);
            }
        });
    }
    clear(): void { this.pool.clear(); this.graphics.forEach(g => g.clear()); }
    destroy(): void { this.clear(); this.graphics.forEach(g => g.destroy()); this.graphics = []; this.renderers.clear(); }
}
