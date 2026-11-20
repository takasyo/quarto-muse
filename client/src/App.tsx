import { useEffect, useRef, useState, type ReactNode } from "react";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api } from "./api";
import {
aiGiveLocal,
aiPlaceLocal,
checkWin,
emptyCells,
isHardRules,
pieceCanWin,
pieceName,
threatCount,
type Difficulty,
type WinInfo,
} from "./engine";

// ---- pieces (visual) ----
function Piece({ p }: { p: number }) {
  const tall = (p & 8) !== 0, dark = (p & 4) !== 0, square = (p & 2) !== 0, hollow = (p & 1) !== 0;
  return (
    <span
      className={`piece ${tall ? "tall" : "short"} ${dark ? "dark" : "light"} ${square ? "square" : "round"}`}
      aria-label={pieceName(p)}
    >
      <span className="body">
        <span className={hollow ? "hole" : "cap"} />
      </span>
      <span className="hgauge" aria-hidden="true">
        <i />
      </span>
    </span>
  );
}

// ---- Muse's face: the mood follows how the position reads ----
type Mood = "calm" | "confident" | "thinking" | "panicked" | "win" | "lose";
const MOOD_CHIPS: Record<Mood, string> = {
  calm: "ふつう",
  confident: "余裕",
  thinking: "考え中…",
  panicked: "ピンチ！",
  win: "勝った！",
  lose: "負けた…",
};

function Face({ mood }: { mood: Mood }) {
  const S = { stroke: "#4a2c0a", strokeWidth: 2.4, strokeLinecap: "round" as const, fill: "none" };
  let f: ReactNode = null;
  if (mood === "confident") {
    f = (<>
      <path d="M19 24.5 Q24 22 29 24.5" {...S} />
      <path d="M35 26.5 Q40 24.5 45 26.5" {...S} />
      <path d="M19.5 32 Q24 35 28.5 32" {...S} />
      <path d="M35.5 32 Q40 35 44.5 32" {...S} />
      <path d="M25 43 Q33 47.5 40.5 40.5" {...S} />
    </>);
  } else if (mood === "thinking") {
    f = (<>
      <path d="M19 25 Q24 22.5 29 25" {...S} />
      <path d="M35 25 Q40 22.5 45 25" {...S} />
      <ellipse cx="24" cy="31" rx="2.5" ry="3.2" fill="#4a2c0a" />
      <ellipse cx="40" cy="31" rx="2.5" ry="3.2" fill="#4a2c0a" />
      <path d="M27.5 44.5 Q30 42.8 32 44.5 Q34 46.2 36.5 44.5" {...S} />
      <circle cx="51" cy="17" r="1.7" fill="#9a6a14" opacity=".55" />
      <circle cx="55.5" cy="11.5" r="2.1" fill="#9a6a14" opacity=".75" />
      <circle cx="60" cy="5.5" r="2.6" fill="#9a6a14" opacity=".95" />
    </>);
  } else if (mood === "panicked") {
    f = (<>
      <path d="M19 28.5 L29 24.5" {...S} />
      <path d="M45 28.5 L35 24.5" {...S} />
      <circle cx="24" cy="33" r="4.6" fill="#fffdf4" stroke="#4a2c0a" strokeWidth="1.8" />
      <circle cx="40" cy="33" r="4.6" fill="#fffdf4" stroke="#4a2c0a" strokeWidth="1.8" />
      <circle cx="24" cy="34" r="1.8" fill="#4a2c0a" />
      <circle cx="40" cy="34" r="1.8" fill="#4a2c0a" />
      <path d="M24 45.5 Q27 42.8 30 45.5 Q33 48.2 36 45.5 Q38.5 43.2 40.5 45.5" {...S} />
      <path d="M54.5 13 C57.5 18.5 59 21.2 59 24 A4.5 4.5 0 1 1 50 24 C50 21.2 51.5 18.5 54.5 13 Z" fill="#8ecae6" stroke="#4a7a96" strokeWidth="1.2" />
    </>);
  } else if (mood === "win") {
    f = (<>
      <path d="M19 34.5 Q24 28 29 34.5" {...S} />
      <path d="M35 34.5 Q40 28 45 34.5" {...S} />
      <path d="M24 40.5 Q32 42 40 40.5 Q38 50.5 32 50.5 Q26 50.5 24 40.5 Z" fill="#8a4b16" />
      <path d="M9 7 L10.6 11.4 L15 13 L10.6 14.6 L9 19 L7.4 14.6 L3 13 L7.4 11.4 Z" fill="#e3a008" />
      <path d="M55 4 L56.2 7.2 L59.5 8.5 L56.2 9.8 L55 13 L53.8 9.8 L50.5 8.5 L53.8 7.2 Z" fill="#e3a008" />
    </>);
  } else if (mood === "lose") {
    f = (<>
      <path d="M28.5 29.5 L21 33.5 L28.5 37.5" {...S} />
      <path d="M35.5 29.5 L43 33.5 L35.5 37.5" {...S} />
      <path d="M25 46.5 Q32 41.5 39 46.5" {...S} />
      <path d="M15.5 38 C17.2 41 18 42.4 18 44 A2.6 2.6 0 1 1 13 44 C13 42.4 13.8 41 15.5 38 Z" fill="#8ecae6" stroke="#4a7a96" strokeWidth="1" />
    </>);
  } else {
    f = (<>
      <path d="M19 26 Q24 23.5 29 26" {...S} />
      <path d="M35 26 Q40 23.5 45 26" {...S} />
      <ellipse cx="24" cy="33" rx="2.6" ry="3.4" fill="#4a2c0a" />
      <ellipse cx="40" cy="33" rx="2.6" ry="3.4" fill="#4a2c0a" />
      <path d="M25.5 42 Q32 47.5 38.5 42" {...S} />
    </>);
  }
  return (
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Museの表情">
      <line x1="32" y1="13" x2="32" y2="7" stroke="#9a6a14" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="32" cy="5.5" r="3" fill="#c98d2d" />
      <rect x="5.5" y="30" width="5" height="11" rx="2.5" fill="#c98d2d" />
      <rect x="53.5" y="30" width="5" height="11" rx="2.5" fill="#c98d2d" />
      <circle cx="32" cy="35" r="23" fill="#f3cd72" stroke="#9a6a14" strokeWidth="2" />
      <ellipse cx="18.5" cy="42" rx="4" ry="2.6" fill="#f0a35e" opacity=".55" />
      <ellipse cx="45.5" cy="42" rx="4" ry="2.6" fill="#f0a35e" opacity=".55" />
      {f}
    </svg>
  );
}

