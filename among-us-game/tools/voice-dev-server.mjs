// Dependency-free dev server for the self-hosted Starship Sus build (SPEC.md §7), so the game can
// run with LiveKit multiplayer + voice without the Next.js app.
//
//   node tools/build.mjs --selfhost            # writes ../public/among-us/index.html
//   LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
//     node tools/voice-dev-server.mjs [--port=8790] [--dir=<build dir>]
//   open http://localhost:8790/among-us
//
// Serves the build directory at /among-us and implements GET /api/among-us/token like the
// Next.js route (app/api/among-us/token/route.ts), signing the LiveKit access token (HS256 JWT)
// itself with node:crypto. Without env vars it uses the keys of `livekit-server --dev`
// (devkey / secret, ws://localhost:7880). NEXT_PUBLIC_LIVEKIT_URL is accepted for LIVEKIT_URL.
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, dirname, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };

const PORT = Number(arg('port') || process.env.PORT || 8790);
const HOST = arg('host') || process.env.HOST || '0.0.0.0';
const DIR = arg('dir') || join(here, '..', '..', 'public', 'among-us');
const LK_URL = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7880';
const API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const TTL = 6 * 3600;

const ROOM_RE = /^ss-[a-z0-9-]{1,40}$/;
const IDENTITY_RE = /^[A-Za-z0-9_-]{4,40}$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// LiveKit access token: HS256 JWT, iss = API key, sub = identity, video grant for one room.
export function signToken({ apiKey, apiSecret, identity, room, ttl = TTL, now = Math.floor(Date.now() / 1000) }) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const claims = {
    iss: apiKey, sub: identity, jti: identity, nbf: now - 10, exp: now + ttl,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true }
  };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${body}.${b64url(createHmac('sha256', apiSecret).update(body).digest())}`;
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

  if (path === '/api/among-us/token') {
    const room = url.searchParams.get('room');
    const identity = url.searchParams.get('identity');
    if (!room || !ROOM_RE.test(room)) return send(res, 400, { error: 'Invalid "room" query parameter' });
    if (!identity || !IDENTITY_RE.test(identity)) return send(res, 400, { error: 'Invalid "identity" query parameter' });
    if (!API_KEY || !API_SECRET || !LK_URL) {
      return send(res, 500, { error: 'Server misconfigured: set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET' });
    }
    return send(res, 200, { token: signToken({ apiKey: API_KEY, apiSecret: API_SECRET, identity, room }), url: LK_URL });
  }

  if (path === '/' ) return send(res, 302, '', 'text/plain', { Location: '/among-us' });
  let rel = null;
  if (path === '/among-us' || path === '/among-us/') rel = 'index.html';
  else if (path.startsWith('/among-us/')) rel = decodeURIComponent(path.slice('/among-us/'.length));
  if (rel === null) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  const file = normalize(join(DIR, rel));
  if (!file.startsWith(normalize(DIR + '/')) || !TYPES[extname(file)]) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  try {
    const buf = await readFile(file);
    return send(res, 200, req.method === 'HEAD' ? '' : buf, TYPES[extname(file)]);
  } catch {
    const hint = rel === 'index.html' ? ' (run `node tools/build.mjs --selfhost` first)' : '';
    return send(res, 404, 'Not found' + hint, 'text/plain; charset=utf-8');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  createServer((req, res) => {
    handle(req, res).catch((e) => { console.error(e); send(res, 500, { error: 'internal error' }); });
  }).listen(PORT, HOST, () => {
    const dev = !process.env.LIVEKIT_API_KEY ? ' (livekit-server --dev keys)' : '';
    console.log(`Starship Sus voice dev server: http://localhost:${PORT}/among-us`);
    console.log(`  serving ${DIR}`);
    console.log(`  LiveKit ${LK_URL}, key ${API_KEY}${dev}`);
  });
}
