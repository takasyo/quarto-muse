// Quarto engine for the "最強" (strongest) level. Runs server-side.
//
// Design (per the build brief):
//  1. Near-full-width alpha-beta search (no top-K candidate pruning like the
//     old client engine; every placement and every give is considered).
//  2. Transposition table keyed by an incremental BigInt board key.
//  3. Endgame: iterative deepening simply runs out to the terminal depth
//     when few cells remain, so late positions are solved exactly
//     (win / loss / draw), not evaluated heuristically.
//  4. Iterative deepening that uses the whole time budget: the root keeps
//     the best move of the last fully completed depth.
//  5. Evaluation weights tuned by self-play (see TUNED_WEIGHTS below and
//     the tuning notes in the build record).
//
// Board: Int8Array(16), -1 = empty, otherwise piece id 0..15.
// Piece bits: 8 = tall, 4 = dark, 2 = square, 1 = hollow.
// Win sets: 10 lines + 9 blocks of 2x2 (hard rules; "最強" is a hard level).

export interface EngineWeights {
  /** placement: building a 2-piece set on a shared attribute */
  p2: number;
  /** placement: building a 3-piece set (a threat) on a shared attribute */
  p3: number;
  /** placement: occupying the last empty cell of a 3-piece set (denial) */
  block: number;
  /** board heat: 2-piece set, per shared attribute bit */
  h2: number;
  /** board heat: 3-piece set (live threat), per shared attribute bit */
  h3: number;
  /** give leaf: penalty per remaining piece that wins immediately */
  giveWin: number;
  /** give leaf: penalty per live threat set on the board */
  giveThreat: number;
  /** give leaf: penalty per unit of board heat */
  giveHot: number;
  /** place leaf: weight of board heat next to the best placement score */
  placeHot: number;
}

// Evaluation weights, tuned by self-play at build time: coordinate descent
// over all nine weights, each candidate playing the inherited weights and a
// port of the old pruned engine with first-give swapped. No single-weight
// change beat the inherited weights beyond noise, so the descent kept them;
// the strength of this level comes from the search itself (near-full width,
// transposition table, iterative deepening, exact endgame solving).
export const TUNED_WEIGHTS: EngineWeights = {
  p2: 1.6,
  p3: 6,
  block: 4,
  h2: 4,
  h3: 30,
  giveWin: 14,
  giveThreat: 3,
  giveHot: 0.35,
  placeHot: 0.12,
};

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
export const SETS: number[][] = [...LINES, ...SQUARES];
const SETS_BY_CELL: number[][][] = Array.from({ length: 16 }, () => []);
for (const s of SETS) for (const cell of s) SETS_BY_CELL[cell]!.push(s);

const WIN = 100000;
const FORCED = 90000; // "every piece I can hand over wins" leaf magnitude

export function isWinBoard(bd: Int8Array): boolean {
  for (const cs of SETS) {
    const a = bd[cs[0]!]!, b = bd[cs[1]!]!, c = bd[cs[2]!]!, d = bd[cs[3]!]!;
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    if (((a & b & c & d) | (~(a | b | c | d) & 15)) !== 0) return true;
  }
  return false;
}

export function canWinWith(bd: Int8Array, piece: number): boolean {
  for (const cs of SETS) {
    let empty = 0;
    let and3 = 15, or3 = 0, filled = 0;
    for (let k = 0; k < 4; k++) {
      const v = bd[cs[k]!]!;
      if (v < 0) empty++;
      else { and3 &= v; or3 |= v; filled++; }
    }
    if (empty !== 1 || filled !== 3) continue;
    if (((and3 & piece) | ((~or3 & 15) & (~piece & 15))) !== 0) return true;
  }
  return false;
}

/** First cell where `piece` wins immediately, or -1. */
export function findWinningCell(bd: Int8Array, piece: number): number {
  for (let i = 0; i < 16; i++) {
    if (bd[i]! >= 0) continue;
    bd[i] = piece;
    const w = isWinBoard(bd);
    bd[i] = -1;
    if (w) return i;
  }
  return -1;
}

