// Copies what the on-device ID-card check (src/features/verification/idCardCheck.js) loads into
// public/tesseract/, so Tesseract runs from this site and never from a CDN: the worker, the three
// LSTM cores (relaxed SIMD, SIMD, plain; the worker picks the one the browser supports) and the
// English model. Run before `vite` and `vite build` (predev, prebuild); the folder is git-ignored.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'public', 'tesseract');
const pkg = (name) => dirname(require.resolve(`${name}/package.json`));

const files = [
  [join(pkg('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['relaxedsimd-lstm', 'simd-lstm', 'lstm'].map((variant) => [
    join(pkg('tesseract.js-core'), `tesseract-core-${variant}.wasm.js`),
    `tesseract-core-${variant}.wasm.js`,
  ]),
  [join(pkg('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];

await mkdir(out, { recursive: true });
for (const [from, name] of files) {
  const to = join(out, name);
  const [source, target] = await Promise.all([stat(from), stat(to).catch(() => null)]);
  if (target && target.size === source.size && target.mtimeMs >= source.mtimeMs) continue;
  await copyFile(from, to);
}
console.log(`tesseract: ${files.length} files in public/tesseract`);
