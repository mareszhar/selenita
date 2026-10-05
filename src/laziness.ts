/** Memoize successful computation without replacing an accessor on a frozen object. */
export function createLazyValue<Value>(createValue: () => Value): () => Value {
  let hasValue = false
  let value: Value
  return () => {
    if (!hasValue) {
      value = freezeData(createValue())
      hasValue = true
    }
    return value
  }
}
/** Define data readers; freezing their container does not evaluate them. */
export function createLazyField<Target extends object, Name extends string, Value>(target: Target, name: Name, createValue: () => Value, isEnumerable = true): Target & Readonly<Record<Name, Value>> {
  Object.defineProperty(target, name, { enumerable: isEnumerable, get: createLazyValue(createValue) })
  return target as Target & Readonly<Record<Name, Value>>
}
/** Freeze only data descriptors, leaving unread accessors and fixture references alone. */
export function freezeData<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if ('value' in descriptor)
        freezeData(descriptor.value)
    }
    Object.freeze(value)
  }
  return value
}
