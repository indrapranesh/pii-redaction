import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
};

/** Start a tiny static file server rooted at `root`. Returns { port, close }. */
export async function serve(root) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = join(root, normalize(p));
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, r));
  return {
    port: server.address().port,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Resolve a Chromium executable, or null if none is configured/available. */
export async function resolveChromium() {
  const candidates = [
    process.env.PW_CHROMIUM,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ].filter(Boolean);
  const { access } = await import('node:fs/promises');
  for (const c of candidates) {
    try {
      await access(c);
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Load playwright-core's chromium, or null if the module isn't installed. */
export async function loadPlaywright() {
  try {
    const { chromium } = await import('playwright-core');
    return chromium;
  } catch {
    return null;
  }
}
