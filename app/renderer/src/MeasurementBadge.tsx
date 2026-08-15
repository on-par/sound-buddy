// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The live header's measurement badge (#457) — TD-001 slice 6h (#711): ported
// off inline-app.js's DOM-writing renderMeasurementBadge onto a pure
// measurementBadgeView derived from liveCaptureStore state, rendered
// reactively. Portaled by App.tsx onto #measurement-badge-island. The span
// keeps id="measurement-badge" so any #measurement-badge locator still works.

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { measurementBadgeView } from './measurement-device-state';

export default function MeasurementBadge(): JSX.Element {
  const { isCapturing, secondaryMeasurement, secondaryWindows, measurementSource, channelConfig } =
    useStoreShallow(useLiveCaptureStore, (s) => ({
      isCapturing: s.isCapturing,
      secondaryMeasurement: s.secondaryMeasurement,
      secondaryWindows: s.secondaryWindows,
      measurementSource: s.measurementSource,
      channelConfig: s.channelConfig,
    }));
  return (
    <span id="measurement-badge">
      {measurementBadgeView({
        isCapturing,
        secondaryStatus: secondaryMeasurement.status,
        secondaryWindows,
        secondaryDeviceName: secondaryMeasurement.deviceName,
        measurementSource,
        channelConfig,
      })}
    </span>
  );
}
