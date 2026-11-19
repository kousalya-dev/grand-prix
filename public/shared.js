// GRAND PRIX shared helpers: sound, car art, countdown, toasts, briefing cards.
window.GP = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- server clock ----------
  let offset = 0, bestRtt = Infinity;
  async function api(path, { method, body, headers } = {}) {
    const t0 = Date.now();
    const res = await fetch(path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', ...(headers || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const t1 = Date.now();
    const data = await res.json().catch(() => ({}));
    if (data && data.serverNow && t1 - t0 <= bestRtt + 40) { bestRtt = Math.min(bestRtt, t1 - t0); offset = data.serverNow - (t0 + t1) / 2; }
    if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.status = res.status; throw e; }
    return data;
  }
  const serverNow = () => Date.now() + offset;

  // ---------- sound (synthesised, no files) ----------
  let ctx = null, muted = false;
  try { muted = localStorage.getItem('gp.muted') === '1'; } catch {}
  function audio() {
    if (muted) return null;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch { return null; }
  }
  const unlock = () => audio();
  function setMuted(m) { muted = m; try { localStorage.setItem('gp.muted', m ? '1' : '0'); } catch {} if (m && ctx) ctx.suspend(); else audio(); }
  function noiseBuf(a, dur) {
    const b = a.createBuffer(1, a.sampleRate * dur, a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function tone(freq, dur, { type = 'sine', vol = 0.25, at = 0, slideTo = null } = {}) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, { at = 0, vol = 0.3, freq = 1200, q = 1, type = 'bandpass', sweepTo = null } = {}) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + at, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf(a, dur + 0.1); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(a.destination); s.start(t); s.stop(t + dur + 0.1);
  }
  const sound = {
    engineStart() {
      const a = audio(); if (!a) return;
      // starter motor
      for (let i = 0; i < 4; i++) noise(0.11, { at: i * 0.16, vol: 0.35, freq: 900, q: 2 });
      // engine catches, revs, settles to idle
      const t = a.currentTime + 0.7, o1 = a.createOscillator(), o2 = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = 18;
      [o1, o2].forEach((o) => { o.frequency.setValueAtTime(30, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.25); o.frequency.exponentialRampToValueAtTime(150, t + 0.9); o.frequency.exponentialRampToValueAtTime(60, t + 1.6); o.frequency.setValueAtTime(60, t + 2.6); });
      f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.9); f.frequency.exponentialRampToValueAtTime(500, t + 1.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.15); g.gain.setValueAtTime(0.32, t + 1.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      o1.connect(f); o2.connect(f); f.connect(g).connect(a.destination);
      o1.start(t); o2.start(t); o1.stop(t + 3.1); o2.stop(t + 3.1);
    },
    rev() { tone(60, 0.9, { type: 'sawtooth', vol: 0.2, slideTo: 170 }); tone(62, 0.9, { type: 'square', vol: 0.08, slideTo: 172 }); },
    beep(high) { tone(high ? 880 : 440, high ? 0.7 : 0.25, { type: 'square', vol: 0.18 }); },
    whoosh() { noise(0.9, { vol: 0.35, freq: 300, sweepTo: 3000, q: 0.8 }); },
    bonk() { tone(220, 0.18, { vol: 0.5, slideTo: 55 }); noise(0.05, { vol: 0.4, freq: 2500, q: 3 }); },
    ouch() { tone(520, 0.14, { type: 'triangle', vol: 0.3, slideTo: 300 }); tone(300, 0.2, { type: 'triangle', vol: 0.25, at: 0.12, slideTo: 180 }); },
    correct() { tone(660, 0.14, { type: 'triangle', vol: 0.3 }); tone(990, 0.28, { type: 'triangle', vol: 0.3, at: 0.11 }); },
    wrong() { tone(150, 0.25, { type: 'square', vol: 0.15 }); },
    tick() { tone(1200, 0.05, { type: 'square', vol: 0.06 }); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.25, at: i * 0.12 })); },
  };

  // ---------- car art (original generic supercar) ----------
  function carSVG(color = '#ff2a2a', spin = false) {
    const id = 'c' + Math.random().toString(36).slice(2, 7);
    const wheel = (cx) => `<g><circle cx="${cx}" cy="100" r="25" fill="#0d0d0f"/><circle cx="${cx}" cy="100" r="16" fill="url(#rim${id})"/>
      <g class="${spin ? 'wheel-spin' : ''}">${[0, 72, 144, 216, 288].map((a) => `<rect x="${cx - 1.6}" y="86" width="3.2" height="14" rx="1.5" fill="#2b2f36" transform="rotate(${a} ${cx} 100)"/>`).join('')}</g>
      <circle cx="${cx}" cy="100" r="4" fill="#d6dae0"/></g>`;
    return `<svg viewBox="0 0 400 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="body${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="#3a0606"/></linearGradient>
        <linearGradient id="glass${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fd8ff" stop-opacity=".85"/><stop offset=".5" stop-color="#1b2b3a"/><stop offset="1" stop-color="#0b1118"/></linearGradient>
        <radialGradient id="rim${id}"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".7" stop-color="#9aa1ab"/><stop offset="1" stop-color="#4c525b"/></radialGradient>
      </defs>
      <ellipse cx="205" cy="124" rx="185" ry="7" fill="#000" opacity=".45"/>
      <path d="M12 98 L14 84 Q17 75 34 73 L116 64 Q158 36 222 31 Q272 29 320 54 L368 60 Q388 63 392 80 L394 94 Q394 101 386 101 L12 101 Z" fill="url(#body${id})"/>
      <path d="M134 63 Q170 41 222 38 Q256 38 290 55 L285 61 Z" fill="url(#glass${id})"/>
      <path d="M196 39 L190 62" stroke="#1a0303" stroke-width="3"/>
      <path d="M40 84 L360 76" stroke="rgba(255,255,255,.25)" stroke-width="2"/>
      <path d="M372 70 L392 76 L390 82 L370 80 Z" fill="#e8fbff"/><path d="M14 82 L30 80 L30 86 L14 88 Z" fill="#ff3b3b"/>
      <path d="M298 52 L338 44 L342 48 L306 56 Z" fill="#1a1a1d"/>
      <circle cx="92" cy="100" r="30" fill="#060607"/><circle cx="322" cy="100" r="30" fill="#060607"/>
      ${wheel(92)}${wheel(322)}
    </svg>`;
  }
  function zoomCar() {
    const el = document.createElement('div');
    el.className = 'zoom-car'; el.innerHTML = carSVG('#ff2a2a', true);
    document.body.appendChild(el); sound.whoosh();
    setTimeout(() => el.remove(), 1300);
  }

  // ---------- countdown: 3 red lights, then green GO + chequered flag ----------
  let cdRunning = false;
  async function countdown(goAtServer) {
    if (cdRunning) return; cdRunning = true;
    const wait = (t) => sleep(Math.max(0, t - serverNow()));
    if (serverNow() > goAtServer + 300) { cdRunning = false; return; }
    const o = document.createElement('div');
    o.className = 'lights-overlay';
    o.innerHTML = `<div class="lights-wrap"><div class="kicker" style="margin-bottom:16px">Get ready</div><div class="lights"><div class="light"></div><div class="light"></div><div class="light"></div></div><div class="count-num" id="cdNum"></div><div id="cdFlag"></div></div>`;
    document.body.appendChild(o);
    const lights = o.querySelectorAll('.light'), num = o.querySelector('#cdNum');
    for (let k = 0; k < 3; k++) {
      await wait(goAtServer - (3 - k) * 1000);
      lights[k].classList.add('on');
      num.textContent = String(3 - k); num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
      sound.beep(false);
    }
    await wait(goAtServer);
    lights.forEach((l) => { l.classList.remove('on'); l.classList.add('go'); });
    num.textContent = 'GO!'; num.classList.add('go'); num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
    o.querySelector('#cdFlag').innerHTML = '<div class="waving-flag"></div>';
    sound.beep(true); zoomCar();
    await sleep(1300);
    o.remove(); cdRunning = false;
  }


  // ---------- live backdrop: floodlit night circuit (canvas, crisp at any resolution) ----------
  function backdrop(canvas) {
    const ctx2 = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, phase = 0, last = 0, dim = false, raf2 = 0, stars = [], trails = [], stands = [];
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.width = Math.round(innerWidth * dpr); H = canvas.height = Math.round(innerHeight * dpr);
      stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.36, r: (Math.random() * 1.2 + 0.3) * dpr, a: Math.random() }));
      stands = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: H * 0.385 + Math.random() * H * 0.03, c: Math.random() < 0.15 ? '#ffd27a' : Math.random() < 0.5 ? '#9fb7d8' : '#ff8a6a', a: Math.random() }));
      draw(true);
    }
    function proj(t) { const hor = H * 0.42; return { y: hor + (H - hor) * t, half: W * 0.03 + W * 0.72 * t }; }
    function draw(force) {
      const hor = H * 0.42;
      // sky
      let g = ctx2.createLinearGradient(0, 0, 0, hor);
      g.addColorStop(0, '#070c16'); g.addColorStop(0.7, '#12203a'); g.addColorStop(1, '#2a3550');
      ctx2.fillStyle = g; ctx2.fillRect(0, 0, W, hor + 2);
      for (const s of stars) { ctx2.globalAlpha = 0.35 + 0.35 * Math.sin(phase * 0.6 + s.a * 9); ctx2.fillStyle = '#cfe0ff'; ctx2.beginPath(); ctx2.arc(s.x, s.y, s.r, 0, 7); ctx2.fill(); }
      ctx2.globalAlpha = 1;
      // floodlight towers glow
      for (const fx of [0.08, 0.27, 0.73, 0.92]) {
        const x = W * fx, y = hor - H * 0.12;
        const rg = ctx2.createRadialGradient(x, y, 0, x, y, H * 0.22);
        rg.addColorStop(0, 'rgba(255,240,210,.55)'); rg.addColorStop(0.15, 'rgba(255,225,170,.18)'); rg.addColorStop(1, 'rgba(255,220,160,0)');
        ctx2.fillStyle = rg; ctx2.fillRect(x - H * 0.22, y - H * 0.22, H * 0.44, H * 0.44);
        ctx2.fillStyle = '#1a2233'; ctx2.fillRect(x - 1.5 * dpr, y, 3 * dpr, hor - y);
        ctx2.fillStyle = '#fff6e0'; ctx2.fillRect(x - 10 * dpr, y - 3 * dpr, 20 * dpr, 5 * dpr);
      }
      // grandstands
      ctx2.fillStyle = '#0b111c'; ctx2.fillRect(0, hor - H * 0.035, W, H * 0.04);
      for (const p of stands) { ctx2.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(phase * 0.8 + p.a * 20)); ctx2.fillStyle = p.c; ctx2.fillRect(p.x, p.y - H * 0.03, 1.6 * dpr, 1.6 * dpr); }
      ctx2.globalAlpha = 1;
      // ground
      g = ctx2.createLinearGradient(0, hor, 0, H); g.addColorStop(0, '#0d1420'); g.addColorStop(1, '#05080d');
      ctx2.fillStyle = g; ctx2.fillRect(0, hor, W, H - hor);
      // track rows (pseudo-3D)
      const step = 2 * dpr;
      for (let y = hor; y < H; y += step) {
        const t = (y - hor) / (H - hor), z = 1 / Math.max(t, 0.004), half = W * 0.03 + W * 0.72 * t, cx = W / 2;
        const shade = 18 + Math.round(10 * t);
        ctx2.fillStyle = `rgb(${shade},${shade + 3},${shade + 8})`;
        ctx2.fillRect(cx - half, y, half * 2, step + 1);
        const kerb = Math.floor(z * 0.9 + phase * 6) % 2 === 0;
        const kw = half * 0.06;
        ctx2.fillStyle = kerb ? '#c8102e' : '#e9edf3';
        ctx2.fillRect(cx - half - kw, y, kw, step + 1); ctx2.fillRect(cx + half, y, kw, step + 1);
        if (Math.floor(z * 0.45 + phase * 3) % 2 === 0) { ctx2.fillStyle = 'rgba(240,240,235,.7)'; ctx2.fillRect(cx - half * 0.012, y, half * 0.024, step + 1); }
      }
      // light trails
      for (const tr of trails) {
        const a = proj(tr.t), b = proj(Math.max(0.001, tr.t - tr.len));
        const xa = W / 2 + a.half * tr.lane, xb = W / 2 + b.half * tr.lane;
        const lg = ctx2.createLinearGradient(xa, a.y, xb, b.y);
        lg.addColorStop(0, tr.col); lg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx2.strokeStyle = lg; ctx2.lineWidth = Math.max(1, 5 * tr.t) * dpr; ctx2.lineCap = 'round';
        ctx2.beginPath(); ctx2.moveTo(xa, a.y); ctx2.lineTo(xb, b.y); ctx2.stroke();
      }
      // vignette
      const vg = ctx2.createRadialGradient(W / 2, H * 0.45, H * 0.2, W / 2, H * 0.5, Math.max(W, H) * 0.8);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.7)');
      ctx2.fillStyle = vg; ctx2.fillRect(0, 0, W, H);
    }
    function frame(ts) {
      raf2 = requestAnimationFrame(frame);
      if (document.hidden || dim || reduce) return;
      if (ts - last < 33) return; // ~30 fps is plenty for a backdrop
      const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
      phase += dt;
      if (Math.random() < 0.035 && trails.length < 6) {
        const out = Math.random() < 0.5;
        trails.push({ t: out ? 1 : 0.02, v: out ? -0.55 : 0.6, lane: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.55), len: 0.25, col: out ? 'rgba(255,60,40,.95)' : 'rgba(235,245,255,.95)' });
      }
      trails.forEach((tr) => (tr.t += tr.v * dt * (0.4 + tr.t)));
      trails = trails.filter((tr) => tr.t > 0.01 && tr.t < 1.2);
      draw();
    }
    addEventListener('resize', resize);
    resize(); raf2 = requestAnimationFrame(frame);
    return { dim(v) { dim = v; canvas.classList.toggle('dim', v); } };
  }

  // ---------- toasts / dialogs / confetti ----------
  function toast(msg, kind = '', ms = 3000) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind; t.innerHTML = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
    return t;
  }
  function ask(title, text, yes = 'Yes') {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><div class="muted">${esc(text)}</div>
        <div class="row"><button class="btn ghost small" data-v="0">Cancel</button><button class="btn small" data-v="1">${esc(yes)}</button></div></div>`;
      back.addEventListener('click', (e) => {
        const v = e.target.dataset.v;
        if (v === undefined && e.target !== back) return;
        back.remove(); resolve(v === '1');
      });
      document.body.appendChild(back);
    });
  }
  function confetti(n = 140) {
    const colors = ['#e10600', '#ffffff', '#a33bff', '#ffc51e', '#2fd26b'];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 2.5 + Math.random() * 2.5 + 's';
      c.style.animationDelay = Math.random() * 1.2 + 's';
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 6500);
    }
  }
  const secs = (ms) => (ms / 1000).toFixed(1) + 's';

  // ---------- briefing cards ----------
  function cards(r) {
    const s = r.scoring, t = r.times;
    return [
      { kicker: 'Round 1', title: 'Badge Hunt', icon: '<div class="ic-badge"><span>?</span></div>',
        text: 'A car logo appears on your phone. Type the brand name as fast as you can.',
        chips: [`${r.logos} logos`, `${t.logo}s each`, `${r.maxTries} tries`],
        score: `+${s.logoBase} correct · up to +${s.logoSpeed} speed bonus`, tip: 'Stuck? A letter hint appears after 15 seconds.' },
      { kicker: 'Round 2', title: 'Parts Hunt', icon: '<div class="ic-grid">' + 'EXHAUSTRBRAKESOFG'.slice(0, 16).split('').map((c, i) => `<span class="${[0, 1, 2, 3, 4, 5, 6].includes(i) ? 'on' : ''}">${c}</span>`).join('') + '</div>',
        text: 'Car parts are hidden in a 9×9 letter grid, and there’s no list! Spot them yourself and drag across each one.',
        chips: [`${r.partsPerGame} hidden parts`, `${t.parts}s`, 'Words run → ↓ ↘ ↗'],
        score: `+${s.part} per part · clear all for +${s.partsBonusPerSec}/sec left`, tip: 'Find as many as you can before the clock hits zero.' },
      { kicker: 'Round 3', title: 'Movie Shuffle', icon: '<div class="ic-cubes"><span>F</span><span>?</span><span>S</span></div>',
        text: 'A famous car movie with its letters shuffled into cubes. Swap the cubes until the title is right.',
        chips: ['1 title', `${t.movie}s`, 'Tap 2 cubes to swap'],
        score: `+${s.movieBase} solved · up to +${s.movieSpeed} speed bonus`, tip: 'Each word turns green when it’s correct.' },
    ];
  }

  return { backdrop, esc, sleep, api, serverNow, sound, unlock, setMuted, isMuted: () => muted, carSVG, zoomCar, countdown, toast, ask, confetti, secs, cards };
})();
