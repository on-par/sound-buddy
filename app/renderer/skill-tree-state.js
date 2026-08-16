// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free skill-tree onboarding (#382): a nine-branch progression
// mirroring the MxU teaching order, with authored content on every level,
// localStorage-backed progress tracking, and derived badges. All content is
// static data — no console integration, no adaptive AI, no per-user
// generation. Progress is a persisted list of completed level ids under the
// versioned KEY; every helper takes a Storage-like object (getItem/setItem)
// so the progression logic is unit-testable without a DOM, degrading safely
// to empty progress on missing/throwing/garbage storage. Loaded via <script
// src> and read off window.skillTreeState, mirroring onboarding-state.js.
(function (root) {
  'use strict';

  // localStorage key, versioned so a future tree revision can reset progress
  // without colliding with existing keys.
  var KEY = 'sb-skill-tree-progress-v1';

  // The MxU teaching order, verbatim from the issue: fundamentals →
  // phase/summation → EQ → compression → gates/sidechain → de-essing/dynamic
  // EQ → relational skills → monitor mixing → effects. Each branch carries
  // three levels (Foundation / Practice / Advanced framing, ids
  // `<branchId>.1|.2|.3`) with non-empty title/body/tip strings.
  var SKILL_TREE = [
    {
      id: 'fundamentals',
      title: 'Fundamentals',
      summary: 'How a mixer path flows, signal levels, and where the engineer fits in the chain.',
      levels: [
        {
          id: 'fundamentals.1',
          title: 'The Signal Path',
          body: 'Every channel on a digital mixer is a chain: input gain, high-pass filter, EQ, dynamics, fader, pan, then the bus. Knowing where you are in that chain tells you which control is causing the sound you are hearing.',
          tip: 'Trace one channel end to end on your console — follow it from the input stage to the mix bus and name each block out loud.',
        },
        {
          id: 'fundamentals.2',
          title: 'Setting Levels',
          body: 'Gain staging is where a good mix starts: set input trim so the channel sits comfortably in the meter band, then ride faders to balance. A channel that is too hot adds noise and eats headroom; one that is too cold gets buried in the noise floor.',
          tip: 'Solo each channel and set its trim so it peaks around -18 to -12 dBFS during the loudest moments of the service.',
        },
        {
          id: 'fundamentals.3',
          title: 'Your Role in the Chain',
          body: 'The engineer\'s job is to serve the room and the service — decisions on level, tone and balance follow what the worship needs, not what the meters say. You are the last person between the musicians and the congregation.',
          tip: 'Before next service, write down the three most important sounds the congregation should hear, then check your mix against that list.',
        },
      ],
    },
    {
      id: 'phase-summation',
      title: 'Phase & Summation',
      summary: 'Polarity, phase alignment, and how multiple mics sum (or cancel).',
      levels: [
        {
          id: 'phase-summation.1',
          title: 'Polarity Inversion',
          body: 'Polarity flips a signal\'s positive and negative halves. When two mics pick up the same source, one flipped polarity can make them fight and thin the sound out.',
          tip: 'On a drum kit, flip the polarity of the overhead pair one at a time and listen for which position gives the fullest low end.',
        },
        {
          id: 'phase-summation.2',
          title: 'Phase Alignment',
          body: 'Phase is about timing: the same sound arriving at two mics at slightly different moments causes comb filtering and hollow tone. Aligning by distance or delay puts the waveforms back in step.',
          tip: 'Mic the same guitar amp with two mics; nudge one in time with a delay and listen for the difference in body and low end.',
        },
        {
          id: 'phase-summation.3',
          title: 'Summation in Practice',
          body: 'When mics sum constructively you get a fuller, more focused sound; when they cancel you get thin, phasey tone that changes as the performer moves. Listen in mono to hear cancellation instantly.',
          tip: 'Check your drum and acoustic-guitar channels in mono — anything that thins out is a phase problem worth fixing.',
        },
      ],
    },
    {
      id: 'eq',
      title: 'EQ',
      summary: 'The spectrum, cutting vs boosting, and where instruments live.',
      levels: [
        {
          id: 'eq.1',
          title: 'The Frequency Spectrum',
          body: 'Sound spans the spectrum from sub bass to air, and every instrument has a home range. Sub and bass carry weight, mids carry tone and intelligibility, highs add sparkle and sibilance.',
          tip: 'Use a sine sweep in your DAW or console to learn what 60 Hz, 250 Hz, 1 kHz, 4 kHz and 12 kHz actually sound like.',
        },
        {
          id: 'eq.2',
          title: 'Cut First, Boost Later',
          body: 'Cutting problem frequencies is almost always safer than boosting: it keeps headroom, avoids amplifying noise, and reads naturally. Boost only when a part genuinely needs presence.',
          tip: 'When a channel sounds muddy, cut around 250-400 Hz before reaching for a boost — listen for what the cut reveals.',
        },
        {
          id: 'eq.3',
          title: 'EQ for the Mix',
          body: 'Where instruments live is your map: kick and bass own the lows, vocals and guitars occupy the mids, cymbals and air live on top. EQ is carving space so each part has its own lane in the mix.',
          tip: 'In your next mix, give the vocal the 2-5 kHz presence it needs by cutting that same range slightly from guitars and keys.',
        },
      ],
    },
    {
      id: 'compression',
      title: 'Compression',
      summary: 'Threshold, ratio, attack, release, and when compression is called for.',
      levels: [
        {
          id: 'compression.1',
          title: 'How a Compressor Works',
          body: 'A compressor turns a signal down automatically once it passes a threshold, at a ratio of your choosing. Attack and release decide how fast it grabs and lets go.',
          tip: 'Compress a vocal demo with a slow attack and then a fast one — hear how the same settings change the front of every word.',
        },
        {
          id: 'compression.2',
          title: 'Choosing Settings',
          body: 'Threshold sets where compression starts, ratio sets how much, attack shapes the transient, and release shapes the groove. Start gentle — 2:1 or 3:1 with a few dB of gain reduction — and listen for glue, not squish.',
          tip: 'On a bass channel, try a fast attack to even out notes and a release that breathes with the song\'s tempo.',
        },
        {
          id: 'compression.3',
          title: 'When It\'s Called For',
          body: 'Compression is for control: taming a singer who moves off-mic, gluing a drum bus, or keeping the mix loud and even. If a channel is already consistent, leaving it uncompressed is a valid choice.',
          tip: 'Pick one track that needs taming and one that doesn\'t, and compress only the first — then compare the two in the mix.',
        },
      ],
    },
    {
      id: 'gates-sidechain',
      title: 'Gates & Sidechain',
      summary: 'Gating, expanders, and sidechain triggering.',
      levels: [
        {
          id: 'gates-sidechain.1',
          title: 'What a Gate Does',
          body: 'A gate mutes a channel when its level drops below a threshold, killing background noise between notes and hits. It opens when the signal crosses the threshold and closes when it falls back.',
          tip: 'Gate a snare that picks up bleed: set the threshold just above the bleed level so it only opens when the snare actually hits.',
        },
        {
          id: 'gates-sidechain.2',
          title: 'Expanders and Tails',
          body: 'An expander turns the signal down gradually rather than slamming it shut, keeping natural tails while reducing noise. A release that is too fast can choke a drum\'s natural ring.',
          tip: 'Compare a gate and an expander on the same tom: the gate cuts hard, the expander keeps the tone\'s natural ring.',
        },
        {
          id: 'gates-sidechain.3',
          title: 'Sidechain Triggering',
          body: 'Sidechain lets one signal control the gate of another — a kick ducking a bassline, or a talk microphone opening over playback. The trigger source is separate from the channel being gated.',
          tip: 'Sidechain a low-bass track from your kick so the bass steps aside on every kick hit, then back off until it is just a groove.',
        },
      ],
    },
    {
      id: 'de-essing-dynamic-eq',
      title: 'De-essing & Dynamic EQ',
      summary: 'Taming harsh sibilance and problem frequencies only when they appear.',
      levels: [
        {
          id: 'de-essing-dynamic-eq.1',
          title: 'What Sibilance Is',
          body: 'Sibilance is the harsh "s" and "sh" energy that sits around 5-8 kHz and can make vocals fatiguing. A de-esser turns those frequencies down only when they spike.',
          tip: 'Solo a vocal and loop a phrase full of "s" sounds; sweep 5-8 kHz to find where the harshness lives.',
        },
        {
          id: 'de-essing-dynamic-eq.2',
          title: 'Setting a De-esser',
          body: 'Set the de-esser\'s frequency to the sibilant band, then adjust the threshold so it grabs the "s"s without dulling the whole vocal. Aim to remove harshness while keeping breath and detail.',
          tip: 'De-ess with a threshold that shows 3-6 dB of reduction on the worst "s", then A/B to make sure the vocal still sounds natural.',
        },
        {
          id: 'de-essing-dynamic-eq.3',
          title: 'Dynamic EQ Moves',
          body: 'Dynamic EQ cuts a problem frequency only when it appears, leaving the rest of the mix untouched. It is the right tool when a static cut would do more harm than good.',
          tip: 'Find a frequency that rings on one word, then apply a narrow dynamic cut there instead of a static EQ cut across the whole vocal.',
        },
      ],
    },
    {
      id: 'relational-skills',
      title: 'Relational Skills',
      summary: 'Listening, communicating with the team, and caring for the musicians\' experience.',
      levels: [
        {
          id: 'relational-skills.1',
          title: 'Listening First',
          body: 'The best engineers listen to what the musicians and the music need before touching anything. A mix serves the song, the room, and the people in it.',
          tip: 'Spend the first ten minutes of rehearsal listening to the band balance before making your first move.',
        },
        {
          id: 'relational-skills.2',
          title: 'Communicating with the Team',
          body: 'Clear, kind communication with musicians, the pastor, and other volunteers makes every mix easier. Say what you need in plain words, and give direction that helps the team feel supported.',
          tip: 'Before service, talk to the worship leader about what they want to hear most — and write it down.',
        },
        {
          id: 'relational-skills.3',
          title: 'Caring for Musicians',
          body: 'The stage mix matters as much as the room: musicians who cannot hear themselves play tentatively. Watch for tired, uncomfortable performers and fix their monitors or the room sound that is hurting them.',
          tip: 'Check in with each musician during a break and ask how they are hearing themselves — then address the loudest complaint first.',
        },
      ],
    },
    {
      id: 'monitor-mixing',
      title: 'Monitor Mixing',
      summary: 'Wedge and IEM mixes, foldback, and the difference between FOH and monitors.',
      levels: [
        {
          id: 'monitor-mixing.1',
          title: 'FOH vs Monitors',
          body: 'Front of house shapes what the congregation hears; monitors shape what the musicians hear on stage. The same signal can serve both, but each mix has its own needs.',
          tip: 'Walk from the console to the front row, then back to the stage, and notice how differently the same mix sounds in both places.',
        },
        {
          id: 'monitor-mixing.2',
          title: 'Wedge Mixes',
          body: 'Wedge mixes live and die on what each player needs to hear — usually more of their own voice or instrument, and less of everything else. Give each musician their own focus rather than a copy of the FOH mix.',
          tip: 'Build a monitor mix for the vocalist that leads with their own voice and a little of the band, not the full room mix.',
        },
        {
          id: 'monitor-mixing.3',
          title: 'In-Ear Mixes',
          body: 'IEMs give each musician a private, consistent mix and cut stage volume, but isolation changes how players hear timing and pitch. Plan for more of each player\'s own part and strong click/guides.',
          tip: 'On an IEM mix, keep the musician\'s own instrument prominent and add a click; listen for players who go flat and feed them more reference.',
        },
      ],
    },
    {
      id: 'effects',
      title: 'Effects',
      summary: 'Delay, reverb, and when less is more.',
      levels: [
        {
          id: 'effects.1',
          title: 'Delay',
          body: 'Delay repeats a signal after a set time, adding space, rhythm, and depth. Short delays thicken, longer delays create echoes.',
          tip: 'Add a quarter-note delay to a lead vocal and adjust the feedback until it sits behind the voice instead of crowding it.',
        },
        {
          id: 'effects.2',
          title: 'Reverb',
          body: 'Reverb simulates a room, gluing a mix together and making parts feel intentional. A little goes a long way — too much muddies clarity and washes out the mix.',
          tip: 'Send vocals and drums to one reverb bus and set the send so you only notice it when you mute it.',
        },
        {
          id: 'effects.3',
          title: 'When Less Is More',
          body: 'Effects serve the song: they should support, not decorate. Most worship mixes need less reverb than you think and more clarity than you fear.',
          tip: 'Run a verse with no effects at all, then bring effects in only as far as the song asks for them — and A/B to hear the difference.',
        },
      ],
    },
  ];

  var BRANCH_COUNT = SKILL_TREE.length;
  var LEVELS_PER_BRANCH = 3;
  var LEVEL_COUNT = BRANCH_COUNT * LEVELS_PER_BRANCH;

  /** Is this a level id that actually exists in the tree? */
  function isKnownLevelId(levelId) {
    for (var b = 0; b < SKILL_TREE.length; b++) {
      var levels = SKILL_TREE[b].levels;
      for (var l = 0; l < levels.length; l++) {
        if (levels[l].id === levelId) return true;
      }
    }
    return false;
  }

  /**
   * Load persisted progress. Best-effort and never-throwing: missing,
   * throwing, or garbage storage degrades to empty progress so the tree
   * always opens clean.
   */
  function loadProgress(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return { completed: [] };
      var raw = storage.getItem(KEY);
      if (!raw) return { completed: [] };
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.completed)) return { completed: [] };
      var seen = {};
      var completed = [];
      for (var i = 0; i < parsed.completed.length; i++) {
        var id = parsed.completed[i];
        if (typeof id === 'string' && id.length > 0 && !seen[id]) {
          seen[id] = true;
          completed.push(id);
        }
      }
      return { completed: completed };
    } catch {
      return { completed: [] };
    }
  }

  /** Persist progress, best-effort (no-op on private-mode/disabled storage). */
  function saveProgress(storage, progress) {
    try {
      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(KEY, JSON.stringify(progress));
      }
    } catch {
      /* private-mode / disabled storage — nothing we can persist, so no-op */
    }
  }

  /** Is this level id already in the progress list? */
  function isLevelComplete(progress, levelId) {
    return !!(progress && progress.completed && progress.completed.indexOf(levelId) !== -1);
  }

  /**
   * Toggle a level's completion. Pure: returns a new progress object and
   * never mutates the input. Unknown level ids are a no-op (an unchanged
   * copy).
   */
  function completeLevel(progress, levelId) {
    var completed = (progress && progress.completed) || [];
    if (!isKnownLevelId(levelId)) return { completed: completed.slice() };
    var idx = completed.indexOf(levelId);
    var next = idx === -1
      ? completed.concat([levelId])
      : completed.slice(0, idx).concat(completed.slice(idx + 1));
    return { completed: next };
  }

  /** Is every level of this branch complete? */
  function branchComplete(progress, branchId) {
    var branch = null;
    for (var b = 0; b < SKILL_TREE.length; b++) {
      if (SKILL_TREE[b].id === branchId) branch = SKILL_TREE[b];
    }
    if (!branch) return false;
    var completed = (progress && progress.completed) || [];
    for (var l = 0; l < branch.levels.length; l++) {
      if (completed.indexOf(branch.levels[l].id) === -1) return false;
    }
    return true;
  }

  /**
   * One badge per fully completed branch, derived from progress — badges are
   * never stored.
   */
  function badgesFor(progress) {
    var badges = [];
    for (var b = 0; b < SKILL_TREE.length; b++) {
      if (branchComplete(progress, SKILL_TREE[b].id)) {
        badges.push({ branchId: SKILL_TREE[b].id, title: SKILL_TREE[b].title });
      }
    }
    return badges;
  }

  /** First uncompleted level in tree order, or null when everything is done. */
  function nextLevelId(progress) {
    var completed = (progress && progress.completed) || [];
    for (var b = 0; b < SKILL_TREE.length; b++) {
      var levels = SKILL_TREE[b].levels;
      for (var l = 0; l < levels.length; l++) {
        if (completed.indexOf(levels[l].id) === -1) return levels[l].id;
      }
    }
    return null;
  }

  var api = {
    KEY: KEY,
    SKILL_TREE: SKILL_TREE,
    BRANCH_COUNT: BRANCH_COUNT,
    LEVELS_PER_BRANCH: LEVELS_PER_BRANCH,
    LEVEL_COUNT: LEVEL_COUNT,
    loadProgress: loadProgress,
    saveProgress: saveProgress,
    isLevelComplete: isLevelComplete,
    completeLevel: completeLevel,
    branchComplete: branchComplete,
    badgesFor: badgesFor,
    nextLevelId: nextLevelId,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.skillTreeState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);