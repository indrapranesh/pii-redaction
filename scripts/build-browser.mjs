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

// Fan the ESM bundle out to the demo (which loads it as a module).
for (const dest of ['demo/vendor/pii-core.mjs', 'extension/vendor/pii-core.mjs']) {
  const target = resolve(root, dest);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(outfile, target);
}

// The extension content script must be a classic IIFE (no ES module / dynamic
// import) so it runs under strict page CSPs. Bundle the engine into it.
await build({
  entryPoints: [resolve(root, 'extension/src/content.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: resolve(root, 'extension/content.js'),
  legalComments: 'none',
});

console.log(
  'Built browser bundle -> browser/pii-core.mjs (+ demo & extension copies)\n' +
    'Built extension content script -> extension/content.js',
);
