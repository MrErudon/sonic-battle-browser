# Sonic Battle Browser Edition

Browser-based isometric arena fighting prototype, built with Phaser 3, TypeScript, and Vite. Engine and placeholder artwork are independent of Sega intellectual property.

## Milestone 1

1. Scaffold a runnable arena with Phaser 3, TypeScript, and Vite.
2. Add two placeholder fighters, eight-direction movement, jumping, and arena bounds.
3. Add light/heavy attacks, hitboxes, damage, knockback, and health bars.
4. Add a basic CPU opponent and automated tests.
5. Complete single-player matches, scoring, menus, rematches and input gating.

## Development workflow

Use Node.js **22.22.0**, pinned in `.nvmrc` and `package.json`, with its
bundled npm **10.9.4**. CI reads the same `.nvmrc`. With nvm, run `nvm install`
and `nvm use`; with nvm-windows, use `nvm install 22.22.0` and
`nvm use 22.22.0`.

```sh
npm ci
npm run dev
```

Before pushing, run the same checks as CI:

```sh
npm audit
npm test
npm run typecheck
npm run build
```

Commit `package-lock.json` whenever dependencies change; `npm ci` installs
the locked versions and fails if the manifest and lockfile disagree.
Vitest 5.1.0 replaces the vulnerable Vitest 3 dependency tree (including
Tinypool), and remains compatible with Vite 7 and the pinned Node version.

Implement in small feature branches and verify each stage before merging.

## M01.6 — Alpha deployment preparation

See [Cloudflare setup, authorization, private-access gates, validation and rollback](docs/M01.6-alpha-deployment.md).
Pages configuration is prepared for `main`, `npm run build`, and `dist`.
No site has been published. GitHub-connected PR previews require Cloudflare authorization
and verified Access protection for both production and preview URLs.

The HUD has stronger contrast and normal gameplay hides fighter diagnostics.
Use Debug to inspect state. Keyboard is required; mobile touch play is not implemented.
CI retains the original Chromium regressions and adds built-asset checks in
Chromium, Firefox and WebKit, plus desktop/mobile-sized layout checks.
Run `npm run report:bundle` after building for raw/gzip asset sizes.

## M01.5 — Playable single-player match

Choose **Easy / Normal / Hard**, then **Start Game**. Control the cyan fighter
with **WASD / arrows**, **Space** to jump, **J** for light and **K** for heavy.
First to two round wins takes the match. Double KO replays the round.
Health, positions, CPU/RNG, inputs and effects reset each round.

Use **Controls / Help** or **Escape** to pause and learn the controls.
Switching away pauses too. **Rematch** starts over with the same difficulty;
**Menu** returns to difficulty selection. Release and press movement/attack
keys again after a transition. **Debug** toggles diagnostics. The former
training shortcuts R and 1/2/3 are no longer used.

See [M01.5 architecture, rules, validation and limitations](docs/M01.5-playable-match.md).
This is a desktop keyboard prototype with original replaceable graphics.

**Audit status (2026-11-19):** the fresh main CI run reports zero vulnerabilities; the earlier picomatch advisory findings have cleared. Full audit remains a required CI check.

## M01.4 — CPU opponent (preserved)

P2 pursues and attacks using the same movement and combat rules. CPU decisions
run once per 60 Hz combat tick with deterministic seeded randomness. Difficulty
now changes only through the match menu. The anti-oscillation correction and
all CPU regression tests are preserved unchanged.
See [CPU architecture, parameters and validation](docs/M01.4-cpu-opponent.md).

## M01.3 — Combat foundation

Move with **WASD / arrows**, jump with **Space**, attack with **J** (light) or
**K** (heavy), and use **Menu** to start a new match. Face the amber target and move
into range. Ground/aerial attacks damage health and cause hitstun/knockback;
heavy attacks launch. P2 is now controlled by the M01.4 CPU.

Combat uses a separate action state and a Phaser-independent 60 Hz simulation.
Original procedural indicators and health bars show attack phases and damage.
See [M01.3 architecture, tuning and validation](docs/M01.3-combat-foundation.md).

Browser regression checks (also run by CI):

```sh
npx playwright install chromium
npm run test:browser
```

## M01.2 — Fighter movement

Move the cyan training robot with **WASD / arrow keys**; press **Space** to jump.
The amber robot remains stationary. Movement is screen-relative, with normalized
arena speed, reduced aerial control, footprint boundaries, and landing recovery.
The labels display idle/walk/jump/landing state and eight-direction facing.

- `src/core/movement.ts`: framework-independent 60 Hz simulation and tuning.
- `src/rendering/FighterView.ts`: replaceable original placeholder graphics.
- `src/scenes/ArenaScene.ts`: arena, keyboard input, fixed-step scheduling.
- `tests/`: arena, movement, jumping, boundaries, state, and depth tests.

See [M01.2 implementation and validation](docs/M01.2-fighter-movement.md)
for spec alignment, provisional values, scope limits, and manual review steps.
