// Client-side Quarto logic: board rules plus the local CPU used for
// かんたん / ふつう / つよい (and as the offline fallback for 最強).
// Ported from the previous (static) Quarto artifact.
//
// Board: number[16], -1 = empty, otherwise piece id 0..15.
// Piece bits: 8 = tall, 4 = dark, 2 = square, 1 = hollow.

export type Difficulty = "easy" | "normal" | "hard" | "saikyo";

export function isHardRules(d: Difficulty): boolean {
  return d === "hard" || d === "saikyo";
}

export const isTall = (p: number) => (p & 8) !== 0;
export const isDark = (p: number) => (p & 4) !== 0;
export const isSquare = (p: number) => (p & 2) !== 0;
export const isHollow = (p: number) => (p & 1) !== 0;

export function pieceName(p: number): string {
  return (
    (isTall(p) ? "高い" : "低い") +
    "・" +
    (isDark(p) ? "暗い" : "明るい") +
    "・" +
    (isSquare(p) ? "四角" : "丸") +
    "・" +
    (isHollow(p) ? "穴あり" : "穴なし")
  );
}

const LINES: number[][] = [];
for (let r = 0; r < 4; r++) LINES.push([r * 4, r * 4 + 1, r * 4 + 2, r * 4 + 3]);
for (let c = 0; c < 4; c++) LINES.push([c, c + 4, c + 8, c + 12]);
LINES.push([0, 5, 10, 15], [3, 6, 9, 12]);
const SQUARES: number[][] = [];
for (let r = 0; r < 3; r++)
  for (let c = 0; c < 3; c++) {
    const tl = r * 4 + c;
    SQUARES.push([tl, tl + 1, tl + 4, tl + 5]);
  }

export function winSets(hard: boolean): { cells: number[]; type: "line" | "square" }[] {
  const sets: { cells: number[]; type: "line" | "square" }[] = LINES.map((cells) => ({
    cells,
    type: "line",
  }));
  if (hard) for (const cells of SQUARES) sets.push({ cells, type: "square" });
  return sets;
}

const BIT_INFO = [
  { bit: 8, one: "高い", zero: "低い" },
  { bit: 4, one: "暗い色の", zero: "明るい色の" },
  { bit: 2, one: "四角い", zero: "丸い" },
  { bit: 1, one: "穴ありの", zero: "穴なしの" },
];

export interface WinInfo {
  cells: number[];
  type: "line" | "square";
  attr: string;
}

export function checkWin(bd: number[], hard: boolean): WinInfo | null {
  for (const set of winSets(hard)) {
    const ps = set.cells.map((c) => bd[c]!);
    if (ps.some((p) => p < 0)) continue;
    for (const { bit, one, zero } of BIT_INFO) {
      const v = (ps[0]! & bit) !== 0;
      if (ps.every((p) => ((p & bit) !== 0) === v))
        return { cells: set.cells, type: set.type, attr: v ? one : zero };
    }
  }
  return null;
}

export function emptyCells(bd: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) if (bd[i]! < 0) out.push(i);
  return out;
}

export function isWinBoard(bd: number[], sets: number[][]): boolean {
  for (const cs of sets) {
    const a = bd[cs[0]!]!, b = bd[cs[1]!]!, c = bd[cs[2]!]!, d = bd[cs[3]!]!;
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    if (((a & b & c & d) | (~(a | b | c | d) & 15)) !== 0) return true;
  }
  return false;
}

export function canWinWith(bd: number[], piece: number, sets: number[][]): boolean {
  for (const cs of sets) {
    let empty = 0;
    const filled: number[] = [];
    for (let k = 0; k < 4; k++) {
      const v = bd[cs[k]!]!;
      if (v < 0) empty++;
      else filled.push(v);
    }
    if (empty !== 1 || filled.length !== 3) continue;
    const and3 = filled[0]! & filled[1]! & filled[2]!;
    const or3 = filled[0]! | filled[1]! | filled[2]!;
    if (((and3 & piece) | ((~or3 & 15) & (~piece & 15))) !== 0) return true;
  }
  return false;
}

export function pieceCanWin(bd: number[], piece: number, hard: boolean): boolean {
  return canWinWith(bd, piece, winSets(hard).map((s) => s.cells));
}

export function threatCount(bd: number[], hard: boolean): number {
  const sets = winSets(hard).map((s) => s.cells);
  let n = 0;
  for (const cs of sets) {
    const filled = cs.map((c) => bd[c]!).filter((v) => v >= 0);
    if (filled.length !== 3) continue;
    const and3 = filled[0]! & filled[1]! & filled[2]!;
    const or3 = filled[0]! | filled[1]! | filled[2]!;
    if ((and3 | (~or3 & 15)) !== 0) n++;
  }
  return n;
}

