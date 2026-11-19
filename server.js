// GRAND PRIX — a car-themed team game.
// Round 1: name the car from its logo (10 × 30s) · Round 2: find car parts in a 9×9 grid (60s)
// Round 3: rearrange the shuffled movie title (60s).
// Local: npm start (data in ./data) · Vercel: zero-config Express + Upstash Redis
const express = require('express');
const QRCode = require('qrcode');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createStore } = require('./lib/store');
const grid = require('./lib/grid');
const C = require('./lib/content');

const PORT = Number(process.env.PORT) || 3000;
const T = {
  logo: (Number(process.env.LOGO_TIME) || 30) * 1000,
  parts: (Number(process.env.PARTS_TIME) || 60) * 1000,
  movie: (Number(process.env.MOVIE_TIME) || 60) * 1000,
};
const HINT_AFTER = 15000; // logo hint (first letter) unlocks after 15s
const MAX_TRIES = 3;
const SCORING = { logoBase: 100, logoSpeed: 100, part: 100, partsBonusPerSec: 2, movieBase: 300, movieSpeed: 200 };
const COUNTDOWN_MS = 6000;
const GRACE_MS = 1500;
const TTL = 7 * 24 * 3600;
const IS_VERCEL = !!process.env.VERCEL;
const NLOGO = C.LOGOS.length;
const STEPS = NLOGO + 2; // logos..., parts, movie

const store = createStore();

// ---------- keys & helpers ----------
const K = {
  pin: 'gp:pin',
  roster: 'gp:roster',
  logoCfg: 'gp:logocfg',
  logoImg: (n) => `gp:logo:${n}`,
  game: 'gp:game',
  players: (g) => `gp:${g}:players`,
  pnames: (g) => `gp:${g}:pnames`,
  tok: (g) => `gp:${g}:tok`,
  stats: (g) => `gp:${g}:stats`,
  bonks: (g) => `gp:${g}:bonks`,
  prog: (g, id) => `gp:${g}:p:${id}`,
};
const parse = (s, d = null) => { if (s === null || s === undefined) return d; try { return JSON.parse(s); } catch { return d; } };
const getJ = async (k, d = null) => parse(await store.get(k), d);
const setJ = (k, v, ttl) => store.set(k, JSON.stringify(v), ttl);
const newId = () => crypto.randomBytes(8).toString('hex');
const rnd = (n) => crypto.randomInt(0, n);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const letters = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
const freshGame = () => ({ gameId: crypto.randomBytes(6).toString('hex'), status: 'lobby', tourStep: 0, goAt: null, endedAt: null, plan: null });

async function getGame() {
  let g = await getJ(K.game);
  if (!g) { await store.setnx(K.game, JSON.stringify(freshGame())); g = await getJ(K.game); }
  return g;
}
// Logo answers + uploaded images (editable at /admin, no redeploy needed)
async function getLogoCfg() {
  const saved = (await getJ(K.logoCfg)) || [];
  return C.LOGOS.map((l) => {
    const o = saved.find((x) => x.n === l.n) || {};
    return { n: l.n, answer: o.answer || l.answer, aliases: Array.isArray(o.aliases) ? o.aliases : l.aliases, v: o.v || 0 };
  });
}
const logoUrl = (l) => (l.v ? `/api/logo/${l.n}?v=${l.v}` : `/logos/${l.n}.png`);
async function getRoster() {
  let r = await getJ(K.roster);
  if (!r) { await store.setnx(K.roster, JSON.stringify(C.ROSTER)); r = await getJ(K.roster); }
  return r;
}
let localPin = null;
async function hostPin() {
  if (process.env.HOST_PIN) return String(process.env.HOST_PIN);
  if (IS_VERCEL) return null;
  if (localPin) return localPin;
  await store.setnx(K.pin, String(crypto.randomInt(1000, 10000)));
  return (localPin = await store.get(K.pin));
}
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) return ni.address;
  return 'localhost';
}
function joinUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '') + '/';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) return `http://${lanAddress()}:${PORT}/`;
  return `${req.headers['x-forwarded-proto'] || req.protocol}://${host}/`;
}

// ---------- answer checking ----------
function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function logoMatches(guess, logo) {
  const g = letters(guess);
  if (!g) return false;
  return [logo.answer, ...logo.aliases].some((a) => {
    const t = letters(a);
    const allowed = t.length >= 9 ? 2 : t.length >= 5 ? 1 : 0; // small typos forgiven
    return g === t || (allowed && Math.abs(g.length - t.length) <= allowed && lev(g, t) <= allowed);
  });
}

