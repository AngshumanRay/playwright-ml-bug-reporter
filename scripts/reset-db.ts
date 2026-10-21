/**
 * Deletes all runs, results and bugs, plus saved screenshots and alert previews.
 *
 *   npm run db:reset
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config';
import { resetDatabase } from '../src/db/database';

resetDatabase();
for (const dir of [config.screenshotDir, config.alertPreviewDir]) {
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.png') || file.endsWith('.html')) fs.rmSync(path.join(dir, file));
  }
}
console.log('Database, screenshots and alert previews cleared.');
