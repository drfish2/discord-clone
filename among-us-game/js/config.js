/* Starship Sus — shared constants. See SPEC.md. */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});

  IS.CONFIG = {
    VERSION: 1,
    TILE: 48,
    PLAYER_RADIUS: 16,
    SPEED: 230, // px/s at settings.spd = 1
    MAX_PLAYERS: 10,
    MIN_PLAYERS: 3,

    // Vision radius in px at settings.cvis / ivis = 1
    VISION: 300,
    LIGHTS_OUT_VISION: 110,

    // Interaction ranges (px)
    USE_RANGE: 70,
    REPORT_RANGE: 140,
    KILL_RANGE: [70, 100, 140], // indexed by settings.kd (0 short, 1 medium, 2 long)
    VENT_RANGE: 60,

    SAB_TIME: 40, // seconds until a critical sabotage (reactor / o2) kills the crew
    SAB_COOLDOWN: 30,
    EJECT_TIME: 7, // seconds
    ROLE_TIME: 4.5,

    DEFAULT_SETTINGS: { imp: 1, kcd: 25, spd: 1, cvis: 1, ivis: 1.5, dis: 15, vot: 45, emg: 1, nt: 5, conf: 1, kd: 1, free: 0 },
    // [min, max] clamps used by host.js when applying `set`
    SETTINGS_LIMITS: {
      imp: [1, 3], kcd: [10, 60], spd: [0.5, 2], cvis: [0.25, 2], ivis: [0.25, 2.5],
      dis: [0, 60], vot: [15, 120], emg: [0, 3], nt: [1, 10], conf: [0, 1], kd: [0, 2], free: [0, 1]
    },

    // 12 crewmate colours: [name, body, shadow]
    COLORS: [
      ['Red', '#c51111', '#7a0838'],
      ['Blue', '#132ed1', '#09158e'],
      ['Green', '#117f2d', '#0a4d2e'],
      ['Pink', '#ed54ba', '#ab2bad'],
      ['Orange', '#ef7d0d', '#b33e15'],
      ['Yellow', '#f5f557', '#c38823'],
      ['Black', '#3f474e', '#1e1f26'],
      ['White', '#d6e0f0', '#8394bf'],
      ['Purple', '#6b2fbb', '#3b177c'],
      ['Brown', '#71491e', '#5e2615'],
      ['Cyan', '#38fedc', '#24a8be'],
      ['Lime', '#50ef39', '#15a742']
    ],

    ROOM_PREFIX: 'ss-',
    CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I / O
  };
})();
