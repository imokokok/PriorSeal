import { createHash } from 'node:crypto';

type FakeObject = {
  bytes: Uint8Array;
  contentType: string;
  customMetadata: Record<string, string>;
  uploaded: Date;
  version: string;
  etag: string;
};

const toBytes = (value: unknown): Uint8Array => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  throw new TypeError('Unsupported fake R2 put value');
};
const toArrayBuffer = (hex: string): ArrayBuffer => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes.buffer;
};
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Minimal R2 binding with If-None-Match and SHA-256 semantics for local tests. */
export function testR2() {
  const objects = new Map<string, FakeObject>();
  const stats = { puts: 0, heads: 0, gets: 0, deletes: 0 };
  let version = 0;
  let putFailure: unknown = null;
  const objectMeta = (key: string, object: FakeObject) => ({
    key,
    version: object.version,
    size: object.bytes.byteLength,
    etag: object.etag,
    httpEtag: object.etag,
    uploaded: object.uploaded,
    checksums: { sha256: toArrayBuffer(sha256(object.bytes)) },
    customMetadata: { ...object.customMetadata },
    httpMetadata: { contentType: object.contentType },
    storageClass: 'Standard',
    writeHttpMetadata(headers: Headers) { headers.set('content-type', object.contentType); },
  });
  const bucket = {
    async put(key: string, value: unknown, options: {
      onlyIf?: { etagDoesNotMatch?: string };
      sha256?: string | ArrayBuffer;
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    } = {}) {
      stats.puts++;
      if (putFailure) {
        const error = putFailure;
        putFailure = null;
        throw error;
      }
      const bytes = toBytes(value);
      if (options.sha256) {
        const expected = typeof options.sha256 === 'string' ? options.sha256 : sha256(new Uint8Array(options.sha256));
        if (expected !== sha256(bytes)) throw new Error('Fake R2 rejected the SHA-256 checksum');
      }
      if (options.onlyIf?.etagDoesNotMatch === '*' && objects.has(key)) return null;
      version++;
      const object: FakeObject = {
        bytes: bytes.slice(),
        contentType: options.httpMetadata?.contentType ?? 'application/octet-stream',
        customMetadata: { ...(options.customMetadata ?? {}) },
        uploaded: new Date(),
        version: `v${version}`,
        etag: `e${version}`,
      };
      objects.set(key, object);
      return objectMeta(key, object);
    },
    async head(key: string) {
      stats.heads++;
      const object = objects.get(key);
      return object ? objectMeta(key, object) : null;
    },
    async get(key: string) {
      stats.gets++;
      const object = objects.get(key);
      if (!object) return null;
      const bytes = object.bytes.slice();
      return {
        ...objectMeta(key, object),
        body: new Response(bytes).body,
        arrayBuffer: async () => bytes.slice().buffer,
        bytes: async () => bytes.slice(),
        text: async () => new TextDecoder().decode(bytes),
        json: async () => JSON.parse(new TextDecoder().decode(bytes)) as unknown,
        blob: async () => new Blob([bytes]),
      };
    },
    async delete(key: string) {
      stats.deletes++;
      objects.delete(key);
    },
    async list(options: { prefix?: string; limit?: number } = {}) {
      const matching = [...objects.entries()].filter(([key]) => !options.prefix || key.startsWith(options.prefix));
      const page = matching.slice(0, options.limit ?? 1000);
      return { objects: page.map(([key, object]) => objectMeta(key, object)), truncated: page.length < matching.length, cursor: undefined };
    },
  } as unknown as R2Bucket;
  return {
    bucket,
    objects,
    stats,
    failNextPut(error: unknown) { putFailure = error; },
    tamper(key: string, bytes: Uint8Array) {
      const object = objects.get(key);
      if (!object) throw new Error('Fake R2 object is missing');
      object.bytes = bytes.slice();
    },
  };
}
