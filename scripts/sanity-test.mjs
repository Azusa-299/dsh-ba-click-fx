// Sanity test: simulate the client module system materializing lib/client.js.
// Run `npm run build` first (this test only reads the built artifact).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const code = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')

let registration = null
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => { registration = entry },
  },
}

// eslint-disable-next-line no-eval -- materialize the bundle like the loader does.
eval(code)

if (!registration || registration.id !== 'dsh-ba-click-fx') {
  console.error('FAIL: no registration')
  process.exit(1)
}
console.log('registration id:', registration.id)

const requested = []
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}
const exports = registration.factory((spec) => {
  requested.push(spec)
  if (spec === 'react') return ReactStub
  throw new Error('unexpected require: ' + spec)
})

const failures = []
const check = (label, condition) => {
  if (condition) console.log('ok:', label)
  else failures.push(label)
}

check('only react was required', requested.length === 1 && requested[0] === 'react')
check('exports apply', typeof exports.apply === 'function')
check('exports name', exports.name === 'ba-click-fx')
check('injects slots + locale', Array.isArray(exports.inject)
  && exports.inject.includes('slots') && exports.inject.includes('locale'))
check('registers settings.section', code.includes("'settings.section'"))
check('registers settings.section.icon', code.includes("'settings.section.icon'"))
check('floating gear UI removed', !code.includes('dsh-ba-fx-toggle') && !code.includes('dsh-ba-fx-panel'))

// Guard path: no DOM -> apply no-ops without throwing (and without touching ctx).
globalThis.window = undefined
globalThis.document = undefined
exports.apply({}, {})
console.log('ok: apply no-op guard')

if (failures.length > 0) {
  console.error('FAIL:', failures.join('; '))
  process.exit(1)
}
console.log('MATERIALIZATION OK')
