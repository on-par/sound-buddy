import { describe, expect, it } from 'vitest';
import { selectDmgArtifacts, planDmgNotarization, DMG_EXTENSION, KEYCHAIN_PROFILE_VAR } from './dmg-notarization.js';

describe('selectDmgArtifacts', () => {
  it('returns [] for an empty input', () => {
    expect(selectDmgArtifacts([])).toEqual([]);
  });

  it('keeps .dmg files', () => {
    expect(selectDmgArtifacts(['/out/Sound Buddy-1.0.0-arm64.dmg'])).toEqual([
      '/out/Sound Buddy-1.0.0-arm64.dmg',
    ]);
  });

  it('drops .dmg.blockmap files', () => {
    expect(selectDmgArtifacts(['/out/Sound Buddy-1.0.0-arm64.dmg.blockmap'])).toEqual([]);
  });

  it('drops .zip and latest-mac.yml', () => {
    expect(
      selectDmgArtifacts(['/out/Sound Buddy-1.0.0-arm64-mac.zip', '/out/latest-mac.yml']),
    ).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(selectDmgArtifacts(['/out/Sound Buddy-1.0.0-arm64.DMG'])).toEqual([
      '/out/Sound Buddy-1.0.0-arm64.DMG',
    ]);
  });

  it('mixes matches and non-matches, preserving order', () => {
    const paths = [
      '/out/Sound Buddy-1.0.0-arm64-mac.zip',
      '/out/Sound Buddy-1.0.0-arm64.dmg',
      '/out/Sound Buddy-1.0.0-arm64.dmg.blockmap',
      '/out/latest-mac.yml',
    ];
    expect(selectDmgArtifacts(paths)).toEqual(['/out/Sound Buddy-1.0.0-arm64.dmg']);
  });
});

describe('planDmgNotarization', () => {
  const dmgPath = '/out/Sound Buddy-1.0.0-arm64.dmg';

  it('skips with a reason mentioning APPLE_KEYCHAIN_PROFILE when the var is unset', () => {
    const plan = planDmgNotarization([dmgPath], {});
    expect(plan.notarize).toBe(false);
    if (plan.notarize) throw new Error('unreachable');
    expect(plan.reason).toContain(KEYCHAIN_PROFILE_VAR);
  });

  it('skips with a reason mentioning APPLE_KEYCHAIN_PROFILE when the var is empty', () => {
    const plan = planDmgNotarization([dmgPath], { [KEYCHAIN_PROFILE_VAR]: '' });
    expect(plan.notarize).toBe(false);
    if (plan.notarize) throw new Error('unreachable');
    expect(plan.reason).toContain(KEYCHAIN_PROFILE_VAR);
  });

  it('skips with a reason mentioning APPLE_KEYCHAIN_PROFILE when the var is whitespace', () => {
    const plan = planDmgNotarization([dmgPath], { [KEYCHAIN_PROFILE_VAR]: '   ' });
    expect(plan.notarize).toBe(false);
    if (plan.notarize) throw new Error('unreachable');
    expect(plan.reason).toContain(KEYCHAIN_PROFILE_VAR);
  });

  it('skips with a reason naming the missing dmg when the profile is set but no dmg is present', () => {
    const plan = planDmgNotarization(['/out/Sound Buddy-1.0.0-arm64-mac.zip'], {
      [KEYCHAIN_PROFILE_VAR]: 'sound-buddy-notary',
    });
    expect(plan.notarize).toBe(false);
    if (plan.notarize) throw new Error('unreachable');
    expect(plan.reason).toContain('dmg');
  });

  it('plans one step per dmg, in order, with exact submit/staple args', () => {
    const dmgPath2 = '/out/Sound Buddy-1.0.0-arm64-2.dmg';
    const plan = planDmgNotarization([dmgPath, dmgPath2], {
      [KEYCHAIN_PROFILE_VAR]: 'sound-buddy-notary',
    });
    expect(plan.notarize).toBe(true);
    if (!plan.notarize) throw new Error('unreachable');
    expect(plan.steps).toEqual([
      {
        dmgPath,
        submitArgs: ['notarytool', 'submit', dmgPath, '--keychain-profile', 'sound-buddy-notary', '--wait'],
        stapleArgs: ['stapler', 'staple', dmgPath],
      },
      {
        dmgPath: dmgPath2,
        submitArgs: ['notarytool', 'submit', dmgPath2, '--keychain-profile', 'sound-buddy-notary', '--wait'],
        stapleArgs: ['stapler', 'staple', dmgPath2],
      },
    ]);
  });

  it('trims a profile with surrounding whitespace', () => {
    const plan = planDmgNotarization([dmgPath], { [KEYCHAIN_PROFILE_VAR]: '  sound-buddy-notary  ' });
    expect(plan.notarize).toBe(true);
    if (!plan.notarize) throw new Error('unreachable');
    expect(plan.steps[0].submitArgs).toContain('sound-buddy-notary');
  });

  it('exports the .dmg extension constant', () => {
    expect(DMG_EXTENSION).toBe('.dmg');
  });
});
