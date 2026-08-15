# DMARC provisioning runbook (#643): monitoring-only policy for soundbuddy.online

The human-provisioning steps for publishing the DMARC record for
`soundbuddy.online` (#643) — the exact TXT record to add, the Cloudflare zone
to add it in, the dig-based verification, the alignment confirmation for the
three legitimate mail flows (Resend transactional, Resend broadcasts, #638
forwarding), and the staged path to `p=quarantine` / `p=reject`. The record
itself lives in the `soundbuddy.online` DNS zone and cannot be written from
this repo; this runbook is the single source of truth for the remaining
out-of-band steps of #643. Each section maps to a line in the final checklist.

> **No code changes ship with #643.** Nothing in `worker/src/`,
> `worker/wrangler.jsonc`, or the sending pipeline changes — DKIM and SPF
> already pass and must not be touched. Every acceptance criterion is satisfied
> by published DNS state (a human step) plus this documentation.

## 0. Status / what this change ships

`_dmarc.soundbuddy.online` currently has **no DMARC record**. DKIM and SPF are
configured and passing (Resend's `send.soundbuddy.online` SPF include +
`resend._domainkey` DKIM selector, per `waitlist-email-provisioning.md` §2),
but with no published DMARC policy receiving servers have no instruction for
mail that claims to come from soundbuddy.online and fails those checks — so
`support@soundbuddy.online` is spoofable, and Gmail/Yahoo treat a missing
record as a deliverability drag. This change publishes a **monitoring-only
`p=none`** policy so receivers start DMARC's alignment accounting without
rejecting or quarantining anything during observation.

Everything the code needs is already shipped and tested (`sendLicenseEmail` /
`sendDunningEmail` / `sendWaitlistConfirmationEmail` from
`hello@soundbuddy.online`, plus Resend Audience broadcasts via
`syncWaitlistContact` and the #638 inbound routing for `support@` / `hello@`);
this runbook is the single source of truth for the one remaining step — the
DNS publish — and the human verification gates that follow it.

## 1. The record

Publish one TXT record in the **Cloudflare DNS zone that already hosts
`soundbuddy.online`** (the zone carrying the SPF and `resend._domainkey` DKIM
records from #609 and the site/worker routes):

```text
Name:   _dmarc.soundbuddy.online
Type:   TXT
Value:  "v=DMARC1; p=none; rua=mailto:reports@soundbuddy.online"
TTL:    zone default (e.g. 300)
```

- Copy the value **verbatim** — the whole policy is one quoted string, well
  under the 255-char TXT limit, so there are no split-string pitfalls.
- Add **exactly one** `_dmarc` TXT record. Do not add a second one; a
  duplicate `_dmarc` TXT is undefined behavior for DMARC receivers.
- `p=none` is the correct starting policy: it instructs receivers to **report
  only** (via `rua`) and never reject or quarantine, so nothing legitimate is
  at risk while alignment is confirmed (§4).

## 2. Reports address

The issue template's `rua=mailto:<reports@…>` is a placeholder. This runbook
pins the aggregate-report address to **`reports@soundbuddy.online`**:

1. Create `reports@soundbuddy.online` as a mailbox/alias via the same #638
   inbound-routing mechanism that already delivers `support@` and `hello@` to
   monitored inboxes.
2. Before relying on aggregate reports, verify the address accepts mail: send
   a test message to it and confirm it lands in the monitored inbox.
3. Fallback if no alias is created: reuse `support@soundbuddy.online` (the
   monitored inbox per `waitlist-email-provisioning.md` §3) as the `rua`
   target, and update the published record accordingly.

## 3. Verify the published record

After the record is added (issue Verification #1):

```bash
dig +short TXT _dmarc.soundbuddy.online                # expect "v=DMARC1; p=none; rua=mailto:..."
dig +short TXT soundbuddy.online                       # SPF include send.soundbuddy.online (unchanged)
dig +short TXT resend._domainkey.soundbuddy.online     # DKIM selector (unchanged)
```

- The first command must return the `v=DMARC1` policy with `p=none` and the
  `rua` address you chose — that output is the proof the record is published
  and parses.
- The SPF and DKIM dig output must be **unchanged** — publishing DMARC never
  alters them.
- Optionally confirm the record parses as valid with a third-party DMARC
  checker (MXToolbox / dmarcian).

## 4. Confirm legitimate mail still aligns

Because the policy is `p=none`, nothing is rejected during observation — this
is the safe window (issue Verification #2). Confirm each legitimate flow still
passes DMARC alignment before any escalation (§5):

- **Resend transactional mail**: send one through an existing worker flow — a
  sandbox purchase's license email, or the waitlist confirmation via
  `POST /api/waitlist` (see `waitlist-email-provisioning.md` §6) — and inspect
  the raw headers in an external mailbox for `spf=pass`, `dkim=pass`,
  `dmarc=pass`.
- **Resend broadcasts**: send a test broadcast to the Audience (the
  `syncWaitlistContact` upsert in `worker/src/delivery.ts`), same header
  check.
- **#638 forwarding**: reply to / forward from `support@` / `hello@` and
  confirm the forwarded copy also passes — forwarding can break SPF, which is
  exactly why the policy starts at `p=none`.

If any legitimate send misaligns, fix it **before** any escalation — this is
the gate for §5.

## 5. Staged path to `p=quarantine` → `p=reject`

DMARC hardening is a ladder, never a one-shot jump (AC #4, follow-up work):

1. Observe aggregate reports at the `rua` address for a floor of **≥ 30 days
   AND ≥ 1,000 aligned messages** with **zero legitimate-mail failures**
   (RFC 7489's 100k-message guidance is a heavy bar at this volume).
2. File a follow-up issue to tighten the record to `p=quarantine`, re-run §3
   and §4, then edit the record.
3. Re-observe the same floor, then file another follow-up issue for `p=reject`,
   re-run §3 and §4, then edit the record.

Each escalation is its own issue + record edit; never tighten without fresh
report data showing the previous step clean.

## 6. What does not change

- **DKIM and SPF records untouched** — both already pass (§3 proves they stay
  byte-identical).
- **Sending infrastructure untouched** — `worker/src/delivery.ts` and
  `worker/wrangler.jsonc` are not edited by #643 (the issue's out-of-scope
  bullets).
- **No DNS change performed by this repo** — the record is added out-of-band
  in the Cloudflare zone, the same H4/H5 pattern every other provisioning step
  in this repo follows.

## 7. No-secret-in-repo scan

N/A — a DNS record contains no secrets. The record string may appear only in
this runbook and never in code.

## Checklist

Every line maps to an #643 acceptance criterion or in-scope bullet; the section
in parens is where to do it.

- [ ] `_dmarc.soundbuddy.online` TXT record published in the Cloudflare zone, exactly one: `"v=DMARC1; p=none; rua=mailto:reports@soundbuddy.online"` (§1)
- [ ] `reports@soundbuddy.online` accepts mail; fallback to `support@` chosen + record updated if no alias created (§2)
- [ ] `dig +short TXT _dmarc.soundbuddy.online` returns `v=DMARC1` with `p=none` + `rua`; SPF/DKIM dig output unchanged (§3)
- [ ] Transactional send via the worker flow shows `spf=pass` / `dkim=pass` / `dmarc=pass` in raw headers (§4)
- [ ] Broadcast send to the Audience shows aligned headers; #638 forwarded mail passes too (§4)
- [ ] Escalation floor followed: ≥ 30 days AND ≥ 1,000 aligned messages with zero legitimate-mail failures before `p=quarantine` → `p=reject` (§5)
- [ ] DKIM / SPF / sending infrastructure untouched; no code or DNS change performed by the repo itself (§6)
- [ ] No-secret-in-repo scan: N/A — DNS record string only in this runbook (§7)
