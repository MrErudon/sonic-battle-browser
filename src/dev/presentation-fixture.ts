/** Opt-in compiled test entry. Excluded from the normal production build. Never controls a real match. */
import Phaser from 'phaser';
import { createCombatFighter, type CombatFighter } from '../core/combat';
import { DEFAULT_SPECIALS, type SpecialId } from '../core/specials';
import type { Facing } from '../core/movement';
import { CharacterAssetLoader } from '../rendering/CharacterAssetLoader';
import { SpriteFighterView } from '../rendering/SpriteFighterView';
import { EffectRegistry } from '../rendering/EffectRegistry';
import { PresentationCapture } from '../presentation/capture';
import { fighterSnapshot } from '../presentation/snapshot';
import type { AnimationContext } from '../presentation/resolver';
interface FixtureInput {
    clip?: string;
    facing?: Facing;
    frame?: number;
    age?: number;
    z?: number;
    x?: number;
    y?: number;
}
class FixtureScene extends Phaser.Scene {
    private view!: SpriteFighterView;
    private loader!: CharacterAssetLoader;
    private effects!: EffectRegistry;
    private version = 0;
    private f!: CombatFighter;
    private context!: AnimationContext;
    constructor() { super('PresentationFixture'); }
    create() {
        const version = ++this.version;
        this.view = new SpriteFighterView(this, 0x55dced, 'SYNTHETIC');
        this.loader = new CharacterAssetLoader(this);
        this.effects = new EffectRegistry(this);
        this.setCase({});
        const api = { ready: false, setCase: (c: FixtureInput) => this.setCase(c), measure: () => this.measure(), load: async (url: string) => { const result = await this.loader.load(url); this.view.setAsset(result.ok ? result.asset : undefined); this.sync(); return result.ok ? { ok: true } : { ok: false, reason: result.reason }; }, restart: () => { api.ready = false; this.scene.restart(); }, missingFrame: () => { const p = this.view.lastPose; if (p) {
                const key = this.view.textureKey();
                if (key)
                    this.textures.get(key).remove(p.frame);
            } this.sync(); }, benchmark: () => this.benchmark(), fillEffects: () => { for (let i = 0; i < 100; i++)
                this.effects.pool.add({ id: 'impact.light', key: 'fixture' + i, born: 0, x: 0, y: 0, z: 22 }, 0); this.effects.sync(0); return this.effects.pool.active.length; } };
        (window as unknown as {
            fixture: typeof api;
        }).fixture = api;
        void this.loader.load('/assets/characters/synthetic/v1/manifest.json').then(result => { if (version !== this.version)
            return; if (result.ok)
            this.view.setAsset(result.asset); this.sync(); api.ready = true; });
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.version++; this.loader.destroy(); this.view.destroy(); this.effects.destroy(); });
    }
    private setCase(input: FixtureInput) {
        const f = this.f = createCombatFighter('P1', input.x ?? 0, input.y ?? 0, input.facing ?? 'e'), clip = input.clip ?? 'idle';
        this.context = { clock: input.age ?? 0, age: input.age ?? 0, airAge: 1, hitAge: 4, matchState: 'Fighting' };
        f.z = input.z ?? 0;
        if (clip === 'move')
            f.state = 'walk';
        if (clip.startsWith('jump.')) {
            f.state = 'jump';
            f.vz = clip === 'jump.ascent' ? 100 : clip === 'jump.descent' ? -100 : 0;
            if (clip === 'jump.takeoff')
                this.context.airAge = 0;
        }
        if (clip === 'land') {
            f.state = 'landing';
            f.landingRemaining = 3;
        }
        if (clip.startsWith('ground.') || clip.startsWith('air.')) {
            const airborne = clip.startsWith('air.'), id = clip.split('.')[1], kind = id === 'heavy' || id === 'finisher' ? 'heavy' : 'light';
            f.action = { type: 'attack', kind, airborne, frame: input.frame ?? 1, facing: f.facing, instanceId: 'fixture', stats: { ...f.stats.attacks[airborne ? 'air' : 'ground'][kind], ...(id === 'light_2' ? { recovery: 11 } : id === 'light_3' ? { startup: 7, recovery: 14 } : {}) }, hitTargets: new Set(), comboStage: airborne || id === 'heavy' ? undefined : id };
        }
        if (clip.startsWith('special.')) {
            const id = clip.split('.')[1] as SpecialId;
            f.action = { type: 'special', id, instanceId: 'fixture', frame: input.frame ?? 1, facing: f.facing, definition: DEFAULT_SPECIALS.definitions[id], hitTargets: new Set(), travelRemaining: 0, travelStopped: false, spawned: false };
        }
        if (clip.startsWith('block.')) {
            const type = ({ 'block.startup': 'block_startup', 'block.hold': 'blocking', 'block.stun': 'blockstun', 'block.release': 'block_recovery' } as const)[clip as 'block.startup'];
            f.action = type === 'block_startup' ? { type, frame: input.frame ?? 1 } : type === 'blocking' ? { type } : { type, remaining: 3 };
        }
        if (clip.startsWith('guard.')) {
            f.action = { type: 'guard_break' };
            f.guard.breakRemaining = clip === 'guard.break' ? 36 : 3;
        }
        if (clip.startsWith('hit.') || clip === 'knockback') {
            f.action = { type: 'hitstun', remaining: 12 };
            this.context.hitAge = clip === 'hit.react' ? 0 : 4;
            if (clip === 'knockback')
                f.knockbackX = 100;
        }
        if (clip === 'ko') {
            f.health = 0;
            f.action = { type: 'ko' };
        }
        if (clip === 'victory') {
            this.context.matchState = 'Match Over';
            this.context.winner = 'P1';
        }
        this.sync();
        return this.measure();
    }
    private sync() { this.view.sync(this.f, 0, true, this.context); const el = document.querySelector('#fixture-status'); if (el)
        el.textContent = JSON.stringify(this.measure(), null, 2); }
    private measure() { return { ...this.view.diagnostics(), children: this.children.list.length, textures: this.textures.getTextureKeys().filter(k => k.startsWith('character:')).length, canvas: { width: this.game.canvas.width, height: this.game.canvas.height }, devicePixelRatio: devicePixelRatio }; }
    private benchmark() { const samples: number[] = []; for (let i = 0; i < 101; i++) {
        const start = performance.now();
        for (let j = 0; j < 100; j++)
            this.view.sync(this.f, 0, false, this.context);
        samples.push((performance.now() - start) / 100);
    } samples.sort((a, b) => a - b); return { adapterCpuMsP50: samples[50], adapterCpuMsP95: samples[95], iterations: 10100, note: 'CPU adapter update only; excludes GPU draw and asset decode' }; }
}
new Phaser.Game({ type: Phaser.AUTO, parent: 'fixture', width: 960, height: 640, pixelArt: true, roundPixels: true, backgroundColor: '#293a4c', scene: [FixtureScene] });
