import Phaser from 'phaser';
import type { CharacterManifest } from '../presentation/manifest';
/** Shared decode/register path. Object URLs are always revoked; the caller owns registered textures. */
export async function registerTexturePage(scene: Phaser.Scene, manifest: Readonly<CharacterManifest>, page: CharacterManifest['pages'][number], key: string, blob: Blob, signal: AbortSignal): Promise<void> {
    if (signal.aborted)
        throw Error('Image load canceled');
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => { const cleanup = () => signal.removeEventListener('abort', cancel), cancel = () => { cleanup(); image.onload = null; image.onerror = null; image.src = ''; reject(Error('Image load canceled')); }; image.onload = () => { cleanup(); resolve(); }; image.onerror = () => { cleanup(); reject(Error('Invalid atlas image')); }; signal.addEventListener('abort', cancel, { once: true }); image.src = url; });
        if (signal.aborted)
            throw Error('Image load canceled');
        if (image.naturalWidth !== page.width || image.naturalHeight !== page.height)
            throw Error('Atlas size mismatch');
        const texture = scene.textures.addImage(key, image);
        if (!texture)
            throw Error('Texture registration failed');
        try {
            texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
            for (const [name, f] of Object.entries(manifest.frames))
                if (f.page === page.id)
                    texture.add(name, 0, f.x, f.y, 64, 64);
        }
        catch (error) {
            scene.textures.remove(key);
            throw error;
        }
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
