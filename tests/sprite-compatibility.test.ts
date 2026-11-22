import { describe, it, expect } from 'vitest';
import legacyJson from '../public/assets/characters/synthetic/v1/manifest.json';
import { CLIPS, DIRECTION_MAP, validateManifest, directionFor, attachment, coverageReport, type CharacterManifest, type ClipId } from '../src/presentation/manifest';
import { normalizeFrames, NormalizationError, type NormalizationRecipe } from '../src/presentation/normalize';
import { resolveAnimation } from '../src/presentation/resolver';
import { fighterSnapshot } from '../src/presentation/snapshot';
import { createCombatFighter } from '../src/core/combat';
import { DIRECTIONS, type Facing } from '../src/core/movement';
import { prepareLocalPackage, type SelectedFile } from '../src/local-assets/package';
import { decodePng, encodePng } from '../scripts/lib/png.mjs';
function recipe() {
    const m = structuredClone(legacyJson) as unknown as CharacterManifest;
    m.schemaVersion = 2;
    m.palette = 'native';
    m.coverage = {} as NonNullable<CharacterManifest['coverage']>;
    m.frames = {};
    const frame = { source: 'source.png', rect: [0, 0, 12, 12] as [
            number,
            number,
            number,
            number
        ], root: [6, 10] as [
            number,
            number
        ], attachments: { hand: [8, 4] as [
                number,
                number
            ] } };
    for (const id of Object.keys(CLIPS) as ClipId[]) {
        m.coverage[id] = {} as any;
        for (const d of DIRECTIONS)
            m.coverage[id][d] = { kinds: ['direct', 'held', ...(DIRECTION_MAP[d].mirror ? ['mirrored' as const] : []), ...(id === 'ground.finisher' ? ['aliased' as const] : [])], verified: true, note: 'Original synthetic fixture' };
        let c = m.animations[id];
        if (c.alias)
            continue;
        for (const d of ['n', 'ne', 'e', 'se', 's'] as const)
            for (const p of Object.keys(c.directions![d]!) as ('loop' | 'startup' | 'active' | 'recovery')[])
                c.directions![d]![p] = c.directions![d]![p]!.map(() => d);
    }
    const { schemaVersion, frameSize, pivot, pages, frames, ...character } = m;
    return { schemaVersion: 1, character, frames: Object.fromEntries(['n', 'ne', 'e', 'se', 's'].map(d => [d, structuredClone(frame)])) } as NormalizationRecipe;
}
function source() { const rgba = new Uint8Array(12 * 12 * 4); rgba.set([255, 255, 255, 255], (2 * 12 + 2) * 4); rgba.set([17, 93, 211, 128], (4 * 12 + 4) * 4); return { width: 12, height: 12, rgba }; }
const build = () => normalizeFrames(recipe(), { 'source.png': source() });
function file(name: string, bytes: Uint8Array): SelectedFile { return { name, size: bytes.length, type: '', text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => Uint8Array.from(bytes).buffer }; }
function selected() { const result = build(), json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)); return [file('manifest.json', json(result.manifest)), file('provenance.json', json({ rightsHolder: 'Original fixture', source: 'Generated', permissionBasis: 'CC0-1.0', redistribution: 'original-fixture' })), ...result.pages.map((p, i) => file(`atlas-${i}.png`, encodePng(p)))]; }
describe('v1/v2 compatibility and reporting', () => {
    it('keeps v1 immutable and rejects v2-only fields in v1', () => { const v1 = validateManifest(legacyJson); expect(v1.schemaVersion).toBe(1); expect(v1.directions).toEqual(legacyJson.directions); expect(() => validateManifest({ ...legacyJson, palette: 'native' })).toThrow(); });
    it.each(DIRECTIONS)('%s default direction and per-frame attachments preserve the pivot', d => { const m = build().manifest; expect(directionFor(m, 'idle', d)).toEqual(DIRECTION_MAP[d]); expect(attachment(m, 'hand', d, 'idle', DIRECTION_MAP[d].source)).toEqual([DIRECTION_MAP[d].mirror ? 30 : 34, 50]); expect(m.pivot).toEqual([32, 56]); });
    it('supports character overrides and animation overrides with explicit frame directions', () => {
        const m = structuredClone(build().manifest) as CharacterManifest;
        m.animations.idle.directions!.w = m.animations.idle.directions!.e;
        m.directionOverrides = { w: { source: 'w', mirror: false } };
        expect(() => validateManifest(m)).toThrow();
        for (const c of Object.values(m.animations))
            if (c.directions)
                c.directions.w = c.directions.e;
        const validated = validateManifest(m);
        expect(directionFor(validated, 'idle', 'w')).toEqual({ source: 'w', mirror: false });
        // Character overrides apply to every clip: all other clips also need the authored source.
    });
    it('animation overrides take precedence without altering unrelated directions', () => { const m = structuredClone(build().manifest) as CharacterManifest; m.animations.idle.directionOverrides = { w: { source: 'w', mirror: false } }; m.animations.idle.directions!.w = m.animations.idle.directions!.e; expect(directionFor(validateManifest(m), 'idle', 'w')).toEqual({ source: 'w', mirror: false }); expect(directionFor(validateManifest(m), 'move', 'w')).toEqual(DIRECTION_MAP.w); });
    it.each(['coverage', 'hold', 'alias', 'mirror', 'approximate', 'palette', 'statistics', 'missingFrame', 'missingDirection', 'invalidAttachment'] as const)('rejects invalid/unreported %s', kind => {
        const m = structuredClone(build().manifest) as any;
        if (kind === 'coverage')
            delete m.coverage.idle.n;
        if (kind === 'hold')
            m.coverage['block.stun'].n.kinds = ['direct'];
        if (kind === 'alias')
            m.coverage['ground.finisher'].n.kinds = ['direct', 'held'];
        if (kind === 'mirror')
            m.coverage.idle.w.kinds = ['direct', 'held'];
        if (kind === 'approximate')
            m.animations.idle.directionOverrides = { n: { source: 'e', mirror: false } };
        if (kind === 'palette')
            m.palette = 'automatic';
        if (kind === 'statistics')
            m.damage = 999;
        if (kind === 'missingFrame')
            m.animations.idle.directions.n.loop = ['missing'];
        if (kind === 'missingDirection')
            delete m.animations.idle.directions.n;
        if (kind === 'invalidAttachment')
            m.frames.n.attachments.hand = [-1, 99];
        expect(() => validateManifest(m)).toThrow();
    });
    it('reports all 28 states and eight headings, including aliases, holds and mirrors', () => { const report = coverageReport(build().manifest); expect(Object.keys(report)).toHaveLength(28); for (const row of Object.values(report))
        expect(Object.keys(row)).toHaveLength(8); expect(report['ground.finisher'].w.kinds).toEqual(expect.arrayContaining(['aliased', 'held', 'mirrored'])); });
    it('does not change authoritative pose timing or frame count semantics', () => { const f = createCombatFighter('P1', 0, 0, 'w'), m = build().manifest, context = { clock: 0, age: 0, airAge: 0, hitAge: 0, matchState: 'Fighting' }; expect(resolveAnimation(fighterSnapshot(f), context, m)).toMatchObject({ clip: 'idle', mirror: true, originX: .5, originY: .875 }); });
});
describe('deterministic normalization', () => {
    it('uses explicit roots, preserves white/partial-alpha colors, padding and attachment coordinates', () => { const result = build(), frame = result.manifest.frames.n, page = result.pages[0]; const pixel = (x: number, y: number) => [...page.rgba.slice(((frame.y + y) * page.width + frame.x + x) * 4, ((frame.y + y) * page.width + frame.x + x) * 4 + 4)]; expect(pixel(28, 48)).toEqual([255, 255, 255, 255]); expect(pixel(30, 50)).toEqual([17, 93, 211, 128]); expect(pixel(0, 0)).toEqual([0, 0, 0, 0]); expect(result.manifest.frames.n.attachments!.hand).toEqual([34, 50]); expect(frame).toMatchObject({ x: 2, y: 2, width: 64, height: 64, trimmed: false, rotated: false }); });
    it('deduplicates exact normalized pixels without discarding mapping or mutating inputs', () => { const r = recipe(), image = source(), before = structuredClone([r, image]); const a = normalizeFrames(r, { 'source.png': image }), b = normalizeFrames(r, { 'source.png': image }); expect(a).toEqual(b); expect(a.report.uniqueFrames).toBe(1); expect(Object.keys(a.manifest.frames)).toHaveLength(5); expect([r, image]).toEqual(before); });
    it.each([[100, 10], [6, 100], [-100, 10], [6, -100]])('rejects out-of-bounds root %j and returns measured exceptions', (x, y) => { const r = recipe(); r.frames.n.root = [x, y]; try {
        normalizeFrames(r, { 'source.png': source() });
        throw Error('expected reject');
    }
    catch (e) {
        expect(e).toBeInstanceOf(NormalizationError);
        expect((e as NormalizationError).report.status).toBe('rejected');
        expect((e as NormalizationError).report.frames.find(f => f.id === 'n')?.fits).toBe(false);
    } });
    it('does not infer or repair invalid rectangles', () => { const r = recipe(); r.frames.n.rect = [0, 0, 13, 12]; expect(() => normalizeFrames(r, { 'source.png': source() })).toThrow(/rectangle/); });
    it('roundtrips PNG RGBA bytes without recoloring', () => { const image = source(), png = encodePng(image); expect(decodePng(png)).toEqual(image); expect(encodePng(image)).toEqual(png); });
    it('rejects corrupt PNG rather than silently recovering', () => { const png = encodePng(source()); png[png.length - 5] ^= 1; expect(() => decodePng(png)).toThrow(); });
});
describe('selected-file provider', () => {
    it('loads only selected bytes with no network or persistence and preserves native palette metadata', async () => { const p = await prepareLocalPackage(selected(), new AbortController().signal); expect(p.manifest.palette).toBe('native'); expect(p.pages.size).toBe(1); expect(p.resources.decodedBytes).toBeLessThan(12 * 1024 * 1024); });
    it.each(['missing', 'duplicate', 'url', 'oversize', 'provenance', 'png'] as const)('rejects %s package', async (kind) => { let files = selected(); if (kind === 'missing')
        files.pop(); if (kind === 'duplicate')
        files.push(files[0]); if (kind === 'oversize')
        files[0] = { ...files[0], size: 1572865 }; if (kind === 'url')
        files[0] = { ...files[0], name: '../manifest.json' }; if (kind === 'provenance')
        files[1] = file('provenance.json', new TextEncoder().encode('{}')); if (kind === 'png')
        files[2] = file('atlas-0.png', new Uint8Array([1, 2, 3])); await expect(prepareLocalPackage(files, new AbortController().signal)).rejects.toThrow(); });
    it('supports cancellation before or during asynchronous file reads', async () => { const c = new AbortController(); c.abort(); await expect(prepareLocalPackage(selected(), c.signal)).rejects.toThrow(/canceled/); const d = new AbortController(), files = selected(), read = files[0].text; files[0] = { ...files[0], text: async () => { d.abort(); return read(); } }; await expect(prepareLocalPackage(files, d.signal)).rejects.toThrow(/canceled/); });
});
describe('padded atlas resource boundaries', () => {
    function many(count: number) { const r = recipe(), rgba = new Uint8Array(count * 4); for (let i = 0; i < count; i++) {
        rgba.set([i & 255, (i >>> 8) & 255, 123, 255], i * 4);
        r.frames['cell-' + i] = { source: 'many.png', rect: [i, 0, 1, 1], root: [0, 0] };
    } return { r, sources: { 'source.png': source(), 'many.png': { width: count, height: 1, rgba } } }; }
    it('packs all 675 unique cells into three bounded padded pages without dropping aliases', () => { const { r, sources } = many(674), result = normalizeFrames(r, sources); expect(result.report.uniqueFrames).toBe(675); expect(result.pages.length).toBe(3); expect(result.pages.every(p => p.width <= 1024 && p.height <= 1024)).toBe(true); expect(result.report.decodedBytes).toBeLessThanOrEqual(12 * 1024 * 1024); expect(Object.keys(result.manifest.frames)).toHaveLength(679); });
    it('rejects 676 unique cells and reports the exception rather than discarding poses', () => { const { r, sources } = many(675); expect(() => normalizeFrames(r, sources)).toThrow(/budget/); });
});
