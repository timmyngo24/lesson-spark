import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BADGES,
  xpToLevel,
  type Lesson,
  type MatchPair,
  type QuizItem,
  type TFItem,
  type VocabItem,
} from "@/lib/lesson-types";

export const Route = createFileRoute("/")({
  component: LumiApp,
});

/* ---------------- Sample lesson for first paint ---------------- */
const SAMPLE: Lesson = {
  title: "Everyday Café Conversations",
  topic: "Ordering food & drinks",
  level: "Elementary",
  intro:
    "Learn friendly phrases and vocabulary for ordering at a café. Perfect for real-world practice!",
  vocabulary: [
    { word: "order", pos: "verb", definition: "to ask for food or a drink", emoji: "📝", pronunciation: "/ˈɔːr.dər/", example: "I'd like to order a latte, please." },
    { word: "menu", pos: "noun", definition: "a list of food and drinks", emoji: "📋", pronunciation: "/ˈmen.juː/", example: "Can I see the menu?" },
    { word: "delicious", pos: "adj", definition: "very tasty", emoji: "😋", pronunciation: "/dɪˈlɪʃ.əs/", example: "This cake is delicious!" },
    { word: "bill", pos: "noun", definition: "the paper that shows how much to pay", emoji: "🧾", pronunciation: "/bɪl/", example: "Could I have the bill, please?" },
    { word: "tip", pos: "noun", definition: "extra money for good service", emoji: "💰", pronunciation: "/tɪp/", example: "We left a small tip." },
    { word: "recommend", pos: "verb", definition: "to say something is good", emoji: "👍", pronunciation: "/ˌrek.əˈmend/", example: "What do you recommend?" },
    { word: "vegetarian", pos: "adj", definition: "no meat or fish", emoji: "🥗", pronunciation: "/ˌvedʒ.əˈter.i.ən/", example: "Do you have vegetarian options?" },
    { word: "takeaway", pos: "noun", definition: "food to eat somewhere else", emoji: "🥡", pronunciation: "/ˈteɪk.ə.weɪ/", example: "I'll have it as a takeaway." },
  ],
  trueFalse: [
    { statement: "'Bill' means the same as 'menu'.", answer: false, explain: "'Bill' is what you pay; 'menu' shows the food." },
    { statement: "A tip is extra money for the server.", answer: true, explain: "Tips reward good service." },
    { statement: "Takeaway means eating in the café.", answer: false, explain: "Takeaway is food you take with you." },
    { statement: "Vegetarian food has no meat.", answer: true, explain: "Correct — no meat or fish." },
    { statement: "'Recommend' means to complain.", answer: false, explain: "It means to suggest something good." },
  ],
  fillBlank: {
    dialogue: [
      { speaker: "Server", line: "Hi! Are you ready to ____?", blank: "order" },
      { speaker: "You", line: "Yes, could I see the ____ again?", blank: "menu" },
      { speaker: "Server", line: "Of course. Anything I can ____?", blank: "recommend" },
      { speaker: "You", line: "Do you have ____ options?", blank: "vegetarian" },
      { speaker: "Server", line: "Yes! The veggie wrap is very ____.", blank: "delicious" },
      { speaker: "You", line: "Great — and could I get the ____ after?", blank: "bill" },
    ],
    options: ["order", "menu", "recommend", "vegetarian", "delicious", "bill", "tip", "takeaway"],
  },
  quiz: [
    { question: "What do you say to see the food list?", choices: ["Can I see the bill?", "Can I see the menu?", "Can I order?", "Can I tip?"], answerIndex: 1, explain: "The menu shows the food." },
    { question: "Which word means 'very tasty'?", choices: ["Delicious", "Vegetarian", "Bill", "Tip"], answerIndex: 0, explain: "'Delicious' = very tasty." },
    { question: "You want food to go. You ask for a…", choices: ["Menu", "Recommendation", "Takeaway", "Tip"], answerIndex: 2, explain: "Takeaway = food to go." },
    { question: "A ____ has no meat.", choices: ["takeaway", "bill", "vegetarian meal", "menu"], answerIndex: 2, explain: "Vegetarian meals have no meat." },
    { question: "Extra money for good service is a…", choices: ["bill", "tip", "menu", "order"], answerIndex: 1, explain: "That's a tip!" },
  ],
  matching: [
    { left: "order", right: "ask for food" },
    { left: "menu", right: "list of dishes" },
    { left: "bill", right: "amount to pay" },
    { left: "tip", right: "extra money for service" },
    { left: "takeaway", right: "food to go" },
    { left: "vegetarian", right: "no meat" },
  ],
  wheelPrompts: [
    "Order your favorite coffee",
    "Ask for the menu politely",
    "Ask what the server recommends",
    "Ask for the bill",
    "Order a vegetarian meal",
    "Ask if takeaway is possible",
    "Compliment the food",
    "Ask about the price",
  ],
};

