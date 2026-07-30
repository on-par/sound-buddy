// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The only allowed construction boundary for Tier 2 OSC traffic (#378).
// There is deliberately no socket code here yet: #371 owns feasibility and
// transport. When that work lands it must use these read-only query shapes
// after calling assertTier2Consent(), never construct arbitrary OSC messages.

export type ConsoleReadOperation = 'channel-names' | 'levels' | 'routing';

export interface ReadOnlyOscQuery {
  address: '/xinfo' | '/meters/0' | '/node';
  arguments: readonly [];
}

const READ_ONLY_QUERIES: Readonly<Record<ConsoleReadOperation, ReadOnlyOscQuery>> = {
  'channel-names': { address: '/xinfo', arguments: [] },
  levels: { address: '/meters/0', arguments: [] },
  routing: { address: '/node', arguments: [] },
};

/** Refuse Tier 2 work before the explicit first-run consent is stored. */
export function assertTier2Consent(consentGranted: boolean): void {
  if (!consentGranted) {
    throw new Error('Enable console-network access from a Tier 2 feature first.');
  }
}

/**
 * Returns one of the fixed, read-only query messages. No write/set OSC
 * address can be represented by this API, which keeps console writes outside
 * the application boundary by construction.
 */
export function buildReadOnlyOscQuery(operation: ConsoleReadOperation): ReadOnlyOscQuery {
  return READ_ONLY_QUERIES[operation];
}
