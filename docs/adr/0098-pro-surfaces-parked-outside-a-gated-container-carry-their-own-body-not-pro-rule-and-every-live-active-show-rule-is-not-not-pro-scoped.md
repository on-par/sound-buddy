# Pro surfaces parked outside a gated container carry their own body.not-pro rule, and every live-active show-rule is :not(.not-pro)-scoped

- Status: Accepted
- Date: 2026-08-28

## Context

Sound Buddy's licence gate has exactly one hook: LicenseChrome.tsx toggles
`body.not-pro` and every Pro surface keys off it in CSS (no component does
its own licence check — SettingsPanel.test.ts and RecordButton.test.ts
assert that). The gate is written as a direct-child selector rooted at the
gated container: `body.not-pro #tab-live > :not(.pro-gate)` and
`body.not-pro #settings-pane-audio > :not(.pro-gate)`.

That shape has now leaked twice. #727 relocated Live into #spectrum-panel
and the Audio settings pane needed its own entry; #729 added
#record-button-island in #header-right, outside both containers, and
needed a third. #1245 is the third instance and the most damaging: since
#727 the whole DAW workspace lives in #live-island inside #spectrum-body,
outside #tab-live, and app.css force-showed it with
`body.live-active #live-island { display:flex !important; }` — so a
free-tier user clicking the Session tab saw the entire arrangement view
beside the lock card. Two `!important` rules of equal specificity would
have resolved on source order, meaning the naive gate rule would have
been silently dead.

Islands are a growing pattern (16 in root-markup.html today) and the
Session surfaces are deliberately parked outside their tab. Relying on a
future author to remember the third rule has already failed three times,
so the invariant needs to be machine-checked rather than documented.

## Decision

Every Pro-only surface that lives outside `#tab-live` and
`#settings-pane-audio` gets its own explicit
`body.not-pro #<id> { display:none !important; }` entry in the licence
gate block of app/renderer/src/styles/app.css — the block that already
holds the `#record-button-island` rule — rather than a new gated
container or a component-level licence check.

Any rule that force-shows such a surface must be scoped so it cannot
match a free-tier body: `body.live-active #live-island` becomes
`body.live-active:not(.not-pro) #live-island`. Gate and show-rule are
made mutually exclusive rather than left to compete on `!important`
specificity and source order.

app/renderer/src/pro-gate.test.ts enforces both halves. It fails when a
`*-island` mount point outside `#tab-live` has neither a `body.not-pro`
rule nor a conscious entry on the file's FREE_TIER_ISLANDS allowlist, and
when a `body.live-active` rule shows an element whose id has no
`body.not-pro` hide rule.

## Consequences

Positive: the paywall bypass is closed for the Session workspace and the
EQ pane; the gate no longer depends on where in app.css a rule happens to
sit; the next island parked outside a gated container is caught by CI
instead of by a customer; the "one gating hook in CSS" architecture is
preserved intact, with no licence state leaking into React components.

Negative: adding a genuinely free-tier island now requires editing an
allowlist in a test file, which will read as friction to an author who
does not know why it exists (the allowlist carries a comment pointing
here). Scoping show-rules with `:not(.not-pro)` also makes those
selectors slightly harder to read, and the invariant is enforced by
source-text assertions over app.css rather than by a real cascade
engine — a rule expressed with different whitespace or selector order
could slip past the guards. Accepted, because the whole repo's gate tests
already use source-text assertions and a cascade-evaluating harness is
not available here.

## References

- [Issue #1245 — fix(renderer): Pro gate leaks the Session workspace to free-tier users](https://github.com/on-par/sound-buddy/issues/1245)
- [#727 — Live relocated into #spectrum-panel (the deliberate container exception)](https://github.com/on-par/sound-buddy/issues/727)
- [#729 — #record-button-island needed its own body.not-pro rule (same bug class)](https://github.com/on-par/sound-buddy/issues/729)
