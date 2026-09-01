# dsh-ba-click-fx

> 🇨🇳 [中文版](./README.zh.md)

Blue Archive (蔚蓝档案) style **click effect and cursor trail** as a DeepSeek Harness **web client plugin**.

This package vendors the open-source library [`ba-click-fx` v1.3.1](https://github.com/CialloKing/ba-click-fx)
(verbatim — see `vendor/ba-click-fx.js`, a zero-dependency ESM bundle) and mounts it
into the DSH web GUI through the standard client-module system. Clicking, dragging or
moving the pointer over the GUI draws the game-style dissolved ring, center disk,
click shards and cursor trail.

The click effect is purely browser-side (DOM / canvas / pointer events), so:
- the **browser half** (`src/client/index.js` → `lib/client.js`) owns all the visuals,
- the **Host half** (`src/index.js` → `lib/index.js`) is a no-op entry point that lets
  the Host Loader activate the row and serve the client bundle.

## Package layout

```
dsh-ba-click-fx/
├── package.json           # dsh.bundle (cordis.patch.yml) + dsh.client (web) declarations
├── cordis.patch.yml       # inserts the plugin row into the loader composition
├── vendor/ba-click-fx.js  # verbatim copy of ba-click-fx v1.3.1 dist bundle (the "照搬" source)
├── src/
│   ├── index.js           # Host half (no-op apply)
│   └── client/index.js    # Browser half (mounts BAClickFX, tears down via ctx.effect)
├── scripts/build.mjs      # assembles lib/ from src/ + vendor/
└── lib/                   # prebuilt artifacts (install-ready)
    ├── index.js
    └── client.js          # lazy-CJS factory: window.__ModuleLoader__.load({id, factory})
```

`lib/client.js` is the artifact format the DSH client module system serves at
`/plugins/dsh-ba-click-fx/client.js`: a closure factory that registers with
`window.__ModuleLoader__.load({ id, factory })`. The vendored ESM bundle's trailing
`export { ... }` is stripped so its symbols (`BAClickFX`, `createConfig`, …) stay
in closure scope; the plugin body re-exports them as CJS `exports` and adds its
`apply(ctx, config)` entry point.

## How it works

1. The Host Loader imports the package's node half and activates a live fiber for
   the row `{ id: ba-click-fx, name: dsh-ba-click-fx }`.
2. The client-modules Host half scans enabled Loader entries for `dsh.client`,
   resolves `exports["./client"]` → `lib/client.js`, hashes it into the boot graph
   and serves it under `/plugins`.
3. In the browser, `apply(ctx, config)` calls `new BAClickFX(...)`, which auto-mounts
   a full-screen overlay canvas (Shadow-DOM-free) and listens to DOM pointer events.
4. `ctx.effect(...)` registers teardown so HMR reload and profile teardown remove the
   overlay and its listeners.

## Install into a profile

From the directory that contains this package (so `./dsh-ba-click-fx` resolves):

```sh
dsh plugin --profile web add ./dsh-ba-click-fx
```

`dsh plugin add` installs the dependency into `$DSH_HOME/profiles/web` (this package
declares `dsh.bundle`, so it is also appended to `dsh.profile.bundles`), then
**restart the `web` profile** so the Host picks up the new client bundle:

```sh
# stop the running web instance, then:
dsh --profile web
```

To remove:

```sh
dsh plugin --profile web remove dsh-ba-click-fx
```

### Manual install (no `dsh` CLI)

1. Copy this package (or a tarball built with `pnpm pack`) into the profile tree.
2. Add it to `$DSH_HOME/profiles/web/package.json` dependencies, e.g.
   `"dsh-ba-click-fx": "link:./dsh-ba-click-fx"`, and append `"dsh-ba-click-fx"`
   to `dsh.profile.bundles`.
3. Run `pnpm install` inside `$DSH_HOME/profiles/web`.
4. Restart the `web` profile.

## Customize the effect

The default theme color is Blue Archive blue (`#4ca7ff`) with the full WebGL2
pipeline and both click + trail enabled. Edit `DEFAULT_CONFIG` in
`src/client/index.js`, then rebuild:

```sh
npm run build
```

Rebuilding rewrites `lib/client.js` (and its source map). Restart the web profile to
pick up the new bundle (the `web` profile is a built install, not the `dev:web`
watcher).

## Notes

- The effect is appended as an overlay and never touches page layout.
- No external runtime dependencies; the vendored bundle is fully self-contained.
- The vendored `vendor/ba-click-fx.js` is copyright of the ba-click-fx authors
  (MIT); see the upstream `LICENSE` / `THIRD_PARTY_NOTICES.md`.
