/**
 * Deep-merge for LibreChat config: override wins; arrays are replaced by default.
 * Exception: endpoints.custom is merged by endpoint name (deep-merge matching items).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge two arrays of endpoint objects by matching `name`. Base order preserved.
 * For each base item, if override has an item with the same name, deep-merge override into base item.
 */
function mergeCustomEndpoints(
  baseArr: unknown[],
  overrideArr: unknown[]
): unknown[] {
  if (!Array.isArray(baseArr) || !Array.isArray(overrideArr)) {
    return overrideArr ?? baseArr;
  }
  return baseArr.map((baseItem) => {
    if (!isPlainObject(baseItem) || typeof baseItem.name !== 'string') {
      return baseItem;
    }
    const overrideItem = overrideArr.find(
      (o) => isPlainObject(o) && o.name === baseItem.name
    );
    if (!overrideItem || !isPlainObject(overrideItem)) {
      return baseItem;
    }
    return deepMerge(baseItem, overrideItem, '');
  });
}

/**
 * Deep-merge base with override. Override wins for primitives and arrays (replace).
 * Exception: at path "endpoints.custom", arrays are merged by object `name` (override patch into base).
 */
export function deepMerge(
  base: unknown,
  override: unknown,
  path = ''
): unknown {
  if (override === undefined || override === null) {
    return base;
  }
  if (path === 'endpoints.custom' && Array.isArray(base) && Array.isArray(override)) {
    return mergeCustomEndpoints(base, override);
  }
  if (Array.isArray(base) || Array.isArray(override)) {
    return override;
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const childPath = path ? `${path}.${key}` : key;
    const baseVal = base[key];
    const overrideVal = override[key];
    if (
      childPath === 'endpoints.custom' &&
      Array.isArray(baseVal) &&
      Array.isArray(overrideVal)
    ) {
      merged[key] = mergeCustomEndpoints(baseVal, overrideVal);
    } else if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      merged[key] = deepMerge(baseVal, overrideVal, childPath);
    } else {
      merged[key] = overrideVal;
    }
  }
  return merged;
}
