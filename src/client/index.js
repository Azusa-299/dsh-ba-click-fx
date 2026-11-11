/**
 * Browser half of the dsh-ba-click-fx client plugin.
 *
 * This file is a *fragment*: it is not imported directly. `scripts/build.mjs`
 * inlines the vendored ba-click-fx ESM bundle (`vendor/ba-click-fx.js`, with its
 * trailing `export { ... }` stripped) and then appends this body inside the
 * lazy-CJS factory of `lib/client.js`. As a result, `BAClickFX` is in scope and
 * `exports`/`module` are the CJS module object the factory returns.
 *
 * On activation it:
 *   1. mounts the full-screen Blue Archive click effect + cursor trail
 *      (`new BAClickFX`),
 *   2. registers one page in the DSH Settings dialog's left navigation
 *      (`settings.section`) plus its own navigation glyph
 *      (`settings.section.icon`) — there is no separate floating window any
 *      more, so the effect is configured where every other DSH preference
 *      lives,
 *   3. edits the effect live through `fx.updateConfig()` / `fx.setThemeColor()`
 *      and persists choices in `localStorage`,
 *   4. routes all visible copy through the Client locale service
 *      (`ctx.locale`), inheriting the host theme through the `--dsw-alias-*`
 *      tokens,
 *   5. tears everything down through `ctx.effect`, so HMR unload/reload and
 *      profile teardown remove the overlay and both slot registrations.
 */

const React = require('react')
const h = React.createElement

const STORAGE_KEY = 'dsh-ba-click-fx-config'
/** Settings section id (also the id its navigation icon registration answers to). */
const SECTION_ID = 'ba-click-fx'
/** Locale namespace owned by this plugin. */
const LOCALE_NS = 'ba-click-fx'

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
  // Trail only appears while the pointer is held down (left-drag), not on every
  // move.
  trailAlways: false,
  // Keep the page scroll / touch behavior unchanged where possible.
  touchAction: 'auto',
  // Cap devicePixelRatio for predictable GPU cost on the overlay.
  maxDpr: 1,
  scale: 1,
  opacity: 1,
  clickTimeScale: 1,
  trailTimeScale: 1,
})

// --- persistence -----------------------------------------------------------

