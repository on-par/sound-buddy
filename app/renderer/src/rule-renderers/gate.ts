// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Self-registering 'gate' narrative renderer (#861, story 1 of #839):
// importing this module registers the gate template and renderer in the
// renderer-side store — adding a rule type is adding one file, no central
// wiring. Registering the template at import time (idempotent upsert) makes
// this adapter self-sufficient: rendering can never hit the #834
// unregistered-template throw.
import { registerRuleTemplate, renderRuleNarrative } from '@sound-buddy/audio-engine/dist/analyze/rule-narrative.js';
import { GATE_NARRATIVE_TEMPLATE } from '@sound-buddy/audio-engine/dist/analyze/gate-narrative.js';
import { registerRuleRenderer } from '../rule-renderer-store';

registerRuleTemplate('gate', GATE_NARRATIVE_TEMPLATE);
registerRuleRenderer('gate', (data) => renderRuleNarrative('gate', data));