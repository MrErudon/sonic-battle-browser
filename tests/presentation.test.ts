import { describe, it, expect, vi } from 'vitest';
import manifestJson from '../public/assets/characters/synthetic/v1/manifest.json';
import { CLIPS, validateManifest, attachment, type ClipId } from '../src/presentation/manifest';
import { resolveAnimation, animationState, type AnimationContext } from '../src/presentation/resolver';
import { PresentationCapture } from '../src/presentation/capture';
import { fighterSnapshot, snapshotMatch, type PresentationSink } from '../src/presentation/snapshot';
import { MatchController, COUNTDOWN_TICKS } from '../src/core/match';
import { createCombatFighter, stepCombat, facingVector, type CombatInput } from '../src/core/combat';
import { createCombatState } from '../src/core/projectiles';
import { DEFAULT_SPECIALS } from '../src/core/specials';
import { DIRECTIONS, NO_INPUT } from '../src/core/movement';
import { CPU_PRESETS, type Difficulty } from '../src/core/cpu';
import { EffectPool, EFFECTS, contactEffect } from '../src/presentation/effects';
const manifest = validateManifest(manifestJson);
const context: AnimationContext = { clock: 0, age: 0, airAge: 1, hitAge: 0, matchState: 'Fighting' };
const clone = () => structuredClone(manifestJson) as any;
function pose(f = createCombatFighter('P1', 0, 0, 'e'), c = context) { return resolveAnimation(fighterSnapshot(f), c, manifest); }
describe('manifest validation', () => {
    it('validates complete immutable synthetic coverage and finisher alias', () => { expect(Object.isFrozen(manifest.animations.idle)).toBe(true); expect(Object.keys(manifest.animations)).toHaveLength(Object.keys(CLIPS).length); expect(manifest.animations['ground.finisher'].alias).toBe('ground.heavy'); });
    it.each(['version', 'pivot', 'trim', 'rotate', 'rectangle', 'missingClip', 'missingDirection', 'missingFrame', 'cycle', 'url', 'pageSize', 'attachment'] as const)('rejects %s', kind => {
        const m = clone();
        if (kind === 'version')
            m.schemaVersion = 2;
        if (kind === 'pivot')
            m.pivot = [31, 56];
        if (kind === 'trim')
            Object.values<any>(m.frames)[0].trimmed = true;
        if (kind === 'rotate')
            Object.values<any>(m.frames)[0].rotated = true;
        if (kind === 'rectangle')
            Object.values<any>(m.frames)[0].x = 9999;
        if (kind === 'missingClip')
            delete m.animations.idle;
        if (kind === 'missingDirection')
            delete m.directions.w;
        if (kind === 'missingFrame')
            m.animations.idle.directions.e.loop = ['absent'];
        if (kind === 'cycle')
            m.animations['ground.heavy'] = { alias: 'ground.finisher' };
        if (kind === 'url')
            m.pages[0].image = '../outside.png';
        if (kind === 'pageSize')
            m.pages[0].width = 2048;
        if (kind === 'attachment')
            m.attachments.hand = [Infinity, 2];
        expect(() => validateManifest(m)).toThrow();
    });
    it.each(DIRECTIONS)('maps %s and mirrors pivot/attachments deterministically', direction => { const f = createCombatFighter('P1', 0, 0, direction), p = pose(f); expect(p.facing).toBe(direction); expect(p.mirror).toBe(['w', 'nw', 'sw'].includes(direction)); expect(p.originX).toBe(.5); expect(p.originY).toBe(.875); expect(p.hand).toEqual([p.mirror ? 18 : 46, 34]); expect(attachment(manifest, 'missing', direction)).toEqual([32, 56]); });
});
describe('authoritative animation phases and transforms', () => {
    it.each(['light_1', 'light_2', 'light_3', 'finisher', 'heavy', 'air.light', 'air.heavy', 'power', 'dash', 'projectile'] as const)('%s first and last phase ticks', kind => {
        const f = createCombatFighter('P1', 0, 0, 'e'), special = ['power', 'dash', 'projectile'].includes(kind);
        if (special) {
            const id = kind as 'power' | 'dash' | 'projectile';
            f.action = { type: 'special', id, instanceId: 'a', frame: 1, facing: 'w', definition: DEFAULT_SPECIALS.definitions[id], hitTargets: new Set(), travelRemaining: 0, travelStopped: false, spawned: false };
        }
        else {
            const airborne = kind.startsWith('air.'), heavy = kind === 'finisher' || kind === 'heavy' || kind === 'air.heavy';
            const stats = { ...f.stats.attacks[airborne ? 'air' : 'ground'][heavy ? 'heavy' : 'light'], ...(kind === 'light_2' ? { recovery: 11 } : kind === 'light_3' ? { startup: 7, recovery: 14 } : {}) };
            f.action = { type: 'attack', kind: heavy ? 'heavy' : 'light', airborne, frame: 1, facing: 'w', stats, hitTargets: new Set(), comboStage: !airborne && kind !== 'heavy' ? kind : undefined };
        }
        const a = f.action, stats = a.type === 'special' ? a.definition : a.stats;
        for (const [frame, phase] of [[1, 'startup'], [stats.startup, 'startup'], [stats.startup + 1, 'active'], [stats.startup + stats.active, 'active'], [stats.startup + stats.active + 1, 'recovery'], [stats.startup + stats.active + stats.recovery, 'recovery']] as const) {
            a.frame = frame;
            const p = pose(f);
            expect(p.phase).toBe(phase);
            expect(p.facing).toBe('w');
            expect(p.index).toBeGreaterThanOrEqual(0);
            expect(p.frame in manifest.frames).toBe(true);
        }
    });
    it.each(Object.keys(CLIPS) as ClipId[])('all drawings in %s retain the same foot pivot', clip => { const def = manifest.animations[clip]; if (def.alias)
        return; for (const direction of Object.values(def.directions!))
        for (const frames of Object.values(direction!))
            for (const frame of frames!) {
                expect(manifest.frames[frame]).toMatchObject({ width: 64, height: 64, trimmed: false, rotated: false });
            } expect(manifest.pivot).toEqual([32, 56]); });
    it('projects body elevation independently of grounded shadow and ground depth', () => { const f = createCombatFighter('P1', 20, 50, 'e'), ground = pose(f); f.z = 80; const air = pose(f); expect(air.y).toBe(ground.y - 80); expect(air.groundY).toBe(ground.groundY); expect(air.depth).toBe(ground.depth); expect(air.shadowScale).toBeLessThan(ground.shadowScale); });
    it('sorts jumping fighters by ground position rather than elevated body', () => { const a = createCombatFighter('P1', 0, 0), b = createCombatFighter('P2', 60, 60); b.z = 150; expect(pose(b).y).toBeLessThan(pose(a).y); expect(pose(b).depth).toBeGreaterThan(pose(a).depth); });
    it('does not invent a jump startup delay and uses ascent/apex/descent/landing', () => { const f = createCombatFighter('P1', 0, 0); stepCombat([f], [{ ...NO_INPUT, jump: true }]); expect(f.z).toBeGreaterThan(0); expect(pose(f, { ...context, airAge: 0 }).clip).toBe('jump.takeoff'); for (const [vz, clip] of [[100, 'jump.ascent'], [0, 'jump.apex'], [-100, 'jump.descent']] as const) {
        f.vz = vz;
        expect(pose(f).clip).toBe(clip);
    } f.state = 'landing'; f.landingRemaining = 1; expect(pose(f)).toMatchObject({ clip: 'land', index: 1 }); });
    it('interrupts attacks immediately, distinguishes break recovery and plays winner victory over frozen actions', () => { const f = createCombatFighter('P1', 0, 0); f.action = { type: 'hitstun', remaining: 12 }; expect(pose(f).clip).toBe('hit.react'); expect(pose(f, { ...context, hitAge: 4 }).clip).toBe('hit.stun'); f.action = { type: 'guard_break' }; f.guard.breakRemaining = 36; expect(pose(f).clip).toBe('guard.break'); f.guard.breakRemaining = 4; expect(pose(f).clip).toBe('guard.recover'); expect(pose(f, { ...context, matchState: 'Match Over', winner: 'P1' }).clip).toBe('victory'); f.health = 0; expect(pose(f, { ...context, matchState: 'Match Over', winner: 'P1' }).clip).toBe('ko'); });
    it.each(['block_startup', 'blocking', 'blockstun', 'block_recovery'] as const)('maps %s without extending legal defense', type => { const f = createCombatFighter('P1', 0, 0); f.action = type === 'block_startup' ? { type, frame: 3 } : type === 'blocking' ? { type } : { type, remaining: 1 }; expect(pose(f).clip).toBe({ 'block_startup': 'block.startup', blocking: 'block.hold', blockstun: 'block.stun', block_recovery: 'block.release' }[type]); });
});
function isolated(difficulty: Difficulty, seed: number, enabled: boolean, hz = 60, policy: 'legacy' | 'refined' = 'refined') {
    const m = new MatchController(seed, policy), capture = new PresentationCapture();
    m.selectDifficulty(difficulty);
    if (enabled)
        m.setPresentation(capture);
    m.start();
    const trace: string[] = [], rng: number[][] = [], original = Math.imul, spy = vi.spyOn(Math, 'imul').mockImplementation((a, b) => { const r = original(a, b); rng.push([a, b, r]); return r; });
    try {
        for (let frame = 0; frame < hz * 12; frame++) {
            // Script edges at fixed common time boundaries, independent of render frequency.
            if (frame % hz === 0) {
                m.press('KeyJ');
                m.release('KeyJ');
            }
            if (frame === hz * 4)
                m.setHelp(true);
            if (frame === hz * 5)
                m.setHelp(false);
            const before = m.combat.tick;
            m.advance(1000 / hz);
            if (frame % Math.max(1, hz / 2) === 0)
                trace.push(JSON.stringify([m.state, m.score, m.round, m.fighters, m.combat, m.winner, m.paused]));
            if (enabled)
                capture.drain();
        }
        return { trace, rng, final: JSON.stringify([m.state, m.score, m.fighters, m.combat]) };
    }
    finally {
        spy.mockRestore();
    }
}
describe('observer isolation and passive capture', () => {
    it.each(['Easy', 'Normal', 'Hard'] as const)('%s preserves full combat/CPU/RNG/match traces on/off', difficulty => { for (const policy of ['legacy', 'refined'] as const)
        for (const seed of [0, 1, 5, 42, 255]) {
            const on = isolated(difficulty, seed, true, 60, policy), off = isolated(difficulty, seed, false, 60, policy);
            expect(on.rng.length).toBeGreaterThan(0);
            expect(on).toEqual(off);
        } });
    it('throwing or mutating observers cannot change combat state', () => { const a = new MatchController(42), b = new MatchController(42); a.setPresentation({ onFrame: s => { (s.fighters[0] as any).x = 999; }, onEvent: () => { throw Error('Consumer failure'); } }); a.start(); b.start(); for (let i = 0; i < 1000; i++) {
        expect(a.tick()).toEqual(b.tick());
        expect([a.fighters, a.combat, a.score, a.state]).toEqual([b.fighters, b.combat, b.score, b.state]);
    } });
    it('captures accepted action, same-tick projectile spawn/contact, immutable DTOs and no phantom live orb', () => { const d = facingVector('e'), a = createCombatFighter('P1', 0, 0, 'e'), b = createCombatFighter('P2', d.x * 10, d.y * 10, 'w'), world = createCombatState(), capture = new PresentationCapture(); for (let i = 0; i < 19; i++)
        stepCombat([a, b], [i === 0 ? { ...NO_INPUT, special: 'projectile' } : NO_INPUT, NO_INPUT], world, undefined, capture); const events = capture.drain().map(q => q.event); expect(events.map(e => e.type)).toEqual(['accepted', 'projectile', 'contact']); expect(events[1]).toMatchObject({ tick: 19, projectile: { bornTick: 19 } }); expect(events[2]).toMatchObject({ tick: 19, hit: { specialId: 'projectile', damage: 10 } }); expect(world.projectiles).toHaveLength(0); expect(Object.isFrozen(events[1])).toBe(true); expect(Object.isFrozen(events[2].type === 'contact' ? events[2].hit : {})).toBe(true); });
    it('pauses clocks, captures zero-tick lifecycle, resets epochs and clears rematch state', () => { const m = new MatchController(), c = new PresentationCapture(); m.setPresentation(c); m.start(); for (let i = 0; i < COUNTDOWN_TICKS; i++)
        m.tick(); const old = c.epoch; m.setHelp(true); const clock = c.clock; for (let i = 0; i < 30; i++)
        m.advance(100); expect(c.clock).toBe(clock); expect(c.drain().some(q => q.event.type === 'lifecycle' && q.event.paused)).toBe(true); m.menu(); expect(c.epoch).toBeGreaterThan(old); expect(c.drain().every(q => q.epoch === c.epoch)).toBe(true); c.clear(); expect(c.snapshot).toBeUndefined(); expect(c.drain()).toHaveLength(0); });
    it('bounds abandoned event queues', () => { const c = new PresentationCapture(); for (let i = 0; i < 600; i++)
        c.onEvent({ type: 'lifecycle', state: 'Menu', resetVersion: 1, paused: false }); expect(c.drain()).toHaveLength(512); expect(c.dropped).toBe(88); });
    it.each([10, 30, 60, 144, 240])('%i Hz produces the same final simulation with capture enabled', hz => { expect(isolated('Hard', 42, true, hz).final).toBe(isolated('Hard', 42, true, 60).final); });
});
describe('bounded effect registry policy', () => {
    it('prefers guard outcomes over finisher confirmation', () => { expect(contactEffect({ comboStage: 'finisher', outcome: 'block' })).toBe('guard.block'); expect(contactEffect({ specialId: 'power', outcome: 'guard_break' })).toBe('guard.break'); expect(contactEffect({ comboStage: 'finisher', outcome: 'hit' })).toBe('impact.finisher'); });
    it('deduplicates, evicts oldest, expires and clears', () => { const pool = new EffectPool(2), base = { id: 'impact.light' as const, born: 0, x: 0, y: 0, z: 0 }; expect(pool.add({ ...base, key: 'a' }, 0)).toBe(true); expect(pool.add({ ...base, key: 'a' }, 0)).toBe(false); pool.add({ ...base, key: 'b' }, 0); pool.add({ ...base, key: 'c' }, 0); expect(pool.active.map(e => e.key)).toEqual(['b', 'c']); pool.advance(EFFECTS['impact.light'].ticks); expect(pool.active).toHaveLength(0); expect(pool.add({ ...base, key: 'expired' }, 60)).toBe(false); pool.clear(); expect(pool.add({ ...base, key: 'a', born: 61 }, 61)).toBe(true); });
});
describe('presentation event cadence and results lifecycle', () => {
    function cadence(hz: number) { const m = new MatchController(42), c = new PresentationCapture(), frames: string[] = [], events: string[] = []; const sink: PresentationSink = { onEvent: e => { c.onEvent(e); events.push(JSON.stringify(e)); }, onFrame: s => { c.onFrame(s); frames.push(JSON.stringify(s.fighters.map(f => resolveAnimation(f, c.context(f), manifest)))); } }; m.setPresentation(sink); m.start(); for (let render = 0; render < hz * 12; render++) {
        if (render % hz === 0) {
            m.press('KeyJ');
            m.release('KeyJ');
        }
        m.advance(1000 / hz);
        c.drain();
    } return { frames, events }; }
    it.each([10, 30, 60, 144, 240])('%i Hz captures every authoritative pose/event including phases skipped by renders', hz => { expect(cadence(hz)).toEqual(cadence(60)); });
    it.each(['single', 'double'] as const)('captures %s KO, freezes positions, then resets cleanly', kind => {
        const m = new MatchController(), c = new PresentationCapture();
        m.setPresentation(c);
        m.start();
        for (let i = 0; i < 180; i++)
            m.tick();
        const [a, b] = m.fighters;
        b.health = 1;
        if (kind === 'double')
            a.health = 1;
        const d = facingVector('e');
        a.x = 0;
        a.y = 0;
        b.x = d.x * 30;
        b.y = d.y * 30;
        a.facing = 'e';
        b.facing = 'w';
        a.action = { type: 'attack', kind: 'light', airborne: false, frame: 5, facing: 'e', stats: a.stats.attacks.ground.light, hitTargets: new Set() };
        if (kind === 'double')
            b.action = { type: 'attack', kind: 'light', airborne: false, frame: 5, facing: 'w', stats: b.stats.attacks.ground.light, hitTargets: new Set() };
        m.tick();
        expect(m.state).toBe('Round Over');
        expect(m.result).toBe(kind === 'double' ? 'Draw' : 'P1');
        const ko = c.drain().filter(q => q.event.type === 'ko');
        expect(ko.length).toBe(kind === 'double' ? 2 : 1);
        const positions = m.fighters.map(f => [f.x, f.y, f.z]);
        for (let i = 0; i < 30; i++)
            m.tick();
        expect(m.fighters.map(f => [f.x, f.y, f.z])).toEqual(positions);
        const epoch = c.epoch;
        m.menu();
        m.start();
        expect(c.epoch).toBeGreaterThan(epoch);
        expect(m.fighters.every(f => f.health === 100)).toBe(true);
        expect(c.drain().every(q => q.epoch === c.epoch)).toBe(true);
    });
    it('new contacts restart hit reaction while jump/landing changes do not fabricate contacts', () => {
        const m = new MatchController(), c = new PresentationCapture();
        const f = m.fighters[0];
        f.action = { type: 'hitstun', remaining: 20 };
        c.onFrame(snapshotMatch(m));
        c.onFrame(snapshotMatch(m));
        expect(c.context(fighterSnapshot(f)).hitAge).toBe(1);
        f.state = 'landing';
        c.onFrame(snapshotMatch(m));
        expect(c.context(fighterSnapshot(f)).hitAge).toBe(2);
        c.onEvent({ type: 'contact', tick: 1, hit: { attackerId: 'P2', defenderId: 'P1', damage: 1, x: 0, y: 0, z: 20, outcome: 'hit' } });
        c.onFrame(snapshotMatch(m));
        expect(c.context(fighterSnapshot(f)).hitAge).toBe(0);
    });
});