function loadStored(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Persist one value, reporting whether the browser accepted the write.
 * Storage may be unavailable (private mode / disabled): the effect still works
 * live, and the page surfaces the failure instead of claiming a save.
 * @param key - storage key.
 * @param value - JSON-serializable value.
 * @returns true when the write succeeded.
 */
function storeValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

// --- copy -------------------------------------------------------------------

// Flat dictionaries for the `ba-click-fx` locale namespace. The locale service
// falls back through each language's chain to `en`, so other languages read
// English until a dedicated dictionary is added.
const I18N = {
  zh: {
    nav: '点击特效',
    title: '点击特效',
    intro: '《蔚蓝档案》风格的点击圆环、点击碎片与光标拖尾。修改会即时生效。',
    themeColor: '主题颜色',
    themeColorDesc: '点击圆环与拖尾的主色。',
    scale: '全局缩放',
    scaleDesc: '特效整体尺寸的倍率。',
    opacity: '不透明度',
    opacityDesc: '特效覆盖层的整体不透明度。',
    clickEnabled: '点击特效',
    clickEnabledDesc: '点击时绘制圆环、光盘与碎片。',
    trailEnabled: '光标拖尾',
    trailEnabledDesc: '指针移动时绘制拖尾。',
    trailAlways: '拖尾始终显示',
    trailAlwaysDesc: '开启后无需按住鼠标；关闭时只在拖动时显示。',
    maxDpr: '最大 DPR',
    maxDprDesc: '限制覆盖层像素比，降低 GPU 开销。',
    clickTimeScale: '点击速度',
    clickTimeScaleDesc: '点击动画的时间倍率。',
    trailTimeScale: '拖尾速度',
    trailTimeScaleDesc: '拖尾动画的时间倍率。',
    glow: '光晕',
    glowDesc: '点击与拖尾辉光的强度倍率。',
    reset: '恢复默认',
    saved: '已保存',
    saveError: '保存失败：浏览器存储不可用。',
  },
  en: {
    nav: 'Click FX',
    title: 'Click effect',
    intro: 'Blue Archive style click rings, click shards and a cursor trail. Changes apply immediately.',
    themeColor: 'Theme color',
    themeColorDesc: 'Main color of the click rings and trail.',
    scale: 'Scale',
    scaleDesc: 'Overall effect size multiplier.',
    opacity: 'Opacity',
    opacityDesc: 'Overall opacity of the effect overlay.',
    clickEnabled: 'Click effect',
    clickEnabledDesc: 'Draw rings, the center disk and shards on click.',
    trailEnabled: 'Cursor trail',
    trailEnabledDesc: 'Draw a trail while the pointer moves.',
    trailAlways: 'Trail always',
    trailAlwaysDesc: 'When off, the trail appears only while dragging.',
    maxDpr: 'Max DPR',
    maxDprDesc: 'Cap the overlay pixel ratio to limit GPU cost.',
    clickTimeScale: 'Click speed',
    clickTimeScaleDesc: 'Time multiplier for the click animation.',
    trailTimeScale: 'Trail speed',
    trailTimeScaleDesc: 'Time multiplier for the trail animation.',
    glow: 'Glow',
    glowDesc: 'Emission multiplier for click and trail bloom.',
    reset: 'Reset',
    saved: 'Saved',
    saveError: 'Could not save: browser storage is unavailable.',
  },
}

// --- page styles ------------------------------------------------------------

// Scoped to the section page and rendered as a React element, so unmounting the
// page removes the stylesheet with it. Colors are host theme tokens only.
const SECTION_CSS = `
.bafx-section{display:flex;flex-direction:column;max-width:760px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.5}
.bafx-title{margin:0;font-size:18px;line-height:26px;font-weight:600}
.bafx-intro{margin:6px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.bafx-rows{display:flex;flex-direction:column;margin-top:18px;border-top:0.5px solid var(--dsw-alias-border-l2)}
.bafx-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.bafx-row-label{display:flex;flex-direction:column;gap:2px;min-width:0}
.bafx-label{flex:0 1 auto;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}
.bafx-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.bafx-control{display:flex;flex:none;align-items:center;gap:10px}
.bafx-range{width:180px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.bafx-value{min-width:46px;text-align:right;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.bafx-color{box-sizing:border-box;width:44px;height:28px;padding:2px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:transparent;cursor:pointer}
.bafx-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}
.bafx-switch[aria-checked='true']{background:var(--dsw-alias-brand-primary)}
.bafx-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.bafx-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-switch-thumb);transition:transform 120ms ease}
.bafx-switch[aria-checked='true'] .bafx-thumb{background:var(--dsw-alias-label-primary-foreground);transform:translateX(16px)}
.bafx-actions{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px}
.bafx-status{margin:0;flex:1 1 auto;min-height:18px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.bafx-status[data-error='true']{color:var(--dsw-alias-state-error-primary)}
.bafx-reset{flex:none;border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:6px 14px;cursor:pointer}
.bafx-reset:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
@media (hover:hover){.bafx-reset:hover{background:var(--dsw-alias-interactive-bg-hover)}}
@media (max-width:520px){.bafx-row{gap:16px}.bafx-control{gap:8px}.bafx-range{width:120px}.bafx-value{min-width:38px}}
`

// --- configurable fields ----------------------------------------------------

// One row per configurable field: key, label-key, control kind and bounds.
const CONTROL_DEFS = [
  { key: 'themeColor', labelKey: 'themeColor', descKey: 'themeColorDesc', type: 'color' },
  { key: 'scale', labelKey: 'scale', descKey: 'scaleDesc', type: 'range', min: 0.5, max: 3, step: 0.05, format: v => v.toFixed(2) },
  { key: 'opacity', labelKey: 'opacity', descKey: 'opacityDesc', type: 'range', min: 0, max: 1, step: 0.01, format: v => v.toFixed(2) },
  { key: 'clickEnabled', labelKey: 'clickEnabled', descKey: 'clickEnabledDesc', type: 'checkbox' },
  { key: 'trailEnabled', labelKey: 'trailEnabled', descKey: 'trailEnabledDesc', type: 'checkbox' },
  { key: 'trailAlways', labelKey: 'trailAlways', descKey: 'trailAlwaysDesc', type: 'checkbox' },
  { key: 'maxDpr', labelKey: 'maxDpr', descKey: 'maxDprDesc', type: 'range', min: 1, max: 2, step: 0.1, format: v => v.toFixed(1) },
  { key: 'clickTimeScale', labelKey: 'clickTimeScale', descKey: 'clickTimeScaleDesc', type: 'range', min: 0.5, max: 2, step: 0.05, format: v => v.toFixed(2) },
  { key: 'trailTimeScale', labelKey: 'trailTimeScale', descKey: 'trailTimeScaleDesc', type: 'range', min: 0.5, max: 2, step: 0.05, format: v => v.toFixed(2) },
  // Glow (bloom) after clicking. Shared multiplier that scales both the click
  // and trail bloom; an Fx param, not a constructor key.
  { key: 'glowIntensity', labelKey: 'glow', descKey: 'glowDesc', type: 'range', min: 0, max: 4, step: 0.05, format: v => v.toFixed(2), default: 1, glow: true },
]

// The subset of defaults the page can edit (reset must only touch these keys).
const PANEL_DEFAULTS = Object.fromEntries(
  CONTROL_DEFS.map(def => [def.key, def.default ?? DEFAULT_CONFIG[def.key]]),
)

// Panel keys that are Fx params (set via fx.setFxParam) and must NOT be passed
// to the BAClickFX constructor.
const FX_PARAM_KEYS = new Set(
  CONTROL_DEFS.filter(def => def.fxParam || def.glow).map(def => def.key),
)

// Unity's baseline trail bloom emission strength; the shared glow slider scales
// both click and trail bloom from this baseline.
const TRAIL_EMISSION_BASE = 23.968628

/** Apply the shared glow multiplier to both click and trail bloom. */
function applyGlow(fx, value) {
  fx.setFxParam('bloom.clickEmissionScale', value)
  fx.setFxParam('bloom.trailEmission', TRAIL_EMISSION_BASE * value)
}

/**
 * Copy the panel-owned values out of a merged config, applying each field's
 * default when the stored document predates it.
 * @param source - merged configuration.
 * @returns a fresh plain object keyed by CONTROL_DEFS.
 */
function pickPanelValues(source) {
  const values = {}
  for (const def of CONTROL_DEFS) {
    values[def.key] = source[def.key] ?? def.default ?? DEFAULT_CONFIG[def.key]
  }
  return values
}

/**
 * Live configuration store shared by the settings page and the effect.
 * The snapshot is `{ values, status }`; every write applies to the effect
 * immediately and lands in `localStorage` after a short trailing debounce so a
 * dragged slider does not write on every pixel. The status drives the page's
 * save feedback (idle → saved, or error when storage rejects the write).
 * @param fx - mounted BAClickFX instance.
 * @param initial - panel values to start from.
 * @returns the store face injected into the settings page.
 */
function createConfigStore(fx, initial) {
  let state = { values: pickPanelValues(initial), status: 'idle' }
  const listeners = new Set()
  let saveTimer
  let statusTimer

  const applyOne = (def, value) => {
    if (def.key === 'themeColor') fx.setThemeColor(value)
    else if (def.glow) applyGlow(fx, value)
    else if (def.fxParam) fx.setFxParam(def.fxParam, value)
    else fx.updateConfig({ [def.key]: value })
  }

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const clearStatusTimer = () => {
    if (statusTimer === undefined) return
    clearTimeout(statusTimer)
    statusTimer = undefined
  }

  const publishStatus = (status) => {
    clearStatusTimer()
    state = { ...state, status }
    emit()
    if (status !== 'saved') return
    // The confirmation is transient; the idle state keeps the line's height.
    statusTimer = setTimeout(() => {
      statusTimer = undefined
      if (state.status !== 'saved') return
      state = { ...state, status: 'idle' }
      emit()
    }, 1600)
  }

  const flush = () => {
    saveTimer = undefined
    publishStatus(storeValue(STORAGE_KEY, state.values) ? 'saved' : 'error')
  }

  const scheduleSave = () => {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, 200)
  }

  const commit = (values) => {
    clearStatusTimer()
    state = { values, status: 'idle' }
    emit()
  }

  return {
    /** @returns the current `{ values, status }` snapshot (stable until a write). */
    get() {
      return state
    },
    /**
     * Apply one field live and schedule its persistence.
     * @param key - CONTROL_DEFS key.
     * @param value - new value.
     */
    set(key, value) {
      const def = CONTROL_DEFS.find(candidate => candidate.key === key)
      if (def === undefined) return
      commit({ ...state.values, [key]: value })
      applyOne(def, value)
      scheduleSave()
    },
    /** Restore every panel-owned field to its default. */
    reset() {
      const values = { ...PANEL_DEFAULTS }
      commit(values)
      for (const def of CONTROL_DEFS) applyOne(def, values[def.key])
      scheduleSave()
    },
    /**
     * Subscribe to state changes.
     * @param listener - called after every commit or status change.
     * @returns unsubscribe.
     */
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Flush a pending write and release timers when the plugin unloads. */
    dispose() {
      if (saveTimer !== undefined) {
        clearTimeout(saveTimer)
        saveTimer = undefined
        storeValue(STORAGE_KEY, state.values)
      }
      clearStatusTimer()
      listeners.clear()
    },
  }
}

