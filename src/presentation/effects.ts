import type { PresentationEvent } from './snapshot';
export const EFFECTS = {
    'impact.light': { ticks: 6, radius: 14, color: 0xffffff }, 'impact.heavy': { ticks: 9, radius: 22, color: 0xffbf69 }, 'impact.finisher': { ticks: 12, radius: 30, color: 0xffbf69 },
    'guard.block': { ticks: 6, radius: 16, color: 0x9aafff }, 'guard.break': { ticks: 18, radius: 32, color: 0xff657a },
    'special.power.arc': { ticks: 4, radius: 28, color: 0x55dced }, 'special.dash.trail': { ticks: 6, radius: 16, color: 0x55dced },
    'special.projectile.charge': { ticks: 18, radius: 14, color: 0xb6a2ff }, 'special.projectile.emit': { ticks: 4, radius: 14, color: 0xb6a2ff },
    'special.projectile.body': { ticks: 1, radius: 8, color: 0xb6a2ff }, 'fighter.hit_flash': { ticks: 2, radius: 12, color: 0xffffff }, 'fighter.ko': { ticks: 24, radius: 30, color: 0xff657a },
} as const;
export type EffectId = keyof typeof EFFECTS;
export function contactEffect(hit: {
    outcome?: string;
    comboStage?: string;
    attackKind?: string;
    specialId?: string;
}): EffectId {
    if (hit.outcome === 'guard_break')
        return 'guard.break';
    if (hit.outcome === 'block')
        return 'guard.block';
    if (hit.comboStage === 'finisher' || hit.specialId === 'power')
        return 'impact.finisher';
    return hit.attackKind?.includes('heavy') ? 'impact.heavy' : 'impact.light';
}
export function eventEffect(e: PresentationEvent): EffectId | undefined { if (e.type === 'ko')
    return 'fighter.ko'; if (e.type === 'contact')
    return contactEffect(e.hit); if (e.type === 'projectile')
    return 'special.projectile.emit'; return; }
export interface EffectInstance {
    id: EffectId;
    key: string;
    born: number;
    x: number;
    y: number;
    z: number;
}
/** Oldest-first eviction, bounded deduplication and deterministic age expiry. */
export class EffectPool {
    readonly active: EffectInstance[] = [];
    private seen = new Map<string, number>();
    constructor(readonly capacity = 32) { if (!Number.isInteger(capacity) || capacity < 1 || capacity > 128)
        throw Error('Invalid effect capacity'); }
    add(effect: EffectInstance, clock: number): boolean { this.advance(clock); if (this.seen.has(effect.key))
        return false; this.seen.set(effect.key, clock); if (clock - effect.born >= EFFECTS[effect.id].ticks)
        return false; if (this.active.length === this.capacity)
        this.active.shift(); this.active.push({ ...effect }); return true; }
    advance(clock: number): void { for (let i = this.active.length - 1; i >= 0; i--)
        if (clock - this.active[i].born >= EFFECTS[this.active[i].id].ticks)
            this.active.splice(i, 1); for (const [key, born] of this.seen)
        if (clock - born > 120)
            this.seen.delete(key); while (this.seen.size > 256)
        this.seen.delete(this.seen.keys().next().value!); }
    clear(): void { this.active.length = 0; this.seen.clear(); }
}
