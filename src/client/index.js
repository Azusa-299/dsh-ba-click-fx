/**
 * Browser half of the dsh-ba-click-fx client plugin.
 *
 * This file is a *fragment*: it is not imported directly. `scripts/build.mjs`
 * inlines the vendored ba-click-fx ESM bundle (`vendor/ba-click-fx.js`, with its
 * trailing `export { ... }` stripped) and then appends this body inside the
 * lazy-CJS factory of `lib/client.js`. As a result, `BAClickFX` is in scope and
 * `exports`/`module` are the CJS module object the factory returns.
 *
 * On activation it instantiates `BAClickFX` over a full-screen overlay canvas
 * and registers teardown through `ctx.effect`, so HMR unload/reload and profile
 * teardown remove the overlay and listeners.
 *
 * Defaults mirror the library's game defaults; customize them in the factory
 * config below or by editing this file and re-running `npm run build`.
 */

const DEFAULT_CONFIG = Object.freeze({
  // Blue Archive default theme blue (#4ca7ff).
  themeColor: '#4ca7ff',
  themeColorMode: 'relative-oklch',
  // Default rendering chain: full WebGL2, with safe fallbacks.
  effectBackend: 'webgl2',
  bloomBackend: 'webgl2',
  // Both click ring/disk and the cursor trail are enabled by default.
  clickEnabled: true,
  trailEnabled: true,
  trailAlways: true,
  // Keep the page scroll / touch behavior unchanged where possible.
  touchAction: 'auto',
  // Cap devicePixelRatio for predictable GPU cost on the overlay.
  maxDpr: 1,
})

/**
 * Browser plugin body: mount the full-screen Blue Archive click effect and
 * cursor trail, and tear it down when the plugin is unloaded.
 * @param ctx - client cordis context.
 * @param config - optional per-deployment overrides (spread over the defaults).
 */
function apply(ctx, config = {}) {
  // The client tree can be booted outside a browser (node e2e); there is no
  // DOM to attach an overlay canvas to, so mount nothing.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }
  const fx = new BAClickFX({ ...DEFAULT_CONFIG, ...config })
  ctx.effect(
    () => () => { fx.destroy() },
    'dsh-ba-click-fx: click effect lifecycle',
  )
}

// A client bundle that has no cross-plugin value imports needs no `inject`.
// The module table seed provides nothing this body `require()`s.
Object.assign(exports, { name: 'ba-click-fx', apply })