// --- settings page components ----------------------------------------------

/**
 * Render one control for a field.
 * @param def - field definition.
 * @param values - current panel values.
 * @param api - live config store.
 * @param labelId - id of the visible label element.
 * @param descId - id of the description element.
 * @returns the control element(s).
 */
function renderControl(def, values, api, labelId, descId) {
  const inputId = `dsh-ba-click-fx-${def.key}`
  const value = values[def.key]
  if (def.type === 'color') {
    return h('input', {
      id: inputId,
      type: 'color',
      className: 'bafx-color',
      value: typeof value === 'string' ? value : String(value),
      'aria-labelledby': labelId,
      'aria-describedby': descId,
      onChange: (event) => { api.set(def.key, event.target.value) },
    })
  }
  if (def.type === 'range') {
    return [
      h('input', {
        key: 'input',
        id: inputId,
        type: 'range',
        className: 'bafx-range',
        min: String(def.min),
        max: String(def.max),
        step: String(def.step),
        value: String(value),
        'aria-labelledby': labelId,
        'aria-describedby': descId,
        onChange: (event) => { api.set(def.key, Number(event.target.value)) },
      }),
      h('output', {
        key: 'output',
        className: 'bafx-value',
        htmlFor: inputId,
      }, def.format ? def.format(Number(value)) : String(value)),
    ]
  }
  const checked = value === true
  return h('button', {
    id: inputId,
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    'aria-labelledby': labelId,
    'aria-describedby': descId,
    className: 'bafx-switch',
    onClick: () => { api.set(def.key, !checked) },
  }, h('span', { className: 'bafx-thumb', 'aria-hidden': true }))
}

