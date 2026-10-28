import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const expected = { glisse: '0.4.3', react: '19.3.1', 'react-dom': '19.3.1', esbuild: '0.28.2' };
let notices = 'Schedule Bot navigation: bundled dependencies and their licenses.\n';
for (const [name, version] of Object.entries(expected)) {
  const path = require.resolve(name + '/package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  if (pkg.version !== version) throw new Error(name + ': expected ' + version + ', got ' + pkg.version);
  if (name !== 'esbuild') notices += '\n--- ' + name + ' ' + version + ' ---\n' + await readFile(dirname(path) + '/LICENSE', 'utf8');
}
const schedulerPath = createRequire(require.resolve('react-dom/package.json')).resolve('scheduler/package.json');
const scheduler = JSON.parse(await readFile(schedulerPath, 'utf8'));
notices += '\n--- scheduler ' + scheduler.version + ' ---\n' + await readFile(dirname(schedulerPath) + '/LICENSE', 'utf8');
const out = fileURLToPath(new URL('../web/glisse-nav.js', import.meta.url));
const result = await build({ entryPoints: [fileURLToPath(new URL('./entry.js', import.meta.url))], outfile: out,
  bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['safari15', 'chrome100'],
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof', write: false,
  banner: { js: '/* Glisse 0.4.3 + React. Licenses: glisse-notices.txt */' } });
if (!result.outputFiles.some((f) => f.path.endsWith('glisse-nav.js')) || !result.outputFiles.some((f) => f.path.endsWith('glisse-nav.css'))) throw new Error('Navigation JS/CSS outputs missing');
await mkdir(dirname(out), { recursive: true });
for (const file of result.outputFiles) await writeFile(file.path, file.contents);
await writeFile(new URL('../web/glisse-notices.txt', import.meta.url), notices);
console.log('Navigation built locally: ' + result.outputFiles.map((f) => f.path + ' (' + f.contents.length + ' bytes)').join(', '));
