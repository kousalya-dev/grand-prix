// Name Hunt grid engine: splits names into pages and builds 9×9 word-search grids.
const crypto = require('crypto');

const SIZE = Number(process.env.GRID_SIZE) || 9;
// Moderate difficulty: names run forwards only, in 4 directions (→ ↓ ↘ ↗).
const DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1]];
// For the uniqueness check we look in all 8 directions (players may drag either way).
const ALL_DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];
const COMMON = 'EEAAIINNRRSSTTOOLLHHDDMMUUKKYYCGPBVJ';

const rnd = (n) => crypto.randomInt(0, n);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const lettersOf = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');

function pageCount(n, maxPages = Number(process.env.MAX_PAGES) || 5) {
  return Math.max(1, Math.min(maxPages, Math.ceil(n / 4)));
}

// Split names across pages; avoid putting a name and its substring (ARUN/VARUN) on the same page.
function splitPages(names) {
  const pages = pageCount(names.length);
  for (let attempt = 0; attempt < 300; attempt++) {
    const order = shuffle(names);
    const buckets = Array.from({ length: pages }, () => []);
    order.forEach((n, i) => buckets[i % pages].push(n));
    const ok = buckets.every((b) => b.every((a) => b.every((c) => a === c || !lettersOf(c.name).includes(lettersOf(a.name)))));
    if (ok) return buckets;
  }
  throw new Error('Could not split names into pages (too many overlapping names).');
}

function countOccurrences(grid, word) {
  let n = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (grid[r][c] !== word[0]) continue;
    for (const [dr, dc] of ALL_DIRS) {
      let k = 0;
      while (k < word.length) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE || grid[rr][cc] !== word[k]) break;
        k++;
      }
      if (k === word.length) n++;
    }
  }
  return word.length === 1 ? n / ALL_DIRS.length : n;
}

// Build one page. names: [{ name, clue }]. Returns { grid: [string], words: [{ name, clue, word, r, c, dr, dc }] }
function buildPage(names) {
  const words = names.map((n) => ({ ...n, word: lettersOf(n.name) })).sort((a, b) => b.word.length - a.word.length);
  for (const w of words) if (w.word.length > SIZE) throw new Error(`"${w.name}" is longer than ${SIZE} letters.`);
  const decoyPool = words.map((w) => w.word).join('');

  for (let attempt = 0; attempt < 400; attempt++) {
    const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    const placed = [];
    let failed = false;
    for (const w of words) {
      const L = w.word.length;
      const options = [];
      for (const [dr, dc] of DIRS) for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        const er = r + dr * (L - 1), ec = c + dc * (L - 1);
        if (er < 0 || er >= SIZE || ec >= SIZE) continue;
        let overlap = 0, ok = true;
        for (let k = 0; k < L; k++) {
          const cell = grid[r + dr * k][c + dc * k];
          if (cell === null) continue;
          if (cell !== w.word[k]) { ok = false; break; }
          overlap++;
        }
        if (ok && overlap < L) options.push({ r, c, dr, dc, overlap });
      }
      if (!options.length) { failed = true; break; }
      // Slight preference for crossing other names (makes it moderately harder), otherwise random.
      const crossing = options.filter((o) => o.overlap > 0);
      const pick = crossing.length && rnd(3) === 0 ? crossing[rnd(crossing.length)] : options[rnd(options.length)];
      for (let k = 0; k < L; k++) grid[pick.r + pick.dr * k][pick.c + pick.dc * k] = w.word[k];
      placed.push({ name: w.name, clue: w.clue, word: w.word, r: pick.r, c: pick.c, dr: pick.dr, dc: pick.dc });
    }
    if (failed) continue;
    // Fill blanks: ~55% letters from the hidden names (decoys/false starts), rest common letters.
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === null) grid[r][c] = rnd(100) < 55 ? decoyPool[rnd(decoyPool.length)] : COMMON[rnd(COMMON.length)];
    }
    // Every name must appear exactly once (in any direction), else rebuild.
    if (placed.every((p) => countOccurrences(grid, p.word) === 1)) {
      return { grid: grid.map((row) => row.join('')), words: shuffle(placed) };
    }
  }
  throw new Error('Could not build a grid for this page. Try shorter or fewer names.');
}

function buildGame(names) {
  return splitPages(names).map(buildPage);
}

const cellsOf = (w) => Array.from({ length: w.word.length }, (_, k) => [w.r + w.dr * k, w.c + w.dc * k]);

module.exports = { SIZE, lettersOf, pageCount, splitPages, buildPage, buildGame, cellsOf, countOccurrences };
