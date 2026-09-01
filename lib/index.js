/**
 * Host half of the dsh-ba-click-fx client plugin.
 *
 * The Blue Archive click effect is entirely browser-side (DOM / canvas /
 * pointer events), so this node half only provides a valid plugin entry point.
 * The Host Loader must import this module and activate a live fiber for the
 * client-modules host half to discover `dsh.client` and serve `lib/client.js`
 * to the web GUI (see packages/client/modules). All visual work happens in the
 * browser half (`src/client/index.js` → `lib/client.js`).
 */

export const name = 'ba-click-fx'

/** No-op on the host. The effect is mounted by the browser half. */
export function apply() {
  // Intentionally empty: this package contributes no Host-side services.
}
