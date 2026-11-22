import { validateManifest, type CharacterManifest } from '../presentation/manifest';
export const PRIVATE_LIMIT = 1572864;
export interface SelectedFile {
    readonly name: string;
    readonly size: number;
    readonly type: string;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}
export interface PreparedPackage {
    manifest: Readonly<CharacterManifest>;
    pages: ReadonlyMap<string, SelectedFile>;
    resources: {
        compressedBytes: number;
        decodedBytes: number;
        targetExceeded: boolean;
    };
    provenance: {
        rightsHolder: string;
        source: string;
        permissionBasis: string;
        redistribution: string;
    };
}
const basename = (s: string) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(s) && !s.includes('..');
/** File-map provider only: deliberately has no fetch, filesystem, storage or analytics dependency. */
export async function prepareLocalPackage(selected: readonly SelectedFile[], signal: AbortSignal): Promise<PreparedPackage> {
    const check = () => { if (signal.aborted)
        throw Error('Package load canceled'); };
    check();
    if (selected.length < 3 || selected.length > 7 || new Set(selected.map(f => f.name)).size !== selected.length || selected.some(f => !basename(f.name) || f.size < 0 || !Number.isSafeInteger(f.size)))
        throw Error('Select a unique manifest, PNG pages and provenance');
    const bytes = selected.reduce((n, f) => n + f.size, 0);
    if (bytes > PRIVATE_LIMIT)
        throw Error('Package exceeds 1.5 MiB; no frames discarded');
    const files = new Map(selected.map(f => [f.name, f])), file = files.get('manifest.json');
    if (!file)
        throw Error('manifest.json is required');
    const manifest = validateManifest(JSON.parse(await file.text()));
    check();
    if (manifest.schemaVersion !== 2)
        throw Error('Local packages require manifest v2 and explicit coverage');
    if (!basename(manifest.provenance))
        throw Error('Provenance must be a selected basename');
    const pfile = files.get(manifest.provenance);
    if (!pfile)
        throw Error('Selected provenance is required');
    const p = JSON.parse(await pfile.text());
    check();
    if (!p || !['rightsHolder', 'source', 'permissionBasis'].every(k => typeof p[k] === 'string' && p[k].trim()) || !['restricted-local', 'original-fixture'].includes(p.redistribution))
        throw Error('Provenance declaration is incomplete');
    const pages = new Map<string, SelectedFile>();
    let decoded = 0;
    for (const page of manifest.pages) {
        check();
        if (!basename(page.image) || !page.image.toLowerCase().endsWith('.png'))
            throw Error('Atlas must reference a selected PNG basename');
        const image = files.get(page.image);
        if (!image)
            throw Error('Selected PNG page is missing');
        const data = new Uint8Array(await image.arrayBuffer());
        check();
        if (data.length < 33 || [137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => data[i] !== b))
            throw Error('Invalid PNG signature');
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        if (view.getUint32(16) !== page.width || view.getUint32(20) !== page.height)
            throw Error('PNG dimensions do not match manifest');
        decoded += page.width * page.height * 4;
        pages.set(page.id, image);
    }
    if (decoded > 12 * 1024 * 1024)
        throw Error('Decoded texture budget exceeds 12 MiB');
    const expected = new Set(['manifest.json', manifest.provenance, 'coverage-report.json', ...manifest.pages.map(p => p.image)]);
    if (selected.some(f => !expected.has(f.name)))
        throw Error('Unrecognized package file');
    return { manifest, pages, resources: { compressedBytes: bytes, decodedBytes: decoded, targetExceeded: bytes > 1048576 }, provenance: { rightsHolder: p.rightsHolder, source: p.source, permissionBasis: p.permissionBasis, redistribution: p.redistribution } };
}
