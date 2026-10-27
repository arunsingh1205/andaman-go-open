// A small QR encoder — enough for a booking reference, nothing more.
//
// It handles versions 1 to 4 at error-correction level L, which is up to
// 78 characters. Every one of those versions uses a single error-correction
// block, which is why this file is 200 lines instead of 600: there is no
// interleaving to do.
//
// The output is an SVG path, built on the server and handed to the browser as
// a plain string, so the ticket costs the phone nothing to draw.

// ---------------------------------------------------------------------------
// Arithmetic in GF(256) — the finite field QR uses for its error correction.
// Multiplication becomes addition of logarithms, so we build both tables once.
// ---------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // the field's defining polynomial
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** The generator polynomial for `degree` error-correction codewords. */
function generator(degree: number): number[] {
  let poly = [1];
  for (let d = 0; d < degree; d++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= poly[i];                     // shift up: multiply by x
      next[i + 1] ^= mul(poly[i], EXP[d]);    // and by the root
    }
    poly = next;
  }
  return poly;
}

/** Polynomial long division — the remainder is the error correction. */
function errorCorrection(data: number[], count: number): number[] {
  const gen = generator(count);
  const rest = [...data, ...new Array<number>(count).fill(0)];

  for (let i = 0; i < data.length; i++) {
    const factor = rest[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) rest[i + j] ^= mul(gen[j], factor);
  }

  return rest.slice(data.length);
}

// ---------------------------------------------------------------------------
// Version table. Only 1 to 4, only level L.
// ---------------------------------------------------------------------------

type Version = { version: number; size: number; data: number; ec: number; align: number[] };

const VERSIONS: Version[] = [
  { version: 1, size: 21, data: 19, ec: 7, align: [] },
  { version: 2, size: 25, data: 34, ec: 10, align: [6, 18] },
  { version: 3, size: 29, data: 55, ec: 15, align: [6, 22] },
  { version: 4, size: 33, data: 80, ec: 20, align: [6, 26] },
];

// ---------------------------------------------------------------------------
// Laying out the grid.
// ---------------------------------------------------------------------------

type Grid = { size: number; on: boolean[][]; fixed: boolean[][] };

function blank(size: number): Grid {
  return {
    size,
    on: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    fixed: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function place(g: Grid, row: number, col: number, on: boolean) {
  if (row < 0 || col < 0 || row >= g.size || col >= g.size) return;
  g.on[row][col] = on;
  g.fixed[row][col] = true;
}

/** The three big squares in the corners, plus their white separators. */
function finder(g: Grid, row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const ring = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
      place(g, row + r, col + c, inner || ring);
    }
  }
}

function skeleton(g: Grid, v: Version) {
  const n = g.size;

  finder(g, 0, 0);
  finder(g, 0, n - 7);
  finder(g, n - 7, 0);

  // Timing patterns: the dashed line that tells a scanner the module size.
  for (let i = 8; i < n - 8; i++) {
    place(g, 6, i, i % 2 === 0);
    place(g, i, 6, i % 2 === 0);
  }

  // Alignment pattern — one, in the bottom-right, for versions 2 to 4.
  if (v.align.length) {
    const centre = v.align[1];
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const on = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        place(g, centre + r, centre + c, on);
      }
    }
  }

  // The one module that is always dark, and the reserved format strips.
  place(g, n - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      g.fixed[8][i] = true;
      g.fixed[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    g.fixed[8][n - 1 - i] = true;
    g.fixed[n - 1 - i][8] = true;
  }
}

