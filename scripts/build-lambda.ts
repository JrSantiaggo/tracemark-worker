import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const outDir = 'dist/lambda';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: ['src/lambda/validate-upload.handler.ts'],
  outfile: `${outDir}/index.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: false,
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});

execFileSync('python3', ['-m', 'zipfile', '-c', 'validate-upload.zip', 'index.mjs'], { cwd: outDir });
console.log(`${outDir}/validate-upload.zip pronto (handler: index.handler)`);