// ---------- game plan (same for every player) ----------
function buildPlan(logoCfg) {
  // parts grid: 12 random parts, no part that contains another (BELT / SEATBELT)
  let page = null;
  for (let attempt = 0; attempt < 50 && !page; attempt++) {
    const chosen = [];
    for (const p of shuffle(C.PARTS)) {
      if (chosen.length === C.PARTS_PER_GAME) break;
      if (chosen.some((c) => letters(c).includes(letters(p)) || letters(p).includes(letters(c)))) continue;
      chosen.push(p);
    }
    try { page = grid.buildPage(chosen.map((name) => ({ name, clue: '' }))); } catch {}
  }
  if (!page) throw new Error('Could not build the parts grid.');
  // movie: shuffle letters until no word is already in place
  const words = C.MOVIE.toUpperCase().split(/\s+/).map(letters).filter(Boolean);
  const answer = words.join('');
  let tiles;
  for (let i = 0; i < 200; i++) {
    tiles = shuffle([...answer]);
    let pos = 0;
    if (words.every((w) => { const ok = tiles.slice(pos, pos + w.length).join('') !== w; pos += w.length; return ok; })) break;
  }
  return {
    logos: logoCfg.map((l) => ({ n: l.n, answer: l.answer, aliases: l.aliases, image: logoUrl(l) })),
    parts: { grid: page.grid, words: page.words.map(({ name, word, r, c, dr, dc }) => ({ name, word, r, c, dr, dc })) },
    movie: { title: C.MOVIE, groups: words.map((w) => w.length), answer, tiles: tiles.join('') },
  };
}

// ---------- progress ----------
const emptyProg = () => ({ answers: [], served: null, finishedAt: null });
const kindOf = (step) => (step < NLOGO ? 'logo' : step === NLOGO ? 'parts' : 'movie');
const limitOf = (step) => T[kindOf(step)];

