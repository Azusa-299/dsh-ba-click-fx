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
 *   2. shows a self-contained configuration window: a draggable gear button
 *      (bottom-right by default, position persisted) + a panel that edits the
 *      effect live via `fx.updateConfig()` / `fx.setThemeColor()` and persists
 *      choices in `localStorage`,
 *   3. adapts the window to the host theme through the DSH `--dsw-alias-*`
 *      tokens (light / dark aware, with fallbacks when those tokens are absent),
 *   4. registers teardown through `ctx.effect`, so HMR unload/reload and profile
 *      teardown remove the overlay, the config window and their listeners.
 */

const STORAGE_KEY = 'dsh-ba-click-fx-config'
const UI_STORAGE_KEY = 'dsh-ba-click-fx-ui'

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

function storeValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may be unavailable (private mode / disabled) — state stays
    // session-only and the UI still works.
  }
}

// --- configuration window --------------------------------------------------

const PANEL_STYLE_ID = 'dsh-ba-fx-style'

// Theme-aware via DSH `--dsw-alias-*` tokens (light/dark), with hardcoded
// fallbacks for hosts that do not load the theme token stylesheet.
const PANEL_CSS = `
#dsh-ba-fx-toggle{position:fixed;z-index:2147483000;width:46px;height:46px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.18));background:var(--dsw-alias-bg-layer-2,rgba(15,20,30,.9));color:var(--dsw-alias-label-primary,#fff);font-size:22px;line-height:1;cursor:grab;box-shadow:0 4px 18px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;user-select:none;transition:background .15s}
#dsh-ba-fx-toggle:active{cursor:grabbing}
#dsh-ba-fx-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.12))}
#dsh-ba-fx-panel{position:fixed;z-index:2147483000;width:280px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,rgba(15,20,30,.95));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.16));border-radius:12px;padding:14px 16px 12px;box-shadow:0 10px 34px rgba(0,0,0,.5);color:var(--dsw-alias-label-primary,#e8ebf2);font:12px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:none}
#dsh-ba-fx-panel.open{display:block}
#dsh-ba-fx-panel h4{margin:0 0 10px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#fff)}
#dsh-ba-fx-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
#dsh-ba-fx-row label{flex:0 0 auto;color:var(--dsw-alias-label-secondary,#c9cedb)}
#dsh-ba-fx-row .ctrl{flex:1 1 auto;display:flex;align-items:center;justify-content:flex-end;gap:8px}
#dsh-ba-fx-row input[type=range]{width:100%}
#dsh-ba-fx-row input[type=color]{width:44px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.2));border-radius:5px;background:none;cursor:pointer}
#dsh-ba-fx-row input[type=checkbox]{width:auto}
#dsh-ba-fx-row output{min-width:30px;text-align:right;color:var(--dsw-alias-label-secondary,#aab3c4);font-variant-numeric:tabular-nums}
#dsh-ba-fx-actions{display:flex;justify-content:space-between;gap:8px;margin-top:10px}
#dsh-ba-fx-actions button{flex:1;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.18));background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e8ebf2);border-radius:7px;padding:6px 8px;font:inherit;cursor:pointer}
#dsh-ba-fx-actions button:hover{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14))}
`

// --- i18n -------------------------------------------------------------------
// DSH keeps the active locale on <html lang> (e.g. "zh-CN" / "en"). Detect it
// from the document and re-apply the window strings when it changes.
const I18N = {
  zh: {
    title: 'ba-click-fx 特效配置',
    toggleTitle: '配置 ba-click-fx（右键拖动可移动位置）',
    aria: 'ba-click-fx 配置',
    themeColor: '主题颜色',
    scale: '全局缩放',
    opacity: '不透明度',
    clickEnabled: '点击特效',
    trailEnabled: '光标拖尾',
    trailAlways: '拖尾始终显示',
    maxDpr: '最大 DPR',
    clickTimeScale: '点击速度',
    trailTimeScale: '拖尾速度',
    glow: '光晕',
    reset: '恢复默认',
    close: '关闭',
  },
  en: {
    title: 'ba-click-fx Effect Settings',
    toggleTitle: 'Configure ba-click-fx (right-drag to move)',
    aria: 'ba-click-fx configuration',
    themeColor: 'Theme color',
    scale: 'Scale',
    opacity: 'Opacity',
    clickEnabled: 'Click effect',
    trailEnabled: 'Cursor trail',
    trailAlways: 'Trail always',
    maxDpr: 'Max DPR',
    clickTimeScale: 'Click speed',
    trailTimeScale: 'Trail speed',
    glow: 'Glow',
    reset: 'Reset',
    close: 'Close',
  },
}

