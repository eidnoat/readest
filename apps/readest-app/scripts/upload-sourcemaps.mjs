// Source maps cleanup for the Tauri export build.
// Strips the `.map` files so they never ship inside the app bundle unless KEEP_SOURCEMAPS=1.

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(appDir, 'out', '_next', 'static');

export const stripSourceMappingComment = (code) =>
  code.replace(/\n\/\/# sourceMappingURL=[^\n]+(?=\n|$)/g, '');

export const stripMaps = (dir) => {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      count += stripMaps(full);
    } else if (entry.endsWith('.map')) {
      rmSync(full);
      count += 1;
    }
  }
  return count;
};

export const main = () => {
  if (!existsSync(staticDir)) return;

  if (process.env['KEEP_SOURCEMAPS'] === '1') {
    console.log('KEEP_SOURCEMAPS=1, keeping the .js.map files in the app bundle.');
    return;
  }

  const removed = stripMaps(staticDir);
  console.log(`Stripped ${removed} .js.map file(s) from the app bundle.`);
};

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
