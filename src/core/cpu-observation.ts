import { attackOverlaps, facingVector, type CombatFighter } from './combat';
import type { CombatState, Projectile } from './projectiles';
export interface Threat {
    id: string;
    age: number;
    projectile?: Projectile;
}
/** Observes only current visible actions/entities. No input or enemy RNG access. */
export class CpuObservation {
    tick = 0;
    private seen = new Map<string, number>();
    private recoveryId = '';
    private recoverySince = 0;
    observe(self: CombatFighter, target: CombatFighter, world: Readonly<CombatState>) {
        this.tick++;
        const live = new Set<string>();
        const a = target.action;
        const id = a.type === 'attack' || a.type === 'special' ? a.instanceId ?? target.id + ':legacy' : undefined;
        if (id) {
            live.add(id);
            if (!this.seen.has(id))
                this.seen.set(id, this.tick);
        }
        for (const p of world.projectiles) {
            live.add(p.id);
            if (!this.seen.has(p.id))
                this.seen.set(p.id, this.tick);
        }
        for (const key of this.seen.keys())
            if (!live.has(key))
                this.seen.delete(key);
        const recovery = a.type === 'attack' ? a.frame > a.stats.startup + a.stats.active : a.type === 'special' ? a.frame > a.definition.startup + a.definition.active : false;
        if (recovery && id !== this.recoveryId) {
            this.recoveryId = id!;
            this.recoverySince = this.tick;
        }
        if (!recovery)
            this.recoveryId = '';
        const threats: Threat[] = [];
        for (const p of world.projectiles) {
            if (p.ownerId === self.id)
                continue;
            const dx = self.x - p.x, dy = self.y - p.y, d = p.direction, forward = dx * d.x + dy * d.y;
            const side = Math.abs(-dx * d.y + dy * d.x), radius = self.stats.hurtRadius + p.definition.projectileRadius;
            if (forward >= 0 && forward <= Math.min(p.remainingDistance, p.definition.projectileSpeed * .5) + radius && side <= radius && self.z <= p.z + p.definition.projectileRadius && self.z + self.stats.hurtHeight >= p.z - p.definition.projectileRadius)
                threats.push({ id: p.id, age: this.tick - this.seen.get(p.id)!, projectile: p });
        }
        if (a.type === 'attack' && a.frame <= a.stats.startup + a.stats.active && attackOverlaps(target, self, a))
            threats.push({ id: id!, age: this.tick - this.seen.get(id!)! });
        if (a.type === 'special' && a.id !== 'projectile' && a.frame <= a.definition.startup + a.definition.active) {
            const d = facingVector(a.facing), dx = self.x - target.x, dy = self.y - target.y, s = a.definition;
            if (dx * d.x + dy * d.y >= 0 && dx * d.x + dy * d.y <= s.reach + s.travel + self.stats.hurtRadius && Math.abs(-dx * d.y + dy * d.x) <= s.width / 2 + self.stats.hurtRadius && self.z <= s.bottom + s.height)
                threats.push({ id: id!, age: this.tick - this.seen.get(id!)! });
        }
        threats.sort((x, y) => (x.projectile ? Math.hypot(x.projectile.x - self.x, x.projectile.y - self.y) / x.projectile.definition.projectileSpeed : 0) -
            (y.projectile ? Math.hypot(y.projectile.x - self.x, y.projectile.y - self.y) / y.projectile.definition.projectileSpeed : 0) || x.id.localeCompare(y.id, 'en'));
        return { threats, actionId: id, actionAge: id ? this.tick - this.seen.get(id)! : 0, recoveryAge: recovery ? this.tick - this.recoverySince : 0,
            remainingRecovery: recovery ? (a.type === 'attack' ? a.stats.startup + a.stats.active + a.stats.recovery - a.frame + 1 : a.type === 'special' ? a.definition.startup + a.definition.active + a.definition.recovery - a.frame + 1 : 0) : 0 };
    }
}
