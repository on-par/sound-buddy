# GitHub issues token provisioning (#929): `GITHUB_ISSUES_TOKEN`

The human-provisioning steps for the fine-grained GitHub PAT the in-app
feedback flow (epic #927) uses to file issues on `on-par/sound-buddy`. Steps
2–4 below need a human with `on-par` org access and Cloudflare account access
(Patrick or repo-owner) — a build agent cannot do them. The `Env` field
(`GITHUB_ISSUES_TOKEN: string` in `worker/src/index.ts`) ships independently
of secret activation; the follow-on feedback story reads it once both are done.

## 1. Why

The ingest Worker needs to create GitHub issues on `on-par/sound-buddy` when a
user submits in-app feedback. The credential must be able to do exactly that —
file issues on one repo — and nothing else.

## 2. Generate the PAT

1. GitHub → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Resource owner**: the `on-par` org.
3. **Repository access**: **Only select repositories** → `on-par/sound-buddy`
   (one repo, no more).
4. **Repository permissions**: **Issues: Read and write** — leave every other
   permission at *No access*.
5. Set an expiry and note it somewhere durable (a calendar reminder). Rotation
   alerting is out of scope for this issue, so an expired token fails silently
   until someone notices.

## 3. Store it

```bash
cd worker
npx wrangler secret put GITHUB_ISSUES_TOKEN
```

Paste the token value at the prompt. Never paste it into a file, a commit, a
PR body, a chat log, or a shell command that lands in shell history.

## 4. Verify

```bash
npx wrangler secret list
```

Confirm `GITHUB_ISSUES_TOKEN` appears (secret names only — values are never
readable back once stored).

## 5. Rotation

When the PAT expires or is compromised:

1. Revoke the old token on GitHub (Settings → Developer settings →
   Fine-grained tokens).
2. Generate a replacement with the identical scope (§2).
3. Re-run `wrangler secret put GITHUB_ISSUES_TOKEN` (§3).

Failure symptom: feedback issue creation starts failing with a 401 or 403 from
the GitHub API.

## Checklist

- [ ] Fine-grained PAT generated, scoped to `on-par/sound-buddy` only, `Issues: Read and write` only, all other permissions `No access` (§2)
- [ ] Expiry noted somewhere durable (§2)
- [ ] `GITHUB_ISSUES_TOKEN` set via `wrangler secret put` (§3)
- [ ] `wrangler secret list` shows `GITHUB_ISSUES_TOKEN` (§4)
