// Runs inside the n8n container (called by scripts/n8n-setup.sh).
// Copies the templates to OUT and fills every empty credential reference with the matching credential that
// already exists in n8n (by type), so re-importing never wipes the accounts the owner connected in the editor.
//   node link-credentials.js <templatesDir> <outDir> <credentialsExport.json>
const fs = require('fs');
const path = require('path');
const [, , src, out, credFile] = process.argv;
let creds = [];
try { creds = JSON.parse(fs.readFileSync(credFile, 'utf8')); } catch { creds = []; }
if (!Array.isArray(creds)) creds = [];
const byType = {};
for (const c of creds) if (c && c.type && c.id && !byType[c.type]) byType[c.type] = { id: c.id, name: c.name };
fs.mkdirSync(out, { recursive: true });
const missing = new Set();
for (const f of fs.readdirSync(src).filter((x) => /^\d\d-.+\.json$/.test(x))) {
  const w = JSON.parse(fs.readFileSync(path.join(src, f), 'utf8'));
  for (const n of w.nodes || []) {
    for (const [type, ref] of Object.entries(n.credentials || {})) {
      const found = byType[type];
      if (found && (!ref || !ref.id)) n.credentials[type] = { id: found.id, name: found.name };
      else if (!found && (!ref || !ref.id)) missing.add(type);
    }
  }
  fs.writeFileSync(path.join(out, f), JSON.stringify(w));
}
const has = (t) => (byType[t] ? 1 : 0);
console.log(`GOOGLE_DRIVE=${has('googleDriveOAuth2Api')}`);
console.log(`GOOGLE_SHEETS=${has('googleSheetsOAuth2Api')}`);
console.log(`MISSING=${[...missing].join(',')}`);
