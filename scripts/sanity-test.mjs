// Sanity test: simulate the client module system materializing lib/client.js.
import { readFileSync } from 'node:fs'

const code = readFileSync('D:/A/temp/ba-click-fx-dsh-plugin/lib/client.js', 'utf8')
let reg = null
globalThis.window = { __ModuleLoader__: { load: (r) => { reg = r } } }
eval(code)

if (!reg || reg.id !== 'dsh-ba-click-fx') {
  console.error('FAIL: no registration')
  process.exit(1)
}
console.log('registration id:', reg.id)

const exports = reg.factory((spec) => {
  throw new Error('unexpected require: ' + spec)
})
console.log('materialized exports keys:', Object.keys(exports))
console.log('has apply:', typeof exports.apply === 'function')
console.log('has name:', exports.name)

// Guard path: no DOM -> apply no-ops without throwing.
globalThis.document = undefined
const ctx = { effect: () => {} }
exports.apply(ctx, {})
console.log('apply no-op guard OK')
console.log('MATERIALIZATION OK')
