import { deepFreeze } from "./immutable";
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
    schemaVersion: 1 | 2;
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
        attachments?: Record<string, [
            number,
            number
        ]>;
    }>;
    directions: Record<Facing, {
        source: Facing;
        mirror: boolean;
    }>;
    attachments: Record<string, [
        number,
        number
    ]>;
    palette?: 'role' | 'native';
    directionOverrides?: Partial<Record<Facing, DirectionMapping>>;
    coverage?: Record<ClipId, Record<Facing, Coverage>>;
    animations: Record<ClipId, {
        alias?: ClipId;
        ticksPerFrame?: number;
        directions?: Partial<Record<Facing, Partial<Record<Phase, string[]>>>>;
        directionOverrides?: Partial<Record<Facing, DirectionMapping>>;
    }>;
}
export interface DirectionMapping {
    source: Facing;
    mirror: boolean;
}
export type CoverageKind = 'direct' | 'aliased' | 'held' | 'mirrored' | 'approximate';
export interface Coverage {
    kinds: CoverageKind[];
    verified: boolean;
    note: string;
}
export const DIRECTION_MAP = { n: { source: 'n', mirror: false }, ne: { source: 'ne', mirror: false }, e: { source: 'e', mirror: false }, se: { source: 'se', mirror: false }, s: { source: 's', mirror: false }, sw: { source: 'se', mirror: true }, w: { source: 'e', mirror: true }, nw: { source: 'ne', mirror: true } } as const;
const authored = ['n', 'ne', 'e', 'se', 's'] as const;
const relative = (s: unknown) => typeof s === 'string' && s.length > 0 && !s.startsWith('/') && !s.includes('..') && !s.includes(':') && !s.includes('\\') && !/[?#]/.test(s);
/** Runtime boundary: reject unsafe URLs, incomplete coverage and malformed atlas layouts. */
export function validateManifest(value: unknown): Readonly<CharacterManifest> {
    const m = value as CharacterManifest;
    if (!m || (m.schemaVersion !== 1 && m.schemaVersion !== 2) || typeof m.id !== 'string' || typeof m.version !== 'string' || typeof m.displayName !== 'string' || !/^[-a-z0-9]+$/.test(m.id) || !/^\d+\.\d+\.\d+$/.test(m.version) || !m.displayName || !relative(m.provenance) || JSON.stringify(m.frameSize) !== '[64,64]' || JSON.stringify(m.pivot) !== '[32,56]')
        throw Error('Invalid character header/pivot');
    if (Object.keys(m).some(k => !['schemaVersion', 'id', 'version', 'displayName', 'frameSize', 'pivot', 'provenance', 'pages', 'frames', 'directions', 'attachments', 'animations', ...(m.schemaVersion === 2 ? ['palette', 'directionOverrides', 'coverage'] : [])].includes(k)))
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
    if (m.schemaVersion === 2) {
        const cells = new Map<string, {
            page: string;
            x: number;
            y: number;
        }>();
        if (Object.keys(m.frames).some(k => ['__proto__', 'constructor', 'prototype'].includes(k)))
            throw Error('Unsafe frame name');
        if (Object.keys(m.frames).length > 4096)
            throw Error('Frame label budget exceeded');
        for (const f of Object.values(m.frames)) {
            const p = pages.get(f.page)!;
            if (f.x < 2 || f.y < 2 || f.x + 66 > p.width || f.y + 66 > p.height)
                throw Error('V2 requires two-pixel atlas padding');
            cells.set(`${f.page}:${f.x}:${f.y}`, f);
        }
        if (cells.size > 675)
            throw Error('Padded frame cell budget exceeded');
        const unique = [...cells.values()];
        for (let i = 0; i < unique.length; i++)
            for (let j = 0; j < i; j++)
                if (unique[i].page === unique[j].page && Math.abs(unique[i].x - unique[j].x) < 68 && Math.abs(unique[i].y - unique[j].y) < 68)
                    throw Error('Overlapping padded cells');
    }
    const attachments = [m.attachments, ...Object.values(m.frames).map(f => f.attachments ?? {})];
    if (m.schemaVersion === 1 && Object.values(m.frames).some(f => f.attachments))
        throw Error('Frame attachments require v2');
    for (const map of attachments)
        for (const [name, p] of Object.entries(map))
            if (!name || !Array.isArray(p) || p.length !== 2 || !p.every(n => Number.isFinite(n) && n >= 0 && n <= 64))
                throw Error('Invalid attachment');
    for (const d of DIRECTIONS) {
        const map = m.directions[d];
        if (!map || !DIRECTIONS.includes(map.source) || typeof map.mirror !== 'boolean' || (m.schemaVersion === 1 && (map.source !== DIRECTION_MAP[d].source || map.mirror !== DIRECTION_MAP[d].mirror)))
            throw Error('Missing direction ' + d);
    }
    if (m.schemaVersion === 2) {
        if (!['native', 'role'].includes(m.palette ?? '') || !m.coverage)
            throw Error('Missing v2 palette/coverage');
        validateOverrides(m.directionOverrides);
    }
    for (const key of Object.keys(CLIPS) as ClipId[]) {
        if (m.schemaVersion === 1 && m.animations[key]?.directionOverrides)
            throw Error('Clip overrides require v2');
        if (m.schemaVersion === 2) {
            validateOverrides(m.animations[key]?.directionOverrides);
            if (Object.keys(m.animations[key] ?? {}).some(k => !['alias', 'ticksPerFrame', 'directions', 'directionOverrides'].includes(k)))
                throw Error('Unknown animation field');
        }
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
        if (m.schemaVersion === 2)
            for (const baseline of authored)
                for (const phase of phases) {
                    const frames = clip.directions[baseline]?.[phase];
                    if (!Array.isArray(frames) || !frames.length || frames.some(f => !m.frames[f]))
                        throw Error('Missing baseline authored direction ' + baseline);
                }
        for (const d of (m.schemaVersion === 1 ? authored : DIRECTIONS))
            for (const phase of phases) {
                const mapping = directionFor(m, key, d);
                const frames = clip.directions[m.schemaVersion === 1 ? d : mapping.source]?.[phase];
                if (!Array.isArray(frames) || !frames.length || frames.length > 16 || frames.some(f => typeof f !== 'string' || !m.frames[f]))
                    throw Error('Invalid animation frames ' + key + '/' + d + '/' + phase);
                if (m.schemaVersion === 2) {
                    const c = m.coverage![key]?.[d];
                    if (!c || !Array.isArray(c.kinds) || !c.kinds.length || new Set(c.kinds).size !== c.kinds.length || c.kinds.some(k => !['direct', 'aliased', 'held', 'mirrored', 'approximate'].includes(k)) || typeof c.verified !== 'boolean' || typeof c.note !== 'string' || !c.note.trim())
                        throw Error('Missing coverage ' + key + '/' + d);
                    const expected = mapping.mirror ? ({ e: 'w', w: 'e', ne: 'nw', nw: 'ne', se: 'sw', sw: 'se', n: 'n', s: 's' } as const)[d] : d;
                    if (mapping.source !== expected && !c.kinds.includes('approximate'))
                        throw Error('Unreported approximate direction ' + key + '/' + d);
                    if (m.animations[key].alias && !c.kinds.includes('aliased') || mapping.mirror && !c.kinds.includes('mirrored') || frames.length === 1 && !c.kinds.includes('held'))
                        throw Error('Unreported alias/hold/mirror ' + key + '/' + d);
                }
            }
    }
    // Own the validated data; callers cannot mutate a manifest while it is being rendered.
    return deepFreeze(JSON.parse(JSON.stringify(m)));
}
export function clipDefinition(m: Readonly<CharacterManifest>, id: ClipId) {
    let c = m.animations[id];
    while (c.alias)
        c = m.animations[c.alias];
    return c;
}
function validateOverrides(overrides: unknown): void { if (overrides === undefined)
    return; if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
    throw Error('Invalid direction override'); for (const [key, value] of Object.entries(overrides)) {
    const map = value as DirectionMapping;
    if (!DIRECTIONS.includes(key as Facing) || !map || !DIRECTIONS.includes(map.source) || typeof map.mirror !== 'boolean' || Object.keys(map).some(k => !['source', 'mirror'].includes(k)))
        throw Error('Invalid direction override');
} }
export function directionFor(m: Readonly<CharacterManifest>, id: ClipId, facing: Facing): DirectionMapping { let clip = m.animations[id], override: DirectionMapping | undefined; while (clip) {
    override ??= clip.directionOverrides?.[facing];
    if (!clip.alias)
        break;
    clip = m.animations[clip.alias];
} return override ?? m.directionOverrides?.[facing] ?? m.directions[facing]; }
export function attachment(m: Readonly<CharacterManifest>, name: string, facing: Facing, id?: ClipId, frame?: string): [
    number,
    number
] { const p = (frame ? m.frames[frame]?.attachments?.[name] : undefined) ?? m.attachments[name] ?? m.pivot; const map = id ? directionFor(m, id, facing) : m.directionOverrides?.[facing] ?? m.directions[facing]; return [map.mirror ? 64 - p[0] : p[0], p[1]]; }
export function coverageReport(m: Readonly<CharacterManifest>) { return Object.fromEntries((Object.keys(CLIPS) as ClipId[]).map(id => [id, Object.fromEntries(DIRECTIONS.map(facing => { const map = directionFor(m, id, facing), clip = clipDefinition(m, id), phases = CLIPS[id].length === 3 ? ['startup', 'active', 'recovery'] as const : ['loop'] as const; return [facing, { ...map, frameCounts: Object.fromEntries(phases.map(p => [p, clip.directions![map.source]![p]!.length])), sequences: Object.fromEntries(phases.map(p => [p, [...clip.directions![map.source]![p]!]])), ...(m.schemaVersion === 2 ? m.coverage![id][facing] : { kinds: [...(m.animations[id].alias ? ['aliased'] : ['direct']), ...(map.mirror ? ['mirrored'] : []), ...(phases.some(p => clip.directions![map.source]![p]!.length === 1) ? ['held'] : [])], verified: false, note: 'Legacy v1 coverage inferred; source audit not provided' }) }]; }))])); }