/* ---------------- Progress persistence ---------------- */
type Progress = {
  xp: number;
  streak: number;
  lastActive: string | null; // YYYY-MM-DD
  badges: string[];
  quests: { id: string; done: boolean }[];
};
const DEFAULT_PROGRESS: Progress = {
  xp: 0,
  streak: 0,
  lastActive: null,
  badges: [],
  quests: [
    { id: "learn5", done: false },
    { id: "quiz3", done: false },
    { id: "match", done: false },
  ],
};
const STORAGE_KEY = "lumi:progress:v1";

function useProgress() {
  const [p, setP] = useState<Progress>(DEFAULT_PROGRESS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setP({ ...DEFAULT_PROGRESS, ...JSON.parse(raw) });
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }, [p]);
  return [p, setP] as const;
}

/* ---------------- Root ---------------- */
function LumiApp() {
  const [lesson, setLesson] = useState<Lesson>(SAMPLE);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"cards" | "match" | "tf" | "wheel" | "fill" | "quiz">("cards");

  const [progress, setProgress] = useProgress();
  const [xpBurst, setXpBurst] = useState<{ id: number; amount: number } | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const [confetti, setConfetti] = useState(false);
  const prevLevel = useRef(xpToLevel(progress.xp).level);

  const { level, into, need } = xpToLevel(progress.xp);
  useEffect(() => {
    if (level > prevLevel.current) {
      setLevelUp(level);
      setConfetti(true);
      window.setTimeout(() => setLevelUp(null), 2200);
      window.setTimeout(() => setConfetti(false), 2400);
    }
    prevLevel.current = level;
  }, [level]);

  const addXP = useCallback((amount: number, questId?: string) => {
    const today = new Date().toISOString().slice(0, 10);
    setProgress((prev) => {
      const newBadges = new Set(prev.badges);
      const newXp = prev.xp + amount;
      // Streak logic
      let streak = prev.streak;
      if (prev.lastActive !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        streak = prev.lastActive === yesterday ? prev.streak + 1 : 1;
      }
      // Auto-award XP-threshold badges
      BADGES.forEach((b) => {
        if (b.xp > 0 && newXp >= b.xp) newBadges.add(b.id);
      });
      if (streak >= 3) newBadges.add("streak3");
      if (newXp > 0) newBadges.add("first");
      const quests = prev.quests.map((q) =>
        questId && q.id === questId ? { ...q, done: true } : q,
      );
      return {
        xp: newXp,
        streak,
        lastActive: today,
        badges: Array.from(newBadges),
        quests,
      };
    });
    setXpBurst({ id: Date.now(), amount });
    window.setTimeout(() => setXpBurst(null), 900);
  }, [setProgress]);

  const awardBadge = useCallback((id: string) => {
    setProgress((prev) =>
      prev.badges.includes(id) ? prev : { ...prev, badges: [...prev.badges, id] },
    );
  }, [setProgress]);

  async function generateLesson() {
    if (!source.trim()) {
      setErr("Paste some text or a topic first.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setLesson(json.lesson as Lesson);
      setTab("cards");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setSource(text.slice(0, 15000));
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <TopBar level={level} into={into} need={need} xp={progress.xp} streak={progress.streak} />

      {/* Uploader */}
      <section className="glass-card mt-6 p-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl">Turn any text into a lesson ✨</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste a paragraph, article, or topic — Lumi builds vocabulary, quizzes & games instantly.
            </p>
          </div>
          <div className="flex gap-2">
            <label className="chip cursor-pointer hover:bg-white">
              📎 Upload .txt
              <input type="file" accept=".txt,.md,text/plain" className="hidden" onChange={onFile} />
            </label>
          </div>
        </div>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Paste a topic or paragraph here (e.g., 'Airport check-in vocabulary')..."
          className="mt-4 h-28 w-full resize-none rounded-2xl border border-border bg-white/70 p-4 text-sm outline-none focus:border-primary"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={generateLesson}
            disabled={loading}
            className="rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-[var(--shadow-pop)] transition hover:-translate-y-0.5 disabled:opacity-60"
          >
            {loading ? "Generating…" : "✨ Generate lesson"}
          </button>
          {err && <span className="text-sm text-destructive">⚠ {err}</span>}
          <span className="ml-auto text-xs text-muted-foreground">
            Powered by Coachio · Gemini 3.1 Flash Lite
          </span>
        </div>
      </section>

      {/* Lesson header */}
      <section className="mt-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="chip !bg-lavender/70">Level: {lesson.level}</span>
            <span className="chip !bg-mint/70">{lesson.vocabulary.length} words</span>
          </div>
          <h2 className="mt-2 text-3xl md:text-4xl">{lesson.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{lesson.intro}</p>
        </div>
        <DailyQuests quests={progress.quests} />
      </section>

      {/* Tabs */}
      <nav className="mt-6 flex flex-wrap gap-2">
        {[
          ["cards", "🎴 Flashcards"],
          ["match", "🧩 Matching"],
          ["tf", "✅ True / False"],
          ["fill", "💬 Fill the blanks"],
          ["quiz", "❓ Quiz"],
          ["wheel", "🎡 Lucky Wheel"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id as typeof tab)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === id
                ? "bg-primary text-primary-foreground shadow-[var(--shadow-pop)]"
                : "bg-white/70 text-foreground hover:bg-white"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="mt-6">
        {tab === "cards" && <Flashcards items={lesson.vocabulary} onXP={(n) => addXP(n, "learn5")} />}
        {tab === "match" && (
          <Matching pairs={lesson.matching} onXP={addXP} onComplete={() => { awardBadge("matchmaster"); addXP(30, "match"); }} />
        )}
        {tab === "tf" && <TrueFalse items={lesson.trueFalse} onXP={addXP} />}
        {tab === "fill" && <FillBlanks data={lesson.fillBlank} onXP={addXP} />}
        {tab === "quiz" && (
          <Quiz items={lesson.quiz} onXP={addXP} onPerfect={() => { awardBadge("perfectquiz"); addXP(50, "quiz3"); }} />
        )}
        {tab === "wheel" && <LuckyWheel prompts={lesson.wheelPrompts} onXP={addXP} />}
      </section>

      <BadgeShelf badges={progress.badges} />

      <footer className="mt-12 pb-8 text-center text-xs text-muted-foreground">
        Made with 💗 for ESL learners.
      </footer>

      {/* Overlays */}
      {xpBurst && (
        <div
          key={xpBurst.id}
          className="pointer-events-none fixed left-1/2 top-24 z-50 -translate-x-1/2 animate-float-up rounded-full bg-success px-4 py-2 text-sm font-black text-success-foreground shadow-lg"
        >
          +{xpBurst.amount} XP
        </div>
      )}
      {levelUp && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div className="animate-pop-in rounded-3xl bg-white/90 px-8 py-6 text-center shadow-2xl backdrop-blur">
            <div className="text-6xl">🎉</div>
            <div className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">Level up</div>
            <div className="text-4xl font-black">Level {levelUp}</div>
          </div>
        </div>
      )}
      {confetti && <Confetti />}
    </div>
  );
}

/* ---------------- Top bar ---------------- */
function TopBar({ level, into, need, xp, streak }: { level: number; into: number; need: number; xp: number; streak: number }) {
  const pct = Math.min(100, Math.round((into / need) * 100));
  return (
    <header className="glass-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-6 md:p-5">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent text-lg font-black text-white shadow-md">
          L
        </div>
        <div>
          <div className="text-lg font-black leading-none">Lumi</div>
          <div className="text-[11px] text-muted-foreground">Play. Learn. Level up.</div>
        </div>
      </div>
      <div className="flex-1">
        <div className="mb-1 flex items-center justify-between text-xs font-semibold">
          <span>Level {level}</span>
          <span className="text-muted-foreground">{into} / {need} XP</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary via-lavender to-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="chip !bg-peach">🔥 {streak}d</span>
        <span className="chip !bg-lemon">⚡ {xp} XP</span>
      </div>
    </header>
  );
}

/* ---------------- Daily quests ---------------- */
function DailyQuests({ quests }: { quests: { id: string; done: boolean }[] }) {
  const labels: Record<string, string> = {
    learn5: "Study 5 flashcards",
    quiz3: "Ace the quiz",
    match: "Finish matching game",
  };
  return (
    <div className="glass-card w-full max-w-sm p-4">
      <div className="mb-2 flex items-center justify-between text-sm font-bold">
        <span>🎯 Daily quests</span>
        <span className="text-xs text-muted-foreground">
          {quests.filter((q) => q.done).length}/{quests.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {quests.map((q) => (
          <li key={q.id} className="flex items-center gap-2 text-sm">
            <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${q.done ? "bg-success text-success-foreground" : "bg-secondary text-muted-foreground"}`}>
              {q.done ? "✓" : "•"}
            </span>
            <span className={q.done ? "line-through text-muted-foreground" : ""}>{labels[q.id] ?? q.id}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Flashcards ---------------- */
function Flashcards({ items, onXP }: { items: VocabItem[]; onXP: (n: number) => void }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const item = items[i];
  useEffect(() => { setFlipped(false); }, [i]);

  function next(mark: "know" | "again") {
    if (mark === "know" && !known.has(i)) {
      setKnown(new Set(known).add(i));
      onXP(10);
    }
    setI((p) => (p + 1) % items.length);
  }

  function speak() {
    const utt = new SpeechSynthesisUtterance(item.word);
    utt.lang = "en-US";
    utt.rate = 0.9;
    window.speechSynthesis.speak(utt);
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_260px]">
      <div>
        <div className="mb-3 flex items-center justify-between text-xs font-semibold text-muted-foreground">
          <span>Card {i + 1} of {items.length}</span>
          <span>{known.size} learned</span>
        </div>
        <div
          onClick={() => setFlipped((f) => !f)}
          className="relative min-h-72 cursor-pointer rounded-3xl bg-white p-8 shadow-[var(--shadow-pop)] transition hover:-translate-y-0.5"
        >
          {!flipped ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="text-6xl">{item.emoji}</div>
              <div className="text-3xl font-black">{item.word}</div>
              <div className="text-sm text-muted-foreground">{item.pos} · {item.pronunciation}</div>
              <button
                onClick={(e) => { e.stopPropagation(); speak(); }}
                className="mt-2 chip !bg-sky"
              >🔊 Listen</button>
              <div className="mt-6 text-xs text-muted-foreground">Tap the card to flip</div>
            </div>
          ) : (
            <div className="flex h-full flex-col justify-center gap-4">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Meaning</div>
              <div className="text-xl font-bold">{item.definition}</div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Example</div>
              <div className="rounded-2xl bg-secondary p-4 italic">"{item.example}"</div>
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => next("again")}
            className="flex-1 rounded-2xl bg-peach px-4 py-3 font-bold text-peach-foreground transition hover:-translate-y-0.5"
          >
            🔁 Practice again
          </button>
          <button
            onClick={() => next("know")}
            className="flex-1 rounded-2xl bg-mint px-4 py-3 font-bold text-mint-foreground transition hover:-translate-y-0.5"
          >
            ✅ I know this (+10 XP)
          </button>
        </div>
      </div>

      {/* Word list */}
      <aside className="glass-card max-h-96 overflow-y-auto p-3">
        <div className="mb-2 px-2 text-xs font-bold text-muted-foreground">All words</div>
        <ul className="space-y-1">
          {items.map((v, idx) => (
            <li key={v.word}>
              <button
                onClick={() => setI(idx)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
                  idx === i ? "bg-primary/20 font-bold" : "hover:bg-white"
                }`}
              >
                <span>{v.emoji}</span>
                <span className="flex-1">{v.word}</span>
                {known.has(idx) && <span className="text-xs text-success">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/* ---------------- Matching ---------------- */
function Matching({ pairs, onXP, onComplete }: { pairs: MatchPair[]; onXP: (n: number) => void; onComplete: () => void }) {
  const [leftPick, setLeftPick] = useState<string | null>(null);
  const [rightPick, setRightPick] = useState<string | null>(null);
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [wrong, setWrong] = useState(false);

  const rights = useMemo(() => shuffle(pairs.map((p) => p.right)), [pairs]);
  const lefts = useMemo(() => shuffle(pairs.map((p) => p.left)), [pairs]);

  useEffect(() => {
    if (leftPick && rightPick) {
      const correct = pairs.some((p) => p.left === leftPick && p.right === rightPick);
      if (correct) {
        setSolved((s) => {
          const ns = new Set(s).add(leftPick);
          if (ns.size === pairs.length) { onComplete(); }
          return ns;
        });
        onXP(8);
        setLeftPick(null); setRightPick(null);
      } else {
        setWrong(true);
        window.setTimeout(() => { setWrong(false); setLeftPick(null); setRightPick(null); }, 500);
      }
    }
  }, [leftPick, rightPick, pairs, onXP, onComplete]);

  const done = solved.size === pairs.length;

  return (
    <div>
      <div className="mb-3 text-sm text-muted-foreground">
        Tap a word on the left and its match on the right.
      </div>
      <div className={`grid grid-cols-2 gap-4 ${wrong ? "animate-shake" : ""}`}>
        <div className="space-y-2">
          {lefts.map((w) => {
            const isSolved = solved.has(w);
            const isPicked = leftPick === w;
            return (
              <button
                key={w}
                disabled={isSolved}
                onClick={() => setLeftPick(w)}
                className={`w-full rounded-2xl p-3 text-left font-semibold transition ${
                  isSolved ? "bg-success/20 text-muted-foreground line-through"
                  : isPicked ? "bg-primary text-primary-foreground"
                  : "bg-white hover:-translate-y-0.5"
                }`}
              >{w}</button>
            );
          })}
        </div>
        <div className="space-y-2">
          {rights.map((w) => {
            const matched = pairs.find((p) => p.right === w);
            const isSolved = matched && solved.has(matched.left);
            const isPicked = rightPick === w;
            return (
              <button
                key={w}
                disabled={!!isSolved}
                onClick={() => setRightPick(w)}
                className={`w-full rounded-2xl p-3 text-left transition ${
                  isSolved ? "bg-success/20 text-muted-foreground line-through"
                  : isPicked ? "bg-accent text-accent-foreground"
                  : "bg-white hover:-translate-y-0.5"
                }`}
              >{w}</button>
            );
          })}
        </div>
      </div>
      {done && (
        <div className="mt-6 animate-pop-in rounded-3xl bg-mint p-6 text-center text-mint-foreground">
          <div className="text-4xl">🧩</div>
          <div className="mt-1 text-xl font-black">All matched!</div>
          <div className="text-sm">+30 XP · Badge unlocked: Match Master</div>
        </div>
      )}
    </div>
  );
}

/* ---------------- True/False ---------------- */
function TrueFalse({ items, onXP }: { items: TFItem[]; onXP: (n: number) => void }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const item = items[i];
  const done = i >= items.length;

  function pick(v: boolean) {
    setPicked(v);
    if (v === item.answer) { setScore((s) => s + 1); onXP(6); }
    window.setTimeout(() => { setPicked(null); setI((p) => p + 1); }, 1200);
  }

  if (done) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="text-5xl">🌟</div>
        <div className="mt-2 text-2xl font-black">Round complete!</div>
        <div className="text-muted-foreground">You scored {score} / {items.length}</div>
        <button onClick={() => { setI(0); setScore(0); }} className="mt-4 rounded-2xl bg-primary px-5 py-3 font-bold text-primary-foreground">Play again</button>
      </div>
    );
  }

  const correct = picked !== null && picked === item.answer;
  const wrong = picked !== null && picked !== item.answer;

  return (
    <div className="glass-card p-8">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">Question {i + 1} / {items.length}</div>
      <div className="text-2xl font-bold">{item.statement}</div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          disabled={picked !== null}
          onClick={() => pick(true)}
          className={`rounded-2xl p-5 text-lg font-bold transition ${
            picked === true
              ? correct ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground"
              : "bg-mint text-mint-foreground hover:-translate-y-0.5"
          }`}
        >✅ True</button>
        <button
          disabled={picked !== null}
          onClick={() => pick(false)}
          className={`rounded-2xl p-5 text-lg font-bold transition ${
            picked === false
              ? correct ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground"
              : "bg-peach text-peach-foreground hover:-translate-y-0.5"
          }`}
        >❌ False</button>
      </div>
      {picked !== null && (
        <div className={`mt-4 rounded-2xl p-4 text-sm ${correct ? "bg-success/20" : "bg-destructive/10"}`}>
          {correct ? "Nice!" : "Not quite."} {item.explain}
        </div>
      )}
      {wrong && null}
    </div>
  );
}

/* ---------------- Fill blanks ---------------- */
function FillBlanks({ data, onXP }: { data: { dialogue: { speaker: string; line: string; blank: string | null }[]; options: string[] }; onXP: (n: number) => void }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);
  const options = useMemo(() => shuffle(data.options), [data]);

  function check() {
    let ok = 0;
    data.dialogue.forEach((d, idx) => {
      if (d.blank && answers[idx]?.toLowerCase() === d.blank.toLowerCase()) ok += 1;
    });
    onXP(ok * 5);
    setChecked(true);
  }

  const blanks = data.dialogue.filter((d) => d.blank);

  return (
    <div className="glass-card p-6">
      <div className="mb-3 text-sm text-muted-foreground">Choose the right word for each blank.</div>
      <div className="space-y-3">
        {data.dialogue.map((d, idx) => (
          <div key={idx} className="rounded-2xl bg-white p-4">
            <div className="text-xs font-bold uppercase text-muted-foreground">{d.speaker}</div>
            <div className="mt-1 text-base">
              {d.blank ? renderWithBlank(d.line, (
                <select
                  value={answers[idx] ?? ""}
                  onChange={(e) => setAnswers({ ...answers, [idx]: e.target.value })}
                  disabled={checked}
                  className={`mx-1 rounded-lg border px-2 py-1 text-sm font-bold ${
                    checked
                      ? answers[idx]?.toLowerCase() === d.blank?.toLowerCase() ? "border-success bg-success/20" : "border-destructive bg-destructive/10"
                      : "border-primary bg-primary/10"
                  }`}
                >
                  <option value="">___</option>
                  {options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )) : d.line}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-3">
        <button onClick={check} disabled={checked} className="rounded-2xl bg-primary px-5 py-3 font-bold text-primary-foreground disabled:opacity-60">
          Check answers
        </button>
        {checked && (
          <button onClick={() => { setAnswers({}); setChecked(false); }} className="rounded-2xl bg-secondary px-5 py-3 font-bold">
            Try again
          </button>
        )}
      </div>
      {checked && (
        <div className="mt-3 text-sm text-muted-foreground">
          {Object.entries(answers).filter(([idx, v]) => data.dialogue[+idx].blank?.toLowerCase() === v.toLowerCase()).length}
          {" / "}{blanks.length} correct
        </div>
      )}
    </div>
  );
}
function renderWithBlank(line: string, node: React.ReactNode) {
  const parts = line.split("____");
  return <>{parts[0]}{node}{parts[1] ?? ""}</>;
}

/* ---------------- Quiz ---------------- */
function Quiz({ items, onXP, onPerfect }: { items: QuizItem[]; onXP: (n: number) => void; onPerfect: () => void }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const item = items[i];
  const done = i >= items.length;

  function pick(idx: number) {
    setPicked(idx);
    if (idx === item.answerIndex) { setScore((s) => s + 1); onXP(12); }
    window.setTimeout(() => { setPicked(null); setI((p) => p + 1); }, 1200);
  }

  useEffect(() => {
    if (done && score === items.length) onPerfect();
  }, [done, score, items.length, onPerfect]);

  if (done) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="text-5xl">{score === items.length ? "🏆" : "🎯"}</div>
        <div className="mt-2 text-2xl font-black">{score} / {items.length}</div>
        <div className="text-sm text-muted-foreground">
          {score === items.length ? "Perfect! Badge unlocked." : "Great job — try again for a perfect score!"}
        </div>
        <button onClick={() => { setI(0); setScore(0); }} className="mt-4 rounded-2xl bg-primary px-5 py-3 font-bold text-primary-foreground">
          Restart
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card p-6 md:p-8">
      <div className="mb-2 flex items-center justify-between text-xs font-bold text-muted-foreground">
        <span>Question {i + 1} / {items.length}</span>
        <span>Score {score}</span>
      </div>
      <div className="text-xl font-bold">{item.question}</div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {item.choices.map((c, idx) => {
          const isPicked = picked === idx;
          const isRight = picked !== null && idx === item.answerIndex;
          return (
            <button
              key={idx}
              disabled={picked !== null}
              onClick={() => pick(idx)}
              className={`rounded-2xl p-4 text-left font-semibold transition ${
                isRight ? "bg-success text-success-foreground"
                : isPicked ? "bg-destructive/80 text-destructive-foreground"
                : "bg-white hover:-translate-y-0.5"
              }`}
            >{c}</button>
          );
        })}
      </div>
      {picked !== null && (
        <div className="mt-3 rounded-xl bg-secondary p-3 text-sm">{item.explain}</div>
      )}
    </div>
  );
}

/* ---------------- Lucky Wheel ---------------- */
function LuckyWheel({ prompts, onXP }: { prompts: string[]; onXP: (n: number) => void }) {
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const colors = ["var(--mint)", "var(--peach)", "var(--lavender)", "var(--sky)", "var(--lemon)", "var(--primary)"];

  function spin() {
    if (spinning) return;
    setSpinning(true);
    setChosen(null);
    const turns = 5 + Math.random() * 3;
    const finalAngle = angle + turns * 360 + Math.random() * 360;
    setAngle(finalAngle);
    window.setTimeout(() => {
      const norm = ((finalAngle % 360) + 360) % 360;
      const seg = 360 / prompts.length;
      const idx = Math.floor(((360 - norm) % 360) / seg);
      setChosen(prompts[idx]);
      setSpinning(false);
      onXP(15);
    }, 3600);
  }

  const seg = 360 / prompts.length;

  return (
    <div className="grid gap-6 md:grid-cols-[320px_1fr] md:items-center">
      <div className="relative mx-auto h-72 w-72">
        <div
          className="h-full w-full rounded-full border-8 border-white shadow-[var(--shadow-pop)] transition-transform duration-[3500ms] ease-out"
          style={{
            transform: `rotate(${angle}deg)`,
            background: `conic-gradient(${prompts
              .map((_, i) => `${colors[i % colors.length]} ${i * seg}deg ${(i + 1) * seg}deg`)
              .join(",")})`,
          }}
        >
          {prompts.map((_, i) => (
            <div
              key={i}
              className="absolute left-1/2 top-1/2 h-1/2 w-px origin-top bg-white/40"
              style={{ transform: `rotate(${i * seg}deg)` }}
            />
          ))}
        </div>
        <div className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-2xl font-black shadow-lg">🎡</div>
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-3xl">▼</div>
      </div>
      <div>
        <button
          onClick={spin}
          disabled={spinning}
          className="rounded-2xl bg-primary px-6 py-4 text-lg font-black text-primary-foreground shadow-[var(--shadow-pop)] transition hover:-translate-y-0.5 disabled:opacity-60"
        >
          {spinning ? "Spinning…" : "🎡 Spin the wheel (+15 XP)"}
        </button>
        {chosen && (
          <div className="animate-pop-in mt-4 rounded-3xl bg-lavender p-5 text-lavender-foreground">
            <div className="text-xs font-bold uppercase tracking-widest">Your challenge</div>
            <div className="mt-1 text-xl font-black">"{chosen}"</div>
            <div className="mt-2 text-xs">Say it out loud or type your answer!</div>
          </div>
        )}
        <div className="mt-4 text-xs text-muted-foreground">
          Practice speaking with a random prompt from today's lesson.
        </div>
      </div>
    </div>
  );
}

/* ---------------- Badges ---------------- */
function BadgeShelf({ badges }: { badges: string[] }) {
  return (
    <section className="glass-card mt-8 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xl">🏅 Your badges</h3>
        <span className="text-xs text-muted-foreground">{badges.length} / {BADGES.length} unlocked</span>
      </div>
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {BADGES.map((b) => {
          const owned = badges.includes(b.id);
          return (
            <div
              key={b.id}
              className={`flex flex-col items-center gap-1 rounded-2xl p-3 text-center transition ${
                owned ? "bg-lemon shadow-md" : "bg-white/50 opacity-50 grayscale"
              }`}
            >
              <div className="text-3xl">{b.emoji}</div>
              <div className="text-[11px] font-bold">{b.label}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- Confetti ---------------- */
function Confetti() {
  const pieces = Array.from({ length: 60 });
  const colors = ["#F9A8D4", "#FCA5A5", "#FCD34D", "#86EFAC", "#93C5FD", "#C4B5FD"];
  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pieces.map((_, i) => (
        <span
          key={i}
          className="confetti-piece absolute top-0 h-2 w-2 rounded-sm"
          style={{
            left: `${Math.random() * 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${Math.random() * 0.6}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ---------------- utils ---------------- */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
