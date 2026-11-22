import { validateManifest, coverageReport, type CharacterManifest } from './manifest';
export interface RgbaImage {
    width: number;
    height: number;
    rgba: Uint8Array;
}
export interface SourceFrame {
    source: string;
    rect: [
        number,
        number,
        number,
        number
    ];
    root: [
        number,
        number
    ];
    attachments?: Record<string, [
        number,
        number
    ]>;
}
export interface NormalizationRecipe {
    schemaVersion: 1;
    character: Omit<CharacterManifest, 'schemaVersion' | 'frameSize' | 'pivot' | 'pages' | 'frames'>;
    frames: Record<string, SourceFrame>;
}
export interface FrameMeasurement {
    id: string;
    rect: number[];
    root: number[];
    opaqueBounds: number[] | null;
    normalizedBounds: number[] | null;
    fits: boolean;
    duplicateOf?: string;
}
export class NormalizationError extends Error {
    constructor(message: string, readonly report: {
        status: 'rejected';
        frames: FrameMeasurement[];
        issues: string[];
    }) { super(message); }
}
/** Pure conversion. Only explicit root translation is permitted: no scaling, clipping, centering or palette changes. */
export function normalizeFrames(recipe: NormalizationRecipe, sources: Readonly<Record<string, RgbaImage>>) {
    const measurements: FrameMeasurement[] = [], issues: string[] = [], images = new Map<string, Uint8Array>();
    if (!recipe || recipe.schemaVersion !== 1 || !recipe.frames || !Object.keys(recipe.frames).length)
        throw Error('Invalid normalization recipe');
    for (const id of Object.keys(recipe.frames).sort()) {
        const f = recipe.frames[id], src = sources[f.source];
        if (!src || !Number.isInteger(src.width) || !Number.isInteger(src.height) || src.width < 1 || src.height < 1 || src.width * src.height > 16777216 || src.rgba.length !== src.width * src.height * 4)
            throw Error('Missing/invalid source image: ' + f.source);
        if (!Array.isArray(f.rect) || f.rect.length !== 4 || !f.rect.every(Number.isInteger) || !Array.isArray(f.root) || f.root.length !== 2 || !f.root.every(Number.isInteger))
            throw Error('Explicit rectangle and integer semantic root required: ' + id);
        const [x, y, w, h] = f.rect, [ax, ay] = f.root;
        if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > src.width || y + h > src.height || Math.abs(ax) > 4096 || Math.abs(ay) > 4096)
            throw Error('Invalid source rectangle/root: ' + id);
        const pixels = new Uint8Array(64 * 64 * 4);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let fits = true;
        for (let sy = 0; sy < h; sy++)
            for (let sx = 0; sx < w; sx++) {
                const at = ((y + sy) * src.width + x + sx) * 4;
                if (!src.rgba[at + 3])
                    continue;
                const dx = sx - ax + 32, dy = sy - ay + 56;
                minX = Math.min(minX, sx);
                minY = Math.min(minY, sy);
                maxX = Math.max(maxX, sx);
                maxY = Math.max(maxY, sy);
                if (dx < 0 || dy < 0 || dx >= 64 || dy >= 64) {
                    fits = false;
                    continue;
                }
                pixels.set(src.rgba.subarray(at, at + 4), (dy * 64 + dx) * 4);
            }
        const measurement = { id, rect: [...f.rect], root: [...f.root], opaqueBounds: minX === Infinity ? null : [minX, minY, maxX, maxY], normalizedBounds: minX === Infinity ? null : [minX - ax + 32, minY - ay + 56, maxX - ax + 32, maxY - ay + 56], fits };
        measurements.push(measurement);
        if (!fits)
            issues.push('Out-of-bounds body pose: ' + id);
        images.set(id, pixels);
    }
    if (issues.length)
        throw new NormalizationError('Body poses do not fit the approved envelope', { status: 'rejected', frames: measurements, issues });
    // Hash buckets plus byte equality make deduplication deterministic and collision safe.
    const unique: {
        id: string;
        pixels: Uint8Array;
    }[] = [], buckets = new Map<number, number[]>(), indices = new Map<string, number>();
    for (const [id, pixels] of images) {
        let hash = 2166136261;
        for (const byte of pixels)
            hash = Math.imul(hash ^ byte, 16777619) >>> 0;
        const candidates = buckets.get(hash) ?? [];
        let index = candidates.find(i => unique[i].pixels.every((b, n) => b === pixels[n]));
        if (index === undefined) {
            index = unique.length;
            unique.push({ id, pixels });
            candidates.push(index);
            buckets.set(hash, candidates);
        }
        else
            measurements.find(m => m.id === id)!.duplicateOf = unique[index].id;
        indices.set(id, index);
    }
    if (unique.length > 675)
        throw new NormalizationError('Padded frame budget exceeded', { status: 'rejected', frames: measurements, issues: [`${unique.length} unique cells exceeds 675; no poses discarded`] });
    const pages: RgbaImage[] = Array.from({ length: Math.ceil(unique.length / 225) }, (_, i) => { const count = Math.min(225, unique.length - i * 225), width = Math.min(15, count) * 68, height = Math.ceil(count / 15) * 68; return { width, height, rgba: new Uint8Array(width * height * 4) }; });
    const frames: CharacterManifest['frames'] = {};
    unique.forEach(({ pixels }, index) => { const page = pages[Math.floor(index / 225)], cell = index % 225, x = cell % 15 * 68 + 2, y = Math.floor(cell / 15) * 68 + 2; for (let row = 0; row < 64; row++)
        page.rgba.set(pixels.subarray(row * 256, (row + 1) * 256), ((y + row) * page.width + x) * 4); });
    for (const [id, index] of indices) {
        const f = recipe.frames[id], cell = index % 225;
        const attachments = f.attachments ? Object.fromEntries(Object.entries(f.attachments).map(([name, [x, y]]) => [name, [x - f.root[0] + 32, y - f.root[1] + 56] as [
                number,
                number
            ]])) : undefined;
        frames[id] = { page: 'page-' + Math.floor(index / 225), x: cell % 15 * 68 + 2, y: Math.floor(cell / 15) * 68 + 2, width: 64, height: 64, trimmed: false, rotated: false, ...(attachments ? { attachments } : {}) };
    }
    const manifest = validateManifest({ ...recipe.character, schemaVersion: 2, frameSize: [64, 64], pivot: [32, 56], frames, pages: pages.map((p, i) => ({ id: 'page-' + i, image: `atlas-${i}.png`, width: p.width, height: p.height })) });
    return { manifest, pages, report: { schemaVersion: 1, status: 'normalized', frames: measurements, sourceFrames: measurements.length, uniqueFrames: unique.length, decodedBytes: pages.reduce((n, p) => n + p.rgba.length, 0), coverage: coverageReport(manifest) } };
}
