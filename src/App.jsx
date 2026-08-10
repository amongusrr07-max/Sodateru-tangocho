import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Camera,
  Pencil,
  Check,
  Trash2,
  X,
  Save,
  BookOpen,
  Loader2,
  AlertCircle,
  RotateCcw,
  Layers,
  ListChecks,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Plus,
  ClipboardCopy,
  Download,
  ChevronDown,
  ChevronUp,
  History,
  Sparkles,
  Eye,
  Volume2,
} from "lucide-react";

const FONT_LINK_ID = "eiken-tangocho-fonts";

function useGoogleFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=Silkscreen:wght@400;700&display=swap";
    document.head.appendChild(link);
  }, []);
}

const STORAGE_KEY = "eiken-tangocho:words";

// ブラウザのlocalStorageを使う簡易ストレージ（Claudeアーティファクト専用のwindow.storageの代わり）
const storage = {
  async get(key) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? null : { key, value: v };
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
};

const PAGE_SIZE = 20;
const DAILY_LIMIT = 3;

const CHANGELOG = [
  {
    v: "v0.8",
    items: [
      "苦手な単語ほど出やすい重み付けクイズ（1日3回までカウント変動、それ以降はその日出にくく）",
      "しばらく出てない単語は出やすく補正",
      "「苦手な単語だけ」で復習できるモードを追加",
      "不正解の時だけ答え合わせの待ち時間を2秒に",
      "単語カード・一覧・クイズに発音ボタンを設置",
      "穴埋めクイズ（英検大問1風）を追加、意味クイズと切り替え可能に",
    ],
  },
  { v: "v0.7", items: ["同じ単語を追加・読み込みした時に自動で統合するように（重複防止）", "既存の単語帳にあった重複も起動時に自動で整理"] },
  {
    v: "v0.6",
    items: [
      "クイズの出題数を選べるように（5/10/15/20問など）",
      "リザルト画面に正解率と出題された単語一覧を表示",
      "リザルト画面から単語を単語帳ごと削除できるように",
      "各単語に例文をAIで生成するボタンを追加",
    ],
  },
  { v: "v0.5", items: ["「もっと見る」で20語ずつ表示", "書き出し/読み込みでバックアップできるように", "追加タブとクイズ/カードを分離"] },
  { v: "v0.4", items: ["デザインをダーク×ミニマルに一新", "保存語数・スコアをLCDカウンター表示に", "スペル修正の誤判定バグを修正"] },
  { v: "v0.3", items: ["手入力モード追加（スペルミス自動補正）"] },
  { v: "v0.2", items: ["フラッシュカード機能を追加", "4択クイズ機能を追加"] },
  { v: "v0.1", items: ["写真から単語抽出→編集→保存の基本フローを実装"] },
];

const C = {
  bg: "#19191C",
  surface: "#221F22",
  surfaceRaised: "#2A272B",
  border: "#333034",
  text: "#F4F3F5",
  textMuted: "#8E8B90",
  blue: "#0A84FF",
  blueDim: "#0A84FF33",
  red: "#FF453A",
  redDim: "#FF453A22",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normWord(w) {
  return (w || "").trim().toLowerCase();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(dateStr, today) {
  const a = new Date(dateStr + "T00:00:00");
  const b = new Date(today + "T00:00:00");
  return Math.max(0, Math.round((b - a) / 86400000));
}

// 出やすさの重み：苦手(wrongCount高)なら出やすく、克服(マイナス)なら出にくく、
// しばらく出てないと出やすく、その日の変動上限(3回)を使い切ったらその日は出にくく
function getWeight(word, today) {
  const wrongCount = word.wrongCount || 0;
  let weight = 1 + Math.max(wrongCount, -0.85);

  if (word.lastAnsweredDate) {
    const days = daysBetween(word.lastAnsweredDate, today);
    weight += Math.min(days * 0.15, 3);
  } else {
    weight += 0.5;
  }

  if (word.dailyDate === today && (word.dailyAnswerCount || 0) >= DAILY_LIMIT) {
    weight *= 0.2;
  }

  return Math.max(weight, 0.05);
}

function weightedSample(words, count, today) {
  const pool = [...words];
  const chosen = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const weights = pool.map((w) => getWeight(w, today));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < weights.length; idx++) {
      r -= weights[idx];
      if (r <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return chosen;
}

// 同じリスト内の重複語を先頭優先でまとめる（意味/例文は空いてる方を補完）
function dedupeSelf(list) {
  const indexByKey = new Map();
  const result = [];
  for (const w of list) {
    const key = normWord(w.word);
    if (indexByKey.has(key)) {
      const i = indexByKey.get(key);
      result[i] = {
        ...result[i],
        meaning: result[i].meaning?.trim() ? result[i].meaning : w.meaning,
        example: result[i].example || w.example,
        exampleTranslation: result[i].exampleTranslation || w.exampleTranslation,
      };
    } else {
      indexByKey.set(key, result.length);
      result.push(w);
    }
  }
  return result;
}

// 新しく追加する単語を、既存の単語帳と統合する（重複は既存側にマージ）
function mergeIntoExisting(existingList, incomingWords) {
  const incoming = dedupeSelf(incomingWords);
  const merged = [...existingList];
  const keyIndex = new Map(merged.map((w, i) => [normWord(w.word), i]));
  const brandNew = [];
  for (const nw of incoming) {
    const key = normWord(nw.word);
    if (keyIndex.has(key)) {
      const i = keyIndex.get(key);
      const cur = merged[i];
      merged[i] = {
        ...cur,
        meaning: cur.meaning?.trim() ? cur.meaning : nw.meaning || cur.meaning,
        example: cur.example || nw.example,
        exampleTranslation: cur.exampleTranslation || nw.exampleTranslation,
      };
    } else {
      brandNew.push({ ...nw, savedAt: nw.savedAt || Date.now() });
    }
  }
  return [...brandNew, ...merged];
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("画像の読み込みに失敗したよ"));
    r.readAsDataURL(file);
  });
}

