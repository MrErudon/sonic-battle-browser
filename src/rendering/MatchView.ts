import { SPECIAL_IDS } from "../core/specials";
import { MatchController } from "../core/match";
import type { Difficulty } from "../core/cpu";

/** Replaceable, accessible DOM shell. Never mutates fighter/combat state. */
export class MatchView {
  private root: HTMLElement;
  private dialog: HTMLDialogElement;
  private previousState = "";
  private returnFocus?: HTMLElement;
  debug = false;
  constructor(private match: MatchController) {
    this.root = document.createElement("div");
    this.root.className = "match-ui";
    this.root.innerHTML = `
      <div class="hud" hidden>
        <section class="fighter-health player"><div><strong>YOU <span>CYAN</span></strong><output id="p1-hp"></output></div><progress id="p1-bar" max="100" value="100" aria-label="Your health"></progress><div class="guard-row"><span>GUARD</span><progress id="p1-guard" max="100" value="100" aria-label="Your guard"></progress><output id="p1-guard-status"></output></div><p id="p1-rounds"></p></section>
        <div class="round-info"><strong id="round-label"></strong><span id="cpu-label"></span></div>
        <section class="fighter-health opponent"><div><strong>CPU <span>AMBER</span></strong><output id="p2-hp"></output></div><progress id="p2-bar" max="100" value="100" aria-label="CPU health"></progress><div class="guard-row"><span>GUARD</span><progress id="p2-guard" max="100" value="100" aria-label="CPU guard"></progress><output id="p2-guard-status"></output></div><p id="p2-rounds"></p></section>
      </div>
      <section class="menu-panel" aria-labelledby="game-title">
        <p class="alpha-badge">PRIVATE ALPHA � KEYBOARD PLAY</p>
        <h1 id="game-title">Arena<br>Clash</h1>
        <p class="intro">You. One rival. First to two wins.</p>
        <fieldset><legend>Choose your CPU opponent</legend><div class="difficulty-options">
          <button data-difficulty="Easy" aria-pressed="false">Easy</button><button data-difficulty="Normal" aria-pressed="true">Normal</button><button data-difficulty="Hard" aria-pressed="false">Hard</button>
        </div></fieldset>
        <p id="difficulty-description">Balanced pursuit and varied attacks.</p>
        <button class="primary" id="start-game">Start Game <span aria-hidden="true"></span></button>
        <p class="quick-controls">WASD / arrows to move � J / K to attack<br>Space to jump � Hold L to block<br>Move toward your rival to face them</p>
      </section>
      <div class="combo-feedback" aria-live="polite"><span id="p1-combo"></span><span id="p2-combo"></span></div>
      <div class="fight-cue" aria-hidden="true" hidden>FIGHT</div>
      <div class="round-message" role="status" aria-live="polite" hidden><h2 id="status-title"></h2><p id="status-detail"></p></div>
      <section class="result-panel" aria-labelledby="result-title" hidden><h2 id="result-title"></h2><p id="result-detail"></p><button class="primary" id="rematch">Rematch</button><button id="result-menu">Return to menu</button></section>
      <div class="pause-message" role="status" hidden>Paused <span>Return to the game to continue</span></div>
      <p class="keyboard-notice">Keyboard required � Touch controls are not available in this alpha.</p>
      <div class="special-controls" aria-label="Special attacks">
        <button id="select-power" aria-pressed="true">1 � Burst <span id="special-power-status">READY</span></button>
        <button id="select-dash" aria-pressed="false">2 � Dash <span id="special-dash-status">READY</span></button>
        <button id="select-projectile" aria-pressed="false">3 � Energy <span id="special-projectile-status">READY</span></button>
        <output id="special-lockout">I � ACTIVATE</output>
      </div>
      <footer><span class="play-hint">WASD / arrows � Space jump � J light � K heavy � L block</span><div><button id="help">Controls / Help</button><button id="menu">Menu</button><button id="debug" aria-pressed="false">Debug</button></div></footer>
      <pre class="debug-readout" hidden></pre>
      <dialog aria-labelledby="help-title"><h2 id="help-title">Make your move.</h2><dl><dt>Move & face</dt><dd>WASD or arrow keys</dd><dt>Jump</dt><dd>Space</dd><dt>Light attack</dt><dd>J - light; tap again after a hit to chain</dd><dt>Heavy attack</dt><dd>K - heavy; J or K after Light 3 finishes the combo</dd><dt>Ground block</dt><dd>Hold L - face your rival first; release to recover. Blocks take chip damage and consume guard. An empty guard breaks.</dd><dt>Special attacks</dt><dd>1 Burst / 2 Dash / 3 Energy � I activates the selected ground special. Tap I; recharge and a shared lockout apply. No special cancels or air specials.</dd></dl><p>Face your rival and close the gap. Tap attacks; holding a button does not repeat them. Jump and attack together for an aerial strike.</p><p>First to two round wins takes the match. A double KO replays the round with no points. Health resets each round.</p><p>Help and switching away pause the match. Release and press your keys again after a countdown or pause. Choose difficulty from the menu.</p><button class="primary" id="close-help">Back to game</button></dialog>`;
    document.querySelector("#shell")!.append(this.root);
    this.dialog = this.root.querySelector("dialog")!;
    SPECIAL_IDS.forEach(id=>this.on("select-"+id,()=>{match.selectSpecial(id);this.sync();}));
    this.on("start-game", () => match.start());
    this.on("rematch", () => match.start());
    this.on("menu", () => match.menu());
    this.on("result-menu", () => match.menu());
    this.on("help", () => this.openHelp());
    this.on("close-help", () => this.dialog.close());
    this.on("debug", () => { this.debug = !this.debug; });
    this.dialog.addEventListener("close", () => {
      match.setHelp(false);
      if (match.state === "Fighting" || match.state === "Countdown") {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      } else this.returnFocus?.focus();
      this.sync();
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-difficulty]").forEach(button => {
      button.addEventListener("click", () => { match.selectDifficulty(button.dataset.difficulty as Difficulty); this.sync(); });
    });
    this.sync();
  }
  private on(id: string, action: () => void): void {
    this.root.querySelector(`#${id}`)!.addEventListener("click", () => { action(); this.sync(); });
  }
  private text(selector: string, value: string): void {
    const node = this.root.querySelector(selector)!;
    if (node.textContent !== value) node.textContent = value;
  }
  private visible(selector: string, visible: boolean): void {
    (this.root.querySelector(selector) as HTMLElement).hidden = !visible;
  }
  openHelp(): void {
    if (this.dialog.open) { this.dialog.close(); return; }
    this.returnFocus = document.activeElement as HTMLElement;
    this.match.setHelp(true); this.dialog.showModal(); this.sync();
  }
  sync(): void {
    const m = this.match, menu = m.state === "Menu", over = m.state === "Match Over";
    this.root.dataset.state = m.state;
    this.visible(".menu-panel", menu); this.visible(".hud", !menu);
    this.visible(".result-panel", over); this.visible("#menu", !menu && !over);
    this.visible(".play-hint", !menu);
    this.visible(".fight-cue", m.state === "Fighting" && !m.paused);
    this.root.dataset.winner = m.winner ?? "";
    this.root.querySelectorAll<HTMLButtonElement>("[data-difficulty]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.difficulty === m.difficulty)));
    this.text("#difficulty-description", { Easy: "Slower reactions. More time to find your rhythm.", Normal: "Balanced pursuit and varied attacks.", Hard: "Faster reactions. Keep moving and pick your moment." }[m.difficulty]);
    m.fighters.forEach((fighter, index) => {
      const id = index + 1;
      const combo = fighter.comboHits;
      this.text(`#p${id}-combo`, combo.count >= 2 && combo.remaining > 0 ? `${combo.count} HITS � ${combo.damage} DAMAGE` : "");
      this.text(`#p${id}-hp`, `${fighter.health} / ${fighter.stats.maxHealth}`);
      const bar = this.root.querySelector(`#p${id}-bar`) as HTMLProgressElement;
      bar.max = fighter.stats.maxHealth; bar.value = fighter.health;
      const guardBar = this.root.querySelector(`#p${id}-guard`) as HTMLProgressElement;
      guardBar.max = fighter.stats.defense?.maxGuard ?? 100; guardBar.value = fighter.guard.value;
      this.text(`#p${id}-guard-status`, fighter.guard.breakRemaining > 0 ? "BROKEN" :
        fighter.action.type === "blocking" || fighter.action.type === "blockstun" ? "BLOCK" :
        fighter.action.type === "block_startup" ? "RAISING" : fighter.action.type === "block_recovery" ? "RECOVER" : String(Math.ceil(fighter.guard.value)));
      this.text(`#p${id}-rounds`, `${m.score[index]} / 2 rounds won`);
    });
    const player=m.fighters[0];
    for(const id of SPECIAL_IDS){
      const button=this.root.querySelector("#select-"+id) as HTMLButtonElement;
      button.setAttribute("aria-pressed",String(m.input.selectedSpecial===id));
      button.disabled=m.paused || (m.state!=="Menu" && m.state!=="Fighting");
      const ticks=player.special.recharge[id],active=id==="projectile"&&m.combat.projectiles.some(p=>p.ownerId===player.id);
      this.text("#special-"+id+"-status",active?"ACTIVE":ticks>0?(ticks/60).toFixed(1)+"s":"READY");
    }
    this.text("#special-lockout",player.special.shared>0?"SHARED "+(player.special.shared/60).toFixed(1)+"s":"I � ACTIVATE");
    this.visible(".special-controls",m.state==="Menu"||m.state==="Fighting");
    this.text("#round-label", `ROUND ${m.round}`); this.text("#cpu-label", `${m.difficulty} CPU`);
    const message = m.state === "Countdown" || m.state === "Round Over";
    this.visible(".round-message", message && !m.paused);
    if (m.state === "Countdown") {
      this.text("#status-title", String(Math.ceil(m.ticksRemaining / 60)));
      this.text("#status-detail", `Round ${m.round} � Get ready`);
    } else if (m.state === "Round Over") {
      this.text("#status-title", m.result === "Draw" ? "DOUBLE KO" : "KO");
      this.text("#status-detail", m.result === "Draw" ? "No points. Replay this round." : `${m.result === "P1" ? "You win" : "CPU wins"} round ${m.round}.`);
    }
    this.text("#result-title", m.winner === "P1" ? "Victory!" : "Defeat");
    this.text("#result-detail", `${m.score[0]} - ${m.score[1]} � ${m.difficulty} CPU � ${m.winner === "P1" ? "The arena is yours." : "Find your opening. Try again."}`);
    this.visible(".pause-message", m.paused && !m.helpOpen && !menu && !over);
    this.visible(".debug-readout", this.debug);
    this.root.querySelector("#debug")!.setAttribute("aria-pressed", String(this.debug));
    if (this.debug) this.text(".debug-readout", `${m.state} | seed ${m.seed} | ${m.difficulty}\n` + m.fighters.map(f => `${f.id}: ${f.x.toFixed(1)}, ${f.y.toFixed(1)}, z ${f.z.toFixed(1)} | ${f.facing} | ${f.state} | ${f.action.type} | guard=${f.guard.value} break=${f.guard.breakRemaining}${f.action.type === "special" ? ` ${f.action.id} frame=${f.action.frame}` : f.action.type === "attack" ? ` ${f.action.comboStage ?? (f.action.airborne ? "air" : "standalone")} frame=${f.action.frame}` : ""}`).join("\n") + `\nPROJECTILES ${m.combat.projectiles.map(p=>`${p.id}@${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";")} | special=${m.input.selectedSpecial} | shared=${m.fighters[0].special.shared}`);
    if (this.previousState !== m.state) {
      if (menu || over) (this.root.querySelector(menu ? "#start-game" : "#rematch") as HTMLElement).focus({ preventScroll: true });
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      this.previousState = m.state;
    }
  }
  destroy(): void { this.root.remove(); }
}
