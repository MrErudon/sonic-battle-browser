import Phaser from 'phaser';
import type { CombatFighter } from '../core/combat';
import { fighterSnapshot } from '../presentation/snapshot';
import { resolveAnimation, type AnimationContext } from '../presentation/resolver';
import { FighterView } from './FighterView';
import type { CharacterAsset } from './CharacterAssetLoader';
/** Sprite presentation can fail independently; geometric fallback remains fully playable. */
export class SpriteFighterView {
    private fallback: FighterView;
    private sprite: Phaser.GameObjects.Image;
    private shadow: Phaser.GameObjects.Ellipse;
    private label: Phaser.GameObjects.Text;
    private asset?: CharacterAsset;
    private disposed = false;
    status = 'geometric';
    lastPose?: ReturnType<typeof resolveAnimation>;
    constructor(private scene: Phaser.Scene, private color: number, private name: string) {
        this.fallback = new FighterView(scene, color, name);
        this.sprite = scene.add.image(0, 0, '__DEFAULT').setVisible(false).setTint(color);
        this.shadow = scene.add.ellipse(0, 0, 30, 12, 0, 0.35).setDepth(1).setVisible(false);
        this.label = scene.add.text(0, 0, name, { fontSize: '12px', color: '#e9f5ff' }).setOrigin(.5, 1).setVisible(false);
    }
    setAsset(asset?: CharacterAsset): void { if (!this.disposed) {
        this.asset = asset;
        this.status = asset ? 'sprite' : 'geometric';
    } }
    sync(f: CombatFighter, time: number, debug = false, context?: AnimationContext): void {
        if (this.disposed)
            return;
        this.label.setText(`${this.name} · ${f.state} · ${f.action.type}`);
        try {
            if (!this.asset)
                throw Error('No character asset');
            const pose = resolveAnimation(fighterSnapshot(f), context ?? { clock: Math.floor(time / 1000 * 60), age: Math.floor(time / 1000 * 60), airAge: 1, hitAge: 2, matchState: 'Fighting' }, this.asset.manifest);
            const frame = this.asset.manifest.frames[pose.frame], key = this.asset.textures[frame.page];
            if (!this.scene.textures.exists(key) || !this.scene.textures.get(key).has(pose.frame))
                throw Error('Missing atlas frame');
            this.fallback.setVisible(false);
            this.lastPose = pose;
            this.status = 'sprite';
            this.sprite.setTexture(key, pose.frame).setOrigin(pose.originX, pose.originY).setFlipX(pose.mirror).setPosition(pose.x, pose.y).setDepth(pose.depth).setVisible(true);
            if (f.action.type === 'hitstun' && (context?.hitAge ?? 2) < 2)
                this.sprite.setTintFill(0xffffff);
            else
                this.sprite.setTint(this.color);
            this.shadow.setPosition(pose.x, pose.groundY).setScale(pose.shadowScale).setVisible(true);
            this.label.setPosition(pose.x, pose.y - 49).setDepth(pose.depth + .01).setText(`${this.name} · ${f.state} · ${f.action.type} · ${pose.clip} · ${pose.phase}`).setVisible(debug);
        }
        catch {
            this.status = 'geometric';
            this.lastPose = undefined;
            this.sprite.setVisible(false);
            this.shadow.setVisible(false);
            this.label.setVisible(false);
            this.fallback.setVisible(true);
            this.fallback.sync(f, time, debug);
        }
    }
    textureKey(): string | undefined { const p = this.lastPose; return p && this.asset ? this.asset.textures[this.asset.manifest.frames[p.frame].page] : undefined; }
    diagnostics() { return { status: this.status, pose: this.lastPose, body: { x: this.sprite.x, y: this.sprite.y, originX: this.sprite.originX, originY: this.sprite.originY, flipX: this.sprite.flipX, visible: this.sprite.visible }, shadow: { x: this.shadow.x, y: this.shadow.y, scale: this.shadow.scaleX, visible: this.shadow.visible } }; }
    destroy(): void { if (this.disposed)
        return; this.disposed = true; this.fallback.destroy(); this.sprite.destroy(); this.shadow.destroy(); this.label.destroy(); this.asset = undefined; }
}
