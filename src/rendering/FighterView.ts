import Phaser from "phaser";
import { DIRECTIONS, projectFighter } from "../core/movement";
import { attackPhase, type CombatFighter } from "../core/combat";
/** Original geometric training robots. Replace this view without changing physics. */
export class FighterView {
  private body: Phaser.GameObjects.Graphics;
  private shadow: Phaser.GameObjects.Ellipse;
  private label: Phaser.GameObjects.Text;
  constructor(scene: Phaser.Scene, private color: number, private name: string) {
    this.shadow = scene.add.ellipse(0, 0, 30, 12, 0x000000, 0.35).setDepth(1);
    this.body = scene.add.graphics();
    this.label = scene.add.text(0, 0, name, { fontSize: "12px", color: "#e9f5ff" }).setOrigin(0.5, 1);
  }
  sync(f: CombatFighter, time: number, debug = false): void {
    const p = projectFighter(f);
    this.shadow.setPosition(p.x, p.groundY).setScale(Math.max(0.55, 1 - f.z / 250));
    const g = this.body;
    g.clear().setPosition(p.x, p.y).setDepth(p.depth);
    const stride = f.state === "walk" ? Math.sin(time / 75) * 4 : 0;
    const squash = f.state === "landing" ? 7 : 0;
    g.fillStyle(0x10151e).fillRoundedRect(-15, -43 + squash, 30, 39 - squash, 7);
    const action = f.action.type === "attack" ? attackPhase(f.action) : f.action.type;
    const color = action === "hitstun" ? 0xffffff : action === "ko" ? 0x647080 : action === "recovery" ? 0x8398ab : this.color;
    g.fillStyle(color).fillRoundedRect(-12, -40 + squash, 24, 33 - squash, 6);
    g.fillStyle(0xe9f5ff).fillRoundedRect(-16, -8 + stride, 13, 7, 2);
    g.fillRoundedRect(3, -8 - stride, 13, 7, 2);
    g.fillStyle(0x172333).fillRoundedRect(-9, -34 + squash, 18, 11, 3);
    const angle = DIRECTIONS.indexOf(f.facing) * Math.PI / 4;
    g.fillStyle(0xffffff).fillCircle(Math.cos(angle) * 6, -29 + squash + Math.sin(angle) * 3, 3);
    g.lineStyle(3, 0xffffff).lineBetween(0, -18 + squash, Math.cos(angle) * 17, -18 + squash + Math.sin(angle) * 9);
    if (["block_startup", "blocking", "blockstun", "block_recovery"].includes(f.action.type)) {
      const active = f.action.type === "blocking" || f.action.type === "blockstun";
      g.lineStyle(active ? 4 : 2, this.color, active ? .95 : .35);
      g.beginPath();
      g.arc(0, -22, 25, angle - Math.PI / 2, angle + Math.PI / 2);
      g.strokePath();
    }
    if (f.guard.breakRemaining > 0) {
      g.lineStyle(3, 0xff657a).lineBetween(-15, -47, -3, -35);
      g.lineBetween(-3, -35, 6, -47); g.lineBetween(6, -47, 17, -35);
    }
    this.label.setPosition(p.x, p.y - 49 + squash).setDepth(p.depth + 0.01);
    this.label.setVisible(debug);
    this.label.setText(debug ? `${this.name} · ${f.state} · ${action}` : this.name);
  }
}
