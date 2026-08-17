import { describe, it, expect } from 'vitest'
import { OscError } from './index.js'
import { assertReadOnlyOscMessage } from './read-only-guard.js'

describe('assertReadOnlyOscMessage — deny list', () => {
  it.each(['/save', '/scene', '/-libs'])(
    'throws for deny-listed address %s with no args',
    (address) => {
      expect(() => assertReadOnlyOscMessage({ address, args: [] })).toThrow(OscError)
      expect(() => assertReadOnlyOscMessage({ address, args: [] })).toThrow(
        /write\/mutation address/,
      )
    },
  )

  it('throws for a `/`-bounded subpath of a deny-listed address', () => {
    expect(() => assertReadOnlyOscMessage({ address: '/scene/1', args: [] })).toThrow(OscError)
  })

  it('does not throw for an address that merely shares a prefix string without a `/` boundary', () => {
    expect(() => assertReadOnlyOscMessage({ address: '/scenegroup', args: [] })).not.toThrow()
  })
})

describe('assertReadOnlyOscMessage — argument-less messages', () => {
  it('does not throw for an argument-less message on a non-denied address', () => {
    expect(() => assertReadOnlyOscMessage({ address: '/xremote', args: [] })).not.toThrow()
  })
})

describe('assertReadOnlyOscMessage — with-args allowlist', () => {
  it('throws for a non-denied, non-allowlisted address carrying an argument', () => {
    expect(() =>
      assertReadOnlyOscMessage({ address: '/ch/01/mix', args: [{ type: 'f', value: 0.5 }] }),
    ).toThrow(/not on the read-only allowlist/)
  })

  it.each(['/node', '/meters', '/xremote', '/renew', '/unsubscribe', '/info', '/xinfo'])(
    'does not throw for allowlisted address %s called with a benign argument',
    (address) => {
      expect(() =>
        assertReadOnlyOscMessage({ address, args: [{ type: 'i', value: 1 }] }),
      ).not.toThrow()
    },
  )
})

describe('assertReadOnlyOscMessage — /node argument inspection', () => {
  it('throws for /node with a string argument normalizing to a deny-listed namespace (leading slash)', () => {
    expect(() =>
      assertReadOnlyOscMessage({
        address: '/node',
        args: [{ type: 's', value: '/-libs/uahfx' }],
      }),
    ).toThrow(/write\/mutation namespace/)
  })

  it('throws for /node with a string argument normalizing to a deny-listed namespace (no leading slash)', () => {
    expect(() =>
      assertReadOnlyOscMessage({
        address: '/node',
        args: [{ type: 's', value: '-libs/uahfx' }],
      }),
    ).toThrow(/write\/mutation namespace/)
  })

  it('does not throw for /node with a benign string argument', () => {
    expect(() =>
      assertReadOnlyOscMessage({ address: '/node', args: [{ type: 's', value: 'ch/01/mix' }] }),
    ).not.toThrow()
  })

  it('does not throw for /node whose first argument is not type "s"', () => {
    expect(() =>
      assertReadOnlyOscMessage({ address: '/node', args: [{ type: 'i', value: 42 }] }),
    ).not.toThrow()
  })
})
