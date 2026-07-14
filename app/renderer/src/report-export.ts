// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure report-card PNG export helpers (#368): the testable core of the
// "Export PNG" button. The rasterization itself (html2canvas → canvas →
// Blob) is impure browser glue that lives in inline-app.js — this module
// only proves the *security-critical* invariant that the exported PNG never
// carries source metadata (EXIF/GPS/device IDs/timestamps), plus the
// filename PII guard, so both are 100% unit-testable without a DOM canvas.

/** The 8-byte PNG file signature every valid PNG starts with. */
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Ancillary PNG chunk types that can carry text/EXIF/timestamp/device-ID
 * metadata. Canvas-generated PNGs (`canvas.toBlob('image/png')`) never emit
 * any of these — this set is what {@link findPngMetadataChunks} scans for to
 * prove that guarantee at runtime.
 */
export const PNG_METADATA_CHUNK_TYPES = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

const CHUNK_HEADER_BYTES = 8; // 4-byte length + 4-byte ASCII type
const CHUNK_CRC_BYTES = 4;

/**
 * Walks a PNG byte buffer's chunk framing and returns the metadata chunk
 * types present (deduped, in first-seen order). Empty means the PNG carries
 * no text/EXIF/timestamp metadata.
 */
export function findPngMetadataChunks(bytes: Uint8Array): string[] {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Not a PNG: bad signature');
  }

  const found: string[] = [];
  const seen = new Set<string>();
  let offset = PNG_SIGNATURE.length;

  while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
    const length =
      ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataStart = offset + CHUNK_HEADER_BYTES;
    const chunkEnd = dataStart + length + CHUNK_CRC_BYTES;

    // Malformed/truncated buffer (a length field that runs past the end) —
    // stop scanning rather than throw, since this is a defense-in-depth scan,
    // not a strict PNG validator.
    if (chunkEnd > bytes.length) break;

    if (PNG_METADATA_CHUNK_TYPES.has(type) && !seen.has(type)) {
      seen.add(type);
      found.push(type);
    }

    if (type === 'IEND') break;
    offset = chunkEnd;
  }

  return found;
}

/**
 * Runtime defense-in-depth guard invoked right before an export is saved.
 * Throws if the PNG carries any text/EXIF/timestamp metadata chunk.
 */
export function assertPngMetadataStripped(bytes: Uint8Array): void {
  const found = findPngMetadataChunks(bytes);
  if (found.length > 0) {
    throw new Error(`Export aborted: PNG contains metadata chunks: ${found.join(', ')}`);
  }
}

/**
 * Strips any directory component from a (possibly absolute) source path,
 * leaving only the basename — belt-and-suspenders so an absolute path can
 * never reach a saved export filename. The card already only ever shows a
 * basename; this exists purely as a PII guard.
 */
export function sanitizeCardFilename(name: string): string {
  const parts = name.split(/[\\/]/);
  const basename = parts[parts.length - 1];
  const collapsed = basename.trim().replace(/\s+/g, ' ');
  return collapsed === '' ? 'report' : collapsed;
}

const MAX_SLUG_LENGTH = 60;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);
}

/**
 * Builds a deterministic suggested save name for the exported PNG. No
 * ambient `new Date()` — `dateText` is injected so this stays a pure
 * function of its arguments.
 */
export function buildExportFilename(cardName: string, dateText: string): string {
  const parts = [slugify(cardName), slugify(dateText)].filter((s) => s !== '');
  if (parts.length === 0) return 'sound-buddy-report.png';
  return `sound-buddy-report-${parts.join('-')}.png`;
}
