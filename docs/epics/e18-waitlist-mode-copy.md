# e18 waitlist-mode: approved copy

Canonical source for the copy referenced as "verbatim from the epic" in
[#598](https://github.com/on-par/sound-buddy/issues/598) (e18-02, waitlist-mode homepage
template). The e18 issues previously pointed at an epic doc that did not exist in the repo,
which blocked the build. This file is that source.

Voice reference: `site/src/pages/index.astro` (hero, trust bar) and `site/src/lib/faq.ts`.

> **Pricing is not final.** Nothing on the waitlist page quotes a price, names a tier cost,
> or promises a Founding price or a seat cap. The page converts to an email list only.
> When pricing is locked, update this file first, then the FAQ entry and the form success
> state together.

## Hero

**Eyebrow**

> For church FOH volunteers & worship engineers

**Headline**

> A clear answer from last Sunday's mix. Coming soon.

**Subhead**

> Sound Buddy grades the recording you already have and names what to fix before next Sunday, fully on your own machine. It isn't open to the public yet, so join the waitlist and we'll email you when early access opens.

## Waitlist form states

**Success**

> You're on the list. We'll email you the moment early access opens.

**Error**

> That didn't go through. Try again, or email support@soundbuddy.online.

## Mini FAQ

Exactly three entries in waitlist mode: `cost`, `privacy`, `launch-timing`. The `privacy`
entry is reused unchanged from `site/src/lib/faq.ts`; the other two are new and belong in
`faq.ts` so they stay greppable alongside the existing FAQ invariant checks.

The `cost` entry deliberately quotes no numbers. Pricing is still being worked out, and a
public page is the wrong place to commit to one.

```ts
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
{
  id: 'privacy',
  question: "Is my church's audio really private?",
  answer: [
    'Yes. Sound Buddy analyzes your recordings on your own Mac. There is no cloud upload step, no account to create, and nothing that tracks you across the web — the analysis engine, the report card, and virtual soundcheck all run locally.',
    'Browser Lite is local-only too: audio is decoded and graded inside your browser tab, not on a server. If you unplug the network mid-analysis, nothing breaks.',
  ],
  link: { href: '/privacy', label: 'Read the full Privacy Policy →' },
},
```

## Trust bar

Reused verbatim from the existing site, unchanged: no cloud/accounts/tracking, works with
the AI you already have, built by live-sound engineers.

## Notes

- Nothing is for sale in waitlist mode. The page converts to an email list and does not
  present a checkout path.
- No price, tier cost, Founding price, or seat cap appears anywhere on the page while
  pricing is unsettled.
- The `privacy` entry retains its original punctuation because #598 requires it verbatim.
