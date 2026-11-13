// Copies the single-file build to the repo root as mt-floor-tool.html, so there is always a page that
// opens by double-clicking (no server needed). Run by `npm run build`.
import { copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
copyFileSync(join(root, 'dist', 'index.html'), join(root, 'mt-floor-tool.html'));
console.log(`mt-floor-tool.html updated (${Math.round(statSync(join(root, 'mt-floor-tool.html')).size / 1024)} kB)`);
