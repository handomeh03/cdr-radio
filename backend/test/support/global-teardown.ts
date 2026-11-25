import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs once in the main process after all e2e files: removes the per-process work folders
 * (see e2e-env.ts) that a worker did not manage to clean up itself. Only our own prefix.
 */
export default function setup() {
  return () => {
    for (const name of readdirSync(tmpdir())) {
      if (name.startsWith('cdr-radio-e2e-')) {
        rmSync(join(tmpdir(), name), { recursive: true, force: true });
      }
    }
  };
}
