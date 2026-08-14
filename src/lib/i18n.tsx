import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Minimal i18n: two languages, one query param.
 *
 * `?language=chinese` (or `zh`) selects Chinese; anything else, or nothing,
 * is English. The choice is read once at startup and kept in localStorage so
 * it survives navigating away from that query string, and the in-app toggle
 * writes both the storage key and the URL so a copied link carries it too.
 */

export type Lang = 'en' | 'zh';

const STORAGE_KEY = 'twentyfour.lang';

function langFromQueryValue(value: string | null): Lang | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === 'zh' || v === 'chinese' || v === 'cn' || v === 'zh-cn') return 'zh';
  if (v === 'en' || v === 'english') return 'en';
  return null;
}

function detectInitialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const fromQuery = langFromQueryValue(new URLSearchParams(window.location.search).get('language'));
  if (fromQuery) return fromQuery;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'zh' || stored === 'en') return stored;
  return 'en';
}

export interface Dict {
  tagline: string;
  howtoIntro: string;
  howtoDrag: string;
  howtoFree: (penalty: number) => string;
  namePlaceholder: string;
  playEasy: string;
  playHard: string;
  howToPlay: string;
  challengedYou: (name: string) => string;
  hands: string;
  deck: string;
  timeToBeat: string;
  leads: string;
  havePlayed: (n: number) => string;
  sentYouThis: string;
  start: string;
  playOwnDeck: string;
  inARow: string;
  handOf: (i: number, n: number) => string;
  vs: (time: string) => string;
  unmuteSounds: string;
  muteSounds: string;
  notDeadEnd: string;
  nudgeNote: (seconds: number, penalty: number) => string;
  undo: string;
  reset: string;
  startOver: string;
  sure: string;
  giveUp: (penalty: number) => string;
  answerPaused: string;
  nextHand: string;
  gaveUp: (n: number) => string;
  cardsLeftOver: (n: number) => string;
  best: (time: string) => string;
  yourChallengeLink: string;
  copied: string;
  copy: string;
  sendItYourself: (hands: number, time: string) => string;
  replayDeck: string;
  newDeck: string;
  yourRecord: string;
  yourRecordTitle: string;
  nothingHereYet: string;
  notPlayedYet: string;
  runsClean: (runs: number, clean: number, lastAt: string | null) => string;
  headToHead: (wins: number, losses: number, ties: number) => string;
  recentRuns: string;
  keptInBrowser: string;
  back: string;
  perHand: string;
  redBarsGaveUp: (penalty: number) => string;
  levelLabel: Record<'easy' | 'hard', string>;
  levelWord: Record<'easy' | 'hard', string>;
  faster: (delta: string, name: string) => string;
  firstOneDown: string;
  fastestHandYet: string;
  underAverage: string;
  thatIsWholeGame: string;
  howToPlayTitle: string;
  skipIKnowHow: string;
  tutorialIntro: string;
  tutorialDone: string;
  backToStart: string;
  stepOf: (i: number, n: number) => string;
  tutorialStep1: ReactNode;
  tutorialStep2: ReactNode;
  tutorialStep3: ReactNode;
  noSolution: string;
  langToggle: string;
}

