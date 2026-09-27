/**
 * Tiny synchronous event emitter. Used by the signaling + WebRTC services so
 * that transport code never imports React and React components never reach
 * into transport internals.
 */
export class Emitter {
  #listeners = new Map();

  on(type, handler) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type).add(handler);
    return () => this.off(type, handler);
  }

  once(type, handler) {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(type, handler) {
    this.#listeners.get(type)?.delete(handler);
  }

  emit(type, payload) {
    const handlers = this.#listeners.get(type);
    if (!handlers) return;
    // Copy so handlers may unsubscribe during dispatch.
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[emitter] listener for "${type}" threw`, error);
      }
    }
  }

  clear() {
    this.#listeners.clear();
  }
}

export default Emitter;
