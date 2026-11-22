import { projectArena } from '../core/arena';
import type { Facing } from '../core/movement';
import type { FighterSnapshot } from './snapshot';
import { attachment, clipDefinition, directionFor, type CharacterManifest, type ClipId, type Phase } from './manifest';
export interface AnimationContext {
    clock: number;
    age: number;
    airAge: number;
    hitAge: number;
    matchState: string;
    winner?: string;
}
export function animationState(f: FighterSnapshot, c: AnimationContext): {
    clip: ClipId;
    phase: Phase;
    offset: number;
    duration?: number;
    loop?: boolean;
} {
    const a = f.action;
    if (f.health <= 0 || a.type === 'ko')
        return { clip: 'ko', phase: 'loop', offset: c.age, duration: 24 };
    if (c.matchState === 'Match Over' && c.winner === f.id)
        return { clip: 'victory', phase: 'loop', offset: c.age, loop: true };
    if (a.type === 'hitstun')
        return { clip: c.hitAge < 2 ? 'hit.react' : Math.hypot(f.knockbackX, f.knockbackY) > 1 ? 'knockback' : 'hit.stun', phase: 'loop', offset: c.hitAge < 2 ? c.hitAge : c.hitAge - 2, ...(c.hitAge < 2 ? { duration: 2 } : { loop: true }) };
    if (f.guardBreak > 0)
        return { clip: f.guardBreak <= 6 ? 'guard.recover' : 'guard.break', phase: 'loop', offset: f.guardBreak <= 6 ? 6 - f.guardBreak : c.age, duration: f.guardBreak <= 6 ? 6 : 6 };
    if (a.type === 'attack' || a.type === 'special') {
        const frame = a.frame!, startup = a.startup!, active = a.active!, recovery = a.recovery!;
        const phase: Phase = frame <= startup ? 'startup' : frame <= startup + active ? 'active' : 'recovery';
        const clip: ClipId = a.type === 'special' ? `special.${a.kind}` as ClipId : a.airborne ? `air.${a.kind}` as ClipId : a.comboStage ? `ground.${a.comboStage}` as ClipId : a.kind === 'light' ? 'ground.light_1' : 'ground.heavy';
        return { clip, phase, offset: frame - 1 - (phase === 'startup' ? 0 : phase === 'active' ? startup : startup + active), duration: phase === 'startup' ? startup : phase === 'active' ? active : recovery };
    }
    if (a.type === 'block_startup')
        return { clip: 'block.startup', phase: 'loop', offset: (a.frame ?? 1) - 1, duration: f.defenseStartup };
    if (a.type === 'blocking')
        return { clip: 'block.hold', phase: 'loop', offset: c.age, loop: true };
    if (a.type === 'blockstun')
        return { clip: 'block.stun', phase: 'loop', offset: 0, duration: 1 };
    if (a.type === 'block_recovery')
        return { clip: 'block.release', phase: 'loop', offset: f.defenseRecovery - (a.remaining ?? f.defenseRecovery), duration: f.defenseRecovery };
    if (f.state === 'landing')
        return { clip: 'land', phase: 'loop', offset: f.landingDuration - f.landingRemaining, duration: f.landingDuration };
    if (f.state === 'jump')
        return { clip: c.airAge === 0 ? 'jump.takeoff' : Math.abs(f.vz) <= 30 ? 'jump.apex' : f.vz > 0 ? 'jump.ascent' : 'jump.descent', phase: 'loop', offset: c.age, loop: true };
    if (c.matchState === 'Match Over' && c.winner === f.id)
        return { clip: 'victory', phase: 'loop', offset: c.age, loop: true };
    return { clip: f.state === 'walk' ? 'move' : 'idle', phase: 'loop', offset: c.age, loop: true };
}
export function resolveAnimation(f: FighterSnapshot, c: AnimationContext, m: Readonly<CharacterManifest>) {
    const state = animationState(f, c), facing: Facing = f.action.facing ?? f.facing, direction = directionFor(m,state.clip,facing), clip = clipDefinition(m, state.clip);
    const frames = clip.directions![direction.source]![state.phase]!;
    const index = state.loop ? Math.floor(Math.max(0, state.offset) / clip.ticksPerFrame!) % frames.length : Math.min(frames.length - 1, Math.floor(Math.max(0, state.offset) * frames.length / Math.max(1, state.duration ?? 1)));
    const ground = projectArena(f.x, f.y);
    return { ...state, facing, mirror: direction.mirror, frame: frames[index], index, x: Math.round(ground.x), y: Math.round(ground.y - f.z), groundY: Math.round(ground.y), depth: ground.y, originX: m.pivot[0] / 64, originY: m.pivot[1] / 64, shadowScale: Math.max(.55, 1 - f.z / 250), hand: attachment(m, 'hand', facing,state.clip,frames[index]) };
}