function detectLang() {
  const docLang = typeof document !== 'undefined' ? (document.documentElement.lang || '') : ''
  const navLang = typeof navigator !== 'undefined' ? (navigator.language || '') : ''
  const tag = (docLang || navLang || 'en').toLowerCase()
  return tag.startsWith('zh') ? 'zh' : 'en'
}

// One row per configurable field: key, label-key, control kind and bounds.
const CONTROL_DEFS = [
  { key: 'themeColor', labelKey: 'themeColor', type: 'color' },
  { key: 'scale', labelKey: 'scale', type: 'range', min: 0.5, max: 3, step: 0.05, format: v => v.toFixed(2) },
  { key: 'opacity', labelKey: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, format: v => v.toFixed(2) },
  { key: 'clickEnabled', labelKey: 'clickEnabled', type: 'checkbox' },
  { key: 'trailEnabled', labelKey: 'trailEnabled', type: 'checkbox' },
  { key: 'trailAlways', labelKey: 'trailAlways', type: 'checkbox' },
  { key: 'maxDpr', labelKey: 'maxDpr', type: 'range', min: 1, max: 2, step: 0.1, format: v => v.toFixed(1) },
  { key: 'clickTimeScale', labelKey: 'clickTimeScale', type: 'range', min: 0.5, max: 2, step: 0.05, format: v => v.toFixed(2) },
  { key: 'trailTimeScale', labelKey: 'trailTimeScale', type: 'range', min: 0.5, max: 2, step: 0.05, format: v => v.toFixed(2) },
  // Glow (bloom) after clicking. Shared multiplier that scales both the click
  // and trail bloom; an Fx param, not a constructor key.
  { key: 'glowIntensity', labelKey: 'glow', type: 'range', min: 0, max: 4, step: 0.05, format: v => v.toFixed(2), default: 1, glow: true },
]

// The subset of defaults the panel can edit (reset must only touch these keys).
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

const bafxClamp = (value, min, max) => Math.min(max, Math.max(min, value))
const BTN_SIZE = 46
const PANEL_W = 280
const PANEL_H = 300

