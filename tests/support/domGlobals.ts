/**
 * Install happy-dom's window as the globals React renders into. It must run
 * before react-dom loads, so tests import their runtime modules after it.
 */
export async function registerDomGlobals(): Promise<void> {
  const { Window } = await import("happy-dom");
  const window = new Window({ url: "http://localhost/" });
  for (const key of Object.getOwnPropertyNames(window)) {
    if (!(key in globalThis)) {
      try {
        (globalThis as unknown as Record<string, unknown>)[key] = (
          window as unknown as Record<string, unknown>
        )[key];
      } catch {
        // Some window accessors cannot be copied; skip them.
      }
    }
  }
  const assignGlobal = (key: string, value: unknown): void => {
    try {
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
      });
    } catch {
      // Some globals cannot be redefined; skip them.
    }
  };
  assignGlobal("window", window);
  assignGlobal("document", window.document);
  assignGlobal("navigator", window.navigator);
  assignGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}
