export interface BuildReleaseNotesOptions {
  version: string
  signed: boolean
  highlights?: string
}

export const INSTALL_INTRO =
  'Self-contained macOS build (Apple Silicon) — bundles the audio toolchain\n' +
  '(sox, ffmpeg/ffprobe) and a Python runtime, so there is no setup.'

// macOS 26 (Tahoe+) removed the old right-click → Open Gatekeeper bypass; this
// is the real flow, kept as the single source of truth for the generated
// release notes (README.md and the site walkthrough hand-copy this wording —
// keep them in sync manually since neither depends on this package).
export const UNSIGNED_STEPS =
  '2. First launch is blocked by Gatekeeper ("Apple could not verify Sound Buddy").\n' +
  '   Open **System Settings → Privacy & Security**, scroll to the **Security** section,\n' +
  '   and click **Open Anyway** next to the Sound Buddy message.\n' +
  '3. Confirm **Open Anyway** and authenticate.\n' +
  '   Power-user alternative: `xattr -dr com.apple.quarantine "/Applications/Sound Buddy.app"`'

export function buildReleaseNotes({ version, signed, highlights }: BuildReleaseNotesOptions): string {
  const zipName = `Sound.Buddy-${version}-arm64-mac.zip`
  const installSteps = signed
    ? `1. Download \`${zipName}\` below, unzip, drag **Sound Buddy.app** to **/Applications**, and launch it.`
    : `1. Download \`${zipName}\` below, unzip, drag **Sound Buddy.app** to **/Applications**.\n${UNSIGNED_STEPS}`

  const trimmedHighlights = highlights?.trim()
  const highlightsSection = trimmedHighlights
    ? `## What's new in ${version}\n${trimmedHighlights}\n\n`
    : ''

  return `${highlightsSection}${INSTALL_INTRO}

## Download & install
${installSteps}

## Requirements
- **Apple Silicon (M1 or newer)** — arm64 only.
- **macOS 26 (Tahoe) or newer.**
`
}