const dict: Record<Lang, Dict> = {
  en: {
    tagline: 'four cards, one target',
    howtoIntro:
      'Four cards. Use each one exactly once with + − × ÷ to make 24. Clear the deck as fast as you can.',
    howtoDrag:
      'Drag a card onto another and a wheel of + − × ÷ appears, then let go on the one you want. The two become one card holding the result. The dragged card goes on the left, so 7 onto 3 is 7 − 3.',
    howtoFree: (penalty: number) =>
      `Undo and Reset are free. Give up costs ${penalty}s and shows an answer: every hand has one.`,
    namePlaceholder: 'Your name',
    playEasy: 'Play easy · A–9 · 9 hands',
    playHard: 'Play hard · A–K · 13 hands',
    howToPlay: 'How to play',
    challengedYou: (name: string) => `${name} challenged you`,
    hands: 'hands',
    deck: 'deck',
    timeToBeat: 'time to beat',
    leads: 'leads',
    havePlayed: (n: number) => `${n} have played this deck, fastest first`,
    sentYouThis: 'sent you this',
    start: 'Start',
    playOwnDeck: 'Play my own deck instead',
    inARow: 'in a row',
    handOf: (i: number, n: number) => `hand ${i}/${n}`,
    vs: (time: string) => `vs ${time}`,
    unmuteSounds: 'Unmute sounds',
    muteSounds: 'Mute sounds',
    notDeadEnd: 'Not 24. Undo or reset.',
    nudgeNote: (seconds: number, penalty: number) =>
      `${seconds}s on this hand. There is an answer, or take the +${penalty}s and see it.`,
    undo: 'Undo',
    reset: 'Reset',
    startOver: 'Start over',
    sure: 'Sure?',
    giveUp: (penalty: number) => `Give up +${penalty}s`,
    answerPaused: 'Answer · clock paused, take your time',
    nextHand: 'Next hand',
    gaveUp: (n: number) => `${n} gave up`,
    cardsLeftOver: (n: number) => `${n} cards left over`,
    best: (time: string) => `best ${time}`,
    yourChallengeLink: 'Your challenge link',
    copied: 'Copied',
    copy: 'Copy',
    sendItYourself: (hands: number, time: string) =>
      `Send it to someone yourself, in a message or an email. Whoever opens it plays the exact same ${hands} hands, in the same order, racing your ${time}. When they finish they see who won, and they get a link back to you with both times in it.`,
    replayDeck: 'Replay deck',
    newDeck: 'New deck',
    yourRecord: 'Your record →',
    yourRecordTitle: 'Your record',
    nothingHereYet: 'Nothing here yet. Finish a deck and your times show up on this screen.',
    notPlayedYet: 'not played yet',
    runsClean: (runs: number, clean: number, lastAt: string | null) =>
      `${runs} ${runs === 1 ? 'run' : 'runs'} · ${clean} without giving up${
        lastAt ? ` · last ${lastAt}` : ''
      }`,
    headToHead: (wins: number, losses: number, ties: number) =>
      `Head to head against people who sent you a deck: ${wins}W ${losses}L ${ties}T.`,
    recentRuns: 'Recent runs',
    keptInBrowser:
      'Kept in this browser only. Nothing is uploaded, so a different device or a cleared browser starts from zero.',
    back: 'Back',
    perHand: 'Per hand',
    redBarsGaveUp: (penalty: number) => `Red bars are hands you gave up. The +${penalty}s penalty is included.`,
    levelLabel: { easy: 'Easy · A–9', hard: 'Hard · A–K' } as Record<'easy' | 'hard', string>,
    levelWord: { easy: 'easy', hard: 'hard' } as Record<'easy' | 'hard', string>,
    faster: (delta: string, name: string) => `${delta}s faster than ${name} on this hand`,
    firstOneDown: 'first one down',
    fastestHandYet: 'fastest hand yet',
    underAverage: 'under your average',
    thatIsWholeGame: 'That is the whole game',
    howToPlayTitle: 'How to play',
    skipIKnowHow: 'Skip, I know how',
    tutorialIntro:
      'Four cards, each used exactly once, with + − × ÷ to make 24. Here is one worked through.',
    tutorialDone:
      'A real deck is nine or thirteen hands of that, against the clock. Undo and Reset cost nothing. Give up costs two minutes and shows you an answer, and every hand has one.',
    backToStart: 'Back to the start',
    stepOf: (i: number, n: number) => `step ${i} of ${n}`,
    tutorialStep1: (
      <>
        Drag the <strong>8</strong> onto the <strong>4</strong>, then let go on <strong>−</strong>.
      </>
    ),
    tutorialStep2: (
      <>
        The two cards became one. That <strong>4</strong> is a card now: drag it onto the{' '}
        <strong>2</strong> and let go on <strong>×</strong>.
      </>
    ),
    tutorialStep3: (
      <>
        Last one. Drag the <strong>8</strong> onto the <strong>3</strong> and let go on{' '}
        <strong>×</strong>.
      </>
    ),
    noSolution: 'No solution exists.',
    langToggle: '中文',
  },
  zh: {
    tagline: '四张牌，一个目标',
    howtoIntro: '四张牌，每张恰好用一次，配合 + − × ÷ 凑出 24。尽快清空这副牌。',
    howtoDrag:
      '将一张牌拖到另一张牌上，会出现一个 + − × ÷ 的选择轮，松手选择你要的运算。两张牌合并成一张新牌，结果即为新牌的点数。被拖动的牌在左边，所以 7 拖到 3 上就是 7 − 3。',
    howtoFree: (penalty: number) => `撤销和重置都是免费的。放弃需要 +${penalty}秒 并会显示答案：每一手牌都有解。`,
    namePlaceholder: '你的名字',
    playEasy: '简单 · A–9 · 9手牌',
    playHard: '困难 · A–K · 13手牌',
    howToPlay: '玩法说明',
    challengedYou: (name: string) => `${name} 向你发起了挑战`,
    hands: '手牌',
    deck: '牌局',
    timeToBeat: '目标时间',
    leads: '领先',
    havePlayed: (n: number) => `已有 ${n} 人玩过这副牌，按用时从快到慢排列`,
    sentYouThis: '发给你的',
    start: '开始',
    playOwnDeck: '改玩我自己的牌局',
    inARow: '连续',
    handOf: (i: number, n: number) => `第 ${i}/${n} 手`,
    vs: (time: string) => `对手 ${time}`,
    unmuteSounds: '取消静音',
    muteSounds: '静音',
    notDeadEnd: '不是24。撤销或重置。',
    nudgeNote: (seconds: number, penalty: number) =>
      `这手牌已用时 ${seconds}秒。有解，或者花 +${penalty}秒 看答案。`,
    undo: '撤销',
    reset: '重置',
    startOver: '重新开始',
    sure: '确定？',
    giveUp: (penalty: number) => `放弃 +${penalty}秒`,
    answerPaused: '答案 · 计时已暂停，慢慢看',
    nextHand: '下一手',
    gaveUp: (n: number) => `${n} 次放弃`,
    cardsLeftOver: (n: number) => `剩 ${n} 张牌`,
    best: (time: string) => `最佳 ${time}`,
    yourChallengeLink: '你的挑战链接',
    copied: '已复制',
    copy: '复制',
    sendItYourself: (hands: number, time: string) =>
      `请复制链接，用短信、即时消息或邮件发给朋友，挑战你的 ${time} 成绩。链接里是完全相同的 ${hands} 手牌，顺序也一样。如果你好奇他们的结果，请他们把比赛结束后的新链接发回给你，里面会带上两人的用时。`,
    replayDeck: '重玩这副牌',
    newDeck: '新的牌局',
    yourRecord: '你的记录 →',
    yourRecordTitle: '你的记录',
    nothingHereYet: '这里还没有记录。完成一副牌后，你的用时会显示在这个页面。',
    notPlayedYet: '尚未玩过',
    runsClean: (runs: number, clean: number, lastAt: string | null) =>
      `${runs} 局 · ${clean} 局未放弃${lastAt ? ` · 最近一次 ${lastAt}` : ''}`,
    headToHead: (wins: number, losses: number, ties: number) =>
      `与向你发起挑战的人的对战记录：${wins}胜 ${losses}负 ${ties}平。`,
    recentRuns: '最近的对局',
    keptInBrowser: '仅保存在此浏览器中。不会上传到任何地方，换设备或清除浏览器数据都会归零。',
    back: '返回',
    perHand: '每手用时',
    redBarsGaveUp: (penalty: number) => `红色的是你放弃的那几手牌，已包含 +${penalty}秒 的罚时。`,
    levelLabel: { easy: '简单 · A–9', hard: '困难 · A–K' } as Record<'easy' | 'hard', string>,
    levelWord: { easy: '简单', hard: '困难' } as Record<'easy' | 'hard', string>,
    faster: (delta: string, name: string) => `比 ${name} 这手牌快 ${delta}秒`,
    firstOneDown: '第一手告捷',
    fastestHandYet: '目前最快的一手',
    underAverage: '快于你的平均水平',
    thatIsWholeGame: '这就是整个玩法',
    howToPlayTitle: '玩法说明',
    skipIKnowHow: '跳过，我会了',
    tutorialIntro: '四张牌，每张恰好用一次，配合 + − × ÷ 凑出 24。下面演示一遍完整过程。',
    tutorialDone:
      '正式的一副牌是九手或十三手这样的题目，并计时。撤销和重置不花时间。放弃要花两分钟并显示答案，每一手牌都有解。',
    backToStart: '返回开始页',
    stepOf: (i: number, n: number) => `第 ${i} 步 / 共 ${n} 步`,
    tutorialStep1: (
      <>
        把 <strong>8</strong> 拖到 <strong>4</strong> 上，然后松手选择 <strong>−</strong>。
      </>
    ),
    tutorialStep2: (
      <>
        两张牌合并成了一张。这张 <strong>4</strong> 现在是一张牌了：把它拖到 <strong>2</strong> 上，
        松手选择 <strong>×</strong>。
      </>
    ),
    tutorialStep3: (
      <>
        最后一步。把 <strong>8</strong> 拖到 <strong>3</strong> 上，然后松手选择 <strong>×</strong>。
      </>
    ),
    noSolution: '无解。',
    langToggle: 'English',
  },
};

const LangContext = createContext<{ lang: Lang; t: Dict; toggle: () => void }>({
  lang: 'en',
  t: dict.en,
  toggle: () => {},
});

/** Keeps `?language=` in sync with the current choice, without discarding
    any other query params or the challenge fragment. */
function writeLangToUrl(lang: Lang) {
  const url = new URL(window.location.href);
  if (lang === 'zh') url.searchParams.set('language', 'chinese');
  else url.searchParams.delete('language');
  window.history.replaceState(window.history.state, '', url);
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(detectInitialLang);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang);
    writeLangToUrl(lang);
  }, [lang]);

  const value = useMemo(
    () => ({
      lang,
      t: dict[lang],
      toggle: () => setLang((l) => (l === 'en' ? 'zh' : 'en')),
    }),
    [lang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}
