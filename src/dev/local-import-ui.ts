import type Phaser from 'phaser';
import { LocalPackageLoader, type PrivateLease } from './LocalPackageLoader';
import type { SpriteFighterView } from '../rendering/SpriteFighterView';
import type { MatchState } from '../core/match';
export function isLoopback(host: string): boolean { return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'; }
export interface LocalImportUi {
    destroy(): void;
    refresh(state: MatchState): void;
}
/** LOCAL_IMPORT_INTERFACE: this entire module must be absent from standard production artifacts. */
export function attachLocalImport(scene: Phaser.Scene, view: SpriteFighterView): LocalImportUi {
    if (!isLoopback(location.hostname))
        throw Error('Local sprite import requires a loopback origin');
    const loader = new LocalPackageLoader(scene), root = document.createElement('section');
    root.id = 'local-sprite-import';
    root.setAttribute('aria-label', 'Local development sprite package');
    root.style.cssText = 'position:fixed;left:8px;top:8px;z-index:1000;background:#182333;padding:8px;color:white;font:12px sans-serif;max-width:330px';
    root.innerHTML = '<strong>Local sprite package · development only</strong><p><input id="local-sprite-files" type="file" multiple accept=".json,.png" aria-label="Select local package files"></p><button id="local-sprite-load">Load selected files</button> <button id="local-sprite-cancel">Cancel load</button> <button id="local-sprite-unload">Unload package</button><p id="local-sprite-status" role="status">Synthetic default · no private package selected</p>';
    document.body.append(root);
    const input = root.querySelector<HTMLInputElement>('input')!, status = root.querySelector<HTMLElement>('[role=status]')!;
    let lease: PrivateLease | undefined, version = 0, alive = true, previous: MatchState = 'Menu';
    const unload = () => { version++; loader.cancel(); view.useDefaultAsset(); lease?.release(); lease = undefined; input.value = ''; root.dataset.privateTextures = '0'; status.textContent = 'Synthetic default · no private package selected'; };
    root.querySelector('#local-sprite-load')!.addEventListener('click', () => {
        const current = ++version;
        loader.cancel();
        view.useDefaultAsset();
        lease?.release();
        lease = undefined;
        root.dataset.privateTextures = '0';
        status.textContent = 'Validating selected files';
        void loader.load(Array.from(input.files ?? [])).then(result => { if (!alive || current !== version) {
            result.release();
            return;
        } lease = result; view.setAsset(result.asset); root.dataset.privateTextures = String(loader.textureCount); status.textContent = `Local package active · ${result.resources.compressedBytes} bytes · ${result.resources.decodedBytes} decoded bytes · source authorization owner-declared, unverified`; }).catch(() => { if (alive && current === version) {
            view.useDefaultAsset();
            status.textContent = 'Package rejected or canceled · synthetic fallback active';
            root.dataset.privateTextures = '0';
        } });
    });
    root.querySelector('#local-sprite-cancel')!.addEventListener('click', unload);
    root.querySelector('#local-sprite-unload')!.addEventListener('click', unload);
    return { refresh(state) { if (state === 'Menu' && previous !== 'Menu' || state === 'Countdown' && previous === 'Match Over' || lease && !view.usesAsset(lease.asset))
            unload(); previous = state; }, destroy() { if (!alive)
            return; alive = false; unload(); loader.destroy(); root.remove(); } };
}