/** Walk the free modules bottom-right to top-left, two columns at a time. */
function writeData(g: Grid, bits: number[]) {
  let i = 0;
  let upward = true;

  for (let right = g.size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // column 6 is the timing pattern — step over it

    for (let step = 0; step < g.size; step++) {
      const row = upward ? g.size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (g.fixed[row][col]) continue;
        g.on[row][col] = i < bits.length && bits[i] === 1;
        i++;
      }
    }
    upward = !upward;
  }
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Format information: 5 bits of meaning, 10 of error correction, then masked. */
function writeFormat(g: Grid, mask: number) {
  const n = g.size;
  const value = 0b01000 | mask; // 01 = level L

  let bch = value << 10;
  for (let i = 4; i >= 0; i--) {
    if (bch & (1 << (i + 10))) bch ^= 0b10100110111 << i;
  }
  const bits = ((value << 10) | bch) ^ 0b101010000010010;

  const at = (i: number) => ((bits >> i) & 1) === 1;

  // Copy one, wrapped around the top-left finder.
  for (let i = 0; i <= 5; i++) place(g, i, 8, at(i));
  place(g, 7, 8, at(6));
  place(g, 8, 8, at(7));
  place(g, 8, 7, at(8));
  for (let i = 9; i <= 14; i++) place(g, 8, 14 - i, at(i));

  // Copy two, split between the other two finders.
  for (let i = 0; i <= 7; i++) place(g, 8, n - 1 - i, at(i));
  for (let i = 8; i <= 14; i++) place(g, n - 15 + i, 8, at(i));
}

/** The standard's four penalty rules — lower is easier to scan. */
function penalty(on: boolean[][]): number {
  const n = on.length;
  let score = 0;

  const runs = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) {
        if (get(a, b) === get(a, b - 1)) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  };
  runs((r, c) => on[r][c]);
  runs((c, r) => on[r][c]);

  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = on[r][c];
      if (v === on[r][c + 1] && v === on[r + 1][c] && v === on[r + 1][c + 1]) score += 3;
    }
  }

  const bad = [true, false, true, true, true, false, true, false, false, false, false];
  const matches = (cells: boolean[]) => {
    for (let i = 0; i + bad.length <= cells.length; i++) {
      let hit = true;
      for (let j = 0; j < bad.length; j++) {
        if (cells[i + j] !== bad[j]) { hit = false; break; }
      }
      if (hit) score += 40;
      let hitR = true;
      for (let j = 0; j < bad.length; j++) {
        if (cells[i + j] !== bad[bad.length - 1 - j]) { hitR = false; break; }
      }
      if (hitR) score += 40;
    }
  };
  for (let i = 0; i < n; i++) {
    matches(on[i]);
    matches(on.map((row) => row[i]));
  }

  let dark = 0;
  for (const row of on) for (const cell of row) if (cell) dark++;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;

  return score;
}

// ---------------------------------------------------------------------------
// The bit that everything else exists for.
// ---------------------------------------------------------------------------

/** The QR grid for `text`, as rows of booleans. Throws if the text is too long. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));

  const v = VERSIONS.find((candidate) => bytes.length + 2 <= candidate.data);
  if (!v) throw new Error(`qrMatrix: "${text.slice(0, 20)}…" is too long for this encoder`);

  // Mode indicator, length, payload, terminator — then pad to the codeword count.
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, v.data * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  for (let i = 0; data.length < v.data; i++) data.push(i % 2 === 0 ? 0xec : 0x11);

  const codewords = [...data, ...errorCorrection(data, v.ec)];
  const stream: number[] = [];
  for (const word of codewords) for (let i = 7; i >= 0; i--) stream.push((word >> i) & 1);

  // Build once, then try all eight masks and keep the friendliest.
  const base = blank(v.size);
  skeleton(base, v);
  writeData(base, stream);

  let best: boolean[][] | null = null;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const g: Grid = {
      size: v.size,
      on: base.on.map((row) => [...row]),
      fixed: base.fixed.map((row) => [...row]),
    };
    for (let r = 0; r < g.size; r++) {
      for (let c = 0; c < g.size; c++) {
        if (!g.fixed[r][c] && MASKS[mask](r, c)) g.on[r][c] = !g.on[r][c];
      }
    }
    writeFormat(g, mask);

    const score = penalty(g.on);
    if (score < bestScore) {
      bestScore = score;
      best = g.on;
    }
  }

  return best!;
}

export type QrCode = { size: number; path: string };

/**
 * The same grid as an SVG path, ready to drop into a `<path d={…} />`.
 * `size` is the number of modules across, which is also the viewBox.
 */
export function qrCode(text: string): QrCode {
  const grid = qrMatrix(text);
  const parts: string[] = [];

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) {
      if (grid[r][c]) parts.push(`M${c} ${r}h1v1h-1z`);
    }
  }

  return { size: grid.length, path: parts.join("") };
}
