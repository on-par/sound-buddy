// Single source of truth for the FAQ / objection-handling section (#558).
// Copy lives here, not in index.astro, so it can't drift from the guarantee
// constants and stays testable/greppable.
import { GUARANTEE_WINDOW_DAYS, REFUND_PATH } from './guarantee';

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
    question: "Is my church's audio really private?",
    answer: [
      'Yes. Sound Buddy analyzes your recordings on your own Mac. There is no cloud upload step, no account to create, and nothing that tracks you across the web — the analysis engine, the report card, and virtual soundcheck all run locally.',
      'Browser Lite is local-only too: audio is decoded and graded inside your browser tab, not on a server. If you unplug the network mid-analysis, nothing breaks.',
    ],
    link: { href: '/privacy', label: 'Read the full Privacy Policy →' },
  },
  {
    id: 'unsigned-install',
    question: "The app isn't signed by Apple. Is it safe to install?",
    answer: [
      'Sound Buddy is currently distributed unsigned, so macOS Gatekeeper blocks the first launch with "Apple could not verify Sound Buddy." That\'s a notarization gap, not a virus warning — every build ships from our public GitHub releases.',
      'To open it: unzip, drag Sound Buddy.app to /Applications, then go to System Settings → Privacy & Security, scroll to Security, and click Open Anyway next to the Sound Buddy message. You only do this once.',
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
      "No account, ever. There's no sign-up, no login, and no license server phoning home — a paid license key is checked offline and never expires. Once the app is downloaded you can run a whole Sunday's analysis on a disconnected machine.",
    ],
  },
  {
    id: 'free-tier',
    question: 'What does the free tier actually include?',
    answer: [
      'Free is a real tier, not a crippled demo: up to 8 channels of capture, the complete report card with its letter grade, full spectral and dynamics analysis, and virtual soundcheck playback. No time limit and no recording cap.',
      'Pro adds 32-channel capture, per-strip stems and session manifests, the AI analyst, channel groups, rigs and profiles, and priority support.',
    ],
  },
  {
    id: 'trial',
    question: 'How do I try Pro?',
    answer: [
      "Every download starts a 14-day Pro trial on first launch — no card and no account. When it ends the app drops to the Free tier rather than locking you out, and your existing recordings and report cards stay exactly where they are.",
    ],
    link: { href: '#pricing', label: 'See pricing →' },
  },
];

/** The three objections #558 names as the ones a church buyer leads with. */
export const CORE_OBJECTION_IDS = ['privacy', 'unsigned-install', 'ai'] as const;
