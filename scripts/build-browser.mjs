/**
 * Bundle the engine core into a single browser-loadable ESM file and copy it
 * into the demo and the extension, so each surface is self-contained.
 *
 * The NER layer's optional `@huggingface/transformers` import is marked
 * external: browser surfaces load Transformers.js from a CDN (or their own
 * bundle) rather than baking it in here.
 */
import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'browser/pii-core.mjs');

mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile,
  external: ['@huggingface/transformers'],
  legalComments: 'none',
});

// Fan the bundle out to the self-contained surfaces.
for (const dest of ['demo/vendor/pii-core.mjs', 'extension/vendor/pii-core.mjs']) {
  const target = resolve(root, dest);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(outfile, target);
}

console.log('Built browser bundle -> browser/pii-core.mjs (+ demo & extension copies)');
