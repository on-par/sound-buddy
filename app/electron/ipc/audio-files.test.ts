// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { collectAudioFiles, AUDIO_EXTENSIONS, type FolderReader } from './audio-files';

function stubReader(files: Record<string, boolean>): FolderReader {
  return {
    readdir: () => Object.keys(files),
    isFile: (fullPath) => files[path.basename(fullPath)] !== false,
  };
}

describe('collectAudioFiles', () => {
  it('filters to whole-mix audio extensions, mixed with non-audio files', () => {
    const io = stubReader({
      'sunday-service.wav': true,
      'notes.txt': true,
      'sermon.mp3': true,
      'photo.jpg': true,
    });
    const result = collectAudioFiles('/recordings', io);
    expect(result).toEqual([
      path.join('/recordings', 'sermon.mp3'),
      path.join('/recordings', 'sunday-service.wav'),
    ]);
  });

  it('matches extensions case-insensitively', () => {
    const io = stubReader({ 'Track.WAV': true, 'Track2.Mp3': true });
    const result = collectAudioFiles('/recordings', io);
    expect(result).toEqual([
      path.join('/recordings', 'Track.WAV'),
      path.join('/recordings', 'Track2.Mp3'),
    ]);
  });

  it('excludes dotfiles, including macOS AppleDouble sidecars', () => {
    const io = stubReader({
      'service.wav': true,
      '._service.wav': true,
      '.DS_Store': true,
    });
    const result = collectAudioFiles('/recordings', io);
    expect(result).toEqual([path.join('/recordings', 'service.wav')]);
  });

  it('excludes directories (isFile:false), even with an audio-looking name', () => {
    const io = stubReader({
      'service.wav': true,
      'stems.wav': false, // actually a directory named stems.wav
    });
    const result = collectAudioFiles('/recordings', io);
    expect(result).toEqual([path.join('/recordings', 'service.wav')]);
  });

  it('sorts results ascending by filename', () => {
    const io = stubReader({ 'c.wav': true, 'a.wav': true, 'b.wav': true });
    const result = collectAudioFiles('/recordings', io);
    expect(result).toEqual([
      path.join('/recordings', 'a.wav'),
      path.join('/recordings', 'b.wav'),
      path.join('/recordings', 'c.wav'),
    ]);
  });

  it('returns an empty array for an empty folder, never throws', () => {
    const io = stubReader({});
    expect(() => collectAudioFiles('/recordings', io)).not.toThrow();
    expect(collectAudioFiles('/recordings', io)).toEqual([]);
  });

  it('covers every declared extension', () => {
    const files: Record<string, boolean> = {};
    AUDIO_EXTENSIONS.forEach((ext, i) => {
      files[`track${i}${ext}`] = true;
    });
    const io = stubReader(files);
    const result = collectAudioFiles('/recordings', io);
    expect(result).toHaveLength(AUDIO_EXTENSIONS.length);
  });
});
