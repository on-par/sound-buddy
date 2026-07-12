// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { createRoot } from 'react-dom/client';
import App from './App';

// No <StrictMode>: it double-invokes effects in dev, which would run the
// classic boot scripts App injects twice and double-bind listeners (#303).
createRoot(document.getElementById('root')!).render(<App />);
