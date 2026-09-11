/**
 * RFC 8785 JSON Canonicalization Scheme for already-parsed JSON values.
 * Adapted from BoundaryAttest commit 1f4ca92072589783bf7a08d8262833abcd8ddccf.
 */

function assertWellFormedUnicode(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError(`${path}: lone high surrogate is not I-JSON`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError(`${path}: lone low surrogate is not I-JSON`);
    }
  }
}

export function compareUtf16(left, right) {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function canonicalize(value, path, ancestors) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'string': assertWellFormedUnicode(value, path); return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`${path}: non-finite number is not JSON`);
      return JSON.stringify(value);
    case 'undefined':
    case 'bigint':
    case 'function':
    case 'symbol': throw new TypeError(`${path}: unsupported non-JSON value (${typeof value})`);
  }

  if (ancestors.has(value)) throw new TypeError(`${path}: cyclic value is not JSON`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const elements = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError(`${path}[${index}]: sparse array holes are not JSON values`);
        elements.push(canonicalize(value[index], `${path}[${index}]`, ancestors));
      }
      const extraKeys = Reflect.ownKeys(value).filter(
        (key) => key !== 'length' && !(typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length),
      );
      if (extraKeys.length > 0) throw new TypeError(`${path}: arrays with extra properties are unsupported`);
      return `[${elements.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path}: unsupported non-JSON object type`);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol')) throw new TypeError(`${path}: symbol property keys are unsupported`);
    const keys = ownKeys.sort(compareUtf16);
    const members = keys.map((key) => {
      assertWellFormedUnicode(key, `${path} property name`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError(`${path}.${key}: accessors and non-enumerable properties are unsupported`);
      return `${JSON.stringify(key)}:${canonicalize(descriptor.value, `${path}.${key}`, ancestors)}`;
    });
    return `{${members.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function jcsCanonicalize(value) {
  return canonicalize(value, '$', new Set());
}

export function jcsCanonicalBytes(value) {
  return Buffer.from(jcsCanonicalize(value), 'utf8');
}
