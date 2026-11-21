import {deepFreeze} from "./immutable";
import { DIRECTIONS, type Facing } from '../core/movement';
export const CLIPS = {
    'idle': [4], 'move': [6], 'jump.takeoff': [1], 'jump.ascent': [2], 'jump.apex': [1], 'jump.descent': [2], 'land': [2],
    'ground.light_1': [2, 1, 2], 'ground.light_2': [2, 1, 2], 'ground.light_3': [3, 1, 3], 'ground.heavy': [3, 2, 4], 'ground.finisher': [3, 2, 4],
    'air.light': [3, 2, 3], 'air.heavy': [3, 2, 4], 'block.startup': [2], 'block.hold': [2], 'block.stun': [1], 'block.release': [2],
    'guard.break': [2], 'guard.recover': [2], 'hit.react': [2], 'hit.stun': [2], 'knockback': [2],
    'special.power': [4, 2, 4], 'special.dash': [3, 2, 4], 'special.projectile': [4, 1, 4], 'ko': [4], 'victory': [4],
} as const;
export type ClipId = keyof typeof CLIPS;
export type AuthoredDirection = 'n' | 'ne' | 'e' | 'se' | 's';
export type Phase = 'loop' | 'startup' | 'active' | 'recovery';
export interface CharacterManifest {
    schemaVersion: 1;
    id: string;
    version: string;
    displayName: string;
    frameSize: [
        64,
        64
    ];
    pivot: [
        32,
        56
    ];
    provenance: string;
    pages: {
        id: string;
        image: string;
        width: number;
        height: number;
    }[];
    frames: Record<string, {
        page: string;
        x: number;
        y: number;
        width: 64;
        height: 64;
        trimmed: false;
        rotated: false;
    }>;
    directions: Record<Facing, {
        source: AuthoredDirection;
        mirror: boolean;
    }>;
    attachments: Record<string, [
        number,
        number
    ]>;
    animations: Record<ClipId, {
        alias?: ClipId;
        ticksPerFrame?: number;
        directions?: Partial<Record<AuthoredDirection, Partial<Record<Phase, string[]>>>>;
    }>;
}
export const DIRECTION_MAP = { n: { source: 'n', mirror: false }, ne: { source: 'ne', mirror: false }, e: { source: 'e', mirror: false }, se: { source: 'se', mirror: false }, s: { source: 's', mirror: false }, sw: { source: 'se', mirror: true }, w: { source: 'e', mirror: true }, nw: { source: 'ne', mirror: true } } as const;
const authored = ['n', 'ne', 'e', 'se', 's'] as const;
const relative = (s: unknown) => typeof s === 'string' && s.length > 0 && !s.startsWith('/') && !s.includes('..') && !s.includes(':') && !s.includes('\\') && !/[?#]/.test(s);
/** Runtime boundary: reject unsafe URLs, incomplete coverage and malformed atlas layouts. */
export function validateManifest(value: unknown): Readonly<CharacterManifest> {
    const m = value as CharacterManifest;
    if (!m || m.schemaVersion !== 1 || typeof m.id !== 'string' || typeof m.version !== 'string' || typeof m.displayName !== 'string' || !/^[-a-z0-9]+$/.test(m.id) || !/^\d+\.\d+\.\d+$/.test(m.version) || !m.displayName || !relative(m.provenance) || JSON.stringify(m.frameSize) !== '[64,64]' || JSON.stringify(m.pivot) !== '[32,56]')
        throw Error('Invalid character header/pivot');
    if (Object.keys(m).some(k => !['schemaVersion', 'id', 'version', 'displayName', 'frameSize', 'pivot', 'provenance', 'pages', 'frames', 'directions', 'attachments', 'animations'].includes(k)))
        throw Error('Unknown manifest field');
    if (!Array.isArray(m.pages) || m.pages.length < 1 || m.pages.length > 3)
        throw Error('Invalid atlas page count');
    const pages = new Map(m.pages.map(p => [p.id, p]));
    if (pages.size !== m.pages.length)
        throw Error('Duplicate atlas page');
    for (const p of m.pages)
        if (!p.id || !relative(p.image) || ![p.width, p.height].every(n => Number.isInteger(n) && n >= 64 && n <= 1024))
            throw Error('Invalid atlas page');
    if (!m.frames || !Object.keys(m.frames).length || !m.animations || !m.directions || !m.attachments)
        throw Error('Missing character sections');
    for (const f of Object.values(m.frames)) {
        const p = pages.get(f.page);
        if (!p || f.width !== 64 || f.height !== 64 || f.trimmed !== false || f.rotated !== false || ![f.x, f.y].every(n => Number.isInteger(n) && n >= 0) || f.x + 64 > p.width || f.y + 64 > p.height)
            throw Error('Invalid atlas rectangle');
    }
    for (const [name, p] of Object.entries(m.attachments))
        if (!name || !Array.isArray(p) || p.length !== 2 || !p.every(n => Number.isFinite(n) && n >= 0 && n <= 64))
            throw Error('Invalid attachment');
    for (const d of DIRECTIONS) {
        const map = m.directions[d];
        if (!map || !authored.includes(map.source) || typeof map.mirror !== 'boolean' || map.source !== DIRECTION_MAP[d].source || map.mirror !== DIRECTION_MAP[d].mirror)
            throw Error('Missing direction ' + d);
    }
    for (const key of Object.keys(CLIPS) as ClipId[]) {
        let clip = m.animations[key];
        const seen = new Set<string>([key]);
        while (clip?.alias) {
            if (seen.has(clip.alias) || !(clip.alias in CLIPS))
                throw Error('Animation alias cycle');
            seen.add(clip.alias);
            clip = m.animations[clip.alias];
        }
        if (!clip?.directions || !Number.isInteger(clip.ticksPerFrame) || clip.ticksPerFrame! < 1 || clip.ticksPerFrame! > 60)
            throw Error('Missing animation ' + key);
        const phases: Phase[] = CLIPS[key].length === 3 ? ['startup', 'active', 'recovery'] : ['loop'];
        for (const d of authored)
            for (const phase of phases) {
                const frames = clip.directions[d]?.[phase];
                if (!Array.isArray(frames) || !frames.length || frames.length > 16 || frames.some(f => typeof f !== 'string' || !m.frames[f]))
                    throw Error('Invalid animation frames ' + key + '/' + d + '/' + phase);
            }
    }
    // Own the validated data; callers cannot mutate a manifest while it is being rendered.
    return deepFreeze(JSON.parse(JSON.stringify(m)));
}
export function clipDefinition(m: Readonly<CharacterManifest>, id: ClipId) { let c = m.animations[id]; while (c.alias)
    c = m.animations[c.alias]; return c; }
export function attachment(m: Readonly<CharacterManifest>, name: string, facing: Facing): [
    number,
    number
] { const p = m.attachments[name] ?? m.pivot; return [m.directions[facing].mirror ? 64 - p[0] : p[0], p[1]]; }
