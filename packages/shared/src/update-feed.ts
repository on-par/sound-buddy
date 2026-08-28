// electron-updater feed (latest-mac.yml) parsing + build-local consistency check (#1226). Pure
// functions only — no fs/child_process here. scripts/release.sh reads the file, hashes the
// artifacts it just built, and calls these to prove the feed describes this build before
// anything is pushed or published.

export interface UpdateFeedFileEntry {
  url: string;
  sha512: string;
  size?: number;
}

export interface UpdateFeed {
  version?: string;
  path?: string;
  sha512?: string;
  files: UpdateFeedFileEntry[];
}

export interface BuiltArtifact {
  /** Basename as it sits in app/release, e.g. `Sound.Buddy-0.8.31-arm64-mac.zip`. */
  name: string;
  sizeBytes: number;
  /** Base64 SHA-512 of the file — the encoding electron-updater uses in latest-mac.yml. */
  sha512Base64: string;
}

export type UpdateFeedVerdict = { ok: true } | { ok: false; problems: string[] };

const TOP_LEVEL_KEYS = ['version', 'path', 'sha512'] as const;

/**
 * Plain-string prefix match, not a regex — a `^\s*key:\s*` style pattern here would give CodeQL's
 * polynomial-redos check something to flag on adversarial whitespace, and buys nothing over
 * `trimStart` + `startsWith` for a format this fixed.
 */
function matchPrefix(line: string, prefix: string): string | undefined {
  const trimmed = line.trimStart();
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : undefined;
}

function isIndented(line: string): boolean {
  return line.length > 0 && (line[0] === ' ' || line[0] === '\t');
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * A deliberately small line parser for electron-builder's latest-mac.yml, not a general YAML
 * library — there is no YAML dependency in packages/shared and this file's shape is fixed by
 * electron-builder. Unrecognized keys are ignored so a new key electron-builder adds later never
 * fails a release; malformed input never throws — problems are reported by checkUpdateFeed.
 */
export function parseLatestMacYml(text: string): UpdateFeed {
  const feed: UpdateFeed = { files: [] };
  let currentFile: UpdateFeedFileEntry | undefined;
  let inFilesBlock = false;

  for (const rawLine of text.split('\n')) {
    const urlValue = matchPrefix(rawLine, '- url:');
    if (urlValue !== undefined) {
      inFilesBlock = true;
      currentFile = { url: unquote(urlValue), sha512: '' };
      feed.files.push(currentFile);
      continue;
    }

    if (inFilesBlock && currentFile && isIndented(rawLine)) {
      const sha512Value = matchPrefix(rawLine, 'sha512:');
      if (sha512Value !== undefined) {
        currentFile.sha512 = unquote(sha512Value);
        continue;
      }
      const sizeValue = matchPrefix(rawLine, 'size:');
      if (sizeValue !== undefined) {
        const parsed = Number.parseInt(unquote(sizeValue), 10);
        currentFile.size = Number.isFinite(parsed) ? parsed : undefined;
        continue;
      }
      continue;
    }

    inFilesBlock = false;
    currentFile = undefined;

    if (rawLine.trim() === 'files:') {
      inFilesBlock = true;
      continue;
    }

    if (isIndented(rawLine)) continue;

    for (const key of TOP_LEVEL_KEYS) {
      const value = matchPrefix(rawLine, `${key}:`);
      if (value !== undefined) {
        feed[key] = unquote(value);
        break;
      }
    }
  }

  return feed;
}

const URL_HAS_SPACE = /\s/;

export function checkUpdateFeed(
  feed: UpdateFeed,
  artifacts: readonly BuiltArtifact[],
  expectedVersion: string,
): UpdateFeedVerdict {
  const problems: string[] = [];

  if (feed.version === undefined || feed.version !== expectedVersion) {
    problems.push(
      `latest-mac.yml version is "${feed.version ?? '(missing)'}" but this build is "${expectedVersion}" — ` +
        `re-run the build so electron-builder regenerates the feed for the version being released.`,
    );
  }

  if (feed.files.length === 0) {
    problems.push(
      'latest-mac.yml has no files entries — electron-builder generated no files entry; check the publish: ' +
        'block in app/electron-builder.yml.',
    );
  }

  const artifactsByName = new Map(artifacts.map((a) => [a.name, a]));

  for (const entry of feed.files) {
    if (URL_HAS_SPACE.test(entry.url)) {
      problems.push(
        `latest-mac.yml file url "${entry.url}" contains a space — GitHub rewrites spaces to dots on upload ` +
          `(#625), so this url will 404 every update check; check the artifactName template in ` +
          `app/electron-builder.yml.`,
      );
      continue;
    }

    const artifact = artifactsByName.get(entry.url);
    if (!artifact) {
      problems.push(
        `latest-mac.yml references "${entry.url}", which does not match any built artifact ` +
          `(${artifacts.map((a) => a.name).join(', ') || '(none built)'}) — check the artifactName template in ` +
          `app/electron-builder.yml.`,
      );
      continue;
    }

    if (entry.sha512 !== artifact.sha512Base64) {
      problems.push(
        `latest-mac.yml sha512 for "${entry.url}" is "${entry.sha512}" but the built file hashes to ` +
          `"${artifact.sha512Base64}" — electron-updater will reject this as a signature mismatch; re-run the ` +
          `build.`,
      );
    }

    if (entry.size !== undefined && entry.size !== artifact.sizeBytes) {
      problems.push(
        `latest-mac.yml size for "${entry.url}" is ${entry.size} bytes but the built file is ` +
          `${artifact.sizeBytes} bytes — re-run the build.`,
      );
    }
  }

  if (feed.path === undefined) {
    problems.push('latest-mac.yml has no path — electron-updater requires a top-level path naming the update file.');
  } else if (!feed.files.some((f) => f.url === feed.path)) {
    problems.push(
      `latest-mac.yml path "${feed.path}" does not match any files[].url (${feed.files.map((f) => f.url).join(', ')}).`,
    );
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
