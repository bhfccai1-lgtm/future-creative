/**
 * Uploads a file read from stdin to Google Drive through the Google archive script (v2), in ≤20 MB parts.
 * Runs INSIDE the web container (it has the database and the encrypted script URL):
 *   docker compose exec -T web npx tsx scripts/drive-upload.ts <backup-folder> <file-name> < file
 */
import { uploadBackupToDrive } from '../src/lib/integrations/google-archive';
import { prisma } from '../src/lib/db';

async function main() {
  const [backup, name] = process.argv.slice(2);
  if (!backup || !name || !/^[\w.-]{1,80}$/.test(backup) || !/^[\w.-]{1,120}$/.test(name)) throw new Error('usage: drive-upload.ts <backup-folder> <file-name> < file');
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const data = Buffer.concat(chunks);
  if (data.length < 1000) throw new Error(`refusing to upload an almost empty file (${data.length} bytes)`);
  const r = await uploadBackupToDrive(data, { backup, name });
  console.log(`Uploaded ${name} (${(r.bytes / 1e6).toFixed(1)} MB) to Google Drive in ${r.parts.length} part(s): backups/${backup}/`);
}
main().catch((e) => { console.error(`Drive upload FAILED: ${(e as Error).message}`); process.exit(1); }).finally(() => prisma.$disconnect());
