import type { AcceptedAttack, CombatFighter, HitEvent } from '../core/combat';
/** Passive sink: receives scalar DTOs, never inputs used by the controller. */
export class CombatTelemetry {
    constructor(readonly ownerId?: string) { }
    private guards = new Map<string, {
        value: number;
        broken: number;
    }>();
    guardConsumed = 0;
    guardRegenerated = 0;
    guardRefilled = 0;
    receivedBlocks = 0;
    receivedBreaks = 0;
    damageTaken: Record<string, number> = {};
    ticks = 0;
    attempts: Record<string, number> = {};
    hits: Record<string, number> = {};
    blocks = 0;
    breaks = 0;
    damage: Record<string, number> = {};
    occupancy: Record<string, number> = {};
    decisions: Record<string, number> = {};
    interrupted = 0;
    completedWhiffs = 0;
    private pending = new Map<string, {
        kind: string;
        owner: string;
        contact: boolean;
    }>();
    accepted = (e: AcceptedAttack): void => {
        if (this.ownerId && e.ownerId !== this.ownerId)
            return;
        this.attempts[e.kind] = (this.attempts[e.kind] ?? 0) + 1;
        this.pending.set(e.instanceId, { kind: e.kind, owner: e.ownerId, contact: false });
    };
    observe(fighters: readonly CombatFighter[], events: readonly HitEvent[], reason = 'legacy', projectiles: readonly {
        id: string;
    }[] = []): void {
        this.ticks++;
        this.decisions[reason] = (this.decisions[reason] ?? 0) + 1;
        for (const f of fighters) {
            if (!this.ownerId || f.id === this.ownerId) {
                const old = this.guards.get(f.id);
                if (old) {
                    const delta = f.guard.value - old.value;
                    if (delta < 0)
                        this.guardConsumed -= delta;
                    else if (old.broken > 0 && f.guard.breakRemaining === 0)
                        this.guardRefilled += delta;
                    else
                        this.guardRegenerated += delta;
                }
                this.guards.set(f.id, { value: f.guard.value, broken: f.guard.breakRemaining });
            }
            const key = f.id + ':' + f.action.type;
            this.occupancy[key] = (this.occupancy[key] ?? 0) + 1;
        }
        for (const e of events) {
            if (!this.ownerId || e.defenderId === this.ownerId) {
                const key = e.attackKind ?? e.specialId ?? e.comboStage ?? 'normal';
                this.damageTaken[key] = (this.damageTaken[key] ?? 0) + e.damage;
                if (e.outcome === 'block' || e.outcome === 'guard_break')
                    this.receivedBlocks++;
                if (e.outcome === 'guard_break')
                    this.receivedBreaks++;
            }
            if (this.ownerId && e.attackerId !== this.ownerId)
                continue;
            const kind = (e.instanceId ? this.pending.get(e.instanceId)?.kind : undefined) ?? e.specialId ?? e.comboStage ?? 'normal';
            const key = kind + (e.outcome === 'block' || e.outcome === 'guard_break' ? ':chip' : ':full');
            this.damage[key] = (this.damage[key] ?? 0) + e.damage;
            this.hits[kind] = (this.hits[kind] ?? 0) + 1;
            if (e.outcome === 'block' || e.outcome === 'guard_break')
                this.blocks++;
            if (e.outcome === 'guard_break')
                this.breaks++;
            const pending = e.instanceId ? this.pending.get(e.instanceId) : undefined;
            if (pending)
                pending.contact = true;
        }
        for (const [id, p] of this.pending) {
            const owner = fighters.find(f => f.id === p.owner), a = owner?.action;
            if (a && (a.type === 'attack' || a.type === 'special') && a.instanceId === id)
                continue;
            // Projectiles may connect after caster recovery; their final outcomes are tracked separately by events.
            if (p.kind === 'projectile' && projectiles.some(orb => orb.id === id))
                continue;
            if (!p.contact) {
                if (a?.type === 'hitstun' || a?.type === 'ko')
                    this.interrupted++;
                else
                    this.completedWhiffs++;
            }
            this.pending.delete(id);
        }
    }
    summary() {
        return { guardConsumed: this.guardConsumed, guardRegenerated: this.guardRegenerated, guardRefilled: this.guardRefilled, receivedBlocks: this.receivedBlocks, receivedBreaks: this.receivedBreaks, damageTaken: { ...this.damageTaken }, ticks: this.ticks, attempts: { ...this.attempts }, hits: { ...this.hits }, damage: { ...this.damage }, blocks: this.blocks, breaks: this.breaks,
            interrupted: this.interrupted, completedWhiffs: this.completedWhiffs, occupancy: { ...this.occupancy }, decisions: { ...this.decisions } };
    }
}
