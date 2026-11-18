# Sonic Battle Browser Edition

Browser-based isometric arena fighting prototype, built with Phaser 3, TypeScript, and Vite. Engine and placeholder artwork are independent of Sega intellectual property.

## Milestone 1

1. Scaffold a runnable arena with Phaser 3, TypeScript, and Vite.
2. Add two placeholder fighters, eight-direction movement, jumping, and arena bounds.
3. Add light/heavy attacks, hitboxes, damage, knockback, and health bars.
4. Add a basic CPU opponent and automated tests.

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

## M01.4 - CPU opponent

P2 pursues and attacks P1 using the same movement and combat rules. Default
**Normal** difficulty; press **1 / 2 / 3** for **Easy / Normal / Hard**.
Changing difficulty resets the round. **R** resets with the selected difficulty
and the same deterministic seed. Both fighters retain the same statistics.

The CPU runs once per 60 Hz combat tick, independently of Phaser and render rate.
See [CPU architecture, parameters, limitations and validation](docs/M01.4-cpu-opponent.md).

## M01.3 — Combat foundation

Move with **WASD / arrows**, jump with **Space**, attack with **J** (light) or
**K** (heavy), and press **R** to reset training. Face the amber target and move
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
