// Single source of truth for the FAQ / objection-handling section (#558).
// Copy lives here, not in index.astro, so it can't drift from the guarantee
// constants and stays testable/greppable.
import { GUARANTEE_WINDOW_DAYS, REFUND_PATH } from './guarantee';
import { FREE_MONTHLY_UPLOADS } from './packaging-copy';

export interface FaqEntry {
  /** Stable slug, used as the disclosure's DOM id so answers are deep-linkable. */
  id: string;
  /** The buyer's question, phrased the way they'd ask it. */
  question: string;
  /**
   * Answer paragraphs. Rendered as one <p> each. Plain text only — no HTML —
   * so the copy stays greppable by the invariant checks.
   */
  answer: string[];
  /** Optional inline link rendered after the answer. */
  link?: { href: string; label: string };
}

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'privacy',
    question: 'Where does my audio get analyzed?',
    answer: [
      'On Pro, on your Mac. The desktop app analyzes your recordings and live input on your own machine — the analysis engine, the report card, and EQ all run locally.',
      `Free runs in your browser: you sign in with your email and upload a recording (up to ${FREE_MONTHLY_UPLOADS} a month), and it is analyzed on our server.`,
    ],
    link: { href: '/privacy', label: 'Read the full Privacy Policy →' },
  },
  // Slug kept stable — `#faq-unsigned-install` is a published deep-link anchor (#558).
  // The shipped build is Developer ID-signed and notarized as of #1234; the wording,
  // not the id, is what changed.
  {
    id: 'unsigned-install',
    question: 'Is the app signed by Apple?',
    answer: [
      'Yes. Sound Buddy is signed with an Apple Developer ID and notarized by Apple, so it opens like any other Mac app — unzip it, drag it to /Applications, and double-click. There is no security override to click through and nothing to approve in System Settings.',
      'The notarization ticket is stapled to the app itself, so macOS can verify it even when your Mac is offline. Every build ships from our public GitHub releases.',
    ],
    link: { href: '#install-walkthrough', label: 'See the step-by-step walkthrough →' },
  },
  {
    id: 'ai',
    question: 'What does "bring Ollama or an API key" actually mean?',
    answer: [
      'The AI narrative — the plain-English write-up of your report card — is optional and runs on AI you supply. Install Ollama and Sound Buddy talks to it on localhost, entirely offline. Or paste your own API key from a provider you already pay for.',
      'Sound Buddy never proxies AI requests and never bills you for inference. Every number on the report card — grades, loudness, spectral balance, speech intelligibility — is computed without any AI at all, so the app is fully useful with the AI panel switched off.',
    ],
  },
  {
    id: 'refund',
    question: "What if it doesn't work for our room?",
    answer: [
      `Every paid plan is covered by a ${GUARANTEE_WINDOW_DAYS}-day money-back guarantee, no questions asked. Email support and we refund it — you don't have to justify the decision.`,
    ],
    link: { href: REFUND_PATH, label: 'Read the Refund Policy →' },
  },
  {
    id: 'requirements',
    question: 'What do I need to run it?',
    answer: [
      'An Apple Silicon Mac (M1 or newer) on macOS 26 (Tahoe) or newer, and roughly 5 GB of disk for the app plus room for your recordings.',
      "For multitrack capture, any Core Audio interface up to 32 inputs works. For a first look you don't need an interface at all — a stream recording or a USB export from the console is enough.",
    ],
  },
  {
    id: 'offline',
    question: 'Do I need an account or an internet connection?',
    answer: [
      `Free runs in your browser and needs a free account — sign in with your email and a one-time code. Pro runs on your Mac: a paid license key is checked offline and never expires, and once the app is downloaded you can analyze a whole Sunday on a disconnected machine.`,
    ],
  },
  {
    id: 'free-tier',
    question: 'What does the free tier actually include?',
    answer: [
      `Free runs in your browser. Create a free account with your email, then upload up to ${FREE_MONTHLY_UPLOADS} recordings a month for a full report card and letter grade — nothing to install.`,
      'Pro is the Mac app: live listening right at the desk, customizable EQ curves, channel select, 32-channel capture with per-strip stems, the AI analyst, and priority support.',
    ],
  },
  {
    id: 'trial',
    question: 'How do I try Pro?',
    answer: [
      "Every download starts a 14-day Pro trial on first launch — no card needed. When it ends the app never locks you out, and your existing recordings and report cards stay exactly where they are.",
    ],
    link: { href: '#pricing', label: 'See pricing →' },
  },
];

/** The three objections #558 names as the ones a church buyer leads with. */
export const CORE_OBJECTION_IDS = ['privacy', 'unsigned-install', 'ai'] as const;

// Two entries answerable before public launch (#598), kept out of FAQ_ENTRIES because
// their copy ("pricing not announced yet", "not publicly available yet") would
// contradict the live-mode pricing section, which renders FAQ_ENTRIES unfiltered and
// is guarded by scripts/lib/faq-invariants.mjs's EXPECTED_FAQ_COUNT.
const WAITLIST_ONLY_FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'cost',
    question: 'What will it cost?',
    answer: [
      "We're still working out pricing, so there's nothing to quote yet. Sound Buddy will have a paid tier when it launches, and we'd rather tell you the real number once than guess at it now.",
      'Joining the waitlist costs nothing and commits you to nothing. When pricing is set, the list hears it first.',
    ],
  },
  {
    id: 'launch-timing',
    question: 'When can I actually use it?',
    answer: [
      "We're still in the build. Sound Buddy isn't publicly available yet, and we'd rather ship it right than ship it early to a room full of volunteers on a Sunday morning.",
      'The waitlist hears first. Everyone on the list gets early access before public launch, and one email when it opens. No drip sequence, no newsletter.',
    ],
  },
];

/** The three pre-launch-answerable entries the waitlist mini-FAQ shows (#598), in
 *  display order. */
export const WAITLIST_FAQ_IDS = ['cost', 'privacy', 'launch-timing'] as const;

/** Resolved waitlist mini-FAQ entries, in WAITLIST_FAQ_IDS order. Throws at import
 *  time if an id doesn't resolve — a fast, loud signal instead of a silently
 *  short mini-FAQ. */
export const WAITLIST_FAQ_ENTRIES: FaqEntry[] = WAITLIST_FAQ_IDS.map((id) => {
  const entry = [...FAQ_ENTRIES, ...WAITLIST_ONLY_FAQ_ENTRIES].find((e) => e.id === id);
  if (!entry) throw new Error(`WAITLIST_FAQ_IDS references unknown FAQ id: ${id}`);
  return entry;
});
