import { errorCode } from '../../shared/error-code.mjs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress as brotliCompressCallback, constants as zlibConstants, gzip as gzipCallback } from 'node:zlib';
import type { BigIntStats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

const brotliCompress = promisify(brotliCompressCallback);
const gzip = promisify(gzipCallback);

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
});

const COMPRESSIBLE_TYPES = new Set(['.css', '.html', '.js', '.json', '.map', '.svg']);
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_FILES = 128;
type Encoding = 'br' | 'gzip';
type CachedAsset = { version: string; body: Buffer; etag: string; compressed: Partial<Record<Encoding, Buffer>> };

const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

function isApplicationPath(pathname: string) {
  return !pathname.startsWith('/v1/')
    && !pathname.startsWith('/health/')
    && !pathname.startsWith('/.well-known/')
    && pathname !== '/openapi/v1.json';
}

function safeAssetPath(root: string, pathname: string) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const candidate = resolve(root, `.${decoded}`);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

function preferredEncoding(value: string | string[] | undefined) {
  const quality = new Map<string, number>();
  for (const entry of String(value ?? '').toLowerCase().split(',')) {
    const [name, ...parameters] = entry.trim().split(';');
    if (!name) continue;
    const qValue = parameters.find((parameter) => parameter.trim().startsWith('q='));
    const q = qValue ? Number(qValue.trim().slice(2)) : 1;
    quality.set(name, Number.isFinite(q) ? q : 0);
  }
  const wildcard = quality.get('*') ?? 0;
  const brotli = quality.get('br') ?? wildcard;
  const gzipped = quality.get('gzip') ?? wildcard;
  if (brotli > 0 && brotli >= gzipped) return 'br';
  if (gzipped > 0) return 'gzip';
  return null;
}

function etagFor(body: Buffer) {
  return `W/"${createHash('sha256').update(body).digest('base64url').slice(0, 24)}"`;
}

function fileVersion(metadata: BigIntStats): string {
  // ctime also changes when a same-sized file is replaced and mtime is restored.
  return [metadata.dev, metadata.ino, metadata.size, metadata.mtimeNs, metadata.ctimeNs].join(':');
}

function assetBytes(asset: CachedAsset): number {
  return asset.body.length + Object.values(asset.compressed).reduce((bytes, body) => bytes + body.length, 0);
}

export function createStaticAssetHandler(rootDirectory: string) {
  const root = resolve(rootDirectory);
  const indexFile = resolve(root, 'index.html');
  const cachedAssets = new Map<string, CachedAsset>();
  let cachedBytes = 0;

  function removeCached(file: string) {
    const previous = cachedAssets.get(file);
    if (previous) cachedBytes -= assetBytes(previous);
    cachedAssets.delete(file);
  }

  function cacheAsset(file: string, asset: CachedAsset) {
    const bytes = assetBytes(asset);
    if (bytes > MAX_CACHE_BYTES) return;
    removeCached(file);
    while (cachedBytes + bytes > MAX_CACHE_BYTES || cachedAssets.size >= MAX_CACHE_FILES) {
      const oldest = cachedAssets.keys().next().value;
      if (!oldest) break;
      removeCached(oldest);
    }
    cachedAssets.set(file, asset);
    cachedBytes += bytes;
  }

  async function loadAsset(file: string): Promise<CachedAsset> {
    const version = fileVersion(await stat(file, { bigint: true }));
    const cached = cachedAssets.get(file);
    if (cached?.version === version) {
      cacheAsset(file, cached); // Refresh recency without reading or hashing the file.
      return cached;
    }
    if (cached) removeCached(file);
    const body = await readFile(file);
    const asset: CachedAsset = { version, body, etag: etagFor(body), compressed: {} };
    // An in-place replacement during read must not be stored under the old version.
    const afterRead = await stat(file, { bigint: true }).catch(() => null);
    if (afterRead && fileVersion(afterRead) === version) cacheAsset(file, asset);
    return asset;
  }

  return async function serveStaticAsset({ pathname, req, res }: { pathname: string; req: IncomingMessage; res: ServerResponse }): Promise<boolean> {
    if (!isApplicationPath(pathname)) return false;
    const requested = pathname === '/' ? indexFile : safeAssetPath(root, pathname);
    if (!requested) return false;
    const hasExtension = Boolean(extname(pathname));
    const file = hasExtension ? requested : indexFile;

    try {
      const asset = await loadAsset(file);
      const extension = extname(file).toLowerCase();
      const cacheControl = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      if (req?.headers?.['if-none-match'] === asset.etag) {
        res.writeHead(304, { ...SECURITY_HEADERS, 'cache-control': cacheControl, etag: asset.etag, vary: 'Accept-Encoding' });
        res.end();
        return true;
      }
      const encoding = asset.body.length >= 1024 && COMPRESSIBLE_TYPES.has(extension) ? preferredEncoding(req?.headers?.['accept-encoding']) : null;
      let responseBody: Buffer = asset.body;
      if (encoding) {
        const compressed = asset.compressed[encoding];
        if (compressed) responseBody = compressed;
        else {
          responseBody = encoding === 'br'
            ? await brotliCompress(asset.body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
            : await gzip(asset.body, { level: 6 });
          if (cachedAssets.get(file) === asset) {
            cacheAsset(file, { ...asset, compressed: { ...asset.compressed, [encoding]: responseBody } });
          }
        }
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': (CONTENT_TYPES as Record<string, string>)[extension] ?? 'application/octet-stream',
        'cache-control': cacheControl,
        ...(encoding ? { 'content-encoding': encoding } : {}),
        'content-length': responseBody.length,
        etag: asset.etag,
        vary: 'Accept-Encoding',
      });
      res.end(responseBody);
      return true;
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EISDIR') return false;
      throw error;
    }
  };
}
