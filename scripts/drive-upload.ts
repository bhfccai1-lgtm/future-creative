/**
 * Uploads a file read from stdin to Google Drive through the Google archive script (v2+), in ≤20 MB parts, each
 * size verified. Streams: a media archive of several GB is never held in memory whole.
 * Runs INSIDE the web container (it has the database and the encrypted script URL):
 *   docker compose exec -T web npx tsx scripts/drive-upload.ts <backup-folder> <file-name> < file
 * Prints «UPLOADED <bytes>» on success (scripts compare it with the file size before deleting anything).
 */
import { uploadStreamToDrive } from '../src/lib/integrations/google-archive';
import { prisma } from '../src/lib/db';

async function main() {
  const [backup, name] = process.argv.slice(2);
  if (!backup || !name || !/^[\w.-]{1,80}$/.test(backup) || !/^[\w.-]{1,120}$/.test(name)) throw new Error('usage: drive-upload.ts <backup-folder> <file-name> < file');
  const r = await uploadStreamToDrive(process.stdin as AsyncIterable<Buffer>, { backup, name });
  if (r.bytes < 1) throw new Error('empty input - nothing uploaded');
  console.log(`Uploaded ${name} (${(r.bytes / 1e6).toFixed(1)} MB) to Google Drive in ${r.parts.length} part(s): backups/${backup}/`);
  console.log(`UPLOADED ${r.bytes}`);
}
main().catch((e) => { console.error(`Drive upload FAILED: ${(e as Error).message}`); process.exit(1); }).finally(() => prisma.$disconnect());
