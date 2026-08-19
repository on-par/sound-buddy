# Stored-scene inventory reads metadata only, and the no-recall boundary is enforced by the read-only guard plus one canonical notice string

- Status: Accepted
- Date: 2026-08-19

## Context

`/node` on the M32R answers `/-show/showfile/scene/NNN` with a single
plain-text line carrying a scene's name, note, safes mask and occupied
flag. It never answers with the scene's parameter contents — those are
simply not reachable over the read-only OSC surface. That makes an
inventory ("what is saved on this desk") genuinely useful and, at the same
time, a place where a user can reasonably expect two things Sound Buddy
must never offer: reading a stored scene's settings, and recalling a scene
from the app. Recall (`/-action/goscene`) is a write and the sharpest edge
in the whole surface — a mis-click during a service changes the live mix.
The repo already refuses writes at one chokepoint (ADR-0060: the guard
lives inside encodeOscMessage, not in callers) and already gates every
socket on Tier 2 consent (ADR-0006 / ADR-0013). What was missing was a
decision about the *product* boundary of the inventory feature itself, and
about where the user-facing statement of that boundary lives, since the
inventory UI (C1b) is built later by different work than the parser.

## Decision

The stored-scene inventory is metadata-only and recall-free, permanently.
packages/console/src/scene-inventory.ts exports the slot path table, the
StoredSceneEntry shape, the line parser and one canonical copy constant,
SCENE_CONTENTS_UNREADABLE_NOTICE, which every inventory UI renders
verbatim; neither this module nor
app/electron/ipc/console-scene-inventory.ts exports any symbol that builds
a recall, save, store or scene-rename message, and none ever will. The
"no recall path" guarantee is not left to UI discipline: it rests on the
encodeOscMessage read-only guard, whose deny list already covers
`/-action`, `/scene`, `/snapshot` and `/cue`, and a test in
scene-inventory.test.ts asserts that `/-action/goscene` and
`/-action/gosnippet` are refused. Scene contents are never fetched, cached
or inferred; a slot's parameter data does not exist in the app's model.
The inventory walk is all-or-nothing — a slot that does not answer fails
the whole fetch with an actionable error rather than yielding a silently
short list that reads as a smaller show file than the desk actually holds.

## Consequences

Positive: the sharpest write in the surface stays unreachable by
construction rather than by convention, and it fails at the encoder even
if a future UI tries to call it. The boundary copy has one home, so the
C1b UI cannot ship a softer or absent version of it, and the statement
travels with the parser that makes the limitation true. Scene names are the
only console-sourced personal data the inventory touches, and holding no
contents keeps the privacy story small (display-local; persistence follows
C1b's rules). Negative: users who want "load this scene from the app" are
told no, and adding it later is deliberately expensive — it would need this
ADR superseded, the guard's deny list changed, and a consent story of its
own. Keeping UI copy in an MIT package next to the parser is a mild layering
oddity, accepted so the constant cannot drift away from the constraint it
describes. All-or-nothing fetching means one lost UDP reply costs a retry of
the whole 100-slot walk (~a second at the measured 350ms/3-retry, ~250 q/s
baseline), which is cheap enough to prefer over an inventory that lies.

## References

- [Issue #890 — feat: Stored-scene inventory (metadata only)](https://github.com/on-par/sound-buddy/issues/890)
- [ADR-0060 — the read-only guardrail is enforced inside encodeOscMessage itself, not by callers](docs/adr/0060-read-only-guardrail-is-enforced-inside-encodeoscmessage-itself-not-by-callers.md)
- [ADR-0071 — scene capture refuses to write a partial .scn](docs/adr/0071-scene-capture-emits-a-generated-fixture-pinned-node-path-table-and-refuses-to-write-a-partial-scn.md)