/** Build the draggable gear toggle + configuration panel. Returns { destroy }. */
function createConfigPanel(fx, initial = PANEL_DEFAULTS, uiState) {
  // Own style sheet (tagged so the client module system's HMR bookkeeping
  // recognizes it).
  if (document.getElementById(PANEL_STYLE_ID) === null) {
    const style = document.createElement('style')
    style.id = PANEL_STYLE_ID
    style.dataset.plugin = 'dsh-ba-click-fx'
    style.dataset.pluginCss = PANEL_STYLE_ID
    style.textContent = PANEL_CSS
    document.head.appendChild(style)
  }

  const viewportW = () => window.innerWidth
  const viewportH = () => window.innerHeight

  const toggle = document.createElement('button')
  toggle.id = 'dsh-ba-fx-toggle'
  toggle.type = 'button'
  toggle.textContent = '⚙'

  const panel = document.createElement('div')
  panel.id = 'dsh-ba-fx-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'ba-click-fx 配置')

  const title = document.createElement('h4')
  title.textContent = 'ba-click-fx 特效配置'
  panel.appendChild(title)

  const inputs = new Map()
  const labelEls = new Map()
  for (const def of CONTROL_DEFS) {
    const row = document.createElement('div')
    row.id = 'dsh-ba-fx-row'
    const label = document.createElement('label')
    label.textContent = def.labelKey
    label.htmlFor = `dsh-ba-fx-${def.key}`
    const ctrl = document.createElement('span')
    ctrl.className = 'ctrl'

    let input
    if (def.type === 'checkbox') {
      input = document.createElement('input')
      input.type = 'checkbox'
      input.id = `dsh-ba-fx-${def.key}`
      ctrl.appendChild(input)
    } else {
      input = document.createElement('input')
      input.type = def.type
      input.id = `dsh-ba-fx-${def.key}`
      if (def.type === 'range') {
        input.min = String(def.min)
        input.max = String(def.max)
        input.step = String(def.step)
        const out = document.createElement('output')
        out.htmlFor = input.id
        ctrl.appendChild(input)
        ctrl.appendChild(out)
        inputs.set(`${def.key}:out`, out)
      } else {
        ctrl.appendChild(input)
      }
    }
    row.appendChild(label)
    row.appendChild(ctrl)
    panel.appendChild(row)
    inputs.set(def.key, input)
    labelEls.set(def.key, label)
  }

  // Reset / close actions.
  const actions = document.createElement('div')
  actions.id = 'dsh-ba-fx-actions'
  const resetBtn = document.createElement('button')
  resetBtn.type = 'button'
  resetBtn.textContent = '恢复默认'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.textContent = '关闭'
  actions.appendChild(resetBtn)
  actions.appendChild(closeBtn)
  panel.appendChild(actions)

  document.body.appendChild(toggle)
  document.body.appendChild(panel)

  // --- i18n: detect the DSH locale and re-apply strings on change ----------
  let lang = detectLang()
  const applyStrings = (value) => {
    const dict = I18N[value] || I18N.en
    title.textContent = dict.title
    toggle.title = dict.toggleTitle
    panel.setAttribute('aria-label', dict.aria)
    for (const def of CONTROL_DEFS) {
      const label = labelEls.get(def.key)
      if (label) label.textContent = dict[def.labelKey]
    }
    resetBtn.textContent = dict.reset
    closeBtn.textContent = dict.close
  }
  applyStrings(lang)
  const localeObserver = new MutationObserver(() => {
    const next = detectLang()
    if (next !== lang) {
      lang = next
      applyStrings(next)
    }
  })
  localeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })

  // --- position (drag-to-move) ---------------------------------------------
  const clampPos = (left, top) => ({
    left: bafxClamp(left, 8, Math.max(8, viewportW() - BTN_SIZE - 8)),
    top: bafxClamp(top, 8, Math.max(8, viewportH() - BTN_SIZE - 8)),
  })
  let pos = (uiState && Number.isFinite(uiState.left) && Number.isFinite(uiState.top))
    ? clampPos(uiState.left, uiState.top)
    : clampPos(viewportW() - BTN_SIZE - 20, viewportH() - BTN_SIZE - 20)

  const applyButtonPos = () => {
    toggle.style.left = `${pos.left}px`
    toggle.style.top = `${pos.top}px`
  }
  applyButtonPos()

  // --- position: right-button drag-to-move, left-button toggles the panel ---
  let drag = null
  let suppressClick = false
  toggle.addEventListener('contextmenu', (event) => event.preventDefault())

  const onPointerDown = (event) => {
    // Only the right button (button === 2) starts a drag. The left button keeps
    // its normal behaviour and toggles the panel via the `click` event below.
    if (event.button !== 2) return
    event.preventDefault()
    drag = {
      startX: event.clientX, startY: event.clientY,
      startLeft: pos.left, startTop: pos.top,
      moved: false,
    }
    try { toggle.setPointerCapture(event.pointerId) } catch { /* older browsers */ }
  }
  const onPointerMove = (event) => {
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true
    if (!drag.moved) return
    pos = clampPos(drag.startLeft + dx, drag.startTop + dy)
    applyButtonPos()
  }
  const onPointerEnd = (event) => {
    if (!drag) return
    const moved = drag.moved
    drag = null
    try { toggle.releasePointerCapture(event.pointerId) } catch { /* older browsers */ }
    if (moved) {
      // A right-button drag that actually moved: persist the new position and
      // ignore any click the browser may still synthesize.
      suppressClick = true
      storeValue(UI_STORAGE_KEY, { left: pos.left, top: pos.top })
      setTimeout(() => { suppressClick = false }, 0)
    }
  }
  toggle.addEventListener('pointerdown', onPointerDown)
  toggle.addEventListener('pointermove', onPointerMove)
  toggle.addEventListener('pointerup', onPointerEnd)
  toggle.addEventListener('pointercancel', onPointerEnd)

  const positionPanel = () => {
    const rect = toggle.getBoundingClientRect()
    let left = rect.left
    if (left + PANEL_W > viewportW() - 12) left = viewportW() - PANEL_W - 12
    let top = rect.top - PANEL_H - 10
    if (top < 12) top = rect.bottom + 10
    if (top + PANEL_H > viewportH() - 12) top = viewportH() - PANEL_H - 12
    panel.style.left = `${Math.max(12, left)}px`
    panel.style.top = `${Math.max(12, top)}px`
  }

  const onResize = () => {
    pos = clampPos(pos.left, pos.top)
    applyButtonPos()
    if (panel.classList.contains('open')) positionPanel()
  }
  window.addEventListener('resize', onResize)

  // Left-click toggles the panel (the right button is reserved for dragging).
  const onClick = () => {
    if (suppressClick) return
    panel.classList.toggle('open')
    if (panel.classList.contains('open')) positionPanel()
  }
  toggle.addEventListener('click', onClick)

  // --- config controls -----------------------------------------------------
  const readControls = () => {
    const value = {}
    for (const def of CONTROL_DEFS) {
      const input = inputs.get(def.key)
      if (def.type === 'checkbox') value[def.key] = input.checked
      else if (def.type === 'color') value[def.key] = input.value
      else value[def.key] = Number(input.value)
    }
    return value
  }

  const applyToFx = (value) => {
    for (const def of CONTROL_DEFS) {
      if (!(def.key in value)) continue
      const v = value[def.key]
      if (def.key === 'themeColor') fx.setThemeColor(v)
      else if (def.glow) applyGlow(fx, v)
      else if (def.fxParam) fx.setFxParam(def.fxParam, v)
      else fx.updateConfig({ [def.key]: v })
    }
  }

  const syncControls = (value) => {
    for (const def of CONTROL_DEFS) {
      const input = inputs.get(def.key)
      const raw = value[def.key]
      const fallback = def.default ?? DEFAULT_CONFIG[def.key]
      if (def.type === 'checkbox') input.checked = raw === true
      else input.value = String(raw ?? fallback)
      const out = inputs.get(`${def.key}:out`)
      if (out && def.format) out.value = def.format(Number(input.value))
      else if (out) out.value = input.value
    }
  }

  const handleChange = () => {
    const next = readControls()
    applyToFx(next)
    storeValue(STORAGE_KEY, next)
    for (const def of CONTROL_DEFS) {
      const out = inputs.get(`${def.key}:out`)
      if (out && def.format) out.value = def.format(next[def.key])
    }
  }

  for (const def of CONTROL_DEFS) {
    inputs.get(def.key).addEventListener('input', handleChange)
    inputs.get(def.key).addEventListener('change', handleChange)
  }

  closeBtn.addEventListener('click', () => panel.classList.remove('open'))
  resetBtn.addEventListener('click', () => {
    syncControls(PANEL_DEFAULTS)
    applyToFx(PANEL_DEFAULTS)
    storeValue(STORAGE_KEY, PANEL_DEFAULTS)
  })

  // Seed the controls with the initial (actually applied) config so the panel
  // reflects reality rather than the static defaults.
  syncControls(initial)

  return {
    destroy() {
      localeObserver.disconnect()
      window.removeEventListener('resize', onResize)
      toggle.remove()
      panel.remove()
      const style = document.getElementById(PANEL_STYLE_ID)
      if (style) style.remove()
    },
  }
}

/**
 * Browser plugin body: mount the full-screen Blue Archive click effect and
 * cursor trail, expose a draggable, theme-aware configuration window, and tear
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
  // Apply any persisted Fx params that the panel owns.
  for (const def of CONTROL_DEFS) {
    if (def.glow && merged[def.key] !== undefined) {
      applyGlow(fx, merged[def.key])
    } else if (def.fxParam && merged[def.key] !== undefined) {
      fx.setFxParam(def.fxParam, merged[def.key])
    }
  }
  const ui = loadStored(UI_STORAGE_KEY)
  const panel = createConfigPanel(fx, merged, ui)
  ctx.effect(
    () => () => { fx.destroy(); panel.destroy() },
    'dsh-ba-click-fx: click effect lifecycle',
  )
}

// A client bundle that has no cross-plugin value imports needs no `inject`.
// The module table seed provides nothing this body `require()`s.
Object.assign(exports, { name: 'ba-click-fx', apply })