export function findWinningCell(bd: number[], piece: number, hard: boolean): number {
  const sets = winSets(hard).map((s) => s.cells);
  for (const cell of emptyCells(bd)) {
    const copy = bd.slice();
    copy[cell] = piece;
    if (isWinBoard(copy, sets)) return cell;
  }
  return -1;
}

function remainingPieces(bd: number[]): number[] {
  const onBoard = new Set(bd.filter((v) => v >= 0));
  const pool: number[] = [];
  for (let i = 0; i < 16; i++) if (!onBoard.has(i)) pool.push(i);
  return pool;
}

// ---- local search (the previous artifact's engine) ----
interface SearchCtx {
  sets: number[][];
  placeK: number;
  giveK: number;
}

function placementScoreS(bd: number[], piece: number, cell: number, sets: number[][]): number {
  const copy = bd.slice();
  copy[cell] = piece;
  let score = 0;
  for (const cells of sets) {
    if (!cells.includes(cell)) continue;
    let before = 0;
    const filled: number[] = [];
    for (let k = 0; k < 4; k++) {
      if (bd[cells[k]!]! >= 0) before++;
      if (copy[cells[k]!]! >= 0) filled.push(copy[cells[k]!]!);
    }
    if (before === 3) score += 4; // denies a threat's last cell
    if (filled.length < 2) continue;
    for (const { bit } of BIT_INFO) {
      const v = (piece & bit) !== 0;
      let all = true;
      for (const m of filled) if (((m & bit) !== 0) !== v) { all = false; break; }
      if (all) score += filled.length === 4 ? 20 : filled.length === 3 ? 6 : 1.6;
    }
  }
  return score;
}

function threatCountS(bd: number[], sets: number[][]): number {
  let n = 0;
  for (const cs of sets) {
    const filled = cs.map((c) => bd[c]!).filter((v) => v >= 0);
    if (filled.length !== 3) continue;
    const and3 = filled[0]! & filled[1]! & filled[2]!;
    const or3 = filled[0]! | filled[1]! | filled[2]!;
    if ((and3 | (~or3 & 15)) !== 0) n++;
  }
  return n;
}

function evalGiveLeaf(bd: number[], giver: "ai" | "you", S: SearchCtx): number {
  const receiver = giver === "ai" ? "you" : "ai";
  const pool = remainingPieces(bd);
  if (!pool.length) return 0;
  let winCount = 0;
  for (const p of pool) if (canWinWith(bd, p, S.sets)) winCount++;
  if (winCount === pool.length) return receiver === "ai" ? 900 : -900;
  const score = winCount * 14 + threatCountS(bd, S.sets) * 3;
  return receiver === "ai" ? score : -score;
}

function evalPlaceLeaf(bd: number[], piece: number, placer: "ai" | "you", S: SearchCtx): number {
  let best = 0;
  for (const cell of emptyCells(bd)) best = Math.max(best, placementScoreS(bd, piece, cell, S.sets));
  const v = best * 0.8;
  return placer === "ai" ? v : -v;
}

function searchGive(bd: number[], giver: "ai" | "you", depth: number, alpha: number, beta: number, S: SearchCtx): number {
  const pool = remainingPieces(bd);
  if (!pool.length) return 0;
  if (depth <= 0) return evalGiveLeaf(bd, giver, S);
  const receiver = giver === "ai" ? "you" : "ai";
  const safe: number[] = [], winning: number[] = [];
  for (const p of pool) (canWinWith(bd, p, S.sets) ? winning : safe).push(p);
  const candidates = safe.length ? safe : winning;
  const empties = emptyCells(bd);
  const scored = candidates.map((p) => {
    let maxS = -1e9;
    for (const cell of empties) maxS = Math.max(maxS, placementScoreS(bd, p, cell, S.sets));
    return { p, s: maxS };
  });
  scored.sort((a, b) => a.s - b.s);
  const list = scored.slice(0, S.giveK).map((o) => o.p);
  const maximizing = giver === "ai";
  let best = maximizing ? -1e9 : 1e9;
  for (const p of list) {
    const v = searchPlace(bd, p, receiver, depth - 1, alpha, beta, S);
    if (maximizing) { if (v > best) best = v; if (best > alpha) alpha = best; }
    else { if (v < best) best = v; if (best < beta) beta = best; }
    if (beta <= alpha) break;
  }
  return best;
}