function statsOf(prog) {
  const a = prog.answers;
  const s = prog.served;
  const liveParts = s && kindOf(s.step) === 'parts' ? s.found.length : 0;
  const step = prog.finishedAt ? STEPS : a.length;
  return {
    step,
    stage: prog.finishedAt ? 'done' : kindOf(step),
    logos: a.filter((x) => x.kind === 'logo' && x.correct).length,
    parts: (a.find((x) => x.kind === 'parts')?.found || 0) + liveParts,
    movie: !!a.find((x) => x.kind === 'movie' && x.correct),
    score: a.reduce((t, x) => t + x.points, 0) + liveParts * SCORING.part,
    totalMs: a.reduce((t, x) => t + x.ms, 0),
    finished: !!prog.finishedAt,
  };
}
async function saveProgress(g, id, prog) {
  await Promise.all([setJ(K.prog(g.gameId, id), prog, TTL), store.hset(K.stats(g.gameId), id, JSON.stringify(statsOf(prog)))]);
}
function finishStep(g, prog, now, { correct = false, timedOut = false } = {}) {
  const s = prog.served;
  const kind = kindOf(s.step);
  const limit = limitOf(s.step);
  const elapsed = Math.max(0, now - s.startedAt);
  let ms = timedOut ? limit : Math.min(elapsed, limit);
  const left = Math.max(0, limit - ms);
  let points = 0, extra = {};
  if (kind === 'logo') {
    if (correct) points = SCORING.logoBase + Math.round(SCORING.logoSpeed * left / limit);
    extra = { answer: g.plan.logos[s.step].answer };
  } else if (kind === 'parts') {
    const all = s.found.length === g.plan.parts.words.length;
    const bonus = all ? Math.floor(left / 1000) * SCORING.partsBonusPerSec : 0;
    points = s.found.length * SCORING.part + bonus;
    correct = all;
    extra = { found: s.found.length, total: g.plan.parts.words.length, bonus,
      reveal: g.plan.parts.words.map((w, i) => ({ i, name: w.name, cells: grid.cellsOf(w), found: s.found.includes(i) })) };
  } else {
    if (correct) points = SCORING.movieBase + Math.round(SCORING.movieSpeed * left / limit);
    extra = { answer: g.plan.movie.title };
  }
  prog.answers.push({ kind, step: s.step, correct, ms, points, found: extra.found });
  prog.served = null;
  if (prog.answers.length >= STEPS) prog.finishedAt = now;
  return { step: s.step, kind, correct, timedOut, points, ms, ...extra };
}
function expireIfNeeded(g, prog, now = Date.now()) {
  if (!prog.served || g.status !== 'live') return null;
  if (now - prog.served.startedAt > limitOf(prog.served.step) + GRACE_MS) return finishStep(g, prog, now, { timedOut: true });
  return null;
}
function movieGroupsOk(plan, arrangement) {
  let pos = 0;
  return plan.movie.groups.map((len) => { const ok = arrangement.slice(pos, pos + len) === plan.movie.answer.slice(pos, pos + len); pos += len; return ok; });
}
function view(g, prog, now = Date.now()) {
  const s = prog.served;
  const kind = kindOf(s.step);
  const base = { state: 'play', step: s.step, kind, totalSteps: STEPS, remainingMs: Math.max(0, limitOf(s.step) - (now - s.startedAt)), limitMs: limitOf(s.step) };
  if (kind === 'logo') {
    const l = g.plan.logos[s.step];
    const hint = now - s.startedAt >= HINT_AFTER ? hintFor(l) : null;
    return { ...base, index: s.step + 1, count: NLOGO, image: l.image, triesLeft: MAX_TRIES - s.tries, maxTries: MAX_TRIES, hint, hintInMs: Math.max(0, HINT_AFTER - (now - s.startedAt)) };
  }
  if (kind === 'parts') {
    const P = g.plan.parts;
    // part names stay hidden until found: players must spot them on their own
    return { ...base, grid: P.grid, total: P.words.length, words: P.words.map((w, i) => (s.found.includes(i) ? { i, found: true, name: w.name, cells: grid.cellsOf(w) } : { i, found: false })) };
  }
  const arr = s.arrangement || g.plan.movie.tiles;
  return { ...base, groups: g.plan.movie.groups, tiles: arr, ok: movieGroupsOk(g.plan, arr) };
}
const hintFor = (l) => l.answer.toUpperCase().split(/\s+/).map((w) => w[0] + ' _'.repeat(w.length - 1)).join('   ');

async function leaderboard(g) {
  const [players, stats] = await Promise.all([store.hgetall(K.players(g.gameId)), store.hgetall(K.stats(g.gameId))]);
  const empty = { step: 0, stage: 'waiting', logos: 0, parts: 0, movie: false, score: 0, totalMs: 0, finished: false };
  return Object.entries(players)
    .map(([id, p]) => { const pr = parse(p, {}); return { id, name: pr.name, emoji: pr.emoji, custom: !!pr.custom, joinedAt: pr.joinedAt, ...empty, ...parse(stats[id], {}) }; })
    .sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || a.joinedAt - b.joinedAt)
    .map((r, i) => ({ rank: i + 1, ...r }));
}
const publicRow = ({ joinedAt, ...r }) => r;

