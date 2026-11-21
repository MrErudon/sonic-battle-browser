import { CpuController, pursuitInput, seededRandom, type CpuConfig, type Difficulty } from './cpu';
import { attackOverlaps, comboStage, facingVector, type AttackAction, type CombatFighter, type CombatInput, type HitEvent } from './combat';
import { canStartBlock } from './defense';
import { canSpecial, specialConfig, type SpecialId } from './specials';
import { NO_INPUT, DIRECTIONS, stepFighter } from './movement';
import type { CombatState } from './projectiles';
import { CpuObservation } from './cpu-observation';
export const TACTICS = {
    Easy: { punish: .15, min: 45, max: 75, center: 60, retry: 24, commit: 8, sidestep: 6 },
    Normal: { punish: .40, min: 40, max: 70, center: 55, retry: 18, commit: 6, sidestep: 8 },
    Hard: { punish: .70, min: 35, max: 65, center: 50, retry: 12, commit: 4, sidestep: 10 },
} as const;
const movement = DIRECTIONS.map((_, i) => ({ x: Math.round(Math.cos(i * Math.PI / 4)), y: Math.round(Math.sin(i * Math.PI / 4)), jump: false }));
/** New policy, explicit persistent-world path. Legacy CpuController is unchanged. */
export class RefinedCpuController {
    readonly config: Readonly<CpuConfig>;
    private legacy: CpuController;
    private observation = new CpuObservation();
    private offense: () => number;
    private defense: () => number;
    private special: () => number;
    private tactical: () => number;
    private interval = 0;
    private retry = 0;
    private guard = 0;
    private quiet = 0;
    private reaction = 0;
    private startupWait: number;
    private avoidance = 0;
    private avoidedId = '';
    private approaching = true;
    private committed: CombatInput = { ...NO_INPUT };
    private commitment = 0;
    private responded = new Set<string>();
    private punished = new Set<string>();
    private continued = new WeakSet<AttackAction>();
    private opportunity = 0;
    private specialAge = 0;
    private candidate?: SpecialId;
    private failures = new Map<string, {
        count: number;
        last: number;
        until: number;
    }>();
    private attempts = new Map<string, {
        kind: string;
        action: CombatFighter['action'];
        contact: boolean;
    }>();
    lastDecision: {
        reason: string;
    } = { reason: 'initial' };
    constructor(config: Readonly<CpuConfig>, seed = 1, readonly difficulty: Difficulty = 'Normal') {
        this.legacy = new CpuController(config, seed);
        this.config = this.legacy.config;
        this.startupWait = config.reactionFrames;
        this.offense = seededRandom(seed);
        this.defense = seededRandom(seed ^ 0x6a09e667);
        this.special = seededRandom(seed ^ 0xbb67ae85);
        this.tactical = seededRandom(seed ^ 0x3c6ef372);
    }
    recordOutcomes(events: readonly HitEvent[]): void {
        for (const e of events) {
            if (!e.instanceId)
                continue;
            const pending = this.attempts.get(e.instanceId);
            if (pending)
                pending.contact = true;
        }
    }
    private choose(input: CombatInput, reason: string) { this.lastDecision = { reason }; return input; }
    private suppressed(kind: string) { const f = this.failures.get(kind); return Boolean(f && this.observation.tick < f.until); }
    private updateOutcomes(self: CombatFighter, world: Readonly<CombatState>) {
        const a = self.action;
        if ((a.type === 'attack' || a.type === 'special') && a.instanceId && !this.attempts.has(a.instanceId))
            this.attempts.set(a.instanceId, { kind: a.type === 'special' ? a.id : a.kind, action: a, contact: false });
        for (const [id, p] of this.attempts) {
            if (p.action.type === 'attack' || p.action.type === 'special')
                p.contact ||= p.action.hitTargets.size > 0;
            if ((a.type === 'attack' || a.type === 'special') && a.instanceId === id || world.projectiles.some(p => p.id === id))
                continue;
            const previous = this.failures.get(p.kind), count = p.contact ? 0 : ((previous && this.observation.tick - previous.last <= 120) ? previous.count : 0) + 1;
            this.failures.set(p.kind, { count, last: this.observation.tick, until: count >= 3 ? this.observation.tick + 60 : 0 });
            this.attempts.delete(id);
        }
    }
    private range(self: CombatFighter, target: CombatFighter, kind: 'light' | 'heavy', horizontal = false) {
        const d = facingVector(self.facing);
        if ((target.x - self.x) * d.x + (target.y - self.y) * d.y < 0)
            return false;
        const airborne = self.state === 'jump';
        return attackOverlaps(self, horizontal ? { ...target, z: self.z } : target, { type: 'attack', kind, airborne, frame: 1, facing: self.facing,
            stats: self.stats.attacks[airborne ? 'air' : 'ground'][kind], hitTargets: new Set() });
    }
    private face(self: CombatFighter, target: CombatFighter): CombatInput | undefined {
        if (this.range(self, target, 'light', true) || this.range(self, target, 'heavy', true))
            return;
        for (const input of movement) {
            const next = { ...self };
            stepFighter(next, input, self.stats.movement);
            if (this.range(next, target, 'light', true) || this.range(next, target, 'heavy', true))
                return { ...input };
        }
        const distance = Math.hypot(self.x - target.x, self.y - target.y);
        if (distance < .001)
            return { ...movement[(DIRECTIONS.indexOf(self.facing) + 4) % 8] };
        return pursuitInput(self, { x: self.x + (self.x - target.x) * 44 / distance, y: self.y + (self.y - target.y) * 44 / distance });
    }
    tick(self: CombatFighter, target: CombatFighter, world?: Readonly<CombatState>): CombatInput {
        if (!world)
            return this.legacy.tick(self, target);
        const idle = { ...NO_INPUT }, t = TACTICS[this.difficulty];
        if (this.interval > 0)
            this.interval--;
        if (this.retry > 0)
            this.retry--;
        if (this.opportunity > 0)
            this.opportunity--;
        const o = this.observation.observe(self, target, world);
        this.updateOutcomes(self, world);
        // Keep bounded observation decisions; live action/entity IDs plus current punish.
        const live = new Set([...world.projectiles.map(p => p.id), ...(o.actionId ? [o.actionId] : [])]);
        for (const id of this.responded)
            if (!live.has(id))
                this.responded.delete(id);
        for (const id of this.punished)
            if (id !== o.actionId)
                this.punished.delete(id);
        if (self.health <= 0 || target.health <= 0)
            return this.choose(idle, 'ko');
        if (self.action.type === 'attack') {
            const a = self.action, s = comboStage(self);
            if (s?.next && s.cancel && (a.confirmedTargets ?? a.hitTargets).has(target.id) && a.frame + 1 >= s.cancel[0] && a.frame + 1 <= s.cancel[1] && !this.continued.has(a)) {
                this.continued.add(a);
                if (this.offense() < (this.config.comboChance ?? .6))
                    return this.choose({ ...idle, attack: 'light' }, 'combo');
            }
        }
        const guardable = o.threats.filter(threat => { const d = facingVector(self.facing), v = threat.projectile ? { x: -threat.projectile.direction.x, y: -threat.projectile.direction.y } : { x: target.x - self.x, y: target.y - self.y }; return d.x * v.x + d.y * v.y >= 0; });
        if (self.action.type === 'blocking' || self.action.type === 'block_startup' || self.action.type === 'blockstun') {
            this.quiet = guardable.length ? 0 : this.quiet + 1;
            if (this.guard > 0 && this.quiet < 6) {
                this.guard--;
                return this.choose({ ...idle, block: true }, 'guard');
            }
            this.retry = t.retry;
            this.guard = 0;
            return this.choose(idle, 'guard-release');
        }
        if (self.action.type !== 'ready' || self.cooldown > 0 || self.state === 'landing' || self.guard.breakRemaining > 0) {
            this.reaction = 0;
            this.commitment = 0;
            return this.choose(idle, 'action-lock');
        }
        if (this.startupWait > 0) {
            this.startupWait--;
            return this.choose(idle, 'reaction-wait');
        }
        if (this.avoidance > 0) {
            const p = world.projectiles.find(p => p.id === this.avoidedId);
            if (p) {
                const next = { ...self };
                stepFighter(next, this.committed, self.stats.movement);
                const d = p.direction;
                const before = Math.abs(-(self.x - p.x) * d.y + (self.y - p.y) * d.x), after = Math.abs(-(next.x - p.x) * d.y + (next.y - p.y) * d.x);
                if (after > before + .01) {
                    this.avoidance--;
                    return this.choose({ ...this.committed }, 'avoid');
                }
            }
            this.avoidance = 0;
        }
        const threat = guardable.find(threat => threat.age >= (this.config.defenseReactionFrames ?? this.config.reactionFrames));
        if (threat && this.retry === 0 && canStartBlock(self)) {
            if (threat.projectile && (self.guard.value <= 35 || !this.responded.has(threat.id))) {
                const p = threat.projectile, d = p.direction, old = Math.abs(-(self.x - p.x) * d.y + (self.y - p.y) * d.x);
                const ranked = movement.map(input => { const next = { ...self }; stepFighter(next, input, self.stats.movement); return { input, score: Math.abs(-(next.x - p.x) * d.y + (next.y - p.y) * d.x), moved: Math.hypot(next.x - self.x, next.y - self.y) }; }).filter(x => x.moved > 0 && x.score > old + .01).sort((a, b) => b.score - a.score);
                if (ranked.length) {
                    this.committed = { ...ranked[0].input };
                    this.avoidance = t.sidestep - 1;
                    this.avoidedId = threat.id;
                    this.responded.add(threat.id);
                    return this.choose({ ...this.committed }, 'avoid');
                }
            }
            if (!this.responded.has(threat.id)) {
                this.responded.add(threat.id);
                if (this.defense() < (this.config.blockChance ?? 0)) {
                    this.guard = (this.config.maxBlockFrames ?? 36) - 1;
                    this.quiet = 0;
                    return this.choose({ ...idle, block: true }, 'guard');
                }
            }
        }
        if (o.actionId && o.recoveryAge >= 6 && o.actionAge >= this.config.reactionFrames && this.interval === 0 && !this.punished.has(o.actionId)) {
            const kinds = (['heavy', 'light'] as const).filter(k => !this.suppressed(k) && this.range(self, target, k) && o.remainingRecovery >= self.stats.attacks.ground[k].startup + 3);
            if (kinds.length) {
                this.punished.add(o.actionId);
                if (this.tactical() < t.punish) {
                    this.interval = this.config.attackInterval;
                    return this.choose({ ...idle, attack: kinds[0] }, 'punish');
                }
            }
        }
        const d = facingVector(self.facing), dx = target.x - self.x, dy = target.y - self.y, forward = dx * d.x + dy * d.y, side = Math.abs(-dx * d.y + dy * d.x), distance = Math.hypot(dx, dy);
        const id: SpecialId | undefined = forward >= 0 && forward <= 70 ? 'power' : forward > 70 && forward <= 140 ? 'dash' : forward > 140 && forward <= 280 ? 'projectile' : undefined;
        const s = id ? specialConfig(self).definitions[id] : undefined;
        const candidate = id && s && !this.suppressed(id) && canSpecial(self, id, world.projectiles.some(p => p.ownerId === self.id)) && side <= (id === 'projectile' ? s.projectileRadius : s.width / 2) + target.stats.hurtRadius && target.z <= s.bottom + s.height ? id : undefined;
        if (this.candidate !== candidate) {
            this.candidate = candidate;
            this.specialAge = 0;
        }
        else if (candidate)
            this.specialAge++;
        const guarding = target.action.type === 'blocking' || target.action.type === 'blockstun';
        if (guarding && target.guard.value <= 45 && this.interval === 0 && this.range(self, target, 'heavy')) {
            this.interval = this.config.attackInterval;
            return this.choose({ ...idle, attack: 'heavy' }, 'guard-pressure');
        }
        if (candidate && this.specialAge >= (this.config.specialReactionFrames ?? this.config.reactionFrames) && this.interval === 0 && this.opportunity === 0) {
            this.specialAge = 0;
            this.opportunity = this.config.attackInterval;
            if (this.special() < (this.config.specialChance ?? 0)) {
                this.interval = this.config.attackInterval;
                return this.choose({ ...idle, special: candidate }, 'special');
            }
        }
        // Same bounded one-step facing correction and height wait as M01.4.
        const horizontallyAligned = this.range(self, target, 'light', true) || this.range(self, target, 'heavy', true);
        // The old overlap correction assumes close spacing. At a wider preferred band,
        // approach first rather than alternating retreat/pursuit at the band edge.
        if (!horizontallyAligned && distance > 44) {
            this.approaching = true;
            this.commitment = 0;
            return this.choose(pursuitInput(self, target), 'align-approach');
        }
        const facing = this.face(self, target);
        if (facing && distance <= 44) {
            this.commitment = 0;
            return this.choose(facing, 'face');
        }
        if (distance > t.max + 6)
            this.approaching = true;
        if (distance <= t.center)
            this.approaching = false;
        if (this.approaching) {
            if (this.commitment > 0) {
                const next = { ...self };
                stepFighter(next, this.committed, self.stats.movement);
                if (Math.hypot(target.x - next.x, target.y - next.y) < distance - .001) {
                    this.commitment--;
                    return this.choose({ ...this.committed }, 'pursue');
                }
            }
            this.committed = pursuitInput(self, target);
            this.commitment = t.commit - 1;
            return this.choose({ ...this.committed }, 'pursue');
        }
        const kinds = (['light', 'heavy'] as const).filter(k => this.range(self, target, k) && !this.suppressed(k));
        if (!kinds.length)
            return this.choose(idle, target.z > 0 ? 'height-wait' : 'range-wait');
        if (++this.reaction <= this.config.reactionFrames || this.interval > 0)
            return this.choose(idle, 'reaction-wait');
        this.reaction = 0;
        if (this.offense() < this.config.pauseChance) {
            this.startupWait = this.config.pauseFrames;
            return this.choose(idle, 'deliberate-wait');
        }
        let kind: 'light' | 'heavy' = this.offense() < this.config.heavyChance ? 'heavy' : 'light';
        if (!kinds.includes(kind))
            kind = kinds[0];
        this.interval = this.config.attackInterval;
        return this.choose({ ...idle, attack: kind, jump: self.z === 0 && this.offense() < this.config.aerialChance }, 'offense');
    }
}
