import { describe, it, expect, vi } from 'vitest';
import { RefinedCpuController, TACTICS } from '../src/core/cpu-policy';
import { CpuObservation } from '../src/core/cpu-observation';
import { CombatTelemetry } from '../src/dev/combat-telemetry';
import { CpuController, CPU_PRESETS } from '../src/core/cpu';
import { createCombatFighter, stepCombat, facingVector, type AttackAction, type CombatInput } from '../src/core/combat';
import { createCombatState } from '../src/core/projectiles';
import { NO_INPUT, DIRECTIONS } from '../src/core/movement';
import { DEFAULT_COMBO } from '../src/core/combos';
import { DEFAULT_DEFENSE } from '../src/core/defense';
import { DEFAULT_SPECIALS } from '../src/core/specials';
import { MatchController, COUNTDOWN_TICKS } from '../src/core/match';
function pair(distance = 44) { const d = facingVector('e'); return [createCombatFighter('cpu', 0, 0, 'e'), createCombatFighter('player', d.x * distance, d.y * distance, 'w')] as const; }
function run(difficulty: keyof typeof CPU_PRESETS, seed: number, observe: boolean, hz = 60, legacy = false) {
    const [a, b] = pair(140), world = createCombatState(), cpu = legacy ? new CpuController(CPU_PRESETS[difficulty], seed) : new RefinedCpuController(CPU_PRESETS[difficulty], seed, difficulty), telemetry = new CombatTelemetry('cpu');
    const multiply = Math.imul, rngTrace: number[][] = [];
    const spy = vi.spyOn(Math, 'imul').mockImplementation((a, b) => { const r = multiply(a, b); rngTrace.push([a, b, r]); return r; });
    let acc = 0, tick = 0;
    const trace = [];
    try {
        for (let frame = 0; frame < hz * 15; frame++) {
            acc += 1 / hz;
            while (acc + 1e-10 >= 1 / 60) {
                const input = cpu.tick(a, b, world), other: CombatInput = { ...NO_INPUT, attack: tick % 43 === 0 ? 'heavy' : tick % 11 === 0 ? 'light' : undefined, block: tick % 180 > 100 };
                const events = stepCombat([a, b], [input, other], world, observe ? telemetry.accepted : undefined);
                if (cpu instanceof RefinedCpuController)
                    cpu.recordOutcomes(events);
                if (observe)
                    telemetry.observe([a, b], events, cpu instanceof RefinedCpuController ? cpu.lastDecision.reason : 'legacy', world.projectiles);
                trace.push(JSON.stringify([input, a, b, world, events, cpu instanceof RefinedCpuController ? cpu.lastDecision : null]));
                tick++;
                acc -= 1 / 60;
            }
        }
        return { trace, rngTrace, summary: telemetry.summary() };
    }
    finally {
        spy.mockRestore();
    }
}
describe('passive telemetry and unchanged combat', () => {
    it.each(['Easy', 'Normal', 'Hard'] as const)('%s observer on/off preserves every combat/input/RNG decision trace', difficulty => {
        for (const legacy of [false, true])
            for (const seed of [0, 1, 5, 42, 255]) {
                const on = run(difficulty, seed, true, 60, legacy), off = run(difficulty, seed, false, 60, legacy);
                expect(on.trace).toEqual(off.trace);
                expect(on.rngTrace).toEqual(off.rngTrace);
                expect(on.rngTrace.length).toBeGreaterThan(0);
            }
    });
    it('counts accepted normal and special attacks rather than requests, with bounded projectile outcomes', () => {
        const [a, b] = pair(30), world = createCombatState(), t = new CombatTelemetry('cpu');
        for (let tick = 0; tick < 30; tick++) {
            const events = stepCombat([a, b], [{ ...NO_INPUT, attack: 'heavy' }, NO_INPUT], world, t.accepted);
            t.observe([a, b], events, 'offense', world.projectiles);
        }
        expect(t.attempts.ground_heavy).toBe(1);
        expect(t.hits.ground_heavy).toBe(1);
        expect(t.completedWhiffs).toBe(0);
        expect(t.damage['ground_heavy:full']).toBe(15);
    });
    it('accepted diagnostics are immutable scalar DTOs', () => {
        const [a] = pair();
        let dto: unknown;
        stepCombat([a], [{ ...NO_INPUT, attack: 'light' }], createCombatState(), e => dto = e);
        expect(Object.isFrozen(dto)).toBe(true);
        expect(Object.keys(dto as object).sort()).toEqual(['instanceId', 'kind', 'ownerId']);
    });
    it('retains all approved combat values', () => {
        const [a] = pair();
        expect(a.stats.movement).toEqual({ speed: 220, airControl: .7, jumpSpeed: 360, gravity: 1000, radius: 16, landingFrames: 6 });
        expect(a.stats.attacks.ground.light).toMatchObject({ startup: 5, active: 3, recovery: 10, cooldown: 4, damage: 5, hitstun: 12, reach: 58 });
        expect(a.stats.attacks.ground.heavy).toMatchObject({ startup: 12, active: 4, recovery: 20, cooldown: 8, damage: 15, hitstun: 24, reach: 76 });
        expect(DEFAULT_COMBO.bufferTicks).toBe(6);
        expect(DEFAULT_COMBO.stages.map(s => s.overrides.damage ?? a.stats.attacks.ground[s.kind].damage)).toEqual([5, 6, 8, 15]);
        expect(DEFAULT_DEFENSE).toMatchObject({ startup: 3, recovery: 6, maxGuard: 100, chipRatio: .25, breakTicks: 36, regenDelay: 60, regenPerTick: .5 });
        expect(DEFAULT_SPECIALS.sharedLockout).toBe(60);
        expect(Object.values(DEFAULT_SPECIALS.definitions).map(s => [s.damage, s.hitstun, s.startup, s.active, s.recovery, s.recharge])).toEqual([[20, 26, 15, 4, 24, 120], [12, 18, 9, 8, 22, 150], [10, 14, 18, 1, 20, 180]]);
    });
});
describe('credible visible observations', () => {
    it.each(['away', 'lateral', 'high', 'expired'] as const)('ignores %s projectile while preserving melee observation', kind => {
        const [a, b] = pair(30), world = createCombatState(), observer = new CpuObservation();
        b.action = { type: 'attack', kind: 'light', airborne: false, frame: 1, facing: 'w', stats: b.stats.attacks.ground.light, hitTargets: new Set(), instanceId: 'player:1' };
        const d = facingVector('e');
        world.projectiles.push({ id: 'orb', ownerId: 'player', x: d.x * 60, y: d.y * 60, z: 22, direction: kind === 'away' ? d : { x: -d.x, y: -d.y }, definition: DEFAULT_SPECIALS.definitions.projectile, remainingDistance: kind === 'expired' ? 0 : 300, remainingTicks: 40, bornTick: 0 });
        if (kind === 'lateral')
            world.projectiles[0].y += 100;
        if (kind === 'high')
            a.z = 100;
        const result = observer.observe(a, b, world);
        expect(result.threats.some(t => t.projectile)).toBe(false);
        if (kind !== 'high')
            expect(result.threats.map(t => t.id)).toContain('player:1');
    });
    it('ages a projectile from first visibility, then admits a 30-tick path threat without future input knowledge', () => {
        const [a, b] = pair(), world = createCombatState(), observer = new CpuObservation(), d = facingVector('e');
        const p = { id: 'p', ownerId: b.id, x: d.x * 200, y: d.y * 200, z: 22, direction: { x: -d.x, y: -d.y }, definition: DEFAULT_SPECIALS.definitions.projectile, remainingDistance: 300, remainingTicks: 70, bornTick: 0 };
        world.projectiles.push(p);
        for (let i = 0; i < 12; i++)
            expect(observer.observe(a, b, world).threats).toHaveLength(0);
        p.x = d.x * 100;
        p.y = d.y * 100;
        expect(observer.observe(a, b, world).threats[0].age).toBe(12);
    });
});
describe('refined policy legality and stability', () => {
    it.each(['Easy', 'Normal', 'Hard'] as const)('%s legacy adapter stays byte-for-byte decision compatible', difficulty => {
        const [a, b] = pair(), old = new CpuController(CPU_PRESETS[difficulty], 42), next = new RefinedCpuController(CPU_PRESETS[difficulty], 42, difficulty);
        for (let i = 0; i < 500; i++)
            expect(next.tick(a, b)).toEqual(old.tick(a, b));
    });
    it.each(['Easy', 'Normal', 'Hard'] as const)('%s actual simulation resumes pursuit and damage after repeated jumping', difficulty => {
        for (const seed of [0, 1, 5, 42, 255]) {
            const [a, b] = pair(200), world = createCombatState(), cpu = new RefinedCpuController(CPU_PRESETS[difficulty], seed, difficulty);
            let damage = -1;
            for (let tick = 0; tick < 2400; tick++) {
                const before = structuredClone([a, b]), input = cpu.tick(a, b, world);
                expect([a, b]).toEqual(before);
                const events = stepCombat([a, b], [input, { ...NO_INPUT, jump: tick < 300 && tick % 60 === 0 }], world);
                cpu.recordOutcomes(events);
                if (tick >= 300 && events.some(e => e.attackerId === a.id)) {
                    damage = tick;
                    break;
                }
            }
            expect(damage).toBeGreaterThanOrEqual(300);
            expect(damage).toBeLessThanOrEqual(1800);
        }
    });
    it.each(DIRECTIONS)('overlap / facing %s uses bounded legal corrections then attacks', facing => {
        for (const distance of [0, .01, 1, 44]) {
            const [a, b] = pair(distance);
            a.facing = facing;
            const world = createCombatState(), cpu = new RefinedCpuController(CPU_PRESETS.Hard, 42, 'Hard');
            let attacks = 0, corrections = 0;
            for (let tick = 0; tick < 720; tick++) {
                const input = cpu.tick(a, b, world);
                if (input.attack || input.special)
                    attacks++;
                if (cpu.lastDecision.reason === 'face')
                    corrections++;
                const events = stepCombat([a, b], [input, NO_INPUT], world);
                cpu.recordOutcomes(events);
            }
            expect(attacks).toBeGreaterThan(0);
            expect(corrections).toBeLessThan(40);
        }
    });
    it.each(['Easy', 'Normal', 'Hard'] as const)('%s cannot block or attack from illegal locked states', difficulty => {
        const [a, b] = pair(), world = createCombatState(), cpu = new RefinedCpuController(CPU_PRESETS[difficulty], 1, difficulty);
        for (const type of ['hitstun', 'guard_break', 'block_recovery'] as const) {
            a.action = type === 'guard_break' ? { type } : { type, remaining: 5 };
            if (type === 'guard_break')
                a.guard.breakRemaining = 5;
            for (let i = 0; i < 60; i++) {
                const input = cpu.tick(a, b, world);
                expect(input.attack).toBeUndefined();
                expect(input.special).toBeUndefined();
                expect(input.block).not.toBe(true);
            }
        }
    });
    it.each(['Easy', 'Normal', 'Hard'] as const)('%s releases quiet guard within six ticks, never perpetual guard', difficulty => {
        const [a, b] = pair(), cpu = new RefinedCpuController(CPU_PRESETS[difficulty], 1, difficulty), world = createCombatState();
        a.action = { type: 'blocking' };
        let held = 0;
        for (let i = 0; i < 60; i++) {
            const input = cpu.tick(a, b, world);
            if (input.block)
                held++;
            stepCombat([a, b], [input, NO_INPUT], world);
        }
        expect(held).toBeLessThanOrEqual(6);
        expect(a.action.type).not.toBe('blocking');
    });
    it.each([10, 30, 60, 144, 240])('%i Hz matches complete refined combat/decision traces', hz => { expect(run('Hard', 42, true, hz).trace).toEqual(run('Hard', 42, true, 60).trace); });
    it('same seed replays and different seeds diverge', () => { expect(run('Normal', 1, true).trace).toEqual(run('Normal', 1, true).trace); expect(run('Normal', 1, true).trace).not.toEqual(run('Normal', 42, true).trace); });
    it('production uses refined policy; explicit legacy match remains available', () => {
        const refined = new MatchController(1), legacy = new MatchController(1, 'legacy');
        expect(refined.cpuPolicy).toBe('refined');
        expect(legacy.cpuPolicy).toBe('legacy');
        for (const m of [refined, legacy]) {
            m.start();
            for (let i = 0; i < COUNTDOWN_TICKS; i++)
                m.tick();
            m.setHelp(true);
            const snap = structuredClone([m.fighters, m.combat]);
            m.advance(1000);
            expect([m.fighters, m.combat]).toEqual(snap);
            m.setHelp(false);
            m.menu();
            expect(m.combat.projectiles).toHaveLength(0);
        }
    });
});
describe('punish opportunities, guard pressure and bounded failure memory', () => {
    it.each(['Easy', 'Normal', 'Hard'] as const)('%s waits six recovery observations and rolls at most once per instance', difficulty => {
        let successful = 0;
        for (let seed = 0; seed < 100; seed++) {
            const [a, b] = pair(40), world = createCombatState(), cpu = new RefinedCpuController({ ...CPU_PRESETS[difficulty], reactionFrames: 1, pauseChance: 1, pauseFrames: 1, attackInterval: 1, specialChance: 0 }, seed, difficulty);
            b.action = { type: 'attack', kind: 'heavy', airborne: false, frame: 17, facing: 'w', stats: b.stats.attacks.ground.heavy, hitTargets: new Set(), instanceId: 'recovery' };
            let punish = 0;
            for (let tick = 0; tick < 20; tick++) {
                cpu.tick(a, b, world);
                if (cpu.lastDecision.reason === 'punish') {
                    expect(tick).toBeGreaterThanOrEqual(6);
                    punish++;
                }
            }
            expect(punish).toBeLessThanOrEqual(1);
            successful += punish;
        }
        expect(successful).toBeGreaterThan(0);
        expect(successful).toBeLessThan(100);
    });
    it('never declares a punish when remaining recovery cannot cover light startup plus margin', () => {
        const [a, b] = pair(40), world = createCombatState(), cpu = new RefinedCpuController({ ...CPU_PRESETS.Hard, reactionFrames: 1, pauseChance: 1, pauseFrames: 1, specialChance: 0 }, 42, 'Hard');
        b.action = { type: 'attack', kind: 'light', airborne: false, frame: 12, facing: 'w', stats: b.stats.attacks.ground.light, hitTargets: new Set(), instanceId: 'short' };
        for (let tick = 0; tick < 30; tick++) {
            cpu.tick(a, b, world);
            expect(cpu.lastDecision.reason).not.toBe('punish');
        }
    });
    it('uses ordinary heavy guard pressure rather than lower-guard-damage Burst', () => {
        const [a, b] = pair(40), world = createCombatState(), cpu = new RefinedCpuController({ ...CPU_PRESETS.Hard, reactionFrames: 1 }, 1, 'Hard');
        b.action = { type: 'blocking' };
        b.guard.value = 20;
        cpu.tick(a, b, world);
        expect(cpu.tick(a, b, world)).toMatchObject({ attack: 'heavy' });
        expect(cpu.lastDecision.reason).toBe('guard-pressure');
    });
    it('three whiffs suppress a move temporarily, then allow it again', () => {
        const [a, b] = pair(40), world = createCombatState(), cpu = new RefinedCpuController({ ...CPU_PRESETS.Hard, reactionFrames: 1, attackInterval: 1, pauseChance: 0, heavyChance: 0, specialChance: 0 }, 1, 'Hard');
        for (let i = 0; i < 3; i++) {
            a.action = { type: 'attack', kind: 'light', airborne: false, frame: 18, facing: 'e', stats: a.stats.attacks.ground.light, hitTargets: new Set(), instanceId: 'cpu:miss' + i };
            cpu.tick(a, b, world);
            a.action = { type: 'ready' };
            cpu.tick(a, b, world);
        }
        for (let tick = 0; tick < 10; tick++)
            expect(cpu.tick(a, b, world).attack).not.toBe('light');
        let returned = false;
        for (let tick = 0; tick < 100; tick++)
            returned ||= cpu.tick(a, b, world).attack === 'light';
        expect(returned).toBe(true);
    });
});
describe('special telemetry and tactical lifecycle', () => {
    it.each(['power', 'dash', 'projectile'] as const)('%s records exactly one accepted activation despite repeated requests', id => {
        const [a, b] = pair(100);
        const world = createCombatState(), t = new CombatTelemetry('cpu');
        for (let tick = 0; tick < 60; tick++) {
            const events = stepCombat([a, b], [{ ...NO_INPUT, special: id }, NO_INPUT], world, t.accepted);
            t.observe([a, b], events, 'special', world.projectiles);
        }
        expect(t.attempts[id]).toBe(1);
        expect(Object.values(t.attempts).reduce((a, b) => a + b, 0)).toBe(1);
    });
    it.each(['Easy', 'Normal', 'Hard'] as const)('%s escapes all four corner fixtures without indefinite pursuit starvation', difficulty => {
        for (const x of [-324, 324])
            for (const y of [-194, 194]) {
                const [a, b] = pair();
                a.x = x;
                a.y = y;
                b.x = -x / 2;
                b.y = -y / 2;
                const world = createCombatState(), cpu = new RefinedCpuController(CPU_PRESETS[difficulty], 42, difficulty);
                let contact = -1;
                for (let tick = 0; tick < 1800; tick++) {
                    const input = cpu.tick(a, b, world), events = stepCombat([a, b], [input, NO_INPUT], world);
                    cpu.recordOutcomes(events);
                    if (events.some(e => e.attackerId === a.id)) {
                        contact = tick;
                        break;
                    }
                }
                expect(contact).toBeGreaterThanOrEqual(0);
                expect(contact).toBeLessThan(1800);
            }
    });
    it('projectile avoidance commits in one direction for at most the configured burst and resumes offense', () => {
        const [a, b] = pair(200), world = createCombatState(), d = facingVector('e');
        const cpu = new RefinedCpuController({ ...CPU_PRESETS.Hard, reactionFrames: 1, defenseReactionFrames: 1 }, 42, 'Hard');
        world.projectiles.push({ id: 'incoming', ownerId: b.id, x: d.x * 100, y: d.y * 100, z: 22, direction: { x: -d.x, y: -d.y }, definition: DEFAULT_SPECIALS.definitions.projectile, remainingDistance: 300, remainingTicks: 70, bornTick: 0 });
        let burst: CombatInput[] = [];
        for (let tick = 0; tick < 60; tick++) {
            const input = cpu.tick(a, b, world);
            if (cpu.lastDecision.reason === 'avoid')
                burst.push(input);
            else if (burst.length)
                break;
            const events = stepCombat([a, b], [input, NO_INPUT], world);
            cpu.recordOutcomes(events);
        }
        expect(burst.length).toBeGreaterThan(0);
        expect(burst.length).toBeLessThanOrEqual(TACTICS.Hard.sidestep);
        expect(burst.every(i => i.x === burst[0].x && i.y === burst[0].y)).toBe(true);
        world.projectiles = [];
        let offense = false;
        for (let tick = 0; tick < 1200; tick++) {
            const input = cpu.tick(a, b, world);
            offense ||= Boolean(input.attack || input.special);
            const events = stepCombat([a, b], [input, NO_INPUT], world);
            cpu.recordOutcomes(events);
        }
        expect(offense).toBe(true);
    });
});
