import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
});

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

export function createStaticAssetHandler(rootDirectory) {
  const root = resolve(rootDirectory);
  const indexFile = resolve(root, 'index.html');

  return async function serveStaticAsset({ pathname, res }) {
    if (!isApplicationPath(pathname)) return false;
    const requested = pathname === '/' ? indexFile : safeAssetPath(root, pathname);
    if (!requested) return false;
    const hasExtension = Boolean(extname(pathname));
    const file = hasExtension ? requested : indexFile;

    try {
      const body = await readFile(file);
      const extension = extname(file).toLowerCase();
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
        'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'content-length': body.length,
      });
      res.end(body);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return false;
      throw error;
    }
  };
}