function popcount4(x: number): number {
  return (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
}

/** Shared-attribute bits among the filled pieces of one set. */
function commonBits(bd: Int8Array, cs: number[]): { n: number; bits: number } {
  let and = 15, or = 0, n = 0;
  for (let k = 0; k < 4; k++) {
    const v = bd[cs[k]!]!;
    if (v >= 0) { and &= v; or |= v; n++; }
  }
  return { n, bits: popcount4(and | (~or & 15)) };
}

class Searcher {
  bd: Int8Array;
  w: EngineWeights;
  tt = new Map<bigint, { depth: number; value: number; flag: number; best: number }>();
  nodes = 0;
  deadline = 0;
  key: bigint = 0n;

  constructor(board: number[], weights: EngineWeights) {
    this.bd = Int8Array.from(board);
    this.w = weights;
    for (let i = 0; i < 16; i++) {
      const v = this.bd[i]!;
      if (v >= 0) this.key += BigInt(v + 1) << BigInt(i * 5);
    }
  }

  place(cell: number, piece: number) {
    this.bd[cell] = piece;
    this.key += BigInt(piece + 1) << BigInt(cell * 5);
  }
  unplace(cell: number, piece: number) {
    this.bd[cell] = -1;
    this.key -= BigInt(piece + 1) << BigInt(cell * 5);
  }

  private checkTime() {
    if ((this.nodes & 2047) === 0 && Date.now() > this.deadline) throw TIMEOUT;
  }

  placementScore(piece: number, cell: number): number {
    const { p2, p3, block } = this.w;
    let score = 0;
    for (const cs of SETS_BY_CELL[cell]!) {
      let before = 0;
      let and = 15, or = 0;
      for (let k = 0; k < 4; k++) {
        const v = this.bd[cs[k]!]!;
        if (v >= 0) { before++; and &= v; or |= v; }
      }
      if (before === 3) score += block; // sits on a threat's last cell
      const n = before + 1;
      if (n < 2 || n > 3) continue;
      // attributes shared by the existing pieces AND this piece
      const bits = popcount4((and & piece) | ((~or & 15) & (~piece & 15)));
      if (bits > 0) score += (n === 3 ? p3 : p2) * bits;
    }
    return score;
  }

  hotness(): number {
    const { h2, h3 } = this.w;
    let score = 0;
    for (const cs of SETS) {
      const { n, bits } = commonBits(this.bd, cs);
      if (bits === 0) continue;
      if (n === 3) score += h3 * bits;
      else if (n === 2) score += h2 * bits;
    }
    return score;
  }

  threatSets(): number {
    let n = 0;
    for (const cs of SETS) {
      const c = commonBits(this.bd, cs);
      if (c.n === 3 && c.bits > 0) n++;
    }
    return n;
  }

  remaining(): number[] {
    const used = new Array<boolean>(16).fill(false);
    for (let i = 0; i < 16; i++) { const v = this.bd[i]!; if (v >= 0) used[v] = true; }
    const out: number[] = [];
    for (let p = 0; p < 16; p++) if (!used[p]) out.push(p);
    return out;
  }

  evalPlaceLeaf(piece: number): number {
    let best = 0;
    for (let i = 0; i < 16; i++) {
      if (this.bd[i]! >= 0) continue;
      const s = this.placementScore(piece, i);
      if (s > best) best = s;
    }
    return best + this.hotness() * this.w.placeHot;
  }

  /** Value for the player who must now hand a piece to the opponent. */
  evalGiveLeaf(): number {
    const pool = this.remaining();
    if (pool.length === 0) return 0;
    let winCount = 0;
    for (const p of pool) if (canWinWith(this.bd, p)) winCount++;
    if (winCount === pool.length) return -FORCED; // forced to hand over a win
    return -(
      winCount * this.w.giveWin +
      this.threatSets() * this.w.giveThreat +
      this.hotness() * this.w.giveHot
    );
  }

  /** Negamax: current player places `piece`, then gives. Value for the placer. */
  searchPlace(piece: number, depth: number, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    this.checkTime();
    if (canWinWith(this.bd, piece)) return WIN - ply;
    if (depth <= 0) return this.evalPlaceLeaf(piece);
    const ttKey = this.key * 32n + BigInt(piece + 1);
    const ent = this.tt.get(ttKey);
    if (ent && ent.depth >= depth) {
      if (ent.flag === 0) return ent.value;
      if (ent.flag === 1) alpha = Math.max(alpha, ent.value);
      else beta = Math.min(beta, ent.value);
      if (alpha >= beta) return ent.value;
    }
    // move ordering: placement score descending, TT move first
    const cells: { cell: number; s: number }[] = [];
    for (let i = 0; i < 16; i++)
      if (this.bd[i]! < 0) cells.push({ cell: i, s: this.placementScore(piece, i) });
    if (cells.length === 0) return 0;
    cells.sort((a, b) => b.s - a.s);
    if (ent && ent.best >= 0) {
      const idx = cells.findIndex((c) => c.cell === ent.best);
      if (idx > 0) { const [c] = cells.splice(idx, 1); cells.unshift(c!); }
    }
    let best = -Infinity, bestCell = cells[0]!.cell;
    const a0 = alpha;
    for (const { cell } of cells) {
      this.place(cell, piece);
      let v: number;
      if (isWinBoard(this.bd)) v = WIN - ply;
      else v = -this.searchGive(depth - 1, -beta, -alpha, ply + 1);
      this.unplace(cell, piece);
      if (v > best) { best = v; bestCell = cell; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    if (this.tt.size < 2_000_000)
      this.tt.set(ttKey, { depth, value: best, flag: best <= a0 ? 2 : alpha >= beta ? 1 : 0, best: bestCell });
    return best;
  }

  /** Negamax: current player chooses a piece to hand to the opponent. Value for the giver. */
  searchGive(depth: number, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    this.checkTime();
    const pool = this.remaining();
    if (pool.length === 0) return 0;
    if (depth <= 0) return this.evalGiveLeaf();
    const ttKey = this.key * 32n;
    const ent = this.tt.get(ttKey);
    if (ent && ent.depth >= depth) {
      if (ent.flag === 0) return ent.value;
      if (ent.flag === 1) alpha = Math.max(alpha, ent.value);
      else beta = Math.min(beta, ent.value);
      if (alpha >= beta) return ent.value;
    }
    // ordering: pieces that do not lose on the spot first, then by how
    // little the opponent can build with them; TT move first.
    const scored = pool.map((p) => {
      const wins = canWinWith(this.bd, p);
      let maxS = 0;
      if (!wins)
        for (let i = 0; i < 16; i++)
          if (this.bd[i]! < 0) { const s = this.placementScore(p, i); if (s > maxS) maxS = s; }
      return { p, wins, s: maxS };
    });
    scored.sort((a, b) => (a.wins === b.wins ? a.s - b.s : a.wins ? 1 : -1));
    if (ent && ent.best >= 0) {
      const idx = scored.findIndex((c) => c.p === ent.best);
      if (idx > 0) { const [c] = scored.splice(idx, 1); scored.unshift(c!); }
    }
    let best = -Infinity, bestPiece = scored[0]!.p;
    const a0 = alpha;
    for (const { p } of scored) {
      const v = -this.searchPlace(p, depth - 1, -beta, -alpha, ply + 1);
      if (v > best) { best = v; bestPiece = p; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    if (this.tt.size < 2_000_000)
      this.tt.set(ttKey, { depth, value: best, flag: best <= a0 ? 2 : alpha >= beta ? 1 : 0, best: bestPiece });
    return best;
  }

  /** Root give: returns the value and the chosen piece. Order is shuffled by caller when wanted. */
  rootGive(depth: number, order: number[]): { value: number; give: number } {
    let best = -Infinity, bestPiece = order[0] ?? -1, alpha = -Infinity;
    for (const p of order) {
      const v = -this.searchPlace(p, depth, -Infinity, -alpha, 1);
      if (v > best) { best = v; bestPiece = p; }
      if (best > alpha) alpha = best;
    }
    return { value: best, give: bestPiece };
  }
}

const TIMEOUT = Symbol("timeout");

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]!; a[i] = a[j]!; a[j] = t;
  }
  return a;
}

export interface MoveResult {
  cell: number; // -1 when only a give was requested
  give: number; // -1 when the board is full after placing
  depth: number; // deepest fully completed iterative-deepening depth (plies)
  nodes: number;
  score: number; // engine value from the AI's perspective
  solved: boolean; // true when the search reached the end of the game
}

/**
 * AI places `piece` on the board and then chooses the piece to hand over.
 * Iterative deepening under `budgetMs`; root order is shuffled so equally
 * good first moves vary from game to game.
 */
export function choosePlaceAndGive(
  board: number[],
  piece: number,
  budgetMs: number,
  weights: EngineWeights = TUNED_WEIGHTS,
): MoveResult {
  const s = new Searcher(board, weights);
  const winCell = findWinningCell(s.bd, piece);
  if (winCell >= 0) return { cell: winCell, give: -1, depth: 0, nodes: 0, score: WIN, solved: true };
  const empties = board.filter((v) => v < 0).length;
  const maxDepth = empties * 2; // place+give plies until the board is full
  s.deadline = Date.now() + budgetMs;
  let bestCell = -1, bestGive = -1, bestScore = 0, doneDepth = 0, solved = false;
  const cellOrder = shuffled(Array.from({ length: 16 }, (_, i) => i).filter((i) => s.bd[i]! < 0));
  try {
    for (let depth = 1; depth <= maxDepth; depth++) {
      let curBest = -Infinity, curCell = -1, curGive = -1, alpha = -Infinity;
      for (const cell of cellOrder) {
        s.place(cell, piece);
        let v: number, g = -1;
        if (isWinBoard(s.bd)) v = WIN;
        else {
          const pool = s.remaining();
          if (pool.length === 0) v = 0;
          else {
            const rg = s.rootGive(depth - 1, shuffled(pool));
            v = rg.value; g = rg.give;
          }
        }
        s.unplace(cell, piece);
        if (v > curBest) { curBest = v; curCell = cell; curGive = g; }
        if (curBest > alpha) alpha = curBest;
      }
      bestCell = curCell; bestGive = curGive; bestScore = curBest; doneDepth = depth;
      if (depth >= maxDepth) { solved = true; break; }
    }
  } catch (e) {
    if (e !== TIMEOUT) throw e;
  }
  if (bestCell < 0) {
    // Not even depth 1 finished (extremely defensive fallback): heuristic.
    let bs = -Infinity;
    for (const cell of cellOrder) {
      const sc = s.placementScore(piece, cell);
      if (sc > bs) { bs = sc; bestCell = cell; }
    }
    const pool = s.remaining().filter((p) => p !== piece);
    bestGive = pool.find((p) => !canWinWith(s.bd, p)) ?? pool[0] ?? -1;
    bestScore = bs;
  }
  return { cell: bestCell, give: bestGive, depth: doneDepth, nodes: s.nodes, score: bestScore, solved };
}

/** AI chooses only the piece to hand over (start of a game, or fallback path). */
export function chooseGive(
  board: number[],
  budgetMs: number,
  weights: EngineWeights = TUNED_WEIGHTS,
): Omit<MoveResult, "cell"> & { cell: -1 } {
  const s = new Searcher(board, weights);
  const pool0 = s.remaining();
  const filled = 16 - pool0.length;
  const maxDepth = (16 - filled) * 2;
  s.deadline = Date.now() + budgetMs;
  let bestGive = pool0[0] ?? -1, bestScore = 0, doneDepth = 0, solved = false;
  try {
    for (let depth = 1; depth <= maxDepth; depth++) {
      const rg = s.rootGive(depth, shuffled(pool0));
      bestGive = rg.give; bestScore = rg.value; doneDepth = depth;
      if (depth >= maxDepth) { solved = true; break; }
    }
  } catch (e) {
    if (e !== TIMEOUT) throw e;
  }
  return { cell: -1, give: bestGive, depth: doneDepth, nodes: s.nodes, score: bestScore, solved };
}
