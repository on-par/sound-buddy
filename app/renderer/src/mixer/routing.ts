// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { ConsoleChannelStateDto, ConsoleStripDetailDto, ConsoleSurfacesDto } from '../../../electron/ipc/api';
import { sendingBuses, busLabel, busName, channelLabel, channelNumber, formatDb, formatReadAge } from './view-model';

export interface BusRoute {
  index: number;
  name: string;
  label: string;
  ranges: string;
  read: boolean;
  fader: string | null;
  on: boolean | null;
  age: string;
  routeAge: string;
  channels: string[];
}

export interface RoutingView {
  buses: BusRoute[];
  sendsRead: number;
  channelCount: number;
  coverage: string;
}

export function channelRanges(indexes: readonly number[]): string {
  const sorted = [...indexes].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  const text = runs.map(([a, b]) => (a === b ? channelNumber(a) : `${channelNumber(a)}–${channelNumber(b)}`)).join(', ');
  return `${sorted.length} ${sorted.length === 1 ? 'channel' : 'channels'}${text ? ` · ${text}` : ''}`;
}

export function busRoutes(
  surfaces: ConsoleSurfacesDto | null,
  stripDetail: readonly ConsoleStripDetailDto[],
  channels: readonly ConsoleChannelStateDto[],
  now: number
): RoutingView {
  const sending = new Map<number, number[]>();
  const sendReads = new Map<number, number[]>();
  let sendsRead = 0;
  for (const d of stripDetail) {
    if (!d.sends) continue;
    sendsRead += 1;
    for (const bus of sendingBuses(d.sends.value)) {
      sending.set(bus, [...(sending.get(bus) ?? []), d.index]);
      sendReads.set(bus, [...(sendReads.get(bus) ?? []), d.sends.readAt]);
    }
  }
  const buses = (surfaces?.buses ?? []).flatMap((b) => {
    if (b.index === null) return [];
    const index = b.index;
    const reads = [b.name?.readAt, b.mix?.readAt].filter((t): t is number => t !== undefined);
    const name = busName(surfaces, index);
    const sendingChannels = sending.get(index) ?? [];
    const routeReads = [...(sendReads.get(index) ?? []), ...(b.name ? [b.name.readAt] : [])];
    return [{
      index,
      name,
      label: busLabel(surfaces, index),
      ranges: channelRanges(sendingChannels),
      read: b.name !== null,
      fader: b.mix ? formatDb(b.mix.value.faderDb) : null,
      on: b.mix ? b.mix.value.on : null,
      age: reads.length === 0 ? 'not read yet' : formatReadAge(Math.min(...reads), now),
      routeAge: sendingChannels.length === 0 ? '' : formatReadAge(Math.min(...routeReads), now),
      channels: sendingChannels.map((c) => channelLabel(channels, c)),
    }];
  });
  const channelCount = stripDetail.length;
  return {
    buses,
    sendsRead,
    channelCount,
    coverage:
      sendsRead === channelCount
        ? `Sends read for all ${channelCount} channels`
        : `Sends read for ${sendsRead} of ${channelCount} channels; the rest arrive on the slow poll.`,
  };
}
