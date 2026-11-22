import type Phaser from 'phaser';
import { prepareLocalPackage, type SelectedFile } from '../local-assets/package';
import { registerTexturePage } from '../rendering/texture-page';
import type { CharacterAsset } from '../rendering/CharacterAssetLoader';
let serial = 0;
export interface PrivateLease {
    asset: CharacterAsset;
    resources: {
        compressedBytes: number;
        decodedBytes: number;
        targetExceeded: boolean;
    };
    release(): void;
}
/** Private identities never share the game-owned public texture cache. Only explicit selected files are read. */
export class LocalPackageLoader {
    private controller?: AbortController;
    private leases = new Set<PrivateLease>();
    constructor(private scene: Phaser.Scene) { }
    cancel(): void { this.controller?.abort(); }
    async load(files: readonly SelectedFile[]): Promise<PrivateLease> {
        this.cancel();
        const controller = this.controller = new AbortController(), created: string[] = [];
        try {
            const prepared = await prepareLocalPackage(files, controller.signal), prefix = 'private-local-' + ++serial, textures: Record<string, string> = {};
            for (const page of prepared.manifest.pages) {
                if (controller.signal.aborted)
                    throw Error('Package load canceled');
                const key = prefix + ':' + page.id;
                await registerTexturePage(this.scene, prepared.manifest, page, key, new Blob([await prepared.pages.get(page.id)!.arrayBuffer()], { type: 'image/png' }), controller.signal);
                created.push(key);
                textures[page.id] = key;
            }
            if (controller.signal.aborted)
                throw Error('Package load canceled');
            let released = false;
            const lease: PrivateLease = { asset: { manifest: prepared.manifest, textures: Object.freeze(textures) }, resources: prepared.resources, release: () => { if (released)
                    return; released = true; created.forEach(key => this.scene.textures.remove(key)); this.leases.delete(lease); } };
            this.leases.add(lease);
            return lease;
        }
        catch (error) {
            created.forEach(key => this.scene.textures.remove(key));
            throw error;
        }
    }
    destroy(): void { this.cancel(); for (const lease of [...this.leases])
        lease.release(); }
    get textureCount(): number { return [...this.leases].reduce((n, l) => n + Object.keys(l.asset.textures).length, 0); }
}