function speakWord(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = 0.9;
    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.error("読み上げに失敗:", e);
  }
}

function SpeakButton({ word, size = 15, style = {} }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        speakWord(word);
      }}
      className="p-1.5 rounded-full shrink-0"
      style={{ color: C.blue, ...style }}
      aria-label="発音を聞く"
    >
      <Volume2 size={size} />
    </button>
  );
}

async function callClaudeJSON(systemPrompt, userContent) {
  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!response.ok) throw new Error(`APIエラー (${response.status})`);
  const data = await response.json();
  const text = (data.content || [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim()
    .replace(/```json|```/g, "")
    .trim();
  return JSON.parse(text);
}

async function extractWordsFromImage(base64, mediaType) {
  const systemPrompt = `あなたは英検（英語検定）を勉強する日本の高校生の手書きノートを読み取るアシスタントです。
画像には、勉強中にわからなかった英単語やフレーズが手書きで書かれています。
すべての英単語・英熟語を読み取り、それぞれに簡潔な日本語の意味をつけてください。
文字が読み取りにくい場合は文脈からベストな推測をしてください。
出力は必ず次の形式のJSON配列のみで、それ以外の文章・説明・マークダウンのコードフェンスは一切含めないでください：
[{"word":"abandon","meaning":"捨てる、放棄する"}]`;
  const parsed = await callClaudeJSON(systemPrompt, [
    { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
    { type: "text", text: "この画像から単語を抽出して、指定のJSON配列だけを返してください。" },
  ]);
  if (!Array.isArray(parsed)) throw new Error("想定外の形式で返ってきたよ。");
  return parsed
    .filter((w) => w && typeof w.word === "string" && w.word.trim())
    .map((w) => ({ id: uid(), word: w.word.trim(), meaning: (w.meaning || "").trim() }));
}

async function extractWordsFromText(rawText) {
  const systemPrompt = `あなたは英検（英語検定）を勉強する日本の高校生の単語帳作りを手伝うアシスタントです。
ユーザーが手打ちで英単語や英熟語を入力します（改行・カンマ・スペースなどで区切られている可能性があります）。
スペルミスが含まれている場合は、文脈から最も可能性の高い正しいスペルに直してください。大文字・小文字の違いはスペルミスとして扱わないでください。
それぞれの単語について、正しいスペルと簡潔な日本語の意味を返してください。
綴りそのものを修正した場合のみ originalInput にユーザーが入力した元の文字列を入れてください（大文字小文字の違いだけの場合や修正していない場合は originalInput を word と全く同じ値にしてください）。
出力は必ず次の形式のJSON配列のみで、それ以外の文章・説明・マークダウンのコードフェンスは一切含めないでください：
[{"word":"abandon","meaning":"捨てる、放棄する","originalInput":"abandonn"}]`;
  const parsed = await callClaudeJSON(
    systemPrompt,
    `次の入力から単語を抽出して、指定のJSON配列だけを返してください：\n${rawText}`
  );
  if (!Array.isArray(parsed)) throw new Error("想定外の形式で返ってきたよ。");
  return parsed
    .filter((w) => w && typeof w.word === "string" && w.word.trim())
    .map((w) => ({
      id: uid(),
      word: w.word.trim(),
      meaning: (w.meaning || "").trim(),
      originalInput: (w.originalInput || "").trim(),
    }));
}

async function generateDistractors(word, meaning, excludeMeanings) {
  const systemPrompt = `あなたは英検の4択クイズを作る先生です。
与えられた英単語の正しい意味に対して、もっともらしいが誤りである日本語の意味の選択肢を3つ作ってください。
本物の意味と紛らわしい、似たジャンル・品詞の誤答が望ましいです。
出力は必ず次の形式のJSON配列のみ（説明やコードフェンスなし）：
["誤答1","誤答2","誤答3"]`;
  const parsed = await callClaudeJSON(systemPrompt, `単語: ${word}\n正しい意味: ${meaning}\nこれと紛らわしい誤答を3つ作って。`);
  if (!Array.isArray(parsed)) throw new Error("bad format");
  return parsed.filter((m) => m && !excludeMeanings.includes(m)).slice(0, 3);
}

async function generateExampleSentence(word, meaning) {
  const systemPrompt = `あなたは英検を勉強する日本の高校生のための例文作成アシスタントです。
与えられた英単語（または熟語）を使った、高校生にもわかりやすい自然な英語の例文を1つ作ってください。
その例文の日本語訳もつけてください。
出力は必ず次の形式のJSONオブジェクトのみで、それ以外の文章・説明・マークダウンのコードフェンスは一切含めないでください：
{"sentence":"She decided to abandon the old plan.","translation":"彼女は古い計画を放棄することにした。"}`;
  const parsed = await callClaudeJSON(systemPrompt, `単語: ${word}\n意味: ${meaning}`);
  if (!parsed || typeof parsed.sentence !== "string") throw new Error("bad format");
  return { sentence: parsed.sentence.trim(), translation: (parsed.translation || "").trim() };
}

async function generateContextQuestion(word, meaning) {
  const systemPrompt = `あなたは英検の大問1（語彙）のような4択の穴埋め問題を作る先生です。
与えられた英単語とその意味をもとに、以下を行ってください：
1. その単語の英検の目安級（5級/4級/3級/準2級/2級/準1級/1級のいずれか）を推定する
2. その級のレベル感に合う、自然な英文を1つ作る。文中でその単語が入る部分は "______"（アンダースコア6つ）という空欄にする
3. 正解はその単語自身。加えて、同じ品詞・同じくらいの難易度で、文脈的にも紛らわしい誤答を3つ作る（正解と極端に簡単すぎたり難しすぎたりしないように）
出力は必ず次の形式のJSONオブジェクトのみで、それ以外の文章・説明・マークダウンのコードフェンスは一切含めないでください：
{"level":"準2級","sentence":"His efforts will ______ to the success of the project.","distractors":["attend","suggest","complain"]}`;
  const parsed = await callClaudeJSON(systemPrompt, `単語: ${word}\n意味: ${meaning}`);
  if (!parsed || typeof parsed.sentence !== "string" || !Array.isArray(parsed.distractors)) {
    throw new Error("bad format");
  }
  return {
    level: parsed.level || "",
    sentence: parsed.sentence.trim(),
    distractors: parsed.distractors.filter((d) => d && normWord(d) !== normWord(word)).slice(0, 3),
  };
}

/* ---------------- Shared UI ---------------- */

function Card({ children, className = "", style = {} }) {
  return (
    <div className={`rounded-2xl border ${className}`} style={{ background: C.surface, borderColor: C.border, ...style }}>
      {children}
    </div>
  );
}

function LcdCounter({ value, label, digits = 3 }) {
  const padded = String(value).padStart(digits, "0");
  return (
    <div
      className="inline-flex flex-col items-center px-4 py-2.5 rounded-xl"
      style={{ background: "#0E0E10", border: `1px solid ${C.border}`, boxShadow: "inset 0 1px 3px rgba(0,0,0,0.6)" }}
    >
      <div
        className="flex gap-[2px] leading-none"
        style={{
          fontFamily: "'Silkscreen', monospace",
          fontSize: "22px",
          color: C.blue,
          textShadow: `0 0 8px ${C.blue}99, 0 0 2px ${C.blue}`,
          letterSpacing: "2px",
        }}
      >
        {padded}
      </div>
      {label && (
        <div className="text-[9px] mt-1 tracking-widest uppercase" style={{ color: C.textMuted, fontFamily: "'Inter', sans-serif" }}>
          {label}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold rounded-xl transition-colors"
      style={{ background: active ? C.blue : "transparent", color: active ? "#FFFFFF" : C.textMuted }}
    >
      <Icon size={15} /> {label}
    </button>
  );
}

function MiniToggle({ options, value, onChange }) {
  return (
    <div className="flex gap-1 mb-3 p-1 rounded-xl" style={{ background: C.bg }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-semibold rounded-lg"
          style={{ background: value === opt.value ? C.blue : "transparent", color: value === opt.value ? "#FFFFFF" : C.textMuted }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Flashcards ---------------- */

function Flashcards({ words }) {
  const [order, setOrder] = useState(() => shuffle(words.map((w) => w.id)));
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    setOrder(shuffle(words.map((w) => w.id)));
    setIdx(0);
    setFlipped(false);
  }, [words.length]);

  const byId = useMemo(() => Object.fromEntries(words.map((w) => [w.id, w])), [words]);
  if (words.length === 0) return null;
  const current = byId[order[idx]];

  const go = (dir) => {
    setFlipped(false);
    setIdx((prev) => (prev + dir + order.length) % order.length);
  };

  const reshuffle = () => {
    setOrder(shuffle(words.map((w) => w.id)));
    setIdx(0);
    setFlipped(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <LcdCounter value={idx + 1} digits={2} label={`/ ${order.length}`} />
        <button onClick={reshuffle} className="flex items-center gap-1 text-xs font-medium" style={{ color: C.blue }}>
          <RefreshCw size={12} /> シャッフル
        </button>
      </div>

      <div className="relative">
        <button onClick={() => setFlipped((f) => !f)} className="w-full mb-4" style={{ perspective: "1200px" }}>
          <div
            className="relative w-full h-56 transition-transform duration-500"
            style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
          >
            <div
              className="absolute inset-0 rounded-2xl flex items-center justify-center px-6 border"
              style={{ backfaceVisibility: "hidden", background: C.surfaceRaised, borderColor: C.border }}
            >
              <p className="text-3xl font-bold text-center" style={{ color: C.text, fontFamily: "'Inter', sans-serif" }}>
                {current.word}
              </p>
            </div>
            <div
              className="absolute inset-0 rounded-2xl flex items-center justify-center px-6 border"
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)", background: C.blue, borderColor: C.blue }}
            >
              <p className="text-xl font-bold text-center" style={{ color: "#FFFFFF" }}>
                {current.meaning || "（意味なし）"}
              </p>
            </div>
          </div>
        </button>
        {!flipped && (
          <div className="absolute top-3 right-3">
            <SpeakButton word={current.word} size={17} style={{ background: C.bg, border: `1px solid ${C.border}` }} />
          </div>
        )}
      </div>
      <p className="text-center text-xs mb-4" style={{ color: C.textMuted }}>
        タップでめくる
      </p>

      <div className="flex gap-2">
        <button
          onClick={() => go(-1)}
          className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl border text-sm font-medium"
          style={{ borderColor: C.border, color: C.text }}
        >
          <ChevronLeft size={16} /> 前
        </button>
        <button
          onClick={() => go(1)}
          className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl border text-sm font-medium"
          style={{ borderColor: C.border, color: C.text }}
        >
          次 <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* ---------------- Quiz ---------------- */

function buildLocalMeaningQuiz(words, count, today) {
  const pool = weightedSample(words, count, today);
  return pool.map((w) => {
    const others = words.filter((o) => o.id !== w.id && o.meaning && o.meaning !== w.meaning);
    const distractors = shuffle(others).slice(0, 3).map((o) => o.meaning);
    const choices = shuffle([w.meaning, ...distractors]);
    return { id: w.id, word: w.word, answer: w.meaning, choices, mode: "meaning" };
  });
}

function Quiz({ words, onRemoveWord, onAnswer, onCacheContextQuestion }) {
  const [phase, setPhase] = useState("setup");
  const [quizMode, setQuizMode] = useState("meaning"); // meaning | context
  const [source, setSource] = useState("all"); // all | wrong
  const [count, setCount] = useState(5);
  const [questions, setQuestions] = useState([]);
  const [qIdx, setQIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [score, setScore] = useState(0);
  const [wrongList, setWrongList] = useState([]);
  const [error, setError] = useState("");
  const [showAppeared, setShowAppeared] = useState(false);
  const [removedIds, setRemovedIds] = useState(() => new Set());

  const pool = useMemo(() => (source === "wrong" ? words.filter((w) => (w.wrongCount || 0) > 0) : words), [words, source]);

  useEffect(() => {
    setCount((c) => Math.min(Math.max(c, 1), Math.max(pool.length, 1)));
  }, [pool.length]);

  const enoughForLocalDistractors = pool.filter((w) => w.meaning).length >= 4;
  const countOptions = useMemo(() => {
    const opts = [5, 10, 15, 20, pool.length].filter((n) => n >= 1 && n <= pool.length);
    return Array.from(new Set(opts)).sort((a, b) => a - b);
  }, [pool.length]);

  const start = async () => {
    setError("");
    setPhase("loading");
    setRemovedIds(new Set());
    const today = todayStr();
    try {
      let qs;
      if (quizMode === "meaning") {
        if (enoughForLocalDistractors) {
          qs = buildLocalMeaningQuiz(pool.filter((w) => w.meaning), count, today);
        } else {
          const targets = weightedSample(pool, count, today);
          qs = [];
          for (const w of targets) {
            const distractors = await generateDistractors(w.word, w.meaning, [w.meaning]);
            const choices = shuffle([w.meaning, ...distractors]);
            qs.push({ id: w.id, word: w.word, answer: w.meaning, choices, mode: "meaning" });
          }
        }
      } else {
        const targets = weightedSample(pool, count, today);
        qs = [];
        for (const w of targets) {
          let cq = w.contextQuestion;
          if (!cq || !cq.sentence) {
            const data = await generateContextQuestion(w.word, w.meaning);
            cq = data;
            await onCacheContextQuestion(w.id, data);
          }
          const choices = shuffle([w.word, ...cq.distractors]);
          qs.push({ id: w.id, word: w.word, answer: w.word, sentence: cq.sentence, choices, mode: "context" });
        }
      }
      setQuestions(qs);
      setQIdx(0);
      setScore(0);
      setWrongList([]);
      setSelected(null);
      setShowAppeared(false);
      setPhase("playing");
    } catch (e) {
      setError("クイズの作成に失敗したよ。もう一回試してみて。");
      setPhase("setup");
    }
  };

  const removeWord = (id) => {
    setRemovedIds((prev) => new Set(prev).add(id));
    onRemoveWord(id);
  };

  if (phase === "setup") {
    return (
      <div className="text-center py-6">
        <ListChecks size={26} className="mx-auto mb-3" color={C.textMuted} />

        <MiniToggle
          options={[
            { value: "meaning", label: "意味クイズ" },
            { value: "context", label: "穴埋めクイズ" },
          ]}
          value={quizMode}
          onChange={setQuizMode}
        />
        <MiniToggle
          options={[
            { value: "all", label: "すべて" },
            { value: "wrong", label: "苦手だけ" },
          ]}
          value={source}
          onChange={setSource}
        />

        {pool.length === 0 ? (
          <p className="text-sm py-6" style={{ color: C.textMuted }}>
            {source === "wrong" ? "苦手な単語（間違えたことがある単語）がまだないよ" : "単語がまだないよ"}
          </p>
        ) : (
          <>
            <p className="text-sm mb-3" style={{ color: C.textMuted }}>
              出題数を選んでね
            </p>
            <div className="flex flex-wrap justify-center gap-2 mb-5">
              {countOptions.map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className="px-3.5 py-2 rounded-xl text-sm font-semibold border"
                  style={{
                    background: count === n ? C.blue : "transparent",
                    borderColor: count === n ? C.blue : C.border,
                    color: count === n ? "#FFFFFF" : C.text,
                  }}
                >
                  {n}問
                </button>
              ))}
            </div>
            {error && (
              <div
                className="mb-4 mx-2 flex items-start gap-2 text-sm px-3 py-2.5 rounded-xl text-left"
                style={{ background: C.redDim, color: C.red, border: `1px solid ${C.red}55` }}
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button onClick={start} className="px-6 py-3 rounded-xl font-semibold text-sm" style={{ background: C.blue, color: "#FFFFFF" }}>
              クイズをはじめる
            </button>
          </>
        )}
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="text-center py-10">
        <Loader2 size={26} className="mx-auto mb-2 animate-spin" color={C.textMuted} />
        <p className="text-sm" style={{ color: C.textMuted }}>
          問題を作ってるよ…
        </p>
      </div>
    );
  }

  if (phase === "done") {
    const total = questions.length;
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const appeared = questions.filter((q) => !removedIds.has(q.id));
    const wrongVisible = wrongList.filter((w) => !removedIds.has(w.id));
    return (
      <div className="py-4">
        <div className="flex justify-center mb-2">
          <LcdCounter value={score} digits={2} label={`/ ${total} 正解`} />
        </div>
        <p className="text-center text-sm mb-1" style={{ color: C.blue, fontFamily: "'Silkscreen', monospace", fontSize: "18px" }}>
          {pct}%
        </p>
        <p className="text-center text-sm mb-6" style={{ color: C.textMuted }}>
          正解率
        </p>

        {wrongVisible.length > 0 && (
          <div className="text-left mb-5 px-1">
            <p className="text-xs font-semibold mb-2" style={{ color: C.red }}>
              まちがえた単語（覚えたら「もう大丈夫」で消せるよ）
            </p>
            <div className="space-y-1.5">
              {wrongVisible.map((w) => (
                <div key={w.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-xl" style={{ background: C.redDim }}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold" style={{ color: C.text }}>
                      {w.word}
                    </span>
                    <SpeakButton word={w.word} size={13} />
                    <span style={{ color: C.textMuted }}>{w.answer}</span>
                  </div>
                  <button
                    onClick={() => removeWord(w.id)}
                    className="text-xs font-semibold px-2.5 py-1.5 rounded-lg shrink-0"
                    style={{ background: C.red, color: "#FFFFFF" }}
                  >
                    もう大丈夫
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => setShowAppeared((s) => !s)}
          className="flex items-center gap-1.5 text-xs font-medium mb-3 px-1"
          style={{ color: C.blue }}
        >
          <Eye size={13} /> どの単語が出たか見る {showAppeared ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showAppeared && (
          <div className="text-left mb-5 px-1 space-y-1.5">
            {appeared.map((w) => (
              <div key={w.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-xl" style={{ background: C.surfaceRaised }}>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold" style={{ color: C.text }}>
                    {w.word}
                  </span>
                  <SpeakButton word={w.word} size={13} />
                  <span style={{ color: C.textMuted }}>{w.answer}</span>
                </div>
                <button onClick={() => removeWord(w.id)} className="p-1 rounded-full shrink-0" aria-label="単語帳から削除">
                  <Trash2 size={14} color={C.red} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => setPhase("setup")}
          className="w-full flex items-center justify-center py-3 rounded-xl font-semibold text-sm"
          style={{ background: C.blue, color: "#FFFFFF" }}
        >
          もう一回
        </button>
      </div>
    );
  }

  const q = questions[qIdx];

  const choose = (choice) => {
    if (selected) return;
    setSelected(choice);
    const correct = choice === q.answer;
    if (correct) setScore((s) => s + 1);
    else setWrongList((l) => [...l, q]);
    onAnswer(q.id, correct);
    const delay = correct ? 900 : 2000;
    setTimeout(() => {
      setSelected(null);
      if (qIdx + 1 < questions.length) setQIdx((i) => i + 1);
      else setPhase("done");
    }, delay);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <LcdCounter value={qIdx + 1} digits={2} label={`/ ${questions.length}`} />
        <LcdCounter value={score} digits={2} label="正解" />
      </div>
      <Card className="p-6 mb-4 flex items-center justify-center min-h-[92px] relative">
        {q.mode === "context" ? (
          <p className="text-lg font-semibold text-center leading-relaxed" style={{ color: C.text, fontFamily: "'Inter', sans-serif" }}>
            {q.sentence}
          </p>
        ) : (
          <>
            <p className="text-2xl font-bold text-center" style={{ color: C.text, fontFamily: "'Inter', sans-serif" }}>
              {q.word}
            </p>
            <div className="absolute top-2 right-2">
              <SpeakButton word={q.word} size={16} />
            </div>
          </>
        )}
      </Card>
      <div className="space-y-2">
        {q.choices.map((c, i) => {
          const isSelected = selected === c;
          const isCorrect = c === q.answer;
          let bg = C.surface;
          let border = C.border;
          let color = C.text;
          if (selected) {
            if (isCorrect) {
              bg = C.blueDim;
              border = C.blue;
              color = C.blue;
            } else if (isSelected) {
              bg = C.redDim;
              border = C.red;
              color = C.red;
            }
          }
          return (
            <button
              key={i}
              onClick={() => choose(c)}
              disabled={!!selected}
              className="w-full text-left px-4 py-3 rounded-xl border text-sm font-medium flex items-center gap-2.5"
              style={{ background: bg, borderColor: border, color, fontFamily: q.mode === "context" ? "'Inter', sans-serif" : "inherit" }}
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0"
                style={{ background: color, color: bg === C.surface ? C.bg : "#fff" }}
              >
                {i + 1}
              </span>
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Backup (export / import) ---------------- */

function wordsToBackupText(words) {
  return words.map((w) => `${w.word}\t${w.meaning || ""}`).join("\n");
}

function parseBackupText(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let parts;
      if (line.includes("\t")) parts = line.split("\t");
      else if (line.includes(" - ")) parts = line.split(" - ");
      else if (line.includes(":")) parts = line.split(":");
      else parts = [line];
      const word = (parts[0] || "").trim();
      const meaning = (parts[1] || "").trim();
      return word ? { id: uid(), word, meaning, savedAt: Date.now() } : null;
    })
    .filter(Boolean);
}

function BackupPanel({ savedWords, onImport }) {
  const [mode, setMode] = useState("export");
  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef(null);

  const backupText = useMemo(() => wordsToBackupText(savedWords), [savedWords]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(backupText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      textareaRef.current?.select();
    }
  };

  const doImport = () => {
    const parsed = parseBackupText(importText);
    if (parsed.length === 0) return;
    onImport(parsed);
    setImportText("");
  };

  return (
    <Card className="p-5 mb-6">
      <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: C.bg }}>
        <button
          onClick={() => setMode("export")}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg"
          style={{ background: mode === "export" ? C.blue : "transparent", color: mode === "export" ? "#FFFFFF" : C.textMuted }}
        >
          <Download size={13} /> 書き出し
        </button>
        <button
          onClick={() => setMode("import")}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg"
          style={{ background: mode === "import" ? C.blue : "transparent", color: mode === "import" ? "#FFFFFF" : C.textMuted }}
        >
          <ClipboardCopy size={13} /> 読み込み
        </button>
      </div>

      {mode === "export" ? (
        savedWords.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: C.textMuted }}>
            まだ単語がないから書き出せることがないよ
          </p>
        ) : (
          <div>
            <p className="text-[11px] mb-2" style={{ color: C.textMuted }}>
              コピーして、メモアプリとかに貼っておけば復元用のバックアップになるよ
            </p>
            <textarea
              ref={textareaRef}
              readOnly
              value={backupText}
              rows={6}
              className="w-full bg-transparent text-xs outline-none rounded-xl px-3 py-2.5 border resize-none font-mono"
              style={{ borderColor: C.border, color: C.text }}
            />
            <button
              onClick={copy}
              className="w-full mt-3 flex items-center justify-center gap-1.5 text-sm py-2.5 rounded-xl font-semibold"
              style={{ background: C.blue, color: "#FFFFFF" }}
            >
              {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} {copied ? "コピーしたよ！" : "コピーする"}
            </button>
          </div>
        )
      ) : (
        <div>
          <p className="text-[11px] mb-2" style={{ color: C.textMuted }}>
            バックアップしたテキストを貼り付けてね（1行に「単語＋タブ or - or : ＋意味」）
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            placeholder={"abandon\t捨てる、放棄する\nharm\t害、傷つける"}
            className="w-full bg-transparent text-xs outline-none rounded-xl px-3 py-2.5 border resize-none font-mono"
            style={{ borderColor: C.border, color: C.text }}
          />
          <button
            onClick={doImport}
            disabled={!importText.trim()}
            className="w-full mt-3 flex items-center justify-center gap-1.5 text-sm py-2.5 rounded-xl font-semibold disabled:opacity-50"
            style={{ background: C.blue, color: "#FFFFFF" }}
          >
            <Download size={15} /> 単語帳に追加する
          </button>
        </div>
      )}
    </Card>
  );
}

/* ---------------- Word row (with example sentence) ---------------- */

function WordRow({ w, onDelete, onGenerateExample, exampleLoading }) {
  return (
    <Card className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-1">
            <p className="font-bold text-[15px]" style={{ color: C.text, fontFamily: "'Inter', sans-serif" }}>
              {w.word}
            </p>
            <SpeakButton word={w.word} size={14} />
          </div>
          {w.meaning && (
            <p className="text-sm" style={{ color: C.textMuted }}>
              {w.meaning}
            </p>
          )}
        </div>
        <button onClick={() => onDelete(w.id)} className="p-1.5 rounded-full shrink-0" aria-label="削除">
          <Trash2 size={15} color={C.red} />
        </button>
      </div>

      {w.example ? (
        <div className="mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${C.border}` }}>
          <p className="text-sm" style={{ color: C.text, fontFamily: "'Inter', sans-serif" }}>
            {w.example}
          </p>
          {w.exampleTranslation && (
            <p className="text-xs mt-1" style={{ color: C.textMuted }}>
              {w.exampleTranslation}
            </p>
          )}
        </div>
      ) : (
        <button
          onClick={() => onGenerateExample(w)}
          disabled={exampleLoading}
          className="mt-2.5 flex items-center gap-1 text-xs font-medium disabled:opacity-50"
          style={{ color: C.blue }}
        >
          {exampleLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {exampleLoading ? "作ってるよ…" : "例文を作る"}
        </button>
      )}
    </Card>
  );
}

/* ---------------- Main App ---------------- */

export default function EikenTangocho() {
  useGoogleFonts();

  const [photo, setPhoto] = useState(null);
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [draftWords, setDraftWords] = useState([]);
  const [savedWords, setSavedWords] = useState([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [view, setView] = useState("add");
  const [inputMode, setInputMode] = useState("photo");
  const [textInput, setTextInput] = useState("");
  const [textLoading, setTextLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [showBackup, setShowBackup] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [exampleLoadingIds, setExampleLoadingIds] = useState(() => new Set());
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          const words = JSON.parse(res.value);
          const deduped = dedupeSelf(words);
          setSavedWords(deduped);
          if (deduped.length !== words.length) {
            await persist(deduped);
          }
          if (deduped.length > 0) setView("list");
        }
      } catch (e) {
        // no key yet
      } finally {
        setSavedLoaded(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    try {
      await storage.set(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.error("保存に失敗:", e);
    }
  }, []);

  const handleFile = async (file) => {
    if (!file) return;
    setErrorMsg("");
    const previewUrl = URL.createObjectURL(file);
    try {
      const base64 = await fileToBase64(file);
      setPhoto({ base64, mediaType: file.type || "image/jpeg", previewUrl });
      setStatus("idle");
      setDraftWords([]);
    } catch (e) {
      setErrorMsg(e.message);
    }
  };

  const runExtraction = async () => {
    if (!photo) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const words = await extractWordsFromImage(photo.base64, photo.mediaType);
      if (words.length === 0) {
        setErrorMsg("単語が見つからなかったよ。写真を撮り直してみて。");
        setStatus("idle");
        return;
      }
      setDraftWords(words);
      setStatus("reviewing");
    } catch (e) {
      setErrorMsg(e.message || "読み取りに失敗したよ");
      setStatus("error");
    }
  };

  const runTextLookup = async () => {
    if (!textInput.trim()) return;
    setTextLoading(true);
    setErrorMsg("");
    try {
      const words = await extractWordsFromText(textInput);
      if (words.length === 0) {
        setErrorMsg("単語が見つからなかったよ。もう一回打ち直してみて。");
        setTextLoading(false);
        return;
      }
      setDraftWords(words);
      setStatus("reviewing");
      setTextInput("");
    } catch (e) {
      setErrorMsg(e.message || "調べるのに失敗したよ");
    } finally {
      setTextLoading(false);
    }
  };

  const updateDraft = (id, field, value) => {
    setDraftWords((prev) => prev.map((w) => (w.id === id ? { ...w, [field]: value } : w)));
  };

  const removeDraft = (id) => {
    setDraftWords((prev) => prev.filter((w) => w.id !== id));
  };

  const addBlankDraft = () => {
    setDraftWords((prev) => [...prev, { id: uid(), word: "", meaning: "" }]);
  };

  const saveAll = async () => {
    const clean = draftWords.filter((w) => w.word.trim());
    if (clean.length === 0) return;
    const next = mergeIntoExisting(
      savedWords,
      clean.map((w) => ({ ...w, savedAt: Date.now() }))
    );
    setSavedWords(next);
    await persist(next);
    setDraftWords([]);
    setPhoto(null);
    setStatus("idle");
    setJustSaved(true);
    setView("list");
    setTimeout(() => setJustSaved(false), 2200);
  };

  const deleteSaved = async (id) => {
    setSavedWords((prev) => {
      const next = prev.filter((w) => w.id !== id);
      persist(next);
      return next;
    });
  };

  const importWords = async (parsedWords) => {
    const next = mergeIntoExisting(savedWords, parsedWords);
    setSavedWords(next);
    await persist(next);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2200);
  };

  const generateExample = async (w) => {
    setExampleLoadingIds((prev) => new Set(prev).add(w.id));
    try {
      const { sentence, translation } = await generateExampleSentence(w.word, w.meaning);
      setSavedWords((prev) => {
        const next = prev.map((x) => (x.id === w.id ? { ...x, example: sentence, exampleTranslation: translation } : x));
        persist(next);
        return next;
      });
    } catch (e) {
      setErrorMsg("例文の生成に失敗したよ。もう一回試してみて。");
    } finally {
      setExampleLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(w.id);
        return next;
      });
    }
  };

  // クイズの正解/不正解を記録（1日3回まで反映、それ以降はノーカウント）
  const registerAnswer = useCallback(
    (wordId, correct) => {
      setSavedWords((prev) => {
        const today = todayStr();
        const next = prev.map((w) => {
          if (w.id !== wordId) return w;
          const sameDayAsBefore = w.dailyDate === today;
          const dailyAnswerCount = sameDayAsBefore ? w.dailyAnswerCount || 0 : 0;
          let wrongCount = w.wrongCount || 0;
          let newDailyCount = dailyAnswerCount;
          if (dailyAnswerCount < DAILY_LIMIT) {
            wrongCount = correct ? wrongCount - 1 : wrongCount + 1;
            newDailyCount = dailyAnswerCount + 1;
          }
          return { ...w, wrongCount, dailyDate: today, dailyAnswerCount: newDailyCount, lastAnsweredDate: today };
        });
        persist(next);
        return next;
      });
    },
    [persist]
  );

  // 穴埋めクイズで生成した問題を単語データにキャッシュ
  const cacheContextQuestion = useCallback(
    async (wordId, data) => {
      setSavedWords((prev) => {
        const next = prev.map((w) =>
          w.id === wordId ? { ...w, contextQuestion: { sentence: data.sentence, distractors: data.distractors }, level: data.level || w.level } : w
        );
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const reset = () => {
    setPhoto(null);
    setDraftWords([]);
    setStatus("idle");
    setErrorMsg("");
  };

  const visibleWords = savedWords.slice(0, visibleCount);
  const hasMore = savedWords.length > visibleCount;

  return (
    <div className="min-h-screen w-full" style={{ background: C.bg, fontFamily: "'Zen Kaku Gothic New', sans-serif", color: C.text }}>
      <div className="max-w-md mx-auto px-4 py-8 pb-16">
        <header className="mb-7 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: C.blue }}>
              <BookOpen size={20} color="#FFFFFF" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-2xl leading-tight font-bold" style={{ color: C.text }}>
                育てる単語帳
              </h1>
              <p className="text-xs tracking-wide" style={{ color: C.textMuted }}>
                手書きノート → AIが単語帳にするやつ
              </p>
            </div>
          </div>
          <span className="text-[10px] tracking-wide" style={{ color: C.textMuted }}>
            v0.8
          </span>
        </header>

        {justSaved && (
          <div
            className="mb-4 flex items-center gap-2 text-sm px-3 py-2.5 rounded-xl font-medium"
            style={{ background: C.blueDim, color: C.blue, border: `1px solid ${C.blue}55` }}
          >
            <Check size={16} /> 単語帳に保存したよ！
          </div>
        )}

        <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <TabButton active={view === "add"} onClick={() => setView("add")} icon={Plus} label="追加" />
          <TabButton active={view === "list"} onClick={() => setView("list")} icon={BookOpen} label="一覧" />
          {savedWords.length > 0 && <TabButton active={view === "flashcards"} onClick={() => setView("flashcards")} icon={Layers} label="カード" />}
          {savedWords.length > 0 && <TabButton active={view === "quiz"} onClick={() => setView("quiz")} icon={ListChecks} label="クイズ" />}
        </div>

        {view === "add" && status !== "reviewing" && (
          <Card className="p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: C.blue, color: "#FFFFFF" }}>
                STEP 1
              </span>
              <span className="text-sm" style={{ color: C.textMuted }}>
                わからなかった単語を追加する
              </span>
            </div>

            <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: C.bg }}>
              <button
                onClick={() => setInputMode("photo")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg"
                style={{ background: inputMode === "photo" ? C.blue : "transparent", color: inputMode === "photo" ? "#FFFFFF" : C.textMuted }}
              >
                <Camera size={14} /> 写真
              </button>
              <button
                onClick={() => setInputMode("text")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg"
                style={{ background: inputMode === "text" ? C.blue : "transparent", color: inputMode === "text" ? "#FFFFFF" : C.textMuted }}
              >
                <Pencil size={14} /> 手入力
              </button>
            </div>

            {inputMode === "photo" ? (
              !photo ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed rounded-2xl py-10 flex flex-col items-center gap-2 transition-colors"
                  style={{ borderColor: C.border }}
                >
                  <Camera size={30} strokeWidth={1.6} color={C.textMuted} />
                  <span className="text-sm" style={{ color: C.textMuted }}>
                    タップして写真を選ぶ
                  </span>
                </button>
              ) : (
                <div>
                  <img
                    src={photo.previewUrl}
                    alt="アップロードした写真"
                    className="w-full rounded-xl mb-3 max-h-64 object-contain"
                    style={{ background: C.bg }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 flex items-center justify-center gap-1.5 text-sm py-2.5 rounded-xl border font-medium"
                      style={{ borderColor: C.border, color: C.text }}
                    >
                      <RotateCcw size={15} /> 撮り直す
                    </button>
                    <button
                      onClick={runExtraction}
                      disabled={status === "loading"}
                      className="flex-[2] flex items-center justify-center gap-1.5 text-sm py-2.5 rounded-xl font-semibold disabled:opacity-60"
                      style={{ background: C.blue, color: "#FFFFFF" }}
                    >
                      {status === "loading" ? (
                        <>
                          <Loader2 size={16} className="animate-spin" /> 読み取り中…
                        </>
                      ) : (
                        <>
                          <Pencil size={15} /> AIに読ませる
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={"英単語を打ってね（改行・カンマ区切りでまとめてOK）\n例：\nabandonn\nconsequense\nmaintain"}
                  rows={5}
                  className="w-full bg-transparent text-sm outline-none rounded-xl px-3 py-2.5 border resize-none"
                  style={{ borderColor: C.border, color: C.text }}
                />
                <p className="text-[11px] mt-1.5 mb-3" style={{ color: C.textMuted }}>
                  スペルミスってても大丈夫、AIが直して調べてくれるよ
                </p>
                <button
                  onClick={runTextLookup}
                  disabled={textLoading || !textInput.trim()}
                  className="w-full flex items-center justify-center gap-1.5 text-sm py-2.5 rounded-xl font-semibold disabled:opacity-50"
                  style={{ background: C.blue, color: "#FFFFFF" }}
                >
                  {textLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> 調べ中…
                    </>
                  ) : (
                    <>
                      <Pencil size={15} /> AIに調べてもらう
                    </>
                  )}
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </Card>
        )}

        {errorMsg && (
          <div
            className="mb-6 flex items-start gap-2 text-sm px-3 py-2.5 rounded-xl"
            style={{ background: C.redDim, color: C.red, border: `1px solid ${C.red}55` }}
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {view === "add" && status === "reviewing" && (
          <Card className="p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: C.blue, color: "#FFFFFF" }}>
                  STEP 2
                </span>
                <span className="text-sm" style={{ color: C.textMuted }}>
                  {draftWords.length}語見つけたよ。確認して！
                </span>
              </div>
              <button onClick={reset} className="text-xs font-medium" style={{ color: C.blue }}>
                やり直す
              </button>
            </div>

            <div className="space-y-3 mb-4">
              {draftWords.map((w) => (
                <div key={w.id} className="flex items-start gap-2 pb-3" style={{ borderBottom: `1px solid ${C.border}` }}>
                  <div className="flex-1 space-y-1.5">
                    {w.originalInput && w.originalInput.toLowerCase().trim() !== w.word.toLowerCase().trim() && (
                      <p className="text-[11px]" style={{ color: C.blue }}>
                        <s style={{ color: C.textMuted }}>{w.originalInput}</s> → スペル直したよ
                      </p>
                    )}
                    <input
                      value={w.word}
                      onChange={(e) => updateDraft(w.id, "word", e.target.value)}
                      placeholder="単語"
                      className="w-full bg-transparent text-base font-bold outline-none border-b pb-0.5"
                      style={{ color: C.text, borderColor: "transparent" }}
                      onFocus={(e) => (e.target.style.borderColor = C.blue)}
                      onBlur={(e) => (e.target.style.borderColor = "transparent")}
                    />
                    <input
                      value={w.meaning}
                      onChange={(e) => updateDraft(w.id, "meaning", e.target.value)}
                      placeholder="意味"
                      className="w-full bg-transparent text-sm outline-none border-b pb-0.5"
                      style={{ color: C.textMuted, borderColor: "transparent" }}
                      onFocus={(e) => (e.target.style.borderColor = C.blue)}
                      onBlur={(e) => (e.target.style.borderColor = "transparent")}
                    />
                  </div>
                  <button onClick={() => removeDraft(w.id)} className="p-1.5 mt-0.5 rounded-full shrink-0" aria-label="削除">
                    <X size={16} color={C.red} />
                  </button>
                </div>
              ))}
            </div>

            <button onClick={addBlankDraft} className="text-xs font-medium mb-4 block" style={{ color: C.blue }}>
              ＋ 見落とした単語を手動で追加
            </button>

            <button
              onClick={saveAll}
              className="w-full flex items-center justify-center gap-2 text-sm py-3 rounded-xl font-semibold"
              style={{ background: C.blue, color: "#FFFFFF" }}
            >
              <Save size={16} /> 単語帳に保存する
            </button>
          </Card>
        )}

        {view === "flashcards" && savedWords.length > 0 && (
          <Card className="p-5 mb-6">
            <Flashcards words={savedWords} />
          </Card>
        )}

        {view === "quiz" && savedWords.length > 0 && (
          <Card className="p-5 mb-6">
            {savedWords.length < 2 ? (
              <p className="text-sm text-center py-6" style={{ color: C.textMuted }}>
                クイズを作るにはあと{2 - savedWords.length}語くらい単語を追加してね
              </p>
            ) : (
              <Quiz words={savedWords} onRemoveWord={deleteSaved} onAnswer={registerAnswer} onCacheContextQuestion={cacheContextQuestion} />
            )}
          </Card>
        )}

        {view === "list" && (
          <>
            <div className="flex items-center justify-between mb-4">
              <LcdCounter value={savedLoaded ? savedWords.length : 0} label="保存語数" />
              <button onClick={() => setShowBackup((s) => !s)} className="flex items-center gap-1 text-xs font-medium" style={{ color: C.blue }}>
                <Download size={13} /> バックアップ {showBackup ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>

            {showBackup && <BackupPanel savedWords={savedWords} onImport={importWords} />}

            {savedLoaded && savedWords.length === 0 && (
              <p className="text-sm px-1" style={{ color: C.textMuted }}>
                まだ単語帳は空っぽ。「追加」タブから最初の単語を追加してみて。
              </p>
            )}

            <div className="space-y-2">
              {visibleWords.map((w) => (
                <WordRow
                  key={w.id}
                  w={w}
                  onDelete={deleteSaved}
                  onGenerateExample={generateExample}
                  exampleLoading={exampleLoadingIds.has(w.id)}
                />
              ))}
            </div>

            {hasMore && (
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="w-full mt-3 py-3 rounded-xl text-sm font-semibold border"
                style={{ borderColor: C.border, color: C.blue }}
              >
                もっと見る（残り{savedWords.length - visibleCount}語）
              </button>
            )}
          </>
        )}

        <div className="mt-10 pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
          <button onClick={() => setShowChangelog((s) => !s)} className="flex items-center gap-1.5 text-xs font-medium mx-auto" style={{ color: C.textMuted }}>
            <History size={12} /> アプデメモ {showChangelog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showChangelog && (
            <div className="mt-3 space-y-3">
              {CHANGELOG.map((c) => (
                <div key={c.v}>
                  <p className="text-xs font-bold mb-1" style={{ color: C.blue, fontFamily: "'Silkscreen', monospace" }}>
                    {c.v}
                  </p>
                  <ul className="text-xs space-y-0.5" style={{ color: C.textMuted }}>
                    {c.items.map((it, i) => (
                      <li key={i}>・{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
