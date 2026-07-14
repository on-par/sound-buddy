// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  PNG_SIGNATURE,
  PNG_METADATA_CHUNK_TYPES,
  findPngMetadataChunks,
  assertPngMetadataStripped,
  sanitizeCardFilename,
  buildExportFilename,
} from './report-export';

// Hand-built PNG byte fixtures — the parser walks real chunk framing (4-byte
// BE length + 4-byte ASCII type + data + 4-byte CRC), so fixtures must be
// byte-accurate rather than mocked.
function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function asciiBytes(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0));
}

function chunk(type: string, dataLength = 0): number[] {
  const data = new Array(dataLength).fill(0xaa);
  const crc = [0, 0, 0, 0];
  return [...u32be(dataLength), ...asciiBytes(type), ...data, ...crc];
}

function buildPng(chunks: number[][]): Uint8Array {
  return new Uint8Array([...PNG_SIGNATURE, ...chunks.flat()]);
}

const CLEAN_PNG = buildPng([chunk('IHDR', 13), chunk('IDAT', 4), chunk('IEND', 0)]);

describe('PNG_SIGNATURE / PNG_METADATA_CHUNK_TYPES', () => {
  it('is the 8-byte PNG magic', () => {
    expect(PNG_SIGNATURE).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('lists the text/EXIF/timestamp ancillary chunk types', () => {
    expect([...PNG_METADATA_CHUNK_TYPES].sort()).toEqual(
      ['eXIf', 'iTXt', 'tEXt', 'tIME', 'zTXt'].sort()
    );
  });
});

describe('findPngMetadataChunks', () => {
  it('returns [] for a clean canvas-generated PNG', () => {
    expect(findPngMetadataChunks(CLEAN_PNG)).toEqual([]);
  });

  it('finds a tEXt chunk', () => {
    const dirty = buildPng([chunk('IHDR', 13), chunk('tEXt', 10), chunk('IDAT', 4), chunk('IEND', 0)]);
    expect(findPngMetadataChunks(dirty)).toEqual(['tEXt']);
  });

  it('finds an eXIf chunk', () => {
    const dirty = buildPng([chunk('IHDR', 13), chunk('eXIf', 20), chunk('IEND', 0)]);
    expect(findPngMetadataChunks(dirty)).toEqual(['eXIf']);
  });

  it('finds an iTXt chunk', () => {
    const dirty = buildPng([chunk('IHDR', 13), chunk('iTXt', 15), chunk('IEND', 0)]);
    expect(findPngMetadataChunks(dirty)).toEqual(['iTXt']);
  });

  it('dedupes repeated metadata chunk types, preserving first-seen order', () => {
    const dirty = buildPng([
      chunk('IHDR', 13),
      chunk('tEXt', 5),
      chunk('tIME', 7),
      chunk('tEXt', 5),
      chunk('IEND', 0),
    ]);
    expect(findPngMetadataChunks(dirty)).toEqual(['tEXt', 'tIME']);
  });

  it('throws a clear error on a bad signature', () => {
    const bad = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(() => findPngMetadataChunks(bad)).toThrow(/Not a PNG/);
  });

  it('stops without throwing on a truncated buffer (length runs past end)', () => {
    // A chunk header claiming a 100-byte payload, but the buffer ends immediately.
    const truncated = new Uint8Array([...PNG_SIGNATURE, ...u32be(100), ...asciiBytes('tEXt')]);
    expect(() => findPngMetadataChunks(truncated)).not.toThrow();
    expect(findPngMetadataChunks(truncated)).toEqual([]);
  });
});

describe('assertPngMetadataStripped', () => {
  it('does not throw on a clean PNG', () => {
    expect(() => assertPngMetadataStripped(CLEAN_PNG)).not.toThrow();
  });

  it('throws with the offending chunk name(s) in the message', () => {
    const dirty = buildPng([chunk('IHDR', 13), chunk('tEXt', 5), chunk('IEND', 0)]);
    expect(() => assertPngMetadataStripped(dirty)).toThrow(
      'Export aborted: PNG contains metadata chunks: tEXt'
    );
  });
});

describe('sanitizeCardFilename', () => {
  it('strips a POSIX directory path', () => {
    expect(sanitizeCardFilename('/Users/x/My Mix.wav')).toBe('My Mix.wav');
  });

  it('strips a Windows directory path', () => {
    expect(sanitizeCardFilename('C:\\a\\b.wav')).toBe('b.wav');
  });

  it('falls back to "report" for an empty string', () => {
    expect(sanitizeCardFilename('')).toBe('report');
  });

  it('falls back to "report" for a whitespace-only string', () => {
    expect(sanitizeCardFilename('   ')).toBe('report');
  });

  it('collapses internal whitespace', () => {
    expect(sanitizeCardFilename('My   Mix.wav')).toBe('My Mix.wav');
  });
});

describe('buildExportFilename', () => {
  it('slugifies the card name and date into the suggested filename', () => {
    expect(buildExportFilename('My Mix.wav', 'Jul 14, 2026')).toBe(
      'sound-buddy-report-my-mix-wav-jul-14-2026.png'
    );
  });

  it('falls back to a generic name when both inputs are empty', () => {
    expect(buildExportFilename('', '')).toBe('sound-buddy-report.png');
  });

  it('truncates a long card name to the length cap', () => {
    const longName = 'a'.repeat(200);
    const result = buildExportFilename(longName, 'Jul 14, 2026');
    const slugPart = result.slice('sound-buddy-report-'.length, -'.png'.length - '-jul-14-2026'.length);
    expect(slugPart.length).toBeLessThanOrEqual(60);
    expect(slugPart).toBe('a'.repeat(60));
  });
});
