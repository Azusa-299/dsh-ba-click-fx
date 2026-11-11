# dsh-ba-click-fx

> 🇨🇳 [中文版](./README.zh.md)

Blue Archive style click effect and cursor trail for the DSH web GUI.
Wraps [`ba-click-fx` v1.3.1](https://github.com/CialloKing/ba-click-fx): click rings, shards, and a trail that follows the pointer.

## Install

```sh
dsh plugin --profile web add ./dsh-ba-click-fx
dsh --profile web
```

Uninstall with
```sh
dsh plugin --profile web remove dsh-ba-click-fx
```

No CLI? Drop the folder into the profile, add `"dsh-ba-click-fx": "link:./dsh-ba-click-fx"` to `dependencies` and `"dsh-ba-click-fx"` to `dsh.profile.bundles`, run `pnpm install`, restart.

## Settings

Settings → **Click FX** (halo icon). Changes apply instantly and persist to `localStorage` (`dsh-ba-click-fx-config`).

| Control | Range | Default |
|---|---|---|
| Theme color | picker | `#4ca7ff` |
| Scale | 0.50–3.00 | 1.00 |
| Opacity | 0.00–1.00 | 1.00 |
| Click effect | on/off | on |
| Cursor trail | on/off | on |
| Trail always | on/off | off |
| Max DPR | 1.0–2.0 | 1.0 |
| Click speed | 0.50–2.00× | 1.00× |
| Trail speed | 0.50–2.00× | 1.00× |
| Glow | 0.00–4.00 | 1.00 |

Colors follow the host theme (`--dsw-alias-*`), copy follows the host locale (zh/en, English fallback).

## Build

`lib/` is prebuilt and committed. After touching `src/`:

```sh
npm run build   # src/ + vendor/ → lib/
npm test        # load the bundle, check exports and slot registration
```

Shipped defaults live in `src/client/index.js`: `DEFAULT_CONFIG` for backend, theme mode and touch action; `CONTROL_DEFS` for the panel ranges and per-control defaults.

## License

MIT. `vendor/ba-click-fx.js` is © CialloKing, see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
