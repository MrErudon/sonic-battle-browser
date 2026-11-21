import characterRegistry from "../presentation/character-registry.json";
import { SpecialView } from "../rendering/SpecialView";
import Phaser from "phaser";
import { ARENA, projectArena } from "../core/arena";
import { COMBAT_KEYS, MatchController } from "../core/match";
import { SpriteFighterView } from "../rendering/SpriteFighterView";
import { CharacterAssetLoader } from "../rendering/CharacterAssetLoader";
import { EffectRegistry } from "../rendering/EffectRegistry";
import { PresentationCapture } from "../presentation/capture";
import { fighterSnapshot } from "../presentation/snapshot";
import { CombatView } from "../rendering/CombatView";
import { MatchView } from "../rendering/MatchView";

export class ArenaScene extends Phaser.Scene {
  readonly match = new MatchController();
  private specialView!: SpecialView;
  private combatView!: CombatView;
  private views!: [SpriteFighterView, SpriteFighterView];
  readonly presentation=new PresentationCapture();
  private assetLoader!:CharacterAssetLoader;
  private effects!:EffectRegistry;
  private alive=false;private generation=0;
  private ui!: MatchView;
  private resetVersion = -1;
  private visualTime = 0;
  constructor() { super("Arena"); }

  create(): void {
    this.alive=true;const generation=++this.generation;this.presentation.clear();
    const g = this.add.graphics();
    const w = ARENA.width / 2;
    const h = ARENA.depth / 2;
    const corners = [projectArena(-w, -h), projectArena(w, -h), projectArena(w, h), projectArena(-w, h)];
    g.fillStyle(0x293a4c, 1);
    g.lineStyle(4, 0x8ecae6, 1);
    g.fillPoints(corners.map(p => new Phaser.Geom.Point(p.x, p.y)), true);
    g.strokePoints(corners.map(p => new Phaser.Geom.Point(p.x, p.y)), true);
    g.lineStyle(1, 0x42586d, 0.7);
    for (let x = -w + 50; x < w; x += 50) {
      const a = projectArena(x, -h), b = projectArena(x, h);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let y = -h + 50; y < h; y += 50) {
      const a = projectArena(-w, y), b = projectArena(w, y);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    this.match.menu();
    this.match.setFocused(!document.hidden);
    this.match.setPresentation(this.presentation);
    this.effects=new EffectRegistry(this);
    this.combatView = new CombatView(this); this.specialView=new SpecialView(this);
    this.views = [new SpriteFighterView(this, 0x55dced, "YOU"), new SpriteFighterView(this, 0xffbf69, "CPU")];
    this.ui = new MatchView(this.match);
    this.assetLoader=new CharacterAssetLoader(this);
    void this.assetLoader.loadRoster(characterRegistry).then(results=>{
      if(!this.alive||generation!==this.generation)return;
      this.views.forEach((view,index)=>{const result=results[index===0?'P1':'P2'];if(result.ok)view.setAsset(result.asset);});
      this.game.canvas.dataset.characterAsset=Object.values(results).every(r=>r.ok)?'ready':'fallback';
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.code === "Escape" && !event.repeat && !this.match.helpOpen) {
        this.ui.openHelp(); return;
      }
      // Let native buttons and the help dialog retain Space/Enter activation.
      const interactive = event.target instanceof HTMLElement && !!event.target.closest("button, input, select, textarea, dialog");
      if (interactive && (this.match.helpOpen || event.code === "Space" || event.code === "Enter")) return;
      if (COMBAT_KEYS.has(event.code)) event.preventDefault();
      this.match.press(event.code, event.repeat);
    };
    const keyup = (event: KeyboardEvent) => this.match.release(event.code);
    const blur = () => this.match.setFocused(false);
    const focus = () => this.match.setFocused(!document.hidden);
    const visibility = () => this.match.setFocused(!document.hidden && document.hasFocus());
    this.game.events.on(Phaser.Core.Events.BLUR, blur);
    this.game.events.on(Phaser.Core.Events.FOCUS, focus);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
      this.game.events.off(Phaser.Core.Events.BLUR, blur);
      this.game.events.off(Phaser.Core.Events.FOCUS, focus);
      this.alive=false;this.generation++;this.assetLoader.destroy();
      this.match.setPresentation(undefined);this.match.setFocused(false);
      this.presentation.clear();this.views.forEach(view=>view.destroy());
      this.effects.destroy();this.combatView.destroy();this.specialView.destroy();
      this.ui.destroy();
    });
  }

  update(_time: number, delta: number): void {
    this.match.advance(delta);
    if (this.resetVersion !== this.match.resetVersion) {
      this.combatView.clear(); this.specialView.clear();this.effects.clear(); this.resetVersion = this.match.resetVersion; this.visualTime = 0;
    }
    if (this.match.acceptsInput) this.visualTime += Math.min(delta, 100);
    this.effects.consume(this.presentation.drain(),this.presentation.clock);
    this.effects.sync(this.presentation.clock);
    this.views[0].sync(this.match.fighters[0], this.visualTime, this.ui.debug,{...this.presentation.context(fighterSnapshot(this.match.fighters[0])),matchState:this.match.state,winner:this.match.winner});
    this.views[1].sync(this.match.fighters[1], this.visualTime, this.ui.debug,{...this.presentation.context(fighterSnapshot(this.match.fighters[1])),matchState:this.match.state,winner:this.match.winner});
    this.combatView.sync(this.match.fighters, this.match.paused ? 0 : delta);
    this.specialView.sync(this.match.fighters,this.match.combat);
    this.ui.sync();
    this.game.canvas.dataset.animations=this.views.map(v=>v.lastPose?`${v.lastPose.clip}:${v.lastPose.phase}:${v.lastPose.frame}:${v.lastPose.mirror}`:'geometric').join('|');
  }
}
