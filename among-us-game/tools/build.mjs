// Inlines scripts, styles and assets into a single HTML file.
//   node tools/build.mjs
// Writes dist/index.html (standalone document) and dist/artifact.html (body fragment for the
// claude.ai Artifact publisher, which wraps the page in its own doctype/head/body skeleton).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.woff2': 'font/woff2'
};

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (MIME[extname(name).toLowerCase()]) out.push(p);
  }
  return out;
}

const html = readFileSync(join(root, 'index.html'), 'utf8');

const assetUrls = {};
let assetBytes = 0;
for (const file of walk(join(root, 'assets'))) {
  const buf = readFileSync(file);
  assetBytes += buf.length;
  const rel = relative(root, file).split('\\').join('/');
  assetUrls[rel] = `data:${MIME[extname(file).toLowerCase()]};base64,${buf.toString('base64')}`;
}
const assetScript = `<script>window.IS=window.IS||{};window.IS.ASSET_URLS=${JSON.stringify(assetUrls)};</script>`;

const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
let injectedAssets = false;
const inlined = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (m, src) => {
  if (/^https?:/.test(src)) return m;
  const code = readFileSync(join(root, src), 'utf8');
  let pre = '';
  if (!injectedAssets && /assets\.js$/.test(src)) { pre = assetScript + '\n'; injectedAssets = true; }
  return `${pre}<script>/* ${src} */\n${safe(code)}\n</script>`;
});
if (!injectedAssets) throw new Error('assets.js script tag not found in index.html');

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), inlined);

// Fragment for the Artifact publisher: <title>, fonts and styles first, then the body content.
const head = (inlined.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, ''])[1];
const body = (inlined.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, ''])[1];
const headKeep = head
  .replace(/<meta\s+charset[^>]*>/gi, '')
  .replace(/<meta\s+name="viewport"[^>]*>/gi, '')
  .trim();
const titleMatch = headKeep.match(/<title>[\s\S]*?<\/title>/i);
const title = titleMatch ? titleMatch[0] : '<title>Starship Sus</title>';
const restHead = headKeep.replace(title, '').trim();
const fragment = `${title}\n${restHead}\n${body.trim()}\n`;
writeFileSync(join(root, 'dist', 'artifact.html'), fragment);

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`assets ${Object.keys(assetUrls).length} files, ${kb(assetBytes)} raw`);
console.log(`dist/index.html ${kb(Buffer.byteLength(inlined))}, dist/artifact.html ${kb(Buffer.byteLength(fragment))}`);