function searchPlace(bd: number[], piece: number, placer: "ai" | "you", depth: number, alpha: number, beta: number, S: SearchCtx): number {
  if (canWinWith(bd, piece, S.sets)) return placer === "ai" ? 1000 + depth * 10 : -(1000 + depth * 10);
  const empties = emptyCells(bd);
  if (!empties.length) return 0;
  if (depth <= 0) return evalPlaceLeaf(bd, piece, placer, S);
  const scored = empties.map((cell) => ({ cell, s: placementScoreS(bd, piece, cell, S.sets) }));
  scored.sort((a, b) => b.s - a.s);
  const list = scored.slice(0, S.placeK).map((o) => o.cell);
  const maximizing = placer === "ai";
  let best = maximizing ? -1e9 : 1e9;
  for (const cell of list) {
    const nb = bd.slice();
    nb[cell] = piece;
    const v = isWinBoard(nb, S.sets)
      ? placer === "ai" ? 1000 + depth * 10 : -(1000 + depth * 10)
      : searchGive(nb, placer, depth, alpha, beta, S);
    if (maximizing) { if (v > best) best = v; if (best > alpha) alpha = best; }
    else { if (v < best) best = v; if (best < beta) beta = best; }
    if (beta <= alpha) break;
  }
  return best;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]!; a[i] = a[j]!; a[j] = t;
  }
  return a;
}

function setupSearch(diff: Difficulty): { S: SearchCtx; depth: number } {
  const hard = isHardRules(diff);
  return {
    S: { sets: winSets(hard).map((s) => s.cells), placeK: 4, giveK: 4 },
    depth: diff === "hard" ? 3 : 2,
  };
}

function bestPlacement(bd: number[], piece: number, S: SearchCtx): number {
  let best = -1, bestScore = -1e9;
  for (const cell of emptyCells(bd)) {
    const s = placementScoreS(bd, piece, cell, S.sets) + Math.random() * 0.6;
    if (s > bestScore) { bestScore = s; best = cell; }
  }
  return best;
}

/** Local CPU placement for easy / normal / hard. */
export function aiPlaceLocal(bd: number[], piece: number, diff: Difficulty): number {
  const hard = isHardRules(diff);
  const winCell = findWinningCell(bd, piece, hard);
  if (diff === "easy") {
    const { S } = setupSearch(diff);
    if (winCell !== -1 && Math.random() < 0.7) return winCell;
    if (Math.random() < 0.45) return bestPlacement(bd, piece, S);
    return pick(emptyCells(bd));
  }
  if (winCell !== -1) return winCell;
  const { S, depth } = setupSearch(diff);
  const empties = shuffled(emptyCells(bd));
  let bestCell = empties[0]!, bestVal = -1e9, alpha = -1e9;
  for (const cell of empties) {
    const nb = bd.slice();
    nb[cell] = piece;
    const v = searchGive(nb, "ai", depth, alpha, 1e9, S);
    if (v > bestVal) { bestVal = v; bestCell = cell; }
    if (bestVal > alpha) alpha = bestVal;
  }
  return bestCell;
}

/** Local CPU give for easy / normal / hard. `used` marks pieces already out of the tray. */
export function aiGiveLocal(bd: number[], used: boolean[], diff: Difficulty): number {
  const hard = isHardRules(diff);
  const rest: number[] = [];
  for (let p = 0; p < 16; p++) if (!used[p]) rest.push(p);
  const safe = rest.filter((p) => !pieceCanWin(bd, p, hard));
  if (diff === "easy") {
    if (safe.length && Math.random() < 0.55) return pick(safe);
    return pick(rest);
  }
  if (safe.length === 0) {
    const { S } = setupSearch(diff);
    let bestForced = rest[0]!, fewest = 99;
    for (const p of rest) {
      let n = 0;
      for (const cell of emptyCells(bd)) {
        const cp = bd.slice();
        cp[cell] = p;
        if (isWinBoard(cp, S.sets)) n++;
      }
      if (n < fewest) { fewest = n; bestForced = p; }
    }
    return bestForced;
  }
  const { S, depth } = setupSearch(diff);
  let bestP = safe[0]!, bestVal = -1e9, alpha = -1e9;
  for (const p of safe) {
    const v = searchPlace(bd, p, "you", depth, alpha, 1e9, S);
    if (v > bestVal) { bestVal = v; bestP = p; }
    if (bestVal > alpha) alpha = bestVal;
  }
  return bestP;
}
