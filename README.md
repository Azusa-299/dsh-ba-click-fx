# dsh-ba-click-fx

> 🇨🇳 [中文版](./README.zh.md)

Blue Archive (蔚蓝档案) style **click effect + cursor trail** as a DeepSeek Harness **web client plugin**.

This package vendors [`ba-click-fx` v1.3.1](https://github.com/CialloKing/ba-click-fx) verbatim
(`vendor/ba-click-fx.js`, a zero-dependency ESM bundle) and mounts it into the DSH web GUI via
the standard client-module system. Clicking, dragging or moving the pointer draws the game-style
dissolved ring, center disk, click shards and cursor trail.

Everything runs in the browser: the **browser half** (`src/client/index.js` → `lib/client.js`)
owns the visuals, while the **Host half** (`src/index.js` → `lib/index.js`) is a no-op entry that
lets the Host Loader activate the row and serve the client bundle.

## Layout

```
dsh-ba-click-fx/
├── package.json            # dsh.bundle + dsh.client (web) declarations
├── cordis.patch.yml        # inserts the plugin row
├── vendor/ba-click-fx.js   # vendored ba-click-fx v1.3.1 dist bundle
├── src/
│   ├── index.js            # Host half (no-op)
│   └── client/index.js     # browser half: effect + config window + i18n/theme
├── scripts/build.mjs       # assembles lib/ from src/ + vendor/
└── lib/                    # prebuilt artifacts (install-ready)
    ├── index.js
    └── client.js           # lazy-CJS factory: window.__ModuleLoader__.load({id, factory})
```

## How it works

1. The Host Loader imports the node half and activates a fiber for `{ id: ba-click-fx, name: dsh-ba-click-fx }`.
2. The client-modules host scans enabled `dsh.client` entries, resolves `exports["./client"]`
   → `lib/client.js`, hashes it into the boot graph and serves it under `/plugins`.
3. In the browser, `apply(ctx, config)` mounts `new BAClickFX(...)` (a full-screen overlay canvas).
4. `ctx.effect(...)` tears everything down on HMR reload / profile teardown.

## Install

```sh
dsh plugin --profile web add ./dsh-ba-click-fx
# restart the web profile so the new client bundle loads:
dsh --profile web
```

Remove with `dsh plugin --profile web remove dsh-ba-click-fx`.

No `dsh` CLI? Copy this package (or a `pnpm pack` tarball) into the profile, add
`"dsh-ba-click-fx": "link:./dsh-ba-click-fx"` to `dependencies` and `"dsh-ba-click-fx"` to
`dsh.profile.bundles`, run `pnpm install`, then restart.

## Configuration window

A **⚙** gear button appears in the bottom-right corner:

- **left-click** toggles the panel; **right-button-drag** moves it anywhere (position is persisted in `localStorage`);
- edits apply **live** via `fx.setThemeColor()` / `fx.updateConfig()` and persist in `localStorage` (`dsh-ba-click-fx-config`);
- **theme-aware** (uses DSH `--dsw-alias-*` tokens) and **i18n-aware** (detects DSH's locale from `<html lang>` and auto-switches 中文 / English).

| Control | Range | Default |
|---|---|---|
| Theme color | picker | `#4ca7ff` |
| Scale | `0.50 – 3.00` | `1.00` |
| Opacity | `0.00 – 1.00` | `1.00` |
| Click effect | on / off | on |
| Cursor trail | on / off | on |
| Trail always | on / off | on |
| Max DPR | `1.0 – 2.0` | `1.0` |
| Click speed | `0.50 – 2.00×` | `1.00×` |
| Trail speed | `0.50 – 2.00×` | `1.00×` |
| Glow (click + trail bloom) | `0.00 – 4.00` | `1.00` |

## Build-time defaults

Defaults: Blue Archive blue (`#4ca7ff`), full WebGL2, click + trail on. To change the shipped
defaults (backend, theme-color mode, touch action, …), edit `DEFAULT_CONFIG` in
`src/client/index.js` and run `npm run build` (rewrites `lib/client.js` + map), then restart.

## Notes

- The effect is an overlay; it never touches page layout.
- Zero external runtime dependencies.
- `vendor/ba-click-fx.js` is © the ba-click-fx authors (MIT); see upstream `LICENSE` / `THIRD_PARTY_NOTICES.md`.
