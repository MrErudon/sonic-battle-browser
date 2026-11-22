import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { decodePng } from '../scripts/lib/png.mjs';
import { checkArtifacts, checkReleaseInputs } from '../scripts/release-inventory.mjs';
function png(color, depth, width, height, scan, palette, alpha) {
    const crc = (b) => { let c = 0xffffffff; for (const n of b) {
        c ^= n;
        for (let j = 0; j < 8; j++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    } return (c ^ 0xffffffff) >>> 0; };
    const chunk = (name, data) => { const body = Buffer.concat([Buffer.from(name), data]), n = Buffer.alloc(4), tail = Buffer.alloc(4); n.writeUInt32BE(data.length); tail.writeUInt32BE(crc(body)); return Buffer.concat([n, body, tail]); };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = depth;
    header[9] = color;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...(palette ? [chunk('PLTE', Buffer.from(palette))] : []), ...(alpha ? [chunk('tRNS', Buffer.from(alpha))] : []), chunk('IDAT', deflateSync(Buffer.from(scan))), chunk('IEND', new Uint8Array())]);
}
describe('offline PNG source conversion', () => {
    it.each([1, 2, 4, 8])('preserves indexed %i-bit palette and transparent index', depth => { const indices = depth === 8 ? [0, 1] : [1 << (8 - 2 * depth)], data = png(3, depth, 2, 1, [0, ...indices], [255, 255, 255, 17, 93, 211], [0, 128]); expect([...decodePng(data).rgba]).toEqual([255, 255, 255, 0, 17, 93, 211, 128]); });
    it('preserves RGB transparency key and grayscale alpha', () => { expect([...decodePng(png(2, 8, 1, 1, [0, 17, 93, 211], undefined, [0, 17, 0, 93, 0, 211])).rgba]).toEqual([17, 93, 211, 0]); expect([...decodePng(png(4, 8, 1, 1, [0, 71, 128])).rgba]).toEqual([71, 71, 71, 128]); });
    it.each([0, 1, 2, 3, 4])('decodes PNG filter %i without modifying color channels', filter => { const rows = [[17, 93, 211, 255, 255, 255], [21, 99, 201, 250, 245, 240]], encoded = []; const paeth = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; }; for (let y = 0; y < 2; y++) {
        encoded.push(filter);
        for (let x = 0; x < 6; x++) {
            const a = x >= 3 ? rows[y][x - 3] : 0, b = y ? rows[y - 1][x] : 0, c = y && x >= 3 ? rows[y - 1][x - 3] : 0;
            encoded.push((rows[y][x] - [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter] + 256) % 256);
        }
    } expect([...decodePng(png(2, 8, 2, 2, encoded)).rgba]).toEqual([17, 93, 211, 255, 255, 255, 255, 255, 21, 99, 201, 255, 250, 245, 240, 255]); });
});
describe('release artifact isolation', () => {
    async function sandbox() { const root = await mkdtemp(join(tmpdir(), 'release-original-')), inventory = JSON.parse(await readFile('reports/public-asset-inventory.json', 'utf8')); for (const path of [...Object.keys(inventory.files), 'src/presentation/character-registry.json', 'reports/public-asset-inventory.json']) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await copyFile(path, join(root, path));
    } execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['add', '.'], { cwd: root }); return root; }
    it('rejects a private canary in dist even when it is not tracked', async () => { const root = await sandbox(); try {
        await mkdir(join(root, 'dist'));
        await writeFile(join(root, 'dist', 'private.json'), 'PRIVATE_PACKAGE_CANARY_32');
        await expect(checkArtifacts(root)).rejects.toThrow(/Local package/);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    } });
    it('rejects ignored/untracked additions to public rather than trusting gitignore', async () => { const root = await sandbox(); try {
        await writeFile(join(root, 'public', 'private.png'), new Uint8Array([1, 2, 3]));
        await expect(checkReleaseInputs(root)).rejects.toThrow(/Unapproved/);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    } });
    it('rejects importer interface code in a production bundle', async () => { const root = await sandbox(); try {
        await mkdir(join(root, 'dist'));
        await writeFile(join(root, 'dist', 'app.js'), 'LOCAL_IMPORT_INTERFACE');
        await expect(checkArtifacts(root)).rejects.toThrow(/interface/);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    } });
    it('rejects an exact private file copied into a CI artifact', async () => { const root = await sandbox(), bytes = new Uint8Array([31, 47, 251, 113]); try {
        await mkdir(join(root, 'artifacts'));
        await writeFile(join(root, 'artifacts', 'data.bin'), bytes);
        await expect(checkArtifacts(root, [bytes])).rejects.toThrow(/Local package/);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    } });
    it('leaves an external package outside an ordinary build inventory', async () => { const root = await sandbox(), external = await mkdtemp(join(tmpdir(), 'private-original-canary-')); try {
        await writeFile(join(external, 'owner.json'), 'PRIVATE_PACKAGE_CANARY_32');
        expect((await checkArtifacts(root)).privateMaterialFound).toBe(false);
    }
    finally {
        await rm(root, { recursive: true, force: true });
        await rm(external, { recursive: true, force: true });
    } });
    it('refuses to enable local importing in any production build', () => { const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { env: { ...process.env, LOCAL_SPRITES: '1' }, encoding: 'utf8' }); expect(result.status).not.toBe(0); expect(result.stderr).toContain('development-only'); });
    it('normalizer CLI refuses paths inside the checkout', () => { const result = spawnSync(process.execPath, ['scripts/normalize-sprites.mjs', '--source-dir', 'public', '--recipe', 'package.json', '--out', 'out'], { encoding: 'utf8' }); expect(result.status).not.toBe(0); expect(result.stderr).toContain('outside the checkout'); });
});
