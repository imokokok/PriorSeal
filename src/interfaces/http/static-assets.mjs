import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress as brotliCompressCallback, constants as zlibConstants, gzip as gzipCallback } from 'node:zlib';

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

const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

function isApplicationPath(pathname) {
  return !pathname.startsWith('/v1/')
    && !pathname.startsWith('/health/')
    && !pathname.startsWith('/.well-known/')
    && pathname !== '/openapi/v1.json';
}

function safeAssetPath(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const candidate = resolve(root, `.${decoded}`);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

function preferredEncoding(value) {
  const quality = new Map();
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

function etagFor(body) {
  return `W/"${createHash('sha256').update(body).digest('base64url').slice(0, 24)}"`;
}

export function createStaticAssetHandler(rootDirectory) {
  const root = resolve(rootDirectory);
  const indexFile = resolve(root, 'index.html');
  const compressedBodies = new Map();

  return async function serveStaticAsset({ pathname, req, res }) {
    if (!isApplicationPath(pathname)) return false;
    const requested = pathname === '/' ? indexFile : safeAssetPath(root, pathname);
    if (!requested) return false;
    const hasExtension = Boolean(extname(pathname));
    const file = hasExtension ? requested : indexFile;

    try {
      const body = await readFile(file);
      const extension = extname(file).toLowerCase();
      const cacheControl = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      const etag = etagFor(body);
      if (req?.headers?.['if-none-match'] === etag) {
        res.writeHead(304, { ...SECURITY_HEADERS, 'cache-control': cacheControl, etag, vary: 'Accept-Encoding' });
        res.end();
        return true;
      }
      const encoding = body.length >= 1024 && COMPRESSIBLE_TYPES.has(extension) ? preferredEncoding(req?.headers?.['accept-encoding']) : null;
      const cacheKey = encoding ? `${file}:${etag}:${encoding}` : null;
      let responseBody = body;
      if (cacheKey) {
        responseBody = compressedBodies.get(cacheKey);
        if (!responseBody) {
          responseBody = encoding === 'br'
            ? await brotliCompress(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
            : await gzip(body, { level: 6 });
          compressedBodies.set(cacheKey, responseBody);
        }
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
        'cache-control': cacheControl,
        ...(encoding ? { 'content-encoding': encoding } : {}),
        'content-length': responseBody.length,
        etag,
        vary: 'Accept-Encoding',
      });
      res.end(responseBody);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return false;
      throw error;
    }
  };
}
