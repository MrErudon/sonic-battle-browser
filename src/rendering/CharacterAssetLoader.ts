import Phaser from 'phaser';
import { validateManifest, type CharacterManifest } from '../presentation/manifest';
export interface CharacterAsset {
    manifest: Readonly<CharacterManifest>;
    textures: Readonly<Record<string, string>>;
}
export type AssetResult = {
    ok: true;
    asset: CharacterAsset;
} | {
    ok: false;
    reason: string;
};
/** Scene-scoped cancellation; textures are game-owned and reused across rematches/restarts. */
export class CharacterAssetLoader {
    private abort = new AbortController();
    constructor(private scene: Phaser.Scene) { }
    async loadRoster(value:unknown):Promise<Record<string,AssetResult>> {
        try {
            const base=new URL('/assets/',location.href),registry=value as {schemaVersion:number;slots:Record<string,string>};
            if(registry?.schemaVersion!==1||!registry.slots||!['P1','P2'].every(id=>typeof registry.slots[id]==='string'&&!registry.slots[id].includes('..')&&!registry.slots[id].startsWith('/')&&!registry.slots[id].includes(':')&&!registry.slots[id].includes('\\')))throw Error('Invalid character registry');
            const cache=new Map<string,Promise<AssetResult>>(),result:Record<string,AssetResult>={};
            for(const id of ['P1','P2']){const path=new URL(registry.slots[id],base).href;let pending=cache.get(path);if(!pending){pending=this.load(path);cache.set(path,pending);}result[id]=await pending;}return result;
        }catch(e){return Object.fromEntries(['P1','P2'].map(id=>[id,{ok:false,reason:e instanceof Error?e.message:String(e)}]));}
    }
    async load(url: string): Promise<AssetResult> {
        const added: string[] = [];
        try {
            const base = new URL(url, location.href);
            if (base.origin !== location.origin)
                throw Error('Character assets must be same-origin');
            const response = await fetch(base, { signal: this.abort.signal });
            if (!response.ok)
                throw Error('Manifest HTTP ' + response.status);
            const manifest = validateManifest(await response.json()), textures: Record<string, string> = {};
            for (const page of manifest.pages) {
                const key = `character:${manifest.id}:${manifest.version}:${page.id}`;
                textures[page.id] = key;
                if (this.scene.textures.exists(key))
                    continue;
                const imageResponse = await fetch(new URL(page.image, base), { signal: this.abort.signal });
                if (!imageResponse.ok)
                    throw Error('Atlas HTTP ' + imageResponse.status);
                const blob = await imageResponse.blob(), objectUrl = URL.createObjectURL(blob);
                try {
                    const image = new Image();
                    await new Promise<void>((resolve, reject) => { const cancel = () => { image.src = ''; reject(Error('Asset load aborted')); }; this.abort.signal.addEventListener('abort', cancel, { once: true }); image.onload = () => { this.abort.signal.removeEventListener('abort', cancel); resolve(); }; image.onerror = () => { this.abort.signal.removeEventListener('abort', cancel); reject(Error('Invalid atlas image')); }; image.src = objectUrl; });
                    if (this.abort.signal.aborted)
                        throw Error('Asset load aborted');
                    if (image.naturalWidth !== page.width || image.naturalHeight !== page.height)
                        throw Error('Atlas size mismatch');
                    const texture = this.scene.textures.addImage(key, image);
                    if (!texture)
                        throw Error('Texture registration failed');
                    added.push(key);
                    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
                    for (const [name, frame] of Object.entries(manifest.frames))
                        if (frame.page === page.id)
                            texture.add(name, 0, frame.x, frame.y, 64, 64);
                }
                finally {
                    URL.revokeObjectURL(objectUrl);
                }
            }
            return { ok: true, asset: { manifest, textures: Object.freeze(textures) } };
        }
        catch (error) {
            for (const key of added)
                this.scene.textures.remove(key);
            return { ok: false, reason: error instanceof Error ? error.message : String(error) };
        }
    }
    destroy(): void { this.abort.abort(); }
}
