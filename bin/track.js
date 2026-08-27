#!/usr/bin/env node
/**
 * Command line front end.
 *
 * Same engine as the web app, no browser and no dependencies: Node strips the
 * TypeScript types on the way in. Useful for checking what the parser makes of
 * a phrase without opening anything.
 *
 *   track "2 rotis, a katori of dal and half a bowl of rice"
 *   track --train "ran 5k in 27 min" --weight 72
 *   track --coach --goal lose --days 4 --equipment dumbbells
 *   track --list dal
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'src', 'cli', 'main.ts');

try {
  execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', entry, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
} catch (error) {
  process.exit(typeof error?.status === 'number' ? error.status : 1);
}