/**
 * One settings page row: visible label plus its control.
 * @param def - field definition.
 * @param values - current panel values.
 * @param api - live config store.
 * @param t - localized copy.
 * @returns the row element.
 */
function renderRow(def, values, api, t) {
  const labelId = `dsh-ba-click-fx-${def.key}-label`
  const descId = `dsh-ba-click-fx-${def.key}-desc`
  return h('div', { className: 'bafx-row', key: def.key },
    h('div', { className: 'bafx-row-label' },
      h('span', { className: 'bafx-label', id: labelId }, t(def.labelKey)),
      h('span', { className: 'bafx-desc', id: descId }, t(def.descKey)),
    ),
    h('div', { className: 'bafx-control' }, renderControl(def, values, api, labelId, descId)),
  )
}

/**
 * The `settings.section` page: the effect's preference rows.
 * @param props - owner `close`, the framework `t` seat and the injected store.
 * @returns the section page.
 */
function BaClickFxSection(props) {
  const { t, api } = props
  const { values, status } = React.useSyncExternalStore(api.subscribe, api.get, api.get)
  const statusText = status === 'saved' ? t('saved') : status === 'error' ? t('saveError') : ''
  return h('div', { className: 'bafx-section' },
    h('style', null, SECTION_CSS),
    h('h2', { className: 'bafx-title' }, t('title')),
    h('p', { className: 'bafx-intro' }, t('intro')),
    h('div', { className: 'bafx-rows' }, CONTROL_DEFS.map(def => renderRow(def, values, api, t))),
    h('div', { className: 'bafx-actions' },
      h('p', {
        className: 'bafx-status',
        role: status === 'error' ? 'alert' : 'status',
        'aria-live': status === 'error' ? 'assertive' : 'polite',
        'data-error': status === 'error' ? 'true' : undefined,
      }, statusText),
      h('button', { type: 'button', className: 'bafx-reset', onClick: () => { api.reset() } }, t('reset')),
    ),
  )
}

