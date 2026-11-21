import type { CombatFighter, AcceptedAttack, HitEvent } from '../core/combat';
import type { Facing, MovementState } from '../core/movement';
import type { MatchState } from '../core/match';
import type { CombatState } from '../core/projectiles';
import { deepFreeze } from './immutable';
export interface FighterSnapshot {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly vz: number;
    readonly facing: Facing;
    readonly state: MovementState;
    readonly defenseStartup: number;
    readonly defenseRecovery: number;
    readonly landingDuration: number;
    readonly health: number;
    readonly landingRemaining: number;
    readonly knockbackX: number;
    readonly knockbackY: number;
    readonly guardBreak: number;
    readonly action: {
        readonly type: CombatFighter['action']['type'];
        readonly id?: string;
        readonly frame?: number;
        readonly facing?: Facing;
        readonly kind?: string;
        readonly comboStage?: string;
        readonly airborne?: boolean;
        readonly remaining?: number;
        readonly startup?: number;
        readonly active?: number;
        readonly recovery?: number;
    };
}
export interface PresentationSnapshot {
    readonly resetVersion: number;
    readonly state: MatchState;
    readonly winner?: 'P1' | 'P2';
    readonly paused: boolean;
    readonly tick: number;
    readonly fighters: readonly FighterSnapshot[];
    readonly projectiles: readonly ProjectileSnapshot[];
}
export interface ProjectileSnapshot {
    readonly id: string;
    readonly ownerId: string;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly dx: number;
    readonly dy: number;
    readonly bornTick: number;
}
export type PresentationEvent = {
    readonly type: 'accepted';
    readonly attack: AcceptedAttack;
    readonly tick: number;
} | {
    readonly type: 'contact';
    readonly hit: Readonly<HitEvent>;
    readonly tick: number;
} | {
    readonly type: 'projectile';
    readonly projectile: ProjectileSnapshot;
    readonly tick: number;
} | {
    readonly type: 'ko';
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly z: number;
} | {
    readonly type: 'lifecycle';
    readonly state: MatchState;
    readonly resetVersion: number;
    readonly paused: boolean;
};
export interface PresentationSink {
    onEvent(event: PresentationEvent): void;
    onFrame(snapshot: PresentationSnapshot): void;
}
/** A failing presentation consumer cannot abort a simulation transaction. No references to fighters cross this port. */
export function notify(sink: PresentationSink | undefined, event: PresentationEvent): void { if (sink)
    try {
        sink.onEvent(deepFreeze(event));
    }
    catch { /* detached presentation failure; simulation continues */ } }
export function fighterSnapshot(f: CombatFighter): FighterSnapshot {
    const a = f.action;
    const action: FighterSnapshot['action'] = a.type === 'attack' ? { type: a.type, id: a.instanceId, frame: a.frame, facing: a.facing, kind: a.kind, comboStage: a.comboStage, airborne: a.airborne, startup: a.stats.startup, active: a.stats.active, recovery: a.stats.recovery } : a.type === 'special' ? { type: a.type, id: a.instanceId, frame: a.frame, facing: a.facing, kind: a.id, startup: a.definition.startup, active: a.definition.active, recovery: a.definition.recovery } : { type: a.type, ...('frame' in a ? { frame: a.frame } : {}), ...('remaining' in a ? { remaining: a.remaining } : {}) };
    return { id: f.id, x: f.x, y: f.y, z: f.z, vz: f.vz, facing: f.facing, state: f.state, defenseStartup: f.stats.defense?.startup ?? 3, defenseRecovery: f.stats.defense?.recovery ?? 6, landingDuration: f.stats.movement.landingFrames, health: f.health, landingRemaining: f.landingRemaining, knockbackX: f.knockbackX, knockbackY: f.knockbackY, guardBreak: f.guard.breakRemaining, action };
}
export function snapshotMatch(m: {
    resetVersion: number;
    state: MatchState;
    winner?: 'P1' | 'P2';
    paused: boolean;
    fighters: readonly CombatFighter[];
    combat: CombatState;
}): PresentationSnapshot {
    return deepFreeze({ resetVersion: m.resetVersion, state: m.state, winner: m.winner, paused: m.paused, tick: m.combat.tick, fighters: m.fighters.map(fighterSnapshot), projectiles: m.combat.projectiles.map(p => ({ id: p.id, ownerId: p.ownerId, x: p.x, y: p.y, z: p.z, dx: p.direction.x, dy: p.direction.y, bornTick: p.bornTick })) });
}