// ---- game state (kept in a ref; React re-renders on demand) ----
interface LogEntry { who: "you" | "ai"; text: string }
interface G {
  board: number[];
  used: boolean[];
  hand: number | null;
  phase: "give" | "place" | "ai" | "over";
  over: boolean;
  winCells: number[] | null;
  seq: number;
  speech: string;
  statusMain: string;
  statusSub: string;
  thinking: boolean;
  mood: Mood;
  log: LogEntry[];
  wins: { you: number; ai: number };
  overlay: boolean;
  overlayText: { title: string; lines: string[] } | null;
}

const emptyBoard = () => new Array<number>(16).fill(-1);
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function App() {
  const [, setTick] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>("hard");
  const diffRef = useRef<Difficulty>("hard");
  const g = useRef<G>({
    board: emptyBoard(),
    used: new Array<boolean>(16).fill(false),
    hand: null,
    phase: "give",
    over: false,
    winCells: null,
    seq: 0,
    speech: "",
    statusMain: "",
    statusSub: "",
    thinking: false,
    mood: "calm",
    log: [],
    wins: { you: 0, ai: 0 },
    overlay: false,
    overlayText: null,
  });
  const render = () => setTick((t) => t + 1);
  const S = g.current;
  const hard = isHardRules(difficulty);

  const say = (text: string) => { S.speech = text; };
  const setStatus = (main: string, sub = "", thinking = false) => {
    S.statusMain = main; S.statusSub = sub; S.thinking = thinking;
  };
  const addLog = (who: "you" | "ai", text: string) => {
    S.log = [{ who, text }, ...S.log];
  };

  function finish(winner: "you" | "ai" | null, winInfo: WinInfo | null) {
    S.over = true;
    S.phase = "over";
    S.thinking = false;
    S.mood = winner === "ai" ? "win" : winner === "you" ? "lose" : "calm";
    if (winInfo) S.winCells = winInfo.cells;
    const placeLabel = winInfo?.type === "square" ? "2×2のブロック" : "1列";
    const isSq = winInfo?.type === "square";
    if (winner === "you" && winInfo) {
      S.wins = { ...S.wins, you: S.wins.you + 1 };
      S.overlayText = {
        title: "あなたの勝ちです！",
        lines: [`「${winInfo.attr}」ピースが${placeLabel}に揃いました。`, ...(isSq ? ["2×2ブロックでの Quarto! です。"] : [])],
      };
      say(isSq
        ? `Quarto! ……やられました。2×2のブロックで「${winInfo.attr}」が揃っていますね。ハードモードならではの決まり手です。見事です。もう一局どうですか？`
        : `Quarto! ……やられました。「${winInfo.attr}」が揃っていますね。見事です。もう一局どうですか？`);
      setStatus("あなたの勝ちです 🎉", `「${winInfo.attr}」ピースが${placeLabel}に揃いました。`);
    } else if (winner === "ai" && winInfo) {
      S.wins = { ...S.wins, ai: S.wins.ai + 1 };
      S.overlayText = {
        title: "Museの勝ちです。",
        lines: [`「${winInfo.attr}」ピースが${placeLabel}に揃いました。`, ...(isSq ? ["2×2ブロックでの Quarto! です。"] : [])],
      };
      say(isSq
        ? `Quarto! 2×2のブロックで「${winInfo.attr}」ピースが揃いました。ハードモードではブロックからも目が離せませんね。`
        : `Quarto! 「${winInfo.attr}」ピースが揃いました。渡してくださったピース、ありがたく使わせてもらいました。`);
      setStatus("Museの勝ちです", `「${winInfo.attr}」ピースが${placeLabel}に揃いました。盤の光っているマスを見てみてください。`);
    } else {
      S.overlayText = {
        title: "引き分けです。",
        lines: [hard
          ? "16個すべて置いても、列も2×2ブロックも揃いませんでした。"
          : "16個すべて置いても揃いませんでした。"],
      };
      say("全部埋まって引き分け。なかなか固い一局でしたね。");
      setStatus("引き分けです", hard
        ? "16個すべて置きましたが、揃う列も2×2ブロックもありませんでした。"
        : "16個すべて置きましたが、揃う列はありませんでした。");
    }
    render();
    const seq = S.seq;
    void delay(winner ? 650 : 300).then(() => {
      if (g.current.seq === seq && g.current.over) { S.overlay = true; render(); }
    });
  }

  /** Returns true when the game just ended. */
  function afterPlace(who: "you" | "ai"): boolean {
    const w = checkWin(S.board, isHardRules(diffRef.current));
    if (w) { finish(who, w); return true; }
    if (emptyCells(S.board).length === 0) { finish(null, null); return true; }
    return false;
  }

  async function aiTurnPlace(givenPiece: number, seq: number) {
    const diff = diffRef.current;
    let cell = -1;
    let give = -1;
    if (diff === "saikyo") {
      try {
        const started = Date.now();
        const r = await api.saikyoPlace({ board: S.board.slice(), piece: givenPiece });
        const wait = 500 - (Date.now() - started);
        if (wait > 0) await delay(wait);
        if (S.seq !== seq || S.over) return;
        cell = r.cell;
        give = r.give;
      } catch {
        // fall through to the local engine below
      }
    }
    if (S.seq !== seq || S.over) return;
    if (cell < 0) {
      await delay(650);
      if (S.seq !== seq || S.over) return;
      cell = aiPlaceLocal(S.board, givenPiece, diff === "saikyo" ? "hard" : diff);
      give = -1; // computed locally after the placement
    }
    S.board = S.board.slice();
    S.board[cell] = givenPiece;
    addLog("ai", `「${pieceName(givenPiece)}」を盤に置きました。`);
    if (afterPlace("ai")) { render(); return; }
    let next = give;
    if (next < 0) next = aiGiveLocal(S.board, S.used, diff === "saikyo" ? "hard" : diff);
    S.used = S.used.slice();
    S.used[next] = true;
    S.hand = next;
    S.phase = "place";
    const h = isHardRules(diffRef.current);
    const danger = pieceCanWin(S.board, next, h);
    S.mood = danger ? "panicked" : threatCount(S.board, h) > 0 ? "confident" : "calm";
    say(danger
      ? `では次はこれをどうぞ。「${pieceName(next)}」です。……おっと、置き場所次第では揃ってしまうかも。慎重にどうぞ。`
      : `では次はこれをどうぞ。「${pieceName(next)}」です。さあ、どこに置きますか？`);
    setStatus("あなたの番：ピースを置いてください", "光っている空きマスをタップすると、その場所に置けます。");
    render();
  }

  function humanGive(p: number) {
    if (S.phase !== "give" || S.over || S.used[p]) return;
    S.used = S.used.slice();
    S.used[p] = true;
    S.phase = "ai";
    addLog("you", `「${pieceName(p)}」をClaudeに渡しました。`);
    say(`「${pieceName(p)}」ですね。どこに置こうかな…`);
    S.mood = "thinking";
    setStatus(
      diffRef.current === "saikyo" ? "Museが考え中です…（最強：深く読んでいます）" : "Museが考え中です…",
      "渡されたピースを置く場所を考えています。",
      true,
    );
    render();
    void aiTurnPlace(p, S.seq);
  }

  function humanPlace(idx: number) {
    if (S.phase !== "place" || S.over || S.board[idx]! >= 0 || S.hand === null) return;
    const p = S.hand;
    S.hand = null;
    S.board = S.board.slice();
    S.board[idx] = p;
    addLog("you", `「${pieceName(p)}」を盤に置きました。`);
    if (afterPlace("you")) { render(); return; }
    S.phase = "give";
    const h = isHardRules(diffRef.current);
    const risky: number[] = [];
    for (let q = 0; q < 16; q++) if (!S.used[q] && pieceCanWin(S.board, q, h)) risky.push(q);
    S.mood = risky.length ? "confident" : "calm";
    say(risky.length
      ? h
        ? "いい置き方ですね。さて次は、私に渡すピースを選んでください。……盤のどこかに、あと1つで揃う列か2×2ブロックができていますよ。"
        : "いい置き方ですね。さて次は、私に渡すピースを選んでください。……盤のどこかに、あと1つで揃う列ができていますよ。"
      : "置きましたね。次は私に渡すピースを選んでください。どのピースも一長一短です。");
    setStatus("あなたの番：渡すピースを選んでください", "選んだピースはMuseが盤に置きます。");
    render();
  }

  function startGame() {
    const diff = diffRef.current;
    const h = isHardRules(diff);
    const humanFirst = Math.random() < 0.5;
    S.board = emptyBoard();
    S.used = new Array<boolean>(16).fill(false);
    S.hand = null;
    S.phase = humanFirst ? "give" : "ai";
    S.over = false;
    S.winCells = null;
    S.seq += 1;
    S.log = [];
    S.overlay = false;
    S.overlayText = null;
    S.mood = "calm";
    const seq = S.seq;
    if (humanFirst) {
      if (diff === "saikyo") {
        say("新しい一局、最強モードですね。置く場所も渡すピースも、サーバー側で置換表を使いながら時間いっぱい深く読みます。ハードルール（2×2でも勝ち）です。抽選であなたが先攻です。まずはピース置き場から、私に渡すピースを1つ選んでください。");
        setStatus("あなたが先攻です：渡すピースを選んでください", "最強：1列でも、2×2ブロックでも揃えば勝ちです。");
      } else if (h) {
        say("新しい一局、ハードモードですね。1列に加えて2×2のブロックでも勝ちになります。今回は先の手までしっかり読んで手を選びます。抽選であなたが先攻です。まずはピース置き場から、私に渡すピースを1つ選んでください。ブロックにも気をつけて。");
        setStatus("あなたが先攻です：渡すピースを選んでください", "ハード：1列でも、2×2ブロックでも揃えば勝ちです。");
      } else if (diff === "normal") {
        say("新しい一局ですね。今回は先の手まで読んで手を選びますので、簡単には勝たせませんよ。抽選であなたが先攻です。まずは下のピース置き場から、私に渡すピースを1つ選んでください。私がそれを盤に置きます。");
        setStatus("あなたが先攻です：渡すピースを選んでください", "選んだピースはMuseが盤に置きます。揃えられそうなピースを渡すと危ないですよ。");
      } else {
        say("新しい一局ですね。抽選であなたが先攻です。まずは下のピース置き場から、私に渡すピースを1つ選んでください。私がそれを盤に置きます。");
        setStatus("あなたが先攻です：渡すピースを選んでください", "選んだピースはMuseが盤に置きます。揃えられそうなピースを渡すと危ないですよ。");
      }
      render();
      return;
    }
    // Muse gives the first piece; you place it.
    if (diff === "saikyo") {
      say("新しい一局、最強モードですね。置く場所も渡すピースも、サーバー側で置換表を使いながら時間いっぱい深く読みます。ハードルール（2×2でも勝ち）です。抽選で私が先攻です。まず私があなたに渡すピースを選びますね。");
      setStatus("Museが先攻です：考え中…", "Museがあなたに渡すピースを選んでいます。最強：2×2でも勝ちです。", true);
    } else if (h) {
      say("新しい一局、ハードモードですね。1列に加えて2×2のブロックでも勝ちになります。今回は先の手までしっかり読んで手を選びます。抽選で私が先攻です。まず私があなたに渡すピースを選びますね。");
      setStatus("Museが先攻です：考え中…", "Museがあなたに渡すピースを選んでいます。ハード：2×2でも勝ちです。", true);
    } else {
      say("新しい一局ですね。抽選で私が先攻です。まず私があなたに渡すピースを選びますね。私が選んだピースを、あなたが盤に置いてください。");
      setStatus("Museが先攻です：考え中…", "Museがあなたに渡すピースを選んでいます。", true);
    }
    S.mood = "thinking";
    render();
    void (async () => {
      let first = -1;
      if (diff === "saikyo") {
        try {
          const r = await api.saikyoGive({ board: emptyBoard() });
          first = r.give;
        } catch { /* fall back below */ }
      }
      if (first < 0) {
        await delay(850);
        const rest: number[] = [];
        for (let p = 0; p < 16; p++) if (!S.used[p]) rest.push(p);
        first = rest[Math.floor(Math.random() * rest.length)]!;
      }
      if (S.seq !== seq || S.over) return;
      S.used = S.used.slice();
      S.used[first] = true;
      S.hand = first;
      S.phase = "place";
      addLog("ai", `「${pieceName(first)}」をあなたに渡しました。`);
      S.mood = "calm";
      say(`私が先攻です。ではこれをどうぞ。「${pieceName(first)}」です。さあ、どこに置きますか？`);
      setStatus("あなたの番：ピースを置いてください", "光っている空きマスをタップすると、その場所に置けます。");
      render();
    })();
  }

  // first game on mount
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onDifficultyChange(d: Difficulty) {
    setDifficulty(d);
    diffRef.current = d;
    if (d === "saikyo") {
      say("最強に切り替えましたね。次の手から、サーバー側で全幅に近い探索＋置換表＋終盤の完全読みで手を選びます。ハードルール（2×2でも勝ち）のままです。覚悟してくださいね。");
      if (!S.over) setStatus(S.statusMain, "最強適用中：1列でも2×2ブロックでも揃えば勝ちです。サーバー側で深く読みます。", S.thinking);
    } else if (d === "hard") {
      say("ハードモードに切り替えましたね。次の手から、縦・横・斜めの1列に加えて2×2のブロックでも勝ちになります。私も2×2を狙いますし、2×2で揃うピースは渡しませんよ。読みも一番深くします。");
      if (!S.over) setStatus(S.statusMain, "ハード適用中：1列でも2×2ブロックでも揃えば勝ちです。", S.thinking);
    } else if (d === "normal") {
      say("強さを「ふつう」に変えましたね。この一局の途中から反映します。先の手まで読んで、置く場所も渡すピースも選びます。2×2ブロックは勝ちにならなくなります。");
    } else {
      say("強さを「かんたん」に変えましたね。この一局の途中から反映します。2×2ブロックは勝ちにならなくなります。");
    }
    render();
  }

  const remain = S.used.filter((u) => !u).length;

  return (
    <div className="qwrap">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <div className="top">
        <div>
          <h1>QUARTO<span>!</span></h1>
          <p>4つ揃えたら勝ち。渡すピースを選ぶ、ちょっと変わった四目並べ — 相手はMuseです。「つよい」と「最強」はハードモード：2×2でも勝ちになります。</p>
        </div>
        <div className="top-actions">
          <label className="diff">
            Museの強さ
            <select
              aria-label="Museの強さとルール"
              value={difficulty}
              onChange={(e) => onDifficultyChange(e.target.value as Difficulty)}
            >
              <option value="easy">かんたん</option>
              <option value="normal">ふつう</option>
              <option value="hard">つよい — ハード（2×2でも勝ち）</option>
              <option value="saikyo">最強 — ハード（2×2でも勝ち）</option>
            </select>
          </label>
          <button className="btn primary" type="button" onClick={startGame}>最初から</button>
        </div>
      </div>

      <div className="layout">
        <div className="main-col">
          <div className={`status${S.thinking ? " thinking" : ""}`}>
            <span className="dot" />
            <div>
              <b>{S.statusMain}</b>
              <small>{S.statusSub}</small>
            </div>
          </div>

          {hard && (
            <div className="hard-banner show" role="note" aria-live="polite">
              <span className="tag">HARD</span>
              <span className="hb-long">
                <b>ハードモード：2×2も勝ち</b> — 縦・横・斜めの1列に加えて、隣り合う<b>2×2のブロック（4マス）</b>に共通する特徴が1つでもあれば勝ちです。渡すピースも置く場所も、ブロックに注意してください。
              </span>
              <span className="hb-short">
                <b>ハードモード：2×2も勝ち</b> — 1列に加えて、隣り合う<b>2×2ブロック</b>に共通する特徴が1つでもあれば勝ちです。
              </span>
            </div>
          )}

          <div className="board-frame">
            <div className="board" role="grid" aria-label="Quarto盤面">
              {S.board.map((p, idx) => {
                const canPlace = S.phase === "place" && p < 0 && !S.over;
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`cell${S.winCells?.includes(idx) ? " win" : ""}${canPlace ? " placeable" : ""}`}
                    role="gridcell"
                    disabled={!canPlace}
                    aria-label={p >= 0 ? `${pieceName(p)}が置かれている` : "空きマス"}
                    onClick={() => humanPlace(idx)}
                  >
                    {p >= 0 && <Piece p={p} />}
                  </button>
                );
              })}
            </div>
            {S.overlay && S.overlayText && (
              <div className="overlay show">
                <div className="quarto">QUARTO!</div>
                <p>
                  {S.overlayText.title}
                  <br />
                  {S.overlayText.lines.map((line, i) => (
                    <span key={i}>{line}{i < S.overlayText!.lines.length - 1 && <br />}</span>
                  ))}
                </p>
                <button className="btn primary" type="button" style={{ fontSize: 15, padding: "10px 22px" }} onClick={startGame}>
                  もう一局
                </button>
              </div>
            )}
          </div>

          <div className="hand-row">
            <div className={`hand${S.hand !== null ? " filled" : ""}`}>
              <div className="slot">
                {S.hand !== null && <Piece p={S.hand} />}
              </div>
              <div>
                <h3>あなたが置くピース</h3>
                {S.hand !== null ? (
                  <p>「<span className="attrs">{pieceName(S.hand)}</span>」を、盤の空きマスに置いてください。</p>
                ) : S.over ? (
                  <p>対局は終わりました。「もう一局」から次へどうぞ。</p>
                ) : S.phase === "give" ? (
                  <p>まずピース置き場から、Museに渡すピースを1つ選んでください。</p>
                ) : (
                  <p>Museが考え中です…</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="panel">
          <div className="card opp opp-card">
            <div className="face" aria-hidden="true">
              <Face mood={S.mood} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="who">
                相手 ・ Muse{" "}
                <span className="mood-chip" data-mood={S.mood}>{MOOD_CHIPS[S.mood]}</span>
              </div>
              <div className="bubble">{S.speech}</div>
            </div>
          </div>

          <div className="card tray-card">
            <h2>ピース置き場<small>残り {remain} 個</small></h2>
            <p className="hint">
              {hard
                ? "ハードモード中：あなたの「渡す番」のときだけ選べます。1列だけでなく、2×2ブロックで揃ってしまうピースも要注意です。高さの見分け：高いピースは大きくて厚みがあり、横の金色ゲージが満タン。低いピースは小さくて平たく、ゲージは少しだけです。"
                : "あなたの「渡す番」のときだけ選べます。相手に渡したくない＝相手が揃えられそうなピースは要注意です。高さの見分け：高いピースは大きくて厚みがあり、横の金色ゲージが満タン。低いピースは小さくて平たく、ゲージは少しだけです。"}
            </p>
            <div className={`tray${S.phase === "give" && !S.over ? " active" : ""}`}>
              {Array.from({ length: 16 }, (_, p) =>
                S.used[p] ? (
                  <button key={p} type="button" className="used" disabled aria-label={`ピース：${pieceName(p)}`} />
                ) : (
                  <button
                    key={p}
                    type="button"
                    disabled={!(S.phase === "give" && !S.over)}
                    aria-label={`ピース：${pieceName(p)}`}
                    onClick={() => humanGive(p)}
                  >
                    <Piece p={p} />
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="card log-card">
            <h2>対局の記録</h2>
            <ul className="log">
              {S.log.length === 0 ? (
                <li className="empty">まだ手はありません。</li>
              ) : (
                S.log.map((entry, i) => (
                  <li key={`${S.seq}-${S.log.length - i}`}>
                    <b className={entry.who}>{entry.who === "you" ? "あなた" : "Muse"}</b> が{entry.text}
                  </li>
                ))
              )}
            </ul>
          </div>

          <details className="card">
            <summary>遊び方・ルール</summary>
            <div className="rules-body">
              <ol>
                <li><b>渡す → 置く</b> を繰り返します。自分の番に置くピースは、<b>相手が選んで渡してきます</b>。自分では選べません。</li>
                <li>あなたが渡したピースはMuseが盤に置き、Museが次にあなたへ渡すピースを選びます。</li>
                <li>縦・横・斜めのどれか1列に並んだ4つのピースに<b>共通する特徴が1つでもあれば</b>、最後に置いた人の勝ちです（「Quarto!」）。</li>
                <li>
                  <b>ハードモード（強さ「つよい」「最強」）では 2×2 でも勝ち：</b>隣り合う2×2のブロック
                  <span className="hard-diagram" aria-hidden="true"><i /><i /><i /><i /></span>
                  の4つのピースに共通する特徴が1つでもあれば、それも勝ちです。盤のどこでも、2×2は全部で9か所あります。Museも2×2を狙い、2×2で揃うピースは渡してきません。
                </li>
                <li><b>最強モードでは、Museの手はサーバー側で計算します：</b>候補をほぼ絞らない全幅探索に、局面の置換表、制限時間いっぱい使う反復深化、終盤の完全読みを組み合わせています。そのぶん、考える時間は少し長めです。</li>
                <li>ピースの特徴は4つ：<b>高い／低い</b>、<b>明るい／暗い</b>、<b>丸い／四角い</b>、<b>穴なし／穴あり</b>。16個すべて組み合わせが違います。</li>
                <li><b>高さの見分け方：</b>高いピースは一回り大きく、側面に厚みがあって、ピース横の金色ゲージが上まで満ちています。低いピースは小さく平たく、ゲージは下の方だけです。</li>
              </ol>
              <p style={{ margin: "8px 0 0" }}>
                コツ：渡すときに「あと1つで揃う列」をよく見て、その特徴を持つピースを渡さないこと。逆に、自分が置くときは揃う列がないか必ず確認しましょう。ハードでは2×2ブロックも同じようにチェックしてください — 3つ埋まったブロックは列と同じくらい危険です。
              </p>
              <div className="legend">
                {[
                  { a: 8, b: 0, t: "高い ／ 低い" },
                  { a: 4, b: 0, t: "暗い ／ 明るい" },
                  { a: 2, b: 0, t: "四角い ／ 丸い" },
                  { a: 1, b: 0, t: "穴あり ／ 穴なし" },
                ].map((d) => (
                  <div key={d.t}>
                    <Piece p={d.a} />
                    <Piece p={d.b} />
                    <span>{d.t}</span>
                  </div>
                ))}
              </div>
            </div>
          </details>

          <div className="card score-card">
            <span>通算成績</span>
            <span>あなた <b>{S.wins.you}</b></span>
            <span className="vs">–</span>
            <span><b>{S.wins.ai}</b> Muse</span>
          </div>
        </aside>
      </div>

      <p className="foot">Quarto（クアルト）は、4つの特徴を持つピースを並べるフランス生まれのボードゲームです。このページではMuseが相手をします。</p>
    </div>
  );
}