/**
 * The `settings.section.icon` glyph: a Blue Archive halo (tilted ring) with a
 * sparkle, drawn in `currentColor` so the shell's nav states theme it.
 * @param props.size - requested square edge in pixels.
 * @returns the navigation icon.
 */
function BaClickFxIcon({ size = 16 }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': true,
    focusable: 'false',
    style: { display: 'block' },
  },
  h('ellipse', {
    cx: 8,
    cy: 10,
    rx: 5.7,
    ry: 2.2,
    transform: 'rotate(-12 8 10)',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round',
  }),
  h('path', {
    d: 'M11.6 2.3l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z',
    fill: 'currentColor',
  }),
  )
}

// --- activation -------------------------------------------------------------

/**
 * Browser plugin body: mount the full-screen Blue Archive click effect and
 * cursor trail, publish its settings page and navigation icon, and tear
 * everything down when the plugin is unloaded.
 * @param ctx - client cordis context.
 * @param config - optional per-deployment overrides (spread over the defaults).
 */
function apply(ctx, config = {}) {
  // The client tree can be booted outside a browser (node e2e); there is no
  // DOM to attach an overlay canvas to, so mount nothing.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }
  const saved = loadStored(STORAGE_KEY)
  const merged = { ...DEFAULT_CONFIG, ...PANEL_DEFAULTS, ...saved, ...config }
  // Fx-param keys (glow) are not BAClickFX constructor options.
  const constructorOptions = Object.fromEntries(
    Object.entries(merged).filter(([key]) => !FX_PARAM_KEYS.has(key)),
  )
  const fx = new BAClickFX(constructorOptions)
  // Apply any persisted Fx params that the page owns.
  for (const def of CONTROL_DEFS) {
    if (merged[def.key] === undefined) continue
    if (def.glow) applyGlow(fx, merged[def.key])
    else if (def.fxParam) fx.setFxParam(def.fxParam, merged[def.key])
  }
  ctx.effect(
    () => () => { fx.destroy() },
    'dsh-ba-click-fx: click effect lifecycle',
  )

  const configStore = createConfigStore(fx, merged)
  ctx.effect(
    () => () => { configStore.dispose() },
    'dsh-ba-click-fx: config store timers',
  )
  // Copy follows the host language: the locale service falls back to English
  // for languages this plugin does not translate yet.
  ctx.effect(
    () => ctx.locale.register(LOCALE_NS, I18N),
    'dsh-ba-click-fx: copy dictionaries',
  )
  const t = ctx.locale.bind(LOCALE_NS)

  // The settings page lives in the Settings dialog's left navigation, beside
  // the host's own sections; the page replaces the old floating gear window.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: 30,
    label: () => t('nav'),
    locale: LOCALE_NS,
    inject: () => ({ api: configStore }),
  }, BaClickFxSection))

  // Its own navigation glyph (Blue Archive halo), addressed by the section id.
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon',
    id: SECTION_ID,
    order: 30,
  }, BaClickFxIcon))
}

// `slots` and `locale` are the two services this body uses; waiting for both
// makes the client activation audit report a missing host service instead of
// letting registration throw mid-apply.
Object.assign(exports, {
  name: 'ba-click-fx',
  inject: ['slots', 'locale'],
  apply,
})