// ---------- app ----------
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '700kb' }));
app.use((req, res, next) => { if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store'); next(); });
if (!IS_VERCEL) app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/host', (req, res) => res.redirect('/host.html'));
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/', (req, res) => res.redirect('/index.html'));
app.use('/api', (req, res, next) => {
  if (!store) return res.status(503).json({ error: 'Database not connected. In Vercel → Storage, connect an Upstash Redis database and redeploy.' });
  next();
});
const err = (res, code, msg) => res.status(code).json({ error: msg });

async function player(req, res, next) {
  const g = await getGame();
  const id = await store.hget(K.tok(g.gameId), req.get('x-player-token') || '-');
  if (!id) return err(res, 401, 'Not joined');
  req.game = g; req.pid = id;
  req.prog = (await getJ(K.prog(g.gameId, id))) || emptyProg();
  next();
}
async function host(req, res, next) {
  const pin = await hostPin();
  if (!pin) return err(res, 503, 'HOST_PIN is not set. Add it in Vercel → Settings → Environment Variables and redeploy.');
  if ((req.get('x-host-pin') || '') !== pin) return err(res, 401, 'Wrong PIN');
  next();
}
const phase = (g) => ({ status: g.status, tourStep: g.tourStep, goAt: g.goAt, serverNow: Date.now(), gameId: g.gameId });
const rules = () => ({ times: { logo: T.logo / 1000, parts: T.parts / 1000, movie: T.movie / 1000 }, logos: NLOGO, partsPerGame: C.PARTS_PER_GAME, maxTries: MAX_TRIES, scoring: SCORING });

// ----- player API -----
app.get('/api/status', async (req, res) => {
  const g = await getGame();
  res.json({ ...phase(g), ...rules(), logoImages: g.status === 'live' && g.plan ? g.plan.logos.map((l) => l.image) : undefined });
});

// Uploaded logo images are served from the database (cache-busted by ?v=)
app.get('/api/logo/:n', async (req, res) => {
  const data = await store.get(K.logoImg(Number(req.params.n) || 0));
  const m = data && /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,(.+)$/.exec(data);
  if (!m) return res.redirect(`/logos/${Number(req.params.n) || 1}.png`);
  res.set('Content-Type', m[1]);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(m[2], 'base64'));
});

app.get('/api/roster', async (req, res) => {
  const g = await getGame();
  const [roster, taken] = await Promise.all([getRoster(), store.hgetall(K.pnames(g.gameId))]);
  res.json({ names: roster.map((name) => ({ name, joined: !!taken[name.toLowerCase()] })) });
});

app.post('/api/join', async (req, res) => {
  const g = await getGame();
  if (g.status === 'ended') return err(res, 403, 'This race has finished. Wait for the host to start a new one.');
  const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (name.length < 2) return err(res, 400, 'Name must be at least 2 characters.');
  const emoji = [...String(req.body?.emoji || '🏎️')].slice(0, 8).join('') || '🏎️';
  const roster = await getRoster();
  const custom = !roster.some((n) => n.toLowerCase() === name.toLowerCase());
  const id = newId();
  if (!(await store.hsetnx(K.pnames(g.gameId), name.toLowerCase(), id))) return err(res, 409, `${name} is already in the game. If that’s you on another device, ask the host to remove the old one.`);
  const token = crypto.randomBytes(16).toString('hex');
  await Promise.all([
    store.hset(K.players(g.gameId), id, JSON.stringify({ name, emoji, custom, joinedAt: Date.now(), token })),
    store.hset(K.tok(g.gameId), token, id),
  ]);
  await Promise.all([K.players, K.pnames, K.tok, K.stats, K.bonks].map((k) => store.expire(k(g.gameId), TTL)));
  res.json({ token, gameId: g.gameId, id, name, emoji, custom });
});

app.get('/api/lobby', player, async (req, res) => {
  const g = req.game;
  const [players, bonks] = await Promise.all([store.hgetall(K.players(g.gameId)), store.hget(K.bonks(g.gameId), req.pid)]);
  res.json({
    ...phase(g),
    me: req.pid,
    bonked: Number(bonks) || 0,
    players: Object.entries(players).map(([id, p]) => { const v = parse(p, {}); return { id, name: v.name, emoji: v.emoji, joinedAt: v.joinedAt }; }).sort((a, b) => a.joinedAt - b.joinedAt),
  });
});

app.post('/api/bonk', player, async (req, res) => {
  const g = req.game;
  const target = String(req.body?.target || '');
  if (target === req.pid) return err(res, 400, 'You can’t bonk yourself 😅');
  if (!(await store.hget(K.players(g.gameId), target))) return err(res, 404, 'Player not found');
  await Promise.all([store.hincrby(K.bonks(g.gameId), target, 1), store.hincrby(K.bonks(g.gameId), '_total', 1)]);
  res.json({ ok: true });
});

app.get('/api/me', player, async (req, res) => {
  const g = req.game, prog = req.prog;
  if (expireIfNeeded(g, prog)) await saveProgress(g, req.pid, prog);
  const board = await leaderboard(g);
  const i = board.findIndex((r) => r.id === req.pid);
  const me = board[i] || { rank: board.length };
  res.json({
    ...phase(g), ...statsOf(prog), rank: me.rank, players: board.length,
    gapAhead: i > 0 ? board[i - 1].score - me.score : null,
    gapBehind: i >= 0 && i < board.length - 1 ? me.score - board[i + 1].score : null,
    top: g.status === 'ended' ? board.slice(0, 5).map(({ id, rank, name, emoji, score }) => ({ me: id === req.pid, rank, name, emoji, score })) : undefined,
  });
});

app.post('/api/next', player, async (req, res) => {
  const g = req.game, prog = req.prog, now = Date.now();
  if (g.status === 'lobby' || g.status === 'tour') return res.json({ state: 'waiting', ...phase(g) });
  if (g.status === 'ended') return res.json({ state: 'ended', ...phase(g) });
  if (now < g.goAt) return res.json({ state: 'countdown', ...phase(g) });
  const summary = expireIfNeeded(g, prog, now);
  let dirty = !!summary;
  if (prog.finishedAt) { if (dirty) await saveProgress(g, req.pid, prog); return res.json({ state: 'finished', summary: summary || undefined }); }
  const step = prog.answers.length;
  if (!prog.served || prog.served.step !== step) { prog.served = { step, startedAt: now, tries: 0, found: [], arrangement: null }; dirty = true; }
  if (dirty) await saveProgress(g, req.pid, prog);
  res.json({ ...view(g, prog, now), summary: summary || undefined });
});

function guard(req, res) {
  const g = req.game, prog = req.prog, now = Date.now();
  if (g.status !== 'live') { err(res, 409, 'The race is not running'); return null; }
  const summary = expireIfNeeded(g, prog, now);
  if (summary) return { summary, now };
  if (!prog.served || prog.served.step !== req.body?.step) { err(res, 409, 'Out of sync'); return null; }
  return { now };
}
const doneResponse = (prog, summary) => ({ done: true, summary, score: statsOf(prog).score, finished: !!prog.finishedAt });

app.post('/api/hint', player, async (req, res) => {
  const ctx = guard(req, res); if (!ctx) return;
  const g = req.game, prog = req.prog;
  if (ctx.summary) { await saveProgress(g, req.pid, prog); return res.json(doneResponse(prog, ctx.summary)); }
  res.json(view(g, prog, ctx.now));
});

app.post('/api/answer', player, async (req, res) => {
  const ctx = guard(req, res); if (!ctx) return;
  const g = req.game, prog = req.prog;
  if (ctx.summary) { await saveProgress(g, req.pid, prog); return res.json(doneResponse(prog, ctx.summary)); }
  const s = prog.served;
  if (kindOf(s.step) !== 'logo') return err(res, 400, 'Wrong round');
  s.tries += 1;
  const ok = logoMatches(req.body?.guess, g.plan.logos[s.step]);
  if (!ok && s.tries < MAX_TRIES) { await saveProgress(g, req.pid, prog); return res.json({ done: false, triesLeft: MAX_TRIES - s.tries }); }
  const summary = finishStep(g, prog, ctx.now, { correct: ok });
  await saveProgress(g, req.pid, prog);
  res.json(doneResponse(prog, summary));
});

app.post('/api/select', player, async (req, res) => {
  const ctx = guard(req, res); if (!ctx) return;
  const g = req.game, prog = req.prog;
  if (ctx.summary) { await saveProgress(g, req.pid, prog); return res.json(doneResponse(prog, ctx.summary)); }
  const s = prog.served;
  if (kindOf(s.step) !== 'parts') return err(res, 400, 'Wrong round');
  const b = req.body;
  const [r1, c1, r2, c2] = [b.r1, b.c1, b.r2, b.c2].map(Number);
  if (![r1, c1, r2, c2].every((v) => Number.isInteger(v) && v >= 0 && v < grid.SIZE)) return err(res, 400, 'Bad selection');
  const same = (a, z) => a[0] === z[0] && a[1] === z[1];
  const words = g.plan.parts.words;
  const hit = words.findIndex((w, i) => {
    if (s.found.includes(i)) return false;
    const cells = grid.cellsOf(w), f = cells[0], l = cells[cells.length - 1];
    return (same(f, [r1, c1]) && same(l, [r2, c2])) || (same(f, [r2, c2]) && same(l, [r1, c1]));
  });
  if (hit < 0) return res.json({ found: false });
  s.found.push(hit);
  const out = { found: true, i: hit, name: words[hit].name, cells: grid.cellsOf(words[hit]) };
  if (s.found.length === words.length) out.summary = finishStep(g, prog, ctx.now);
  await saveProgress(g, req.pid, prog);
  res.json({ ...out, done: !!out.summary, score: statsOf(prog).score, finished: !!prog.finishedAt });
});

app.post('/api/arrange', player, async (req, res) => {
  const ctx = guard(req, res); if (!ctx) return;
  const g = req.game, prog = req.prog;
  if (ctx.summary) { await saveProgress(g, req.pid, prog); return res.json(doneResponse(prog, ctx.summary)); }
  const s = prog.served;
  if (kindOf(s.step) !== 'movie') return err(res, 400, 'Wrong round');
  const arr = letters(req.body?.tiles);
  // must be a rearrangement of the same letters
  if ([...arr].sort().join('') !== [...g.plan.movie.answer].sort().join('')) return err(res, 400, 'Bad arrangement');
  s.arrangement = arr;
  const ok = movieGroupsOk(g.plan, arr);
  if (arr === g.plan.movie.answer) {
    const summary = finishStep(g, prog, ctx.now, { correct: true });
    await saveProgress(g, req.pid, prog);
    return res.json({ ...doneResponse(prog, summary), ok });
  }
  await saveProgress(g, req.pid, prog);
  res.json({ done: false, ok });
});

// skip the current question / timer ran out on the phone
app.post('/api/endstep', player, async (req, res) => {
  const g = req.game, prog = req.prog, now = Date.now();
  if (g.status !== 'live') return err(res, 409, 'The race is not running');
  let summary = expireIfNeeded(g, prog, now);
  if (!summary) {
    const s = prog.served;
    if (!s || s.step !== req.body?.step) return res.json({ done: true, summary: null, stale: true, score: statsOf(prog).score, finished: !!prog.finishedAt });
    summary = finishStep(g, prog, now, { timedOut: req.body?.reason === 'timeout' });
  }
  await saveProgress(g, req.pid, prog);
  res.json(doneResponse(prog, summary));
});

// ----- host API -----
app.post('/api/host/login', host, (req, res) => res.json({ ok: true }));

const qrCache = new Map();
app.get('/api/host/overview', host, async (req, res) => {
  const g = await getGame();
  const url = joinUrl(req);
  if (!qrCache.has(url)) qrCache.set(url, await QRCode.toDataURL(url, { margin: 1, width: 520, errorCorrectionLevel: 'M', color: { dark: '#0b0b10', light: '#ffffff' } }));
  const [board, roster, bonksTotal] = await Promise.all([leaderboard(g), getRoster(), store.hget(K.bonks(g.gameId), '_total')]);
  const joinedNames = new Set(board.map((p) => p.name.toLowerCase()));
  res.json({
    ...phase(g), ...rules(),
    joinUrl: url, qr: qrCache.get(url),
    leaderboard: board.map(publicRow),
    pending: roster.filter((n) => !joinedNames.has(n.toLowerCase())),
    rosterSize: roster.length,
    bonksTotal: Number(bonksTotal) || 0,
    storage: store.kind,
  });
});

app.post('/api/host/ignite', host, async (req, res) => {
  const g = await getGame();
  if (g.status !== 'lobby') return err(res, 409, 'Already started.');
  g.status = 'tour'; g.tourStep = 0;
  await setJ(K.game, g);
  res.json(phase(g));
});
app.post('/api/host/tour', host, async (req, res) => {
  const g = await getGame();
  if (g.status !== 'tour') return err(res, 409, 'Not in the briefing.');
  g.tourStep = Math.max(0, Math.min(2, Number(req.body?.step) || 0));
  await setJ(K.game, g);
  res.json(phase(g));
});
app.post('/api/host/go', host, async (req, res) => {
  const g = await getGame();
  if (g.status !== 'tour' && g.status !== 'lobby') return err(res, 409, 'The race already started.');
  try { g.plan = buildPlan(await getLogoCfg()); } catch (e) { return err(res, 500, e.message); }
  g.status = 'live';
  g.goAt = Date.now() + COUNTDOWN_MS;
  await setJ(K.game, g);
  res.json(phase(g));
});
app.post('/api/host/end', host, async (req, res) => {
  const g = await getGame();
  if (g.status !== 'live') return err(res, 409, 'The race is not running.');
  const ids = Object.keys(await store.hgetall(K.players(g.gameId)));
  const progs = await store.mget(ids.map((id) => K.prog(g.gameId, id)));
  const now = Date.now();
  await Promise.all(ids.map(async (id, i) => { const p = parse(progs[i]); if (p && expireIfNeeded(g, p, now)) await saveProgress(g, id, p); }));
  g.status = 'ended'; g.endedAt = now;
  await setJ(K.game, g);
  res.json(phase(g));
});
app.post('/api/host/reset', host, async (req, res) => {
  const old = await getGame();
  const ids = Object.keys(await store.hgetall(K.players(old.gameId)));
  await store.del(K.players(old.gameId), K.pnames(old.gameId), K.tok(old.gameId), K.stats(old.gameId), K.bonks(old.gameId), ...ids.map((id) => K.prog(old.gameId, id)));
  await setJ(K.game, freshGame());
  res.json({ ok: true });
});
app.delete('/api/host/players/:id', host, async (req, res) => {
  const g = await getGame();
  const p = parse(await store.hget(K.players(g.gameId), req.params.id));
  if (p) await Promise.all([
    store.hdel(K.players(g.gameId), req.params.id), store.hdel(K.pnames(g.gameId), p.name.toLowerCase()),
    store.hdel(K.tok(g.gameId), p.token), store.hdel(K.stats(g.gameId), req.params.id), store.del(K.prog(g.gameId, req.params.id)),
  ]);
  res.json({ ok: true });
});

// ----- admin: roster + content check -----
app.get('/api/admin/roster', host, async (req, res) => res.json({ names: await getRoster() }));
app.put('/api/admin/roster', host, async (req, res) => {
  const seen = new Set();
  const names = String(req.body?.text || '').split(/\n|,/).map((n) => n.replace(/\s+/g, ' ').trim().slice(0, 24)).filter((n) => {
    if (n.length < 2 || seen.has(n.toLowerCase())) return false;
    seen.add(n.toLowerCase()); return true;
  });
  await setJ(K.roster, names);
  res.json({ names });
});
app.put('/api/admin/logo/:n', host, async (req, res) => {
  const n = Number(req.params.n);
  if (!C.LOGOS.some((l) => l.n === n)) return err(res, 404, 'No such logo slot');
  if ((await getGame()).status === 'live') return err(res, 409, 'Logos are locked while a race is live.');
  const cfg = await getLogoCfg();
  const item = cfg.find((l) => l.n === n);
  const b = req.body || {};
  if (b.answer !== undefined) {
    const a = String(b.answer).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (letters(a).length < 2) return err(res, 400, 'Enter the car brand name.');
    item.answer = a;
  }
  if (b.aliases !== undefined) item.aliases = String(b.aliases).split(',').map((x) => x.trim()).filter((x) => letters(x).length >= 2).slice(0, 6);
  if (b.image) {
    if (!/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(b.image)) return err(res, 400, 'Unsupported image. Use PNG, JPG, WebP or SVG.');
    if (b.image.length > 650000) return err(res, 413, 'Image is too large. Use one under 450 KB.');
    await store.set(K.logoImg(n), b.image);
    item.v = Date.now();
  }
  if (b.clearImage) { await store.del(K.logoImg(n)); item.v = 0; }
  await setJ(K.logoCfg, cfg);
  res.json({ n, answer: item.answer, aliases: item.aliases, image: logoUrl(item), uploaded: !!item.v });
});
app.get('/api/admin/content', host, async (req, res) => res.json({
  logos: (await getLogoCfg()).map((l) => ({ n: l.n, answer: l.answer, aliases: l.aliases, image: logoUrl(l), uploaded: !!l.v })),
  parts: C.PARTS, partsPerGame: C.PARTS_PER_GAME, movie: C.MOVIE,
}));

app.use((e, req, res, next) => { console.error(e); res.status(500).json({ error: 'Server error' }); });

module.exports = app;
module.exports._test = { logoMatches, buildPlan, hintFor };

if (!IS_VERCEL && require.main === module) {
  app.listen(PORT, '0.0.0.0', async () => {
    const lan = process.env.PUBLIC_URL || `http://${lanAddress()}:${PORT}`;
    console.log('\n  🏁 GRAND PRIX is running' + (store.kind === 'redis' ? ' (Upstash Redis)' : ' (local file storage)'));
    console.log(`  Host screen : http://localhost:${PORT}/host`);
    console.log(`  Admin       : http://localhost:${PORT}/admin`);
    console.log(`  Players join: ${lan}/`);
    console.log(`  Host PIN    : ${await hostPin()}${process.env.HOST_PIN ? ' (from HOST_PIN)' : ''}\n`);
  });
}
