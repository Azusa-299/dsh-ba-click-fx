/**
 * Build the dsh-ba-click-fx plugin artifacts from source + vendored library.
 *
 * Produces:
 *   lib/index.js   — Host half (plain ESM; a verbatim copy of src/index.js).
 *   lib/client.js  — Browser half as the lazy-CJS factory artifact the client
 *                    module system expects:
 *                      window.__ModuleLoader__.load({
 *                        id: "<pkg>",
 *                        factory: (require) => {
 *                          var module = { exports: {} };
 *                          var exports = module.exports;
 *                          <inlined ba-click-fx ESM body>
 *                          <plugin browser body>
 *                          return module.exports;
 *                        }
 *                      });
 *   lib/client.js.map — a minimal source map (sourcesContent included) so
 *                    browser stack traces reference this repo's files.
 *
 * The vendored `dist/ba-click-fx.js` is a zero-dependency ESM bundle whose only
 * ESM-specific syntax is its trailing `export { ... }` statement. We strip that
 * line, which leaves every exported symbol (BAClickFX, createConfig, ...) as an
 * ordinary in-scope declaration inside the factory closure. The plugin browser
 * body then re-exports them as CJS `exports` and adds its `apply` entry point.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 1. Host half: lib/index.js is a verbatim copy of src/index.js.
await copyFile(resolve(ROOT, 'src/index.js'), resolve(ROOT, 'lib/index.js'))

// 2. Browser half.
const vendor = await readFile(resolve(ROOT, 'vendor/ba-click-fx.js'), 'utf8')
const pluginBody = await readFile(resolve(ROOT, 'src/client/index.js'), 'utf8')

// Strip the trailing ESM export statement. The bundle's only `export {` is its
// final line; everything before it is plain JS scoped to the factory closure.
const exportIndex = vendor.lastIndexOf('\nexport {')
if (exportIndex === -1) {
  throw new Error('build: vendored bundle has no trailing `export {` to strip')
}
const libraryBody = vendor.slice(0, exportIndex)

const banner = `window.__ModuleLoader__.load({\n\tid: "dsh-ba-click-fx",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n`
const footer = `\n\t\treturn module.exports;\n\t}\n});\n`

const clientBundle = `${banner}${libraryBody}\n${pluginBody}${footer}`

// 3. Minimal inline source map so /plugins/dsh-ba-click-fx/client.js.map exists
//    and browser tools can walk the bundle body back to this repo's files.
//    Paths are relative to lib/, where the map is emitted.
const sources = ['../vendor/ba-click-fx.js', '../src/client/index.js']
const sourcesContent = [libraryBody, pluginBody]
const map = {
  version: 3,
  file: 'client.js',
  sources,
  sourcesContent,
  names: [],
  mappings: '',
}
const sourceMapping = `\n//# sourceMappingURL=client.js.map`
const mapFile = JSON.stringify(map)

await mkdir(resolve(ROOT, 'lib'), { recursive: true })
await writeFile(resolve(ROOT, 'lib/client.js'), `${clientBundle}${sourceMapping}`)
await writeFile(resolve(ROOT, 'lib/client.js.map'), mapFile)

console.log('built lib/index.js and lib/client.js (+ map)')

async function copyFile(from, to) {
  const data = await readFile(from)
  await mkdir(dirname(to), { recursive: true })
  await writeFile(to, data)
}
