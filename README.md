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

Implement in small feature branches and verify each stage before adding combat.
