import { computed, type IComputedValue, type IEqualsComparer } from "mobx";

/**
 * A derivation per key, cached until something it read changes. A MobX
 * computed is cached only while a reaction observes it; these stay cached
 * between unobserved reads too (an action's, the server's), so a view read
 * once per row and once per stage costs one derivation per change, not one
 * per read. Each key's cache lives as long as the store that owns it.
 */
export function keyedView<Key, Value>(
  derive: (key: Key) => Value,
  equals?: IEqualsComparer<Value>,
): (key: Key) => Value {
  const views = new Map<Key, IComputedValue<Value>>();
  return (key) => {
    let view = views.get(key);
    if (view == null) {
      view = computed(() => derive(key), { keepAlive: true, equals });
      views.set(key, view);
    }
    return view.get();
  };
}

/** A derivation without a key, cached the same way. */
export function cachedView<Value>(derive: () => Value): () => Value {
  const view = computed(derive, { keepAlive: true });
  return () => view.get();
}
