class BrowserBuffer extends Uint8Array {
  toString(encoding = 'utf8') {
    if (encoding !== 'hex') throw new TypeError(`Unsupported browser Buffer encoding: ${encoding}`)
    return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
}

function fromBase64(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/[\t\n\f\r ]/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) throw new TypeError('Invalid base64 input')
  const padded = normalized.replace(/=+$/, '') + '='.repeat((4 - normalized.replace(/=+$/, '').length % 4) % 4)
  const binary = atob(padded)
  const output = new BrowserBuffer(binary.length)
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index)
  return output
}

export const Buffer = {
  from(value: string | ArrayBuffer | ArrayBufferView, encoding?: string) {
    if (typeof value === 'string') {
      if (encoding !== 'base64') throw new TypeError(`Unsupported browser Buffer encoding: ${encoding ?? 'utf8'}`)
      return fromBase64(value)
    }
    if (value instanceof ArrayBuffer) return new BrowserBuffer(new Uint8Array(value))
    if (ArrayBuffer.isView(value)) return new BrowserBuffer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    throw new TypeError('Unsupported browser Buffer input')
  },
}
