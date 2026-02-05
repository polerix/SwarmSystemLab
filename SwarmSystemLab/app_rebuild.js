/*
  app_rebuild.js
  Rebuilt Swarm System Lab with Emoji assets, Liquid Glass UI support, and Self-Balancing logic.
*/

(() => {
  "use strict";

  /* =========================================================
     0) Utilities
  ========================================================= */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const irand = (a, b) => a + ((Math.random() * (b - a + 1)) | 0);
  const choice = (arr) => arr[(Math.random() * arr.length) | 0];

  /* =========================================================
     0b) Game Time (Cosmic Clockwork)
     - 1 in-game day = 20 minutes real time
     - => 72 game seconds per real second
     - Day phases per real-time budget:
         sunrise 1.5m, day 10m, sunset 1.5m, night 7m
  ========================================================= */
  const GAME_SECONDS_PER_REAL_SECOND = 72;
  const GAME_DAY_SECONDS = 24 * 60 * 60;
  const GAME_YEAR_DAYS = 365;
  const GAME_YEAR_SECONDS = GAME_YEAR_DAYS * GAME_DAY_SECONDS;

  // Phase fractions (must sum to 1)
  const DAY_PHASE = {
    sunrise: 0.075,
    day: 0.50,
    sunset: 0.075,
    night: 0.35
  };

  let gameSeconds = 0; // monotonically increasing

  // Weather events
  const WEATHER = { CLEAR: 'clear', WINDY: 'windy', RAIN: 'rain', SUNNY: 'sunny' };
  const weather = { kind: WEATHER.CLEAR, untilGS: 0 };

  function getDayPhase(tDayFrac) {
    // tDayFrac in [0,1)
    const a = DAY_PHASE.sunrise;
    const b = a + DAY_PHASE.day;
    const c = b + DAY_PHASE.sunset;

    if (tDayFrac < a) {
      const k = tDayFrac / a; // 0..1
      return { name: 'sunrise', isDay: true, isNight: false, light: 0.30 + 0.70 * k };
    }
    if (tDayFrac < b) {
      return { name: 'day', isDay: true, isNight: false, light: 1.0 };
    }
    if (tDayFrac < c) {
      const k = (tDayFrac - b) / DAY_PHASE.sunset;
      return { name: 'sunset', isDay: true, isNight: false, light: 1.0 - 0.70 * k };
    }
    return { name: 'night', isDay: false, isNight: true, light: 0.30 };
  }

  function dayFracFromGameSeconds(gs) {
    const d = ((gs % GAME_DAY_SECONDS) + GAME_DAY_SECONDS) % GAME_DAY_SECONDS;
    return d / GAME_DAY_SECONDS;
  }

  function currentPhase() {
    return getDayPhase(dayFracFromGameSeconds(gameSeconds));
  }

  function isShaded(x, y) {
    // Shade is provided by dirt/rock/leaf/wood(tree)
    // Simplified: if there is a solid tile above, or a leaf resource on surface, or a tree at this x.
    if (y <= 0) return false;
    const aboveSolid = tileAt(x, y - 1) !== TILE.AIR;
    if (aboveSolid) return true;
    if (trees.some(t => t.x === wrapX(x))) return true;
    if (resources.some(r => !r.dead && !r.carried && r.kind === 'leaf' && r.x === wrapX(x) && r.y === SURFACE_WALK_Y)) return true;
    return false;
  }

  function tickWeather(gsdt) {
    const ph = currentPhase();

    if (!weather.untilGS || gameSeconds >= weather.untilGS) {
      // Choose next weather event
      const r = Math.random();
      let kind = WEATHER.CLEAR;
      if (r < 0.10) kind = WEATHER.WINDY;
      else if (r < 0.20) kind = WEATHER.RAIN;
      else if (r < 0.30 && ph.isDay) kind = WEATHER.SUNNY;
      else kind = WEATHER.CLEAR;

      const dur = irand(2 * GS_HOUR, 6 * GS_HOUR);
      weather.kind = kind;
      weather.untilGS = gameSeconds + dur;
    }

    // Apply effects
    if (weather.kind === WEATHER.WINDY) {
      // Move leaves on the surface
      for (let n = 0; n < 25; n++) {
        const r = resources[(Math.random() * resources.length) | 0];
        if (!r || r.dead || r.carried) continue;
        if (r.kind !== 'leaf') continue;
        if (r.y !== SURFACE_WALK_Y) continue;
        const dir = Math.random() < 0.5 ? -1 : 1;
        r.x = wrapX(r.x + dir);
      }
    }

    if (weather.kind === WEATHER.RAIN) {
      // Wet up to 3 tiles deep + add water that flows downward
      for (let n = 0; n < 160; n++) {
        const x = irand(0, W - 1);
        // add surface water
        const si = idx(x, SURFACE_WALK_Y);
        water[si] = Math.min(5, water[si] + 0.25);
        // wet 3 deep
        for (let d = 0; d < 3; d++) {
          const y = surfaceY + d;
          const i = idx(x, y);
          moisture[i] = clamp(moisture[i] + 0.02, 0, 1);
        }
      }

      // Water flow: falls down until blocked, then absorbs
      for (let n = 0; n < 260; n++) {
        const x = irand(0, W - 1);
        const y = irand(0, H - 2);
        const i = idx(x, y);
        const wv = water[i];
        if (wv <= 0.001) continue;
        const bi = idx(x, y + 1);
        const below = tile[bi];
        if (below === TILE.AIR || below === TILE.TUNNEL) {
          const moved = Math.min(wv, 0.5);
          water[i] -= moved;
          water[bi] = Math.min(8, water[bi] + moved);
        } else {
          // absorb into moisture
          const take = Math.min(wv, 0.20);
          water[i] -= take;
          moisture[i] = clamp(moisture[i] + take * 0.04, 0, 1);
        }
      }
    }

    // Sunshine drying rules (daylight always dries; SUNNY event amplifies)
    const sunFactor = (ph.isDay ? 1 : 0) * (weather.kind === WEATHER.SUNNY ? 2.2 : 1.0);
    if (sunFactor > 0) {
      // Dry surface tiles to 3-tile height (moisture)
      for (let n = 0; n < 220; n++) {
        const x = irand(0, W - 1);
        for (let d = 0; d < 3; d++) {
          const y = surfaceY + d;
          const i = idx(x, y);
          if (isShaded(x, y)) continue;
          moisture[i] = clamp(moisture[i] - 0.0025 * sunFactor, 0, 1);
        }
      }

      // Dry water up to 2 tiles down unless shaded
      for (let n = 0; n < 220; n++) {
        const x = irand(0, W - 1);
        for (let d = 0; d < 2; d++) {
          const y = surfaceY + d;
          const i = idx(x, y);
          if (isShaded(x, y)) continue;
          const evap = Math.min(water[i], 0.05 * sunFactor);
          water[i] -= evap;
        }
      }
    }

    // Expose for UI
    window.SWARM_WEATHER = { kind: weather.kind, untilGS: weather.untilGS };
  }

  /* =========================================================
     1) Configuration & Toggles
  ========================================================= */
  const PLAY_FLAGS = {
    mealworm: true,
    beetle: true,
    worm: true,
    spider: true,
    ant_orange: true,
    ant_cyan: true,
    leaf: true,
    mushroom: true,
    protein: true,
    spore: true,
    sound_on: false,
    volume: 0.35
  };

  // Expose toggles
  window.SWARM_FLAGS = PLAY_FLAGS;
  window.saveFlags = () => {
    try { localStorage.setItem('swarm_flags_v2', JSON.stringify(PLAY_FLAGS)); } catch (e) { }
  };
  try {
    const saved = JSON.parse(localStorage.getItem('swarm_flags_v2') || '{}');
    if (saved) Object.assign(PLAY_FLAGS, saved);
  } catch (e) { }

  /* =========================================================
     2) Canvas & Camera
  ========================================================= */
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  let DPR = 1;
  const W = 220; // World Width
  const H = 140; // World Height
  const surfaceY = 34;
  const SURFACE_WALK_Y = surfaceY;

  function resize() {
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(innerWidth * DPR);
    canvas.height = Math.floor(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  addEventListener("resize", resize);
  setTimeout(resize, 100); // Force resize shortly after load

  const camera = {
    x: 110, y: 70,
    scale: 8.0,
    minScale: 4.0,
    maxScale: 22.0
  };

  const wrapX = (x) => ((x % W) + W) % W;
  const idx = (x, y) => wrapX(x) + y * W;
  const inb = (x, y) => y >= 0 && y < H;

  function worldToScreen(wx, wy) {
    const sx = (wx - camera.x) * camera.scale + innerWidth * 0.5;
    const sy = (wy - camera.y) * camera.scale + innerHeight * 0.5;
    return { sx, sy };
  }
  function screenToWorld(sx, sy) {
    const wx = (sx - innerWidth * 0.5) / camera.scale + camera.x;
    const wy = (sy - innerHeight * 0.5) / camera.scale + camera.y;
    return { wx, wy };
  }

  // Camera Input
  let draggingCam = false;
  let lastMX = 0, lastMY = 0;
  canvas.addEventListener("mousedown", (e) => {
    draggingCam = true;
    lastMX = e.clientX; lastMY = e.clientY;
  });
  addEventListener("mouseup", () => {
    draggingCam = false;
    localStorage.setItem('swarm_cam', JSON.stringify({ x: camera.x, y: camera.y, s: camera.scale }));
  });
  addEventListener("mousemove", (e) => {
    if (!draggingCam) return;
    const dx = e.clientX - lastMX;
    const dy = e.clientY - lastMY;
    lastMX = e.clientX; lastMY = e.clientY;
    camera.x -= dx / camera.scale;
    camera.y -= dy / camera.scale;
    // Keep camera bounded roughly or wrapped
    if (camera.x < 0) camera.x += W;
    if (camera.x >= W) camera.x -= W;
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = -Math.sign(e.deltaY);
    const factor = (delta > 0) ? 1.1 : 0.9;
    const before = screenToWorld(e.clientX, e.clientY);
    camera.scale = clamp(camera.scale * factor, camera.minScale, camera.maxScale);
    const after = screenToWorld(e.clientX, e.clientY);
    camera.x += (before.wx - after.wx);
    camera.y += (before.wy - after.wy);
  }, { passive: false });

  // Restore Camera Safely
  try {
    const cam = JSON.parse(localStorage.getItem('swarm_cam'));
    if (cam && isFinite(cam.x) && isFinite(cam.y) && isFinite(cam.s)) {
      camera.x = cam.x; camera.y = cam.y; camera.scale = cam.s;
    }
  } catch (e) { }

  /* =========================================================
     3) Simulation World
  ========================================================= */
  const TILE = { AIR: 0, SOIL: 1, TUNNEL: 2, ROCKS: 3, ROCKM: 4, ROCKL: 5, ROOT_DIRT: 6 };

  const tile = new Uint8Array(W * H);
  const moisture = new Float32Array(W * H);
  // Surface/underground water film (for rain + flow before absorption)
  const water = new Float32Array(W * H);
  // Root-dirt nutrient mass (poor nutrition, but crucial for trees/soil cycling)
  const rootMass = new Float32Array(W * H);
  // Fertility (slowly built from decomposed root-dirt)
  const fertility = new Float32Array(W * H);

  const tileAt = (x, y) => tile[idx(wrapX(x), y)];
  const setTile = (x, y, t) => tile[idx(wrapX(x), y)] = t;
  const isSoil = (x, y) => inb(x, y) && tileAt(x, y) === TILE.SOIL;

  function depositRootDirt(x, y, mass) {
    if (!inb(x, y)) return;
    const wx = wrapX(x);
    const i = idx(wx, y);
    rootMass[i] += mass;
    // Deposit into soil/tunnel as a root-dirt tile marker (poor nutrition)
    const t = tile[i];
    if (t === TILE.SOIL || t === TILE.TUNNEL) tile[i] = TILE.ROOT_DIRT;
  }

  const EMOJI = {
    ANT: '🐜',
    BEETLE: '🪲',
    WORM: '🪱',
    SPIDER: '🕷️',
    LEAF: '🍃',
    MUSHROOM: '🍄',
    PROTEIN: '🍖',
    SPORE: '🦠'
  };

  /* =========================================================
     Castes & Lifecycle Constants
  ========================================================= */
  const CASTE = {
    QUEEN: 0,
    EGG: 1,          // dormant, hatches after time (willBe determines outcome)
    NANITIC: 2,      // first-gen workers ("ninantic"), small, forage-focused
    WORKER: 3,       // standard workers: dig, haul, feed queen
    EXPLORER: 4,     // scouts: range further + lay food pheromones
    WARRIOR: 5,      // defenders: fight worms/beetles/enemy ants; retrieve foreign corpses
    MALE: 6          // escorted out (despawn on surface)
  };

  const ROLE = {
    IDLE: 0,
    FORAGE: 1,      // go to surface, find food, return
    DIG: 2,         // expand tunnels
    HAUL_DIRT: 3,   // carry dirt to surface mound
    FEED_QUEEN: 4,  // bring food to queen
    DEFEND: 5,      // attack threats
    SCOUT: 6        // long-range exploration + pheromone trails
  };

  // Colony lifecycle phases
  const PHASE = {
    FOUNDING: 0,   // queen alone, lays nanitic eggs
    NANITIC: 1,    // nanitics hatched, foraging to feed queen
    GROWING: 2,    // queen laying worker eggs
    MATURE: 3      // full colony operations
  };

  let nextId = 1;
  const ants = [];
  const mobs = [];
  const resources = [];
  const plants = [];
  const trees = [];

  // Surface pheromone field (food trails) - explorers lay it, workers follow it
  const pherFood = new Float32Array(W * H);
  function addPherFood(x, y, v) {
    if (!inb(x, y)) return;
    pherFood[idx(wrapX(x), y)] = clamp(pherFood[idx(wrapX(x), y)] + v, 0, 1000);
  }
  function pherAt(x, y) {
    if (!inb(x, y)) return 0;
    return pherFood[idx(wrapX(x), y)];
  }

  // Explorer recruitment pings: workers can latch onto a target and run a dedicated haul.
  const recruitSignals = []; // {team,x,y,kind,score,untilGS}
  const RECRUIT_MAX = 50;
  function addRecruit(team, x, y, kind, score = 10, ttlGS = 2 * GS_HOUR) {
    // Cap signals to prevent runaway memory/guidance spam
    if (recruitSignals.length >= RECRUIT_MAX) {
      // Replace the weakest/oldest
      let wi = 0;
      let wScore = Infinity;
      for (let i = 0; i < recruitSignals.length; i++) {
        const s = recruitSignals[i];
        const sc = (s.score || 0) + (s.untilGS - gameSeconds) * 0.001;
        if (sc < wScore) { wScore = sc; wi = i; }
      }
      recruitSignals.splice(wi, 1);
    }
    recruitSignals.push({ team, x: wrapX(x), y, kind, score, untilGS: gameSeconds + ttlGS });
  }
  function pruneRecruit() {
    for (let i = recruitSignals.length - 1; i >= 0; i--) {
      if (gameSeconds >= recruitSignals[i].untilGS) recruitSignals.splice(i, 1);
    }
  }
  function bestRecruitFor(team, ax, ay) {
    let best = null;
    let bestScore = -1;
    for (const s of recruitSignals) {
      if (s.team !== team) continue;
      const d = wrappedDist(ax, ay, s.x, s.y);
      const sc = s.score - d * 0.15;
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    return bestScore > 0 ? best : null;
  }

  // Helper: game-time durations
  const GS_HOUR = 60 * 60;
  const GS_DAY = GAME_DAY_SECONDS;
  const GS_WEEK = 7 * GS_DAY;
  const GS_MONTH = 30 * GS_DAY;
  const GS_YEAR = GAME_YEAR_SECONDS;

  // Lifecycle stats (global ordering constraints)
  // Attack: Egg < Adult < Juvenile
  // Defense: Egg < Adult < Juvenile
  // Food: Egg < Juvenile < Adult
  const STAGE = { EGG: 'egg', JUV: 'juvenile', ADULT: 'adult' };
  const STAGE_MUL = {
    egg: { atk: 0.5, def: 0.5, food: 0.35 },
    juvenile: { atk: 1.25, def: 1.25, food: 0.70 },
    adult: { atk: 0.85, def: 0.85, food: 1.00 }
  };
  function applyStageStats(ent, base) {
    const m = STAGE_MUL[ent.stage] || STAGE_MUL.adult;
    ent.atk = base.atk * m.atk;
    ent.def = base.def * m.def;
    ent.foodValue = base.food * m.food;
    // corpse bonus: additional edible value; keep it near base food
    ent.corpseBonus = base.food;
  }

  // Team color palette (team id -> CSS color)
  const TEAM_COLORS = ["orange", "cyan", "#a3ff5f", "#ff5fe1", "#ffd25f", "#5fb4ff", "#c75fff"];
  function teamColor(team) {
    if (TEAM_COLORS[team]) return TEAM_COLORS[team];
    // deterministic-ish fallback
    const hue = (team * 137.5) % 360;
    return `hsl(${hue} 90% 60%)`;
  }

  function newColony(team, homeX, homeY) {
    const c = {
      team,
      homeX: wrapX(homeX),
      homeY: clamp(homeY, surfaceY + 5, H - 5),
      queenId: -1,
      phase: PHASE.FOUNDING,
      foodStore: 10,
      eggTimer: 0,
      naniticCount: 0,
      workerCount: 0,
      respawnAtGS: 0,
      founding: { entranceX: wrapX(homeX), entranceY: SURFACE_WALK_Y, sealed: false, dugToY: SURFACE_WALK_Y },
      foreignFed: 0,
      queenBabyId: -1,
      maleEggChance: 0.08,
      maleTargetOnTrees: 1,
      thrive: { qbSpawnedAtGS: 0, qbFailStreak: 0, qbLastMateAtGS: 0 }
    };
    colonies.push(c);
    return c;
  }

  function allocTeam() {
    // allocate next unused integer id
    let t = 0;
    while (colonies.some(c => c.team === t)) t++;
    return t;
  }

  const colonies = [
    { 
      team: 0, homeX: 0, homeY: 0, queenId: -1,
      phase: PHASE.FOUNDING,
      foodStore: 10,      // food available to queen
      eggTimer: 0,
      naniticCount: 0,
      workerCount: 0,
      respawnAtGS: 0,
      founding: { entranceX: 0, entranceY: SURFACE_WALK_Y, sealed: false, dugToY: 0 },
      foreignFed: 0,
      queenBabyId: -1,
      maleEggChance: 0.08,
      maleTargetOnTrees: 1,
      thrive: { qbSpawnedAtGS: 0, qbFailStreak: 0, qbLastMateAtGS: 0 }
    },
    { 
      team: 1, homeX: 0, homeY: 0, queenId: -1,
      phase: PHASE.FOUNDING,
      foodStore: 10,
      eggTimer: 0,
      naniticCount: 0,
      respawnAtGS: 0,
      workerCount: 0,
      founding: { entranceX: 0, entranceY: SURFACE_WALK_Y, sealed: false, dugToY: 0 },
      foreignFed: 0,
      queenBabyId: -1,
      maleEggChance: 0.08,
      maleTargetOnTrees: 1,
      thrive: { qbSpawnedAtGS: 0, qbFailStreak: 0, qbLastMateAtGS: 0 }
    }
  ];

  /* =========================================================
     Diagnostic Tracking
  ========================================================= */
  const diag = {
    // Rolling window accumulators (reset every N seconds)
    windowSec: 5,
    timer: 0,
    // Per-window counters
    foodGathered: 0,
    foodConsumed: 0,
    tunnelsDug: 0,
    antDeaths: 0,
    antDeathsByPredator: 0,
    stuckMoves: 0,
    totalMoves: 0,
    // Snapshot values (computed at window end)
    foodPressure: 0,      // positive = deficit
    tunnelRate: 0,
    predationRate: 0,
    pathingFail: 0,       // fraction of stuck moves
    verdict: 'Colony stable.'
  };

  function diagReset() {
    diag.foodGathered = 0;
    diag.foodConsumed = 0;
    diag.tunnelsDug = 0;
    diag.antDeaths = 0;
    diag.antDeathsByPredator = 0;
    diag.stuckMoves = 0;
    diag.totalMoves = 0;
  }

  function diagCompute() {
    // Food pressure: consumed - gathered (higher = worse)
    diag.foodPressure = diag.foodConsumed - diag.foodGathered;

    // Tunnel rate per second
    diag.tunnelRate = diag.tunnelsDug / diag.windowSec;

    // Predation: deaths by predator / total deaths (0-1)
    diag.predationRate = diag.antDeaths > 0 ? diag.antDeathsByPredator / diag.antDeaths : 0;

    // Pathing fail: stuck / total moves
    diag.pathingFail = diag.totalMoves > 0 ? diag.stuckMoves / diag.totalMoves : 0;

    // Generate verdict
    const issues = [];
    if (diag.foodPressure > 5) issues.push('Food deficit: ants starving faster than foraging.');
    if (diag.tunnelRate < 0.5 && ants.length > 10) issues.push('Low dig rate: expansion stalled.');
    if (diag.predationRate > 0.5) issues.push('High predation: mobs are decimating the colony.');
    if (diag.pathingFail > 0.4) issues.push('Pathing issues: ants frequently blocked.');

    if (issues.length === 0) {
      diag.verdict = 'Colony stable.';
    } else {
      diag.verdict = issues.join(' ');
    }
  }

  function diagTick(dt) {
    diag.timer += dt;
    if (diag.timer >= diag.windowSec) {
      diag.timer = 0;
      diagCompute();
      diagReset();
    }
  }

  /* =========================================================
     4) Simulation Logic
  ========================================================= */
  function wrappedDist(x1, y1, x2, y2) {
    let dx = Math.abs(wrapX(x1) - wrapX(x2));
    dx = Math.min(dx, W - dx);
    return dx + Math.abs(y1 - y2);
  }

  function passableForAnt(x, y) {
    if (!inb(x, y)) return false;
    if (y === SURFACE_WALK_Y) return true;
    return tileAt(wrapX(x), y) === TILE.TUNNEL;
  }

  function spawnAnt(team, caste, x, y) {
    const a = {
      id: nextId++, team, caste, x, y,
      hp: 100, hpMax: 100, e: 100, eMax: 100,
      atk: 6, def: 6,
      role: ROLE.IDLE, carried: null, carriedKind: null,
      moveT: 0, age: 0, hatchTime: 0,
      life: 2000 + Math.random() * 500,
      bornAtGS: gameSeconds,
      dieAtGS: gameSeconds + (40 * GS_DAY),
      target: null,  // {x, y} for pathfinding goals
      mem: {}
    };
    
    if (caste === CASTE.QUEEN) { 
      a.hpMax = 5000; a.hp = 5000; a.life = 999999;
      a.atk = 4; a.def = 18;
      a.dieAtGS = gameSeconds + (9999 * GS_YEAR);
    } else if (caste === CASTE.EGG) {
      a.hp = 20; a.hpMax = 20;
      a.atk = 1; a.def = 1;
      a.hatchTime = 8 + Math.random() * 4; // seconds to hatch
      a.willBe = CASTE.NANITIC; // what it hatches into
      a.dieAtGS = gameSeconds + (5 * GS_DAY);
    } else if (caste === CASTE.NANITIC) {
      a.hp = 55; a.hpMax = 55; a.life = 800 + Math.random() * 200;
      a.atk = 7; a.def = 7;
      a.role = ROLE.FORAGE;
      a.dieAtGS = gameSeconds + (18 * GS_DAY);
    } else if (caste === CASTE.WORKER) {
      a.hp = 95; a.hpMax = 95; a.life = 1500 + Math.random() * 500;
      a.atk = 8; a.def = 8;
      a.role = ROLE.IDLE;
      a.dieAtGS = gameSeconds + (30 * GS_DAY);
    } else if (caste === CASTE.EXPLORER) {
      a.hp = 80; a.hpMax = 80;
      a.atk = 9; a.def = 9;
      a.role = ROLE.SCOUT;
      a.dieAtGS = gameSeconds + (25 * GS_DAY);
    } else if (caste === CASTE.WARRIOR) {
      a.hp = 150; a.hpMax = 150;
      a.atk = 16; a.def = 16;
      a.role = ROLE.DEFEND;
      a.dieAtGS = gameSeconds + (22 * GS_DAY);
    } else if (caste === CASTE.MALE) {
      a.hp = 35; a.hpMax = 35;
      a.atk = 2; a.def = 2;
      a.role = ROLE.IDLE;
      // Long enough to be found; will also die after mating.
      a.dieAtGS = gameSeconds + (10 * GS_DAY);
    }
    
    ants.push(a);
    return a;
  }

  function spawnMob(type, x, y, opts = {}) {
    // All lifeforms participate in Egg -> Juvenile -> Adult, then Root-dirt on death.
    const base = (
      type === 'worm' ? { hp: 120, atk: 6, def: 10, food: 12, life: 40 * GS_DAY } :
      type === 'mealworm' ? { hp: 55, atk: 5, def: 9, food: 10, life: 25 * GS_DAY } :
      type === 'beetle' ? { hp: 75, atk: 10, def: 10, food: 16, life: 18 * GS_DAY } :
      type === 'spider' ? { hp: 90, atk: 16, def: 8, food: 14, life: 22 * GS_DAY } :
      { hp: 50, atk: 10, def: 10, food: 10, life: 20 * GS_DAY }
    );

    const m = {
      id: nextId++,
      type,
      x: wrapX(x),
      y,
      stage: opts.stage || STAGE.ADULT,
      hp: base.hp,
      hpMax: base.hp,
      atk: base.atk,
      def: base.def,
      foodValue: base.food,
      corpseBonus: base.food,
      moveT: 0,
      dead: false,
      e: opts.e ?? 100,
      eMax: opts.eMax ?? 100,
      bornAtGS: gameSeconds,
      dieAtGS: gameSeconds + (opts.lifespanGS ?? base.life),
      // lifecycle timers
      hatchAtGS: opts.hatchAtGS || 0,
      adultAtGS: opts.adultAtGS || 0,
      // behavior state
      state: opts.state || 'wander',
      foodCap: opts.foodCap || 40,
      foodHeld: opts.foodHeld || 0,
      mateCooldownAtGS: 0
    };

    // Apply global stage-based stat curve
    applyStageStats(m, base);

    // Stage-specific HP scaling (keeps ordering readable)
    if (m.stage === STAGE.EGG) { m.hpMax = Math.max(5, base.hp * 0.25); m.hp = m.hpMax; }
    if (m.stage === STAGE.JUV) { m.hpMax = base.hp * 0.80; m.hp = m.hpMax; }

    mobs.push(m);
    return m;
  }

  function addRes(kind, x, y, extra = {}) {
    resources.push({ id: nextId++, kind, x: wrapX(x), y, amt: 10, dead: false, ...extra });
  }

  // --- SPAWNERS & TOGGLES ---
  function checkToggles() {
    if (!PLAY_FLAGS.mealworm) removeMobs(m => m.type === 'mealworm');
    if (!PLAY_FLAGS.beetle) removeMobs(m => m.type === 'beetle' || m.type === 'beetleEgg');
    if (!PLAY_FLAGS.worm) removeMobs(m => m.type === 'worm');
    if (!PLAY_FLAGS.spider) removeMobs(m => m.type === 'spider');

    if (!PLAY_FLAGS.ant_orange) killColony(0);
    if (!PLAY_FLAGS.ant_cyan) killColony(1);

    if (!PLAY_FLAGS.leaf) removeRes('leaf');
  }

  function removeMobs(pred) {
    for (let i = mobs.length - 1; i >= 0; i--) {
      if (pred(mobs[i])) mobs.splice(i, 1);
    }
  }
  function removeRes(kind) {
    for (let i = resources.length - 1; i >= 0; i--) {
      if (resources[i].kind === kind) resources.splice(i, 1);
    }
  }
  function killColony(team) {
    for (let i = ants.length - 1; i >= 0; i--) {
      if (ants[i].team === team) ants.splice(i, 1);
    }
    colonies[team].queenId = -1;
    colonies[team].phase = PHASE.FOUNDING;
    colonies[team].foodStore = 10;
    colonies[team].naniticCount = 0;
    colonies[team].workerCount = 0;
    // If ant colony dies off, wait a day and respawn a new queen.
    colonies[team].respawnAtGS = gameSeconds + GAME_DAY_SECONDS;
  }
  function respawnColony(team) {
    if (colonies[team].queenId !== -1) return;
    const c = colonies[team];
    if (gameSeconds < (c.respawnAtGS || 0)) return;

    // Queen starts on the surface, chews off wings (instant), then digs a founding chamber.
    c.founding.entranceX = c.homeX;
    c.founding.entranceY = SURFACE_WALK_Y;
    c.founding.sealed = false;
    c.founding.dugToY = SURFACE_WALK_Y;

    const q = spawnAnt(team, CASTE.QUEEN, c.homeX, SURFACE_WALK_Y);
    q.mem.wingsChewed = true;
    q.mem.founding = true;

    // Set homeY target depth (deep enough)
    c.homeY = surfaceY + 15;

    c.queenId = q.id;
    c.phase = PHASE.FOUNDING;
    c.foodStore = 10;
    c.eggTimer = 0;
    c.naniticCount = 0;
    c.workerCount = 0;
    c.foreignFed = 0;
    c.respawnAtGS = 0;
  }

  // --- AI LOGIC ---
  // Root-dirt slowly sinks, filling tunnels over geologic time.
  // Also converts into fertility (very slowly).
  let rootSinkAcc = 0;
  const ROOT_SINK_INTERVAL_GS = 4 * GAME_YEAR_SECONDS;

  // Fertility conversion rate: rootMass -> fertility per in-game second
  const ROOT_TO_FERT_RATE = 0.000002; // slow on purpose
  function rootDirtSinkStep() {
    // bottom-up so a tile doesn't move twice in one pass
    for (let y = H - 2; y >= 0; y--) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        if (tile[i] !== TILE.ROOT_DIRT) continue;
        const by = y + 1;
        if (!inb(x, by)) continue;
        const bi = idx(x, by);
        const below = tile[bi];
        // Root-dirt stops going down until free/consumed.
        // Treat AIR and TUNNEL as "free" (tunnels get filled in).
        if (below === TILE.AIR || below === TILE.TUNNEL) {
          tile[bi] = TILE.ROOT_DIRT;
          rootMass[bi] += rootMass[i];
          rootMass[i] = 0;
          tile[i] = TILE.SOIL;
        }
      }
    }
  }

  function tickSimulation(dt) {
    // Advance cosmic clock
    gameSeconds += dt * GAME_SECONDS_PER_REAL_SECOND;

    // Expose time for UI (orb position)
    const ph = currentPhase();
    const frac = dayFracFromGameSeconds(gameSeconds);
    window.SWARM_TIME = {
      isDay: ph.isDay,
      isNight: ph.isNight,
      phase: ph.name,
      light: ph.light,
      dayPhase: frac,  // 0..1 across day
      dayT: ph.light   // used for simple vertical bob
    };

    // Weather
    tickWeather(dt * GAME_SECONDS_PER_REAL_SECOND);

    // Track queen babies per colony (for escort behavior)
    for (const c of colonies) c.queenBabyId = -1;
    for (const a of ants) {
      if (a.caste === CASTE.QUEEN && a.mem.queenBaby && a.mem.originTeam !== undefined) {
        const c = colonies.find(cc => cc.team === a.mem.originTeam);
        if (c) c.queenBabyId = a.id;
      }
    }

    // Thrive controller (KPI #1): Queen baby should mate within 1 in-game day of spawning.
    for (const c of colonies) {
      if (!c.thrive) c.thrive = { qbSpawnedAtGS: 0, qbFailStreak: 0, qbLastMateAtGS: 0 };

      if (c.thrive.qbSpawnedAtGS && (gameSeconds - c.thrive.qbSpawnedAtGS) > GS_DAY) {
        // Failure: queen baby didn't mate in time. Escalate male availability.
        c.thrive.qbFailStreak = (c.thrive.qbFailStreak || 0) + 1;
        c.thrive.qbSpawnedAtGS = gameSeconds; // start another window

        // escalate target males on trees temporarily (cap at 3)
        c.maleTargetOnTrees = clamp(1 + c.thrive.qbFailStreak, 1, 3);
      }

      // Adaptive male production: aim for maleTargetOnTrees males on trees per colony.
      const males = ants.filter(a => a.team === c.team && a.caste === CASTE.MALE && a.y === SURFACE_WALK_Y);
      const malesOnTrees = males.filter(m => trees.some(t => t.x === m.x)).length;
      const need = (c.maleTargetOnTrees || 1);

      // If we are below need, boost chance; otherwise decay toward baseline.
      const boost = 0.35 + 0.10 * Math.min(3, (c.thrive.qbFailStreak || 0));
      const targetChance = (malesOnTrees < need) ? boost : 0.06;
      c.maleEggChance = c.maleEggChance ?? 0.08;
      c.maleEggChance += (targetChance - c.maleEggChance) * 0.04; // slow nudges
      c.maleEggChance = clamp(c.maleEggChance, 0.01, 0.75);
    }

    // Pheromone evaporation (surface only)
    // Scale evaporation a bit with intensity to avoid full saturation.
    const evapBase = dt * 2.0;
    for (let x = 0; x < W; x++) {
      const i = idx(x, SURFACE_WALK_Y);
      const v = pherFood[i];
      const evap = evapBase + v * dt * 0.003;
      pherFood[i] = Math.max(0, v - evap);
    }

    pruneRecruit();

    // 0. Root-dirt -> fertility (slow conversion)
    const gsdt = dt * GAME_SECONDS_PER_REAL_SECOND;
    // Sample-based update to keep it cheap
    const samples = 180;
    for (let s = 0; s < samples; s++) {
      const x = irand(0, W - 1);
      const y = irand(surfaceY, H - 1);
      const i = idx(x, y);
      const rm = rootMass[i];
      if (rm <= 0) continue;
      const take = Math.min(rm, rm * ROOT_TO_FERT_RATE * gsdt * 500); // scale up due to sampling
      rootMass[i] -= take;
      fertility[i] = Math.min(1000, fertility[i] + take);
    }

    // 0. Corpse timeout (1h in-game)
    for (let i = resources.length - 1; i >= 0; i--) {
      const r = resources[i];
      if (r.kind === 'corpse' && r.expireAtGS && gameSeconds >= r.expireAtGS && !r.carried) {
        resources.splice(i, 1);
      }
    }

    // 0b. Root-dirt sinking
    rootSinkAcc += dt * GAME_SECONDS_PER_REAL_SECOND;
    if (rootSinkAcc >= ROOT_SINK_INTERVAL_GS) {
      rootSinkAcc = 0;
      rootDirtSinkStep();
    }

    // 1. Ants
    for (const a of ants) {
      if (a.hp <= 0) continue;
      if (a.dieAtGS && gameSeconds >= a.dieAtGS) { a.dead = true; continue; }

      a.moveT += dt;
      if (a.moveT > 0.15) {
        a.moveT = 0;
        stepAnt(a);
      }

      a.e -= dt * 0.5;
      if (a.e <= 0) {
        a.hp -= dt * 2;
        diag.foodConsumed += dt * 0.1; // proxy for starvation drain
      }
      if (a.hp <= 0) a.dead = true;
    }
    for (let i = ants.length - 1; i >= 0; i--) {
      if (ants[i].dead) {
        const aDead = ants[i];
        diag.antDeaths++;
        if (aDead._killedByMob) diag.antDeathsByPredator++;

        // Universal death/decay: deposit root-dirt into soil (poor nutrition)
        // Root-dirt amount is based on stage food value.
        const stageFood = (aDead.caste === CASTE.EGG) ? 3 : 10;
        depositRootDirt(aDead.x, aDead.y, stageFood);

        // Fresh kill: corpse provides additional food value if consumed within 1h game time.
        addRes('corpse', aDead.x, aDead.y, {
          food: stageFood,
          bonusFood: stageFood, // "additional" portion
          expireAtGS: gameSeconds + 60 * 60,
          team: aDead.team,
          from: 'ant'
        });

        ants.splice(i, 1);
      }
    }

    // 2. Mobs
    for (const m of mobs) {
      if (m.hp <= 0) continue;
      m.moveT += dt;
      if (m.moveT > 0.25) {
        m.moveT = 0;
        stepMob(m);
      }
      if (m.hp <= 0) m.dead = true;
    }
    for (let i = mobs.length - 1; i >= 0; i--) {
      if (mobs[i].dead) {
        const md = mobs[i];
        // Universal death/decay: deposit root-dirt into soil based on stage food value
        depositRootDirt(md.x, md.y, md.foodValue || 10);

        // Fresh kill bonus: edible corpse window (1h in-game)
        addRes('corpse', md.x, md.y, {
          food: md.foodValue || 10,
          bonusFood: md.corpseBonus || (md.foodValue || 10),
          expireAtGS: gameSeconds + 60 * 60
        });

        mobs.splice(i, 1);
      }
    }

    // 2b. Trees + apples (new system)
    for (let i = trees.length - 1; i >= 0; i--) {
      const t = trees[i];
      const age = gameSeconds - t.bornAtGS;

      // Growth
      const matureAt = t.matureAtGS;
      const k = clamp((gameSeconds - t.bornAtGS) / (matureAt - t.bornAtGS), 0, 1);
      t.scale = 1 + 3 * k; // up to 400%
      t.tiles = Math.max(1, Math.round(t.scale));

      // Apple production (once mature)
      if (gameSeconds >= matureAt && gameSeconds >= (t.nextAppleAtGS || 0)) {
        // Drop an apple near the tree
        addRes('apple', t.x, SURFACE_WALK_Y, {
          rotAtGS: gameSeconds + 2 * GS_DAY,
          bornAtGS: gameSeconds
        });
        t.nextAppleAtGS = gameSeconds + irand(1 * GS_DAY, 3 * GS_DAY);
      }

      // Death -> root-dirt column (amount equals tiles occupied at death)
      if (gameSeconds >= t.dieAtGS) {
        for (let j = 0; j < t.tiles; j++) {
          depositRootDirt(t.x, SURFACE_WALK_Y + j, 1);
        }
        trees.splice(i, 1);
      }
    }

    // Resource aging: apple -> rotten_apple, and rotten_apple can seed trees
    for (const r of resources) {
      if (r.kind === 'apple' && r.rotAtGS && gameSeconds >= r.rotAtGS) {
        r.kind = 'rotten_apple';
        r.rottedAtGS = gameSeconds;
        // 2% chance: rotten apple grows a tree
        if (Math.random() < 0.02) {
          // Avoid stacking too many trees on same x
          const hasTree = trees.some(t => t.x === r.x);
          if (!hasTree) {
            trees.push({
              x: r.x,
              bornAtGS: gameSeconds,
              matureAtGS: gameSeconds + 2 * GS_MONTH,
              dieAtGS: gameSeconds + 4 * GS_YEAR,
              scale: 1,
              tiles: 1,
              nextAppleAtGS: gameSeconds + 2 * GS_DAY
            });
          }
        }
      }
    }

    // 3. Spawners
    if (Math.random() < 0.05) {
      if (PLAY_FLAGS.leaf && Math.random() < 0.4) {
        addRes('leaf', irand(0, W), SURFACE_WALK_Y);
      }
      if (PLAY_FLAGS.beetle && Math.random() < 0.03) spawnMob('beetle', irand(0, W), SURFACE_WALK_Y);
      if (PLAY_FLAGS.mealworm && Math.random() < 0.02) spawnMob('mealworm', irand(0, W), SURFACE_WALK_Y);
      if (PLAY_FLAGS.spider && Math.random() < 0.015) spawnMob('spider', irand(0, W), SURFACE_WALK_Y);
      if (PLAY_FLAGS.worm && Math.random() < 0.01) spawnMob('worm', irand(0, W), irand(surfaceY + 10, H - 10));
    }
  }

  function stepAnt(a) {
    const c = colonies[a.team];
    
    // === EGG: just incubate ===
    if (a.caste === CASTE.EGG) {
      a.age += 0.15; // roughly matches moveT interval
      if (a.age >= a.hatchTime) {
        // Hatch!
        a.caste = a.willBe || CASTE.NANITIC;
        a.age = 0;

        if (a.caste === CASTE.NANITIC) {
          a.hp = 55; a.hpMax = 55;
          a.atk = 7; a.def = 7;
          a.role = ROLE.FORAGE;
          c.naniticCount++;
        } else if (a.caste === CASTE.WORKER) {
          // 1/100 worker ant hatch as a queen baby
          if (Math.random() < 0.01) {
            a.caste = CASTE.QUEEN;
            a.mem.queenBaby = true;
            a.mem.originTeam = a.team;
            a.mem.newTeam = allocTeam();
            a.mem.waitingMate = true;
            // record spawn for thrive controller
            const oc = colonies.find(cc => cc.team === a.mem.originTeam);
            if (oc) oc.thrive.qbSpawnedAtGS = gameSeconds;
            // queen baby is overfed (boost)
            a.hpMax = 220; a.hp = 220;
            a.atk = 6; a.def = 14;
            a.role = ROLE.IDLE;
          } else {
            a.hp = 95; a.hpMax = 95;
            a.atk = 8; a.def = 8;
            a.role = ROLE.IDLE;
            c.workerCount++;
          }
        } else if (a.caste === CASTE.EXPLORER) {
          a.hp = 80; a.hpMax = 80;
          a.atk = 9; a.def = 9;
          a.role = ROLE.SCOUT;
        } else if (a.caste === CASTE.WARRIOR) {
          a.hp = 150; a.hpMax = 150;
          a.atk = 16; a.def = 16;
          a.role = ROLE.DEFEND;
        } else if (a.caste === CASTE.MALE) {
          a.hp = 35; a.hpMax = 35;
          a.atk = 2; a.def = 2;
          a.role = ROLE.IDLE;
        }
      }
      return;
    }
    
    // === QUEEN: founding behavior + egg strategy ===
    if (a.caste === CASTE.QUEEN) {
      // Queen baby (new colony) behavior
      if (a.mem.queenBaby) {
        // Escorted out: head to surface
        if (a.y > SURFACE_WALK_Y) {
          moveToward(a, a.x, SURFACE_WALK_Y);
          return;
        }

        // Find a tree to climb
        let tx = null;
        if (trees.length) {
          // nearest tree
          let best = trees[0].x, bd = 9999;
          for (const t of trees) {
            const d = Math.abs(wrapX(t.x) - wrapX(a.x));
            if (d < bd) { bd = d; best = t.x; }
          }
          tx = best;
        }
        if (tx !== null) {
          moveToward(a, tx, SURFACE_WALK_Y);
        } else {
          // no trees yet, wander west
          a.x = wrapX(a.x - 1);
        }

        // Mate trigger: if a male is on this tile on surface
        const maleHere = ants.find(an => an.team === a.mem.originTeam && an.caste === CASTE.MALE && an.y === SURFACE_WALK_Y && an.x === a.x);
        if (maleHere) {
          // male consumed by destiny
          maleHere.dead = true;

          // Thrive controller: successful mating within window
          const oc = colonies.find(cc => cc.team === a.mem.originTeam);
          if (oc && oc.thrive) {
            oc.thrive.qbLastMateAtGS = gameSeconds;
            oc.thrive.qbFailStreak = Math.max(0, (oc.thrive.qbFailStreak || 0) - 1);
            oc.thrive.qbSpawnedAtGS = 0;
            oc.maleTargetOnTrees = 1;
          }

          // Found a new color colony
          const newTeam = a.mem.newTeam;
          // Switch this queen baby's team and initialize colony state
          a.team = newTeam;
          a.mem.queenBaby = false;
          // Clear any escorts still targeting this queen baby
          for (const w of ants) {
            if (w.mem.escortQueenBabyId === a.id) w.mem.escortQueenBabyId = null;
          }
          a.mem.founding = true;

          const nc = newColony(newTeam, a.x, surfaceY + 15);
          nc.queenId = a.id;
          // set tiles for entrance initially
          nc.founding.entranceX = a.x;
          nc.founding.sealed = false;
          // place queen at surface entrance
          a.x = nc.homeX;
          a.y = SURFACE_WALK_Y;

          return;
        }

        return;
      }

      // Queen lifespan
      if (a.dieAtGS && gameSeconds >= a.dieAtGS) { a.dead = true; return; }

      c.eggTimer += 0.15;

      // Founding: queen starts at surface, digs to chamber depth, seals entrance, then lays nanitics.
      if (a.mem.founding) {
        const ex = c.founding.entranceX;
        // Dig vertical shaft at entrance
        if (!c.founding.sealed) {
          if (a.y < c.homeY) {
            // dig down one tile per step
            const ny = a.y + 1;
            setTile(ex, ny, TILE.TUNNEL);
            a.x = ex; a.y = ny;
            c.founding.dugToY = ny;
            return;
          }
          // At chamber depth: create a small chamber
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (inb(ex + dx, c.homeY + dy)) setTile(ex + dx, c.homeY + dy, TILE.TUNNEL);
            }
          }
          // Seal (plug) the surface entrance
          setTile(ex, SURFACE_WALK_Y, TILE.SOIL);
          c.founding.sealed = true;
        }
        // Keep queen at chamber
        a.x = ex; a.y = c.homeY;
      }

      // Egg laying logic by phase
      if (c.phase === PHASE.FOUNDING) {
        // Lay ninantics (4-6)
        const target = 4 + irand(0, 2);
        const naniticEggs = ants.filter(ant => ant.team === a.team && ant.caste === CASTE.EGG && ant.willBe === CASTE.NANITIC).length;
        if (naniticEggs < target && c.eggTimer > 3 && c.foodStore > 1) {
          const egg = spawnAnt(a.team, CASTE.EGG, a.x, a.y);
          egg.willBe = CASTE.NANITIC;
          c.foodStore -= 1;
          c.eggTimer = 0;
        }
        if (c.founding.sealed && c.naniticCount >= 1) c.phase = PHASE.NANITIC;
      } else if (c.phase === PHASE.NANITIC) {
        // Once nanitics have food coming in, start worker era
        if (c.foodStore >= 18 && c.naniticCount >= 2) {
          c.phase = PHASE.GROWING;
          // Any surviving ninantics are fed to the queen at this point
          for (let i = ants.length - 1; i >= 0; i--) {
            const an = ants[i];
            if (an.team === a.team && an.caste === CASTE.NANITIC) {
              c.foodStore += 3;
              an.dead = true;
              ants.splice(i, 1);
            }
          }
          c.naniticCount = 0;
        }
      } else if (c.phase === PHASE.GROWING) {
        // Lay worker eggs (female workers) and some males
        const workerEggs = ants.filter(ant => ant.team === a.team && ant.caste === CASTE.EGG && ant.willBe === CASTE.WORKER).length;
        const maleEggs = ants.filter(ant => ant.team === a.team && ant.caste === CASTE.EGG && ant.willBe === CASTE.MALE).length;

        if (c.eggTimer > 2 && c.foodStore > 2) {
          const egg = spawnAnt(a.team, CASTE.EGG, a.x, a.y);
          // Adaptive male chance (aim: at least one male on a tree somewhere)
          const maleChance = c.maleEggChance ?? 0.08;
          if (Math.random() < maleChance && maleEggs < 4) egg.willBe = CASTE.MALE;
          else egg.willBe = CASTE.WORKER;
          c.foodStore -= 2;
          c.eggTimer = 0;
        }

        // When the new batch of eggs hatch, they are all female workers (we approximate by reaching workerCount)
        if (c.workerCount >= 6) {
          // Lay 4-6 explorers
          const explorers = ants.filter(ant => ant.team === a.team && ant.caste === CASTE.EXPLORER).length;
          if (explorers < 4) {
            const n = 4 + irand(0, 2);
            for (let k = 0; k < n; k++) spawnAnt(a.team, CASTE.EXPLORER, a.x, a.y);
          }
          c.phase = PHASE.MATURE;
        }
      } else if (c.phase === PHASE.MATURE) {
        // Mature: continue laying workers, and produce warriors when foreign corpses are fed.
        if (c.eggTimer > 2 && c.foodStore > 3) {
          const egg = spawnAnt(a.team, CASTE.EGG, a.x, a.y);
          egg.willBe = CASTE.WORKER;
          c.foodStore -= 3;
          c.eggTimer = 0;
        }

        if (c.foreignFed > 0) {
          const n = 4 + irand(0, 2);
          for (let k = 0; k < n; k++) spawnAnt(a.team, CASTE.WARRIOR, a.x, a.y);
          c.foreignFed = 0;
        }
      }

      return;
    }
    
    // === NANITIC: forage to surface, find food, bring to queen ===
    if (a.caste === CASTE.NANITIC) {
      stepNanitic(a, c);
      return;
    }
    
    // === WORKER: dig, haul dirt, gather food, feed queen, defend ===
    if (a.caste === CASTE.WORKER) {
      stepWorker(a, c);
      return;
    }

    // === EXPLORER: long-range forage + pheromone trails ===
    if (a.caste === CASTE.EXPLORER) {
      stepExplorer(a, c);
      return;
    }

    // === WARRIOR: defend colony, retrieve foreign corpses ===
    if (a.caste === CASTE.WARRIOR) {
      stepWarrior(a, c);
      return;
    }

    // === MALE: escorted out to surface then despawn ===
    if (a.caste === CASTE.MALE) {
      stepMale(a, c);
      return;
    }
  }

  function stepNanitic(a, c) {
    // Ninantics purpose:
    // - Unplug the hole (open the sealed entrance)
    // - Find food, feed the queen
    // - Store eggs away from queen to make room

    // 1) Unplug entrance if sealed
    const ex = c.founding.entranceX;
    if (c.founding.sealed && tileAt(ex, SURFACE_WALK_Y) !== TILE.TUNNEL) {
      moveToward(a, ex, SURFACE_WALK_Y);
      if (a.x === ex && a.y === SURFACE_WALK_Y) {
        setTile(ex, SURFACE_WALK_Y, TILE.TUNNEL); // unplug
        c.founding.sealed = false;
      }
      return;
    }

    // 2) If not carrying, try to relocate eggs away from queen
    if (!a.carried && Math.random() < 0.20) {
      const egg = ants.find(an => an.team === a.team && an.caste === CASTE.EGG && wrappedDist(an.x, an.y, c.homeX, c.homeY) <= 1);
      if (egg) {
        // "store" egg by moving it a few tiles away in the chamber
        egg.x = wrapX(c.homeX + irand(-3, 3));
        egg.y = clamp(c.homeY + irand(-2, 2), surfaceY + 2, H - 2);
        return;
      }
    }

    // 3) Forage loop
    if (a.carried) {
      moveToward(a, c.homeX, c.homeY);
      if (wrappedDist(a.x, a.y, c.homeX, c.homeY) < 3) {
        if (a.carriedKind === 'leaf' || a.carriedKind === 'protein' || a.carriedKind === 'apple' || a.carriedKind === 'mealworm_egg') {
          c.foodStore += 5;
          diag.foodGathered++;
        } else if (a.carriedKind === 'corpse') {
          // Foreign corpse only triggers warriors when delivered by WARRIORS (see stepWarrior)
          c.foodStore += (a.carried.bonusFood || a.carried.food || 5);
          diag.foodGathered++;
        }
        dropCarried(a);
      }
    } else {
      const food = findNearestResource(a, ['leaf', 'protein', 'corpse', 'apple', 'mealworm_egg']);
      if (food) {
        moveToward(a, food.x, food.y);
        if (a.x === food.x && a.y === food.y) pickUp(a, food);
      } else {
        if (a.y > SURFACE_WALK_Y) moveToward(a, a.x, SURFACE_WALK_Y);
        else wanderSurface(a);
      }
    }
  }

  function foodTrailStrength(kind) {
    if (kind === 'corpse') return 10;
    if (kind === 'protein') return 8;
    if (kind === 'apple' || kind === 'rotten_apple') return 7;
    if (kind === 'leaf') return 4;
    return 3;
  }

  function stepExplorer(a, c) {
    // Explorers: range further, remember best food, recruit workers, and lay pheromone trails.
    if (a.carried) {
      // Lay pheromone trail back home (surface only), stronger for better food
      if (a.y === SURFACE_WALK_Y) addPherFood(a.x, a.y, foodTrailStrength(a.carriedKind) * 0.8);

      moveToward(a, c.homeX, c.homeY);
      if (wrappedDist(a.x, a.y, c.homeX, c.homeY) < 3) {
        if (a.carriedKind === 'corpse') {
          c.foodStore += (a.carried.bonusFood || a.carried.food || 5);
        } else {
          c.foodStore += 6;
        }
        diag.foodGathered++;
        // Remember this as "best food" for a while (helps repeat visits)
        a.mem.bestFood = { x: a.carried.x, y: a.carried.y, kind: a.carriedKind, untilGS: gameSeconds + 6 * GS_HOUR };
        dropCarried(a);
      }
      return;
    }

    // If we remember a strong source, bias movement toward it
    if (a.mem.bestFood && gameSeconds < a.mem.bestFood.untilGS) {
      moveToward(a, a.mem.bestFood.x, a.mem.bestFood.y);
    }

    // Seek food farther out
    const food = findNearestResource(a, ['leaf', 'protein', 'corpse', 'apple', 'rotten_apple']);
    if (food && wrappedDist(a.x, a.y, food.x, food.y) < 80) {
      moveToward(a, food.x, food.y);

      // When near a good source, recruit workers to haul it.
      const dist = wrappedDist(a.x, a.y, food.x, food.y);
      if (dist <= 2 && a.y === SURFACE_WALK_Y) {
        const score = 10 + foodTrailStrength(food.kind) * 2;
        addRecruit(a.team, food.x, food.y, food.kind, score, 4 * GS_HOUR);
        // Also spike pheromone at the source
        addPherFood(food.x, SURFACE_WALK_Y, foodTrailStrength(food.kind) * 3);
      }

      if (a.x === food.x && a.y === food.y) pickUp(a, food);
    } else {
      // Long wander on surface
      if (a.y > SURFACE_WALK_Y) moveToward(a, a.x, SURFACE_WALK_Y);
      else {
        const dir = choice([-1, 1]);
        a.x = wrapX(a.x + dir);
      }
    }
  }

  function stepWarrior(a, c) {
    // Ensure only 1 warrior stays guarding the colony
    const guardExists = ants.some(an => an.team === a.team && an.caste === CASTE.WARRIOR && an.mem.guard);
    if (!guardExists) a.mem.guard = true;

    if (a.mem.guard) {
      moveToward(a, c.homeX, c.homeY);
    } else {
      // Patrol surface and retrieve foreign corpses
      if (a.carried) {
        moveToward(a, c.homeX, c.homeY);
        if (wrappedDist(a.x, a.y, c.homeX, c.homeY) < 3) {
          if (a.carriedKind === 'corpse' && a.carried.team !== undefined && a.carried.team !== a.team) {
            c.foreignFed++;
            c.foodStore += (a.carried.bonusFood || a.carried.food || 5);
          }
          dropCarried(a);
        }
      } else {
        const corpse = resources.find(r => r.kind === 'corpse' && !r.carried && r.team !== undefined && r.team !== a.team);
        if (corpse) {
          moveToward(a, corpse.x, corpse.y);
          if (a.x === corpse.x && a.y === corpse.y) pickUp(a, corpse);
        } else {
          if (a.y > SURFACE_WALK_Y) moveToward(a, a.x, SURFACE_WALK_Y);
          else wanderSurface(a);
        }
      }
    }

    // Combat: attack nearby enemy ants/mobs
    for (const enemy of ants) {
      if (enemy.team !== a.team && enemy.x === a.x && enemy.y === a.y && enemy.hp > 0) {
        enemy.hp -= Math.max(1, a.atk - 2);
      }
    }
    for (const m of mobs) {
      if (m.x === a.x && m.y === a.y && !m.dead) {
        m.hp -= Math.max(1, a.atk - (m.def || 0) * 0.1);
        if (m.hp <= 0) m.dead = true;
      }
    }
  }

  function stepMale(a, c) {
    // Male ants climb trees, eat apples, until a royal lady ant (queen baby) climbs up.
    if (a.y > SURFACE_WALK_Y) {
      moveToward(a, a.x, SURFACE_WALK_Y);
      return;
    }

    // Prefer to sit on a tree x
    if (trees.length) {
      let best = trees[0].x, bd = 9999;
      for (const t of trees) {
        const d = Math.abs(wrapX(t.x) - wrapX(a.x));
        if (d < bd) { bd = d; best = t.x; }
      }
      moveToward(a, best, SURFACE_WALK_Y);
    } else {
      a.x = wrapX(a.x - 1);
    }

    // Eat apples on the tree tile
    const apple = resources.find(r => !r.dead && !r.carried && (r.kind === 'apple' || r.kind === 'rotten_apple') && r.x === a.x && r.y === SURFACE_WALK_Y);
    if (apple) {
      // Consume: boost energy a bit
      a.e = Math.min(a.eMax, a.e + 15);
      const ii = resources.indexOf(apple);
      if (ii > -1) resources.splice(ii, 1);
    }

    // If a queen baby is here, mating is handled in the queen baby logic (she founds a colony).

    // Idle life
    if (Math.random() < 0.02) a.dead = true;
  }

  function stepWorker(a, c) {
    // Escort queen baby out (2-4 workers)
    if (c.queenBabyId !== -1) {
      const qb = ants.find(an => an.id === c.queenBabyId);
      if (qb && qb.mem.queenBaby) {
        const escorts = ants.filter(an => an.team === c.team && an.caste === CASTE.WORKER && an.mem.escortQueenBabyId === qb.id);
        if (a.caste === CASTE.WORKER) {
          if (a.mem.escortQueenBabyId === qb.id || (escorts.length < 4 && Math.random() < 0.03)) {
            a.mem.escortQueenBabyId = qb.id;
            // Follow and defend
            moveToward(a, qb.x, qb.y);

            // Attack threats on contact
            for (const m of mobs) {
              if (!m.dead && m.x === a.x && m.y === a.y) {
                m.hp -= Math.max(1, a.atk - (m.def || 0) * 0.1);
                if (m.hp <= 0) m.dead = true;
              }
            }
            for (const en of ants) {
              if (en.team !== a.team && en.x === a.x && en.y === a.y && en.hp > 0) {
                en.hp -= Math.max(1, a.atk - 2);
              }
            }
            return;
          }
        }
      }
    }

    // Assign role if idle
    if (a.role === ROLE.IDLE) {
      // If explorers posted a recruit signal, latch on and run a dedicated haul.
      const s = bestRecruitFor(a.team, a.x, a.y);
      if (s) {
        a.mem.follow = { x: s.x, y: s.y, kind: s.kind, untilGS: gameSeconds + 3 * GS_HOUR };
        a.role = ROLE.FORAGE;
      } else {
        // Role priority: feed queen if low food, else dig if young colony, else forage
        if (c.foodStore < 5) {
          a.role = ROLE.FORAGE;
        } else if (c.workerCount < 10 && Math.random() < 0.5) {
          a.role = ROLE.DIG;
        } else if (a.carried && a.carriedKind === 'dirt') {
          a.role = ROLE.HAUL_DIRT;
        } else {
          a.role = ROLE.FORAGE;
        }
      }
    }
    
    if (a.role === ROLE.FORAGE) {
      if (a.carried) {
        moveToward(a, c.homeX, c.homeY);
        if (wrappedDist(a.x, a.y, c.homeX, c.homeY) < 3) {
          if (a.carriedKind === 'leaf' || a.carriedKind === 'protein' || a.carriedKind === 'apple' || a.carriedKind === 'rotten_apple') {
            c.foodStore += 5;
            diag.foodGathered++;
          } else if (a.carriedKind === 'corpse') {
            c.foodStore += (a.carried.bonusFood || a.carried.food || 5);
            diag.foodGathered++;
          }
          dropCarried(a);
          a.role = ROLE.IDLE;
        }
      } else {
        // If following an explorer recruit, go to that target first
        if (a.mem.follow && gameSeconds < a.mem.follow.untilGS) {
          moveToward(a, a.mem.follow.x, a.mem.follow.y);
          // If we reached the follow target, try to pick up that kind
          if (a.x === a.mem.follow.x && a.y === a.mem.follow.y) {
            const target = resources.find(r => !r.dead && !r.carried && r.x === a.x && r.y === a.y && r.kind === a.mem.follow.kind);
            if (target) pickUp(a, target);
            a.mem.follow = null;
          }
        }

        // Workers prefer following pheromone trails on surface
        if (a.y === SURFACE_WALK_Y) {
          const here = pherAt(a.x, a.y);
          const l = pherAt(a.x - 1, a.y);
          const r = pherAt(a.x + 1, a.y);
          if (l > here + 0.5 || r > here + 0.5) {
            a.x = wrapX(a.x + ((r > l) ? 1 : -1));
          }
        }
        const food = findNearestResource(a, ['leaf', 'protein', 'corpse', 'apple', 'rotten_apple']);
        if (food) {
          moveToward(a, food.x, food.y);
          if (a.x === food.x && a.y === food.y) pickUp(a, food);
        } else {
          if (a.y > SURFACE_WALK_Y) {
            moveToward(a, a.x, SURFACE_WALK_Y);
          } else {
            wanderSurface(a);
          }
        }
      }
    } else if (a.role === ROLE.DIG) {
      // Dig downward/outward from home
      const dirs = [[1, 0], [-1, 0], [0, 1]];
      const d = choice(dirs);
      const nx = wrapX(a.x + d[0]);
      const ny = a.y + d[1];
      
      if (isSoil(nx, ny)) {
        setTile(nx, ny, TILE.TUNNEL);
        addRes('dirt', a.x, a.y); // dirt appears where ant is
        diag.tunnelsDug++;
        a.role = ROLE.HAUL_DIRT;
        // Pick up the dirt
        const dirtRes = resources.find(r => r.kind === 'dirt' && r.x === a.x && r.y === a.y && !r.carried);
        if (dirtRes) pickUp(a, dirtRes);
      } else if (passableForAnt(nx, ny)) {
        a.x = nx; a.y = ny;
        diag.totalMoves++;
      } else {
        diag.stuckMoves++;
        diag.totalMoves++;
        a.role = ROLE.IDLE;
      }
    } else if (a.role === ROLE.HAUL_DIRT) {
      if (!a.carried) {
        // Find dirt to pick up
        const dirt = findNearestResource(a, ['dirt']);
        if (dirt && wrappedDist(a.x, a.y, dirt.x, dirt.y) < 5) {
          moveToward(a, dirt.x, dirt.y);
          if (a.x === dirt.x && a.y === dirt.y) pickUp(a, dirt);
        } else {
          a.role = ROLE.IDLE;
        }
      } else {
        // Haul dirt to surface, deposit near entrance
        if (a.y <= SURFACE_WALK_Y) {
          // Deposit dirt (creates mound)
          dropCarried(a);
          a.role = ROLE.IDLE;
        } else {
          moveToward(a, c.homeX, SURFACE_WALK_Y);
        }
      }
    }
  }

  // === Helper functions for ant movement ===
  function moveToward(a, tx, ty) {
    const dirs = [];
    let dx = tx - a.x;
    // Handle wrap-around
    if (Math.abs(dx) > W / 2) dx = dx > 0 ? dx - W : dx + W;
    
    if (dx > 0) dirs.push([1, 0]);
    else if (dx < 0) dirs.push([-1, 0]);
    if (ty > a.y) dirs.push([0, 1]);
    else if (ty < a.y) dirs.push([0, -1]);
    
    if (dirs.length === 0) return; // already there
    
    // Try primary direction first
    for (const d of dirs) {
      const nx = wrapX(a.x + d[0]);
      const ny = a.y + d[1];
      if (passableForAnt(nx, ny)) {
        a.x = nx; a.y = ny;
        diag.totalMoves++;
        return;
      } else if (isSoil(nx, ny) && a.caste === CASTE.WORKER && Math.random() < 0.3) {
        // Workers can dig through
        setTile(nx, ny, TILE.TUNNEL);
        addRes('dirt', nx, ny);
        diag.tunnelsDug++;
        a.x = nx; a.y = ny;
        diag.totalMoves++;
        return;
      }
    }
    
    // Stuck - try random
    const allDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const d = choice(allDirs);
    const nx = wrapX(a.x + d[0]);
    const ny = a.y + d[1];
    if (passableForAnt(nx, ny)) {
      a.x = nx; a.y = ny;
      diag.totalMoves++;
    } else {
      diag.stuckMoves++;
      diag.totalMoves++;
    }
  }

  function wanderSurface(a) {
    const dirs = [[1, 0], [-1, 0]];
    const d = choice(dirs);
    const nx = wrapX(a.x + d[0]);
    if (passableForAnt(nx, SURFACE_WALK_Y)) {
      a.x = nx;
      a.y = SURFACE_WALK_Y;
    }
    diag.totalMoves++;
  }

  function findNearestResource(a, kinds) {
    let best = null;
    let bestDist = 999999;
    for (const r of resources) {
      if (r.dead || r.carried) continue;
      if (!kinds.includes(r.kind)) continue;
      const d = wrappedDist(a.x, a.y, r.x, r.y);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    return best;
  }

  function pickUp(a, r) {
    if (a.carried || r.carried) return;
    a.carried = r;
    a.carriedKind = r.kind;
    r.carried = true;
  }

  function dropCarried(a) {
    if (!a.carried) return;
    const r = a.carried;
    r.carried = false;
    r.x = a.x;
    r.y = a.y;
    // If consumed resource, remove from world
    if (r.kind === 'leaf' || r.kind === 'protein' || r.kind === 'corpse') {
      const idx = resources.indexOf(r);
      if (idx > -1) resources.splice(idx, 1);
    }
    a.carried = null;
    a.carriedKind = null;
  }

  function stepMob(m) {
    // Lifespan expiry
    if (m.dieAtGS && gameSeconds >= m.dieAtGS) { m.dead = true; return; }

    // Lifecycle stage progression
    if (m.stage === STAGE.EGG) {
      // Eggs mostly sit still
      if (m.hatchAtGS && gameSeconds >= m.hatchAtGS) {
        m.stage = STAGE.JUV;
        // Juvenile->Adult timer varies by species
        if (!m.adultAtGS) {
          if (m.type === 'worm') {
            // Juvenile to Adult (10–55 weeks) => 35h to 192.5h game time
            m.adultAtGS = gameSeconds + irand(35 * GS_HOUR, Math.floor(192.5 * GS_HOUR));
          } else {
            m.adultAtGS = gameSeconds + irand(6 * GS_HOUR, 18 * GS_HOUR);
          }
        }
      }
      return;
    }
    if (m.stage === STAGE.JUV && m.adultAtGS && gameSeconds >= m.adultAtGS) {
      m.stage = STAGE.ADULT;
    }

    // Update stage stats every step (cheap, ensures correctness)
    const base = (
      m.type === 'worm' ? { hp: 120, atk: 6, def: 10, food: 12, life: 40 * GS_DAY } :
      m.type === 'mealworm' ? { hp: 55, atk: 5, def: 9, food: 10, life: 25 * GS_DAY } :
      m.type === 'beetle' ? { hp: 75, atk: 10, def: 10, food: 16, life: 18 * GS_DAY } :
      m.type === 'spider' ? { hp: 90, atk: 16, def: 8, food: 14, life: 22 * GS_DAY } :
      { hp: 50, atk: 10, def: 10, food: 10, life: 20 * GS_DAY }
    );
    applyStageStats(m, base);

    // Behavior by type
    const phase = currentPhase();

    if (m.type === 'beetle') {
      stepBeetle(m, phase);
    } else if (m.type === 'mealworm') {
      stepMealworm(m);
    } else if (m.type === 'worm') {
      stepEarthworm(m);
    } else {
      stepPredatorLike(m);
    }

    // Combat contact vs ants (very simple)
    for (const a of ants) {
      if (a.x === m.x && a.y === m.y) {
        a.hp -= Math.max(1, m.atk - 2);
        a._killedByMob = true;
      }
    }
  }

  function stepPredatorLike(m) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const move = choice(dirs);
    const nx = wrapX(m.x + move[0]);
    const ny = m.y + move[1];
    const canPass = passableForAnt(nx, ny) || (ny === SURFACE_WALK_Y);
    if (canPass) { m.x = nx; m.y = ny; }
  }

  function isLeafAtSurface(x) {
    return resources.some(r => !r.dead && !r.carried && r.kind === 'leaf' && r.y === SURFACE_WALK_Y && r.x === wrapX(x));
  }

  function stepMealworm(m) {
    // Mealworms mostly hang around leaf litter and mate under leaves.
    // Mating chance: 10% when under leaves (surface), then lay egg nearby.
    if (m.y > SURFACE_WALK_Y) {
      // move up toward surface
      m.y -= 1;
      return;
    }
    // surface wander
    const nx = wrapX(m.x + choice([-1, 1, 0]));
    m.x = nx;

    if (gameSeconds > m.mateCooldownAtGS && isLeafAtSurface(m.x) && Math.random() < 0.10) {
      // spawn egg under leaves (same tile)
      spawnMob('mealworm', m.x, SURFACE_WALK_Y, {
        stage: STAGE.EGG,
        hatchAtGS: gameSeconds + 4 * GS_HOUR,
        adultAtGS: gameSeconds + 18 * GS_HOUR,
        lifespanGS: 25 * GS_DAY
      });
      m.mateCooldownAtGS = gameSeconds + 6 * GS_HOUR;
    }
  }

  function stepEarthworm(m) {
    // Earthworms dig tunnels; eggs deposited in moist leaf litter.
    // Worms mate chance: 2%
    // Eggs hatch in 7h game time.
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const move = choice(dirs);
    const nx = wrapX(m.x + move[0]);
    const ny = m.y + move[1];

    // Prefer underground
    if (ny <= SURFACE_WALK_Y) {
      m.y = Math.min(H - 2, m.y + 1);
    } else if (inb(nx, ny)) {
      m.x = nx; m.y = ny;
      if (isSoil(nx, ny)) setTile(nx, ny, TILE.TUNNEL);
    }

    // Mate deep underground (we interpret mating action underground), but deposit eggs in moist leaf litter.
    if (gameSeconds > m.mateCooldownAtGS && m.y > surfaceY + 8 && Math.random() < 0.02) {
      // Find a nearby surface leaf-litter tile (moist + leaf)
      const sx = m.x;
      if (isLeafAtSurface(sx) && moisture[idx(wrapX(sx), surfaceY)] >= 0.25) {
        spawnMob('worm', sx, SURFACE_WALK_Y, {
          stage: STAGE.EGG,
          hatchAtGS: gameSeconds + 7 * GS_HOUR,
          lifespanGS: 40 * GS_DAY
        });
        m.mateCooldownAtGS = gameSeconds + 10 * GS_HOUR;
      }
    }
  }

  function stepBeetle(m, phase) {
    // Beetles: dig to eat until maxed out food capacity, dig up,
    // wait for night, mate on surface at night (30%), dig down, lay egg,
    // die when out of energy, deposit into root-dirt.

    // energy drain
    m.e -= 0.6;
    if (m.e <= 0) { m.dead = true; return; }

    if (m.state === 'wander') m.state = 'feed';

    if (m.state === 'feed') {
      // go underground and "eat" by digging (simple proxy)
      if (m.y <= surfaceY + 2) { m.y += 1; return; }
      const d = choice([[1, 0], [-1, 0], [0, 1]]);
      const nx = wrapX(m.x + d[0]);
      const ny = m.y + d[1];
      if (inb(nx, ny)) {
        m.x = nx; m.y = ny;
        if (isSoil(nx, ny)) setTile(nx, ny, TILE.TUNNEL);
        m.foodHeld = clamp(m.foodHeld + 1, 0, m.foodCap);
      }
      if (m.foodHeld >= m.foodCap) {
        m.state = 'surface';
      }
      return;
    }

    if (m.state === 'surface') {
      // Dig up to surface
      if (m.y > SURFACE_WALK_Y) { m.y -= 1; return; }
      // On surface: day => idle or go down, night => attempt mate
      if (!phase.isNight) {
        if (Math.random() < 0.5) {
          // idle
        } else {
          m.state = 'feed';
        }
        return;
      }
      // Night
      if (gameSeconds > m.mateCooldownAtGS && Math.random() < 0.30) {
        m.state = 'lay';
        m.mateCooldownAtGS = gameSeconds + 8 * GS_HOUR;
      }
      return;
    }

    if (m.state === 'lay') {
      // Dig down a bit and lay egg, then continue until energy runs out
      if (m.y <= surfaceY + 6) { m.y += 1; return; }
      // lay egg underground
      spawnMob('beetle', m.x, m.y, {
        stage: STAGE.EGG,
        hatchAtGS: gameSeconds + 6 * GS_HOUR,
        adultAtGS: gameSeconds + 24 * GS_HOUR,
        lifespanGS: 18 * GS_DAY
      });
      m.state = 'feed';
      m.foodHeld = 0;
      return;
    }
  }

  // --- AUTO BALANCE ---
  let balanceTimer = 0;
  function autoBalance(dt) {
    balanceTimer += dt;
    if (balanceTimer < 2.0) return;
    balanceTimer = 0;

    // Detect colony extinction: if queen missing, schedule respawn +1 in-game day.
    for (const c of colonies) {
      if (c.queenId !== -1) {
        const qAlive = ants.some(a => a.id === c.queenId && a.caste === CASTE.QUEEN);
        if (!qAlive) {
          c.queenId = -1;
          if (!c.respawnAtGS) c.respawnAtGS = gameSeconds + GAME_DAY_SECONDS;
        }
      }
    }

    if (PLAY_FLAGS.ant_orange && colonies[0].queenId === -1) respawnColony(0);
    if (PLAY_FLAGS.ant_cyan && colonies[1].queenId === -1) respawnColony(1);

    // Auto-reset if stuck or overcrowded
    if (ants.length > 500 || resources.length > 600) {
      console.log("Population overflow, resetting.");
      resetWorld();
    }
  }

  function resetWorld() {
    ants.length = 0;
    mobs.length = 0;
    resources.length = 0;
    plants.length = 0;
    trees.length = 0;
    genWorld();
    if (PLAY_FLAGS.ant_orange) respawnColony(0);
    if (PLAY_FLAGS.ant_cyan) respawnColony(1);
  }

  function genWorld() {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let i = idx(x, y);
        tile[i] = (y < surfaceY) ? TILE.AIR : TILE.SOIL;
        moisture[i] = (y < surfaceY) ? 0 : 0.5;
        water[i] = 0;
        rootMass[i] = 0;
        fertility[i] = 0;
        if (y > surfaceY + 10 && Math.random() < 0.05) tile[i] = TILE.ROCKS;
      }
    }
    colonies[0].homeX = Math.floor(W * 0.25); colonies[0].homeY = surfaceY + 15;
    colonies[1].homeX = Math.floor(W * 0.75); colonies[1].homeY = surfaceY + 15;
    if (PLAY_FLAGS.ant_orange) respawnColony(0);
    if (PLAY_FLAGS.ant_cyan) respawnColony(1);

    // Initial resources
    for (let x = 0; x < W; x += 4) {
      if (Math.random() < 0.5) plants.push({ x, e: 10, bloom: 0 });
    }
  }

  /* =========================================================
     5) Rendering with Emojis
  ========================================================= */
  function draw() {
    // Clear screen (sky)
    const ph = currentPhase();
    const sky = ph.isNight ? "#050814" : "#5db7ff"; // navy blue-black at night, blue sky at day
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    // Wait! ctx.fillRect uses context logical units. 
    // With setTransform in resize, 1 unit = 1 logical pixel.
    // But innerWidth is logical pixels. So if DPR=2, rect is correct logical size.
    // And we scaled up by DPR, so this fills canvas. Correct.

    // Debug: Check Camera
    if (isNaN(camera.x) || isNaN(camera.y)) {
      ctx.fillStyle = "red";
      ctx.fillText("Camera Error: NaN", 100, 100);
      return;
    }

    const loopDraw = (drawFn) => {
      const offsets = [-W, 0, W];
      for (let off of offsets) drawFn(off);
    };

    // Draw Terrain
    const startX = Math.floor(camera.x - (innerWidth / camera.scale) / 2) - 2;
    const endX = Math.floor(camera.x + (innerWidth / camera.scale) / 2) + 2;
    const startY = Math.floor(camera.y - (innerHeight / camera.scale) / 2) - 30; // Extra buffer
    const endY = Math.floor(camera.y + (innerHeight / camera.scale) / 2) + 30;

    for (let y = Math.max(0, startY); y < Math.min(H, endY); y++) {
      for (let x = startX; x <= endX; x++) {
        let wx = wrapX(x);
        let t = tileAt(wx, y);

        if (t === TILE.AIR) {
          // Maybe draw faint sky grid?
          continue;
        }

        let s = worldToScreen(x, y);
        if (s.sx < -50 || s.sx > innerWidth + 50 || s.sy < -50 || s.sy > innerHeight + 50) continue;

        if (t === TILE.SOIL) ctx.fillStyle = "#3d2e24";
        else if (t === TILE.TUNNEL) ctx.fillStyle = "#1a120d";
        else if (t === TILE.ROOT_DIRT) ctx.fillStyle = "#2b1f18";
        else if (t >= TILE.ROCKS) ctx.fillStyle = "#555";

        // Fill rect for tile
        ctx.fillRect(Math.floor(s.sx), Math.floor(s.sy), Math.ceil(camera.scale), Math.ceil(camera.scale));
      }
    }

    // Draw Entities
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.floor(camera.scale * 1.5)}px sans-serif`;

    loopDraw((off) => {
      for (const p of plants) {
        const s = worldToScreen(p.x + off, SURFACE_WALK_Y);
        if (s.sx >= -50 && s.sx <= innerWidth + 50) ctx.fillText("🌿", s.sx, s.sy - camera.scale);
      }
    });

    // Trees (grow by resizing up to 400%)
    loopDraw((off) => {
      for (const t of trees) {
        const s = worldToScreen(t.x + off, SURFACE_WALK_Y);
        if (s.sx < -80 || s.sx > innerWidth + 80) continue;
        const size = Math.floor(camera.scale * 1.6 * (t.scale || 1));
        ctx.save();
        ctx.font = `${size}px sans-serif`;
        ctx.fillText("🌳", s.sx, s.sy - camera.scale * 1.2);
        ctx.restore();
      }
    });
    loopDraw((off) => {
      for (const a of ants) {
        const s = worldToScreen(a.x + off, a.y);
        if (s.sx < -50 || s.sx > innerWidth + 50) continue;

        // Render based on caste
        if (a.caste === CASTE.EGG) {
          // Egg rendering: show type via color/size
          const isNaniticEgg = a.willBe === CASTE.NANITIC;
          const isWorkerEgg = a.willBe === CASTE.WORKER;
          const isMaleEgg = a.willBe === CASTE.MALE;
          const r = camera.scale * (isWorkerEgg ? 0.40 : 0.30);
          // base tint from team
          let alpha = 0.85;
          let col = "rgba(220,220,220,0.85)";
          if (isNaniticEgg) col = "rgba(255,210,150,0.85)";
          if (isWorkerEgg) col = "rgba(255,160,60,0.95)";
          if (isMaleEgg) col = "rgba(200,200,200,0.9)";

          // Apply team hue by drawing a tinted overlay ring
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(s.sx, s.sy, r, 0, Math.PI * 2);
          ctx.fill();

          // team-colored rim
          ctx.strokeStyle = teamColor(a.team);
          ctx.lineWidth = Math.max(1, camera.scale * 0.10);
          ctx.beginPath();
          ctx.arc(s.sx, s.sy, r + camera.scale * 0.05, 0, Math.PI * 2);
          ctx.stroke();

          // Tiny glyph hints
          if (isWorkerEgg) {
            ctx.font = `${Math.floor(camera.scale * 0.9)}px sans-serif`;
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillText("W", s.sx, s.sy);
            ctx.font = `${Math.floor(camera.scale * 1.5)}px sans-serif`;
          } else if (isNaniticEgg) {
            ctx.font = `${Math.floor(camera.scale * 0.9)}px sans-serif`;
            ctx.fillStyle = "rgba(0,0,0,0.30)";
            ctx.fillText("N", s.sx, s.sy);
            ctx.font = `${Math.floor(camera.scale * 1.5)}px sans-serif`;
          }
        } else if (a.caste === CASTE.QUEEN) {
        } else if (a.caste === CASTE.QUEEN) {
          // Queen: bigger ant with crown indicator
          ctx.font = `${Math.floor(camera.scale * 2)}px sans-serif`;
          ctx.fillText(EMOJI.ANT, s.sx, s.sy);
          ctx.fillStyle = "gold";
          ctx.fillText("👑", s.sx, s.sy - camera.scale);
          ctx.font = `${Math.floor(camera.scale * 1.5)}px sans-serif`;
        } else {
          // Regular ant emoji
          if (a.caste === CASTE.NANITIC) {
            ctx.font = `${Math.floor(camera.scale * 1.2)}px sans-serif`; // smaller
          }
          ctx.fillText(EMOJI.ANT, s.sx, s.sy);
          ctx.font = `${Math.floor(camera.scale * 1.5)}px sans-serif`;
        }

        // Team dot indicator (skip for eggs)
        if (a.caste !== CASTE.EGG) {
          ctx.beginPath();
          ctx.fillStyle = teamColor(a.team);
          ctx.arc(s.sx + camera.scale * 0.4, s.sy + camera.scale * 0.4, camera.scale * 0.25, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    loopDraw((off) => {
      for (const m of mobs) {
        const s = worldToScreen(m.x + off, m.y);
        if (s.sx < -50 || s.sx > innerWidth + 50) continue;
        if (m.type === 'beetle') ctx.fillText(EMOJI.BEETLE, s.sx, s.sy);
        else if (m.type === 'mealworm') ctx.fillText('🪱', s.sx, s.sy);
        else if (m.type === 'worm') ctx.fillText(EMOJI.WORM, s.sx, s.sy);
        else if (m.type === 'spider') ctx.fillText(EMOJI.SPIDER, s.sx, s.sy);
      }
    });
    loopDraw((off) => {
      for (const r of resources) {
        const s = worldToScreen(r.x + off, r.y);
        if (s.sx < -50 || s.sx > innerWidth + 50) continue;
        let char = "?";
        if (r.kind === 'leaf') char = EMOJI.LEAF;
        else if (r.kind === 'protein') char = EMOJI.PROTEIN;
        else if (r.kind === 'mushroom') char = EMOJI.MUSHROOM;
        else if (r.kind === 'spore') char = EMOJI.SPORE;
        else if (r.kind === 'corpse') char = "💀";
        else if (r.kind === 'apple') char = "🍎";
        else if (r.kind === 'rotten_apple') char = "🍏";
        else if (r.kind === 'dirt') char = "🪨";
        ctx.fillText(char, s.sx, s.sy);
      }
    });

    // === Lighting (UI-only): menu orb is the indicator, but no radial blend on the world ===
    // Flat yellow for sunlight, flat 20% grey for moonlight.
    try {
      const phase = currentPhase();
      const wrapperEl = document.getElementById('sphereWrapper');
      if (wrapperEl) {
        wrapperEl.dataset.phase = phase.name;
        wrapperEl.dataset.isNight = phase.isNight ? '1' : '0';
      }
    } catch (e) { }

    // DEBUG OVERLAY
    if (true) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(10, innerHeight - 60, 200, 50);
      ctx.fillStyle = "lime";
      ctx.font = "12px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`FPS: ${(1 / lastT) * 1000 | 0} Ants: ${ants.length} Cam: ${camera.x | 0},${camera.y | 0}`, 20, innerHeight - 30);
      ctx.fillText(`Res: ${resources.length} Mobs: ${mobs.length}`, 20, innerHeight - 15);
    }
  }

  function updateUI() {
    const c0 = colonies[0];
    const c1 = colonies[1];
    
    const pop = {
      orange: ants.filter(a => a.team === 0 && a.caste !== CASTE.EGG).length,
      orangeEggs: ants.filter(a => a.team === 0 && a.caste === CASTE.EGG).length,
      cyan: ants.filter(a => a.team === 1 && a.caste !== CASTE.EGG).length,
      cyanEggs: ants.filter(a => a.team === 1 && a.caste === CASTE.EGG).length,
      beetles: mobs.filter(m => m.type === 'beetle').length,
      mealworms: mobs.filter(m => m.type === 'mealworm').length,
      worms: mobs.filter(m => m.type === 'worm').length
    };
    
    const phaseNames = ['Founding', 'Nanitic', 'Growing', 'Mature'];

    const lMap = {
      'stat_orange': `${pop.orange} (${pop.orangeEggs}🥚) [${phaseNames[c0.phase]}]`,
      'stat_cyan': `${pop.cyan} (${pop.cyanEggs}🥚) [${phaseNames[c1.phase]}]`,
      'stat_beetle': pop.beetles,
      'stat_mealworm': pop.mealworms,
      'stat_worm': pop.worms
    };
    for (let id in lMap) {
      const el = document.getElementById(id);
      if (el) el.textContent = lMap[id];
    }

    // Diagnostic UI
    const diagFood = document.getElementById('diag_food');
    const diagTunnel = document.getElementById('diag_tunnel');
    const diagPredation = document.getElementById('diag_predation');
    const diagPathing = document.getElementById('diag_pathing');
    const diagVerdict = document.getElementById('diag_verdict');

    if (diagFood) diagFood.textContent = diag.foodPressure > 0 ? `+${diag.foodPressure.toFixed(1)} deficit` : `${diag.foodPressure.toFixed(1)} surplus`;
    if (diagTunnel) diagTunnel.textContent = `${diag.tunnelRate.toFixed(1)}/s`;
    if (diagPredation) diagPredation.textContent = `${(diag.predationRate * 100).toFixed(0)}%`;
    if (diagPathing) diagPathing.textContent = `${(diag.pathingFail * 100).toFixed(0)}% blocked`;
    if (diagVerdict) diagVerdict.textContent = diag.verdict;

    // Stats tab (menu)
    const ph = currentPhase();
    const frac = dayFracFromGameSeconds(gameSeconds);
    const hh = Math.floor((frac * 24 + 24) % 24);
    const mm = Math.floor((((frac * 24) % 1) * 60 + 60) % 60);
    const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

    const statPhase = document.getElementById('stat_phase');
    const statTime = document.getElementById('stat_time');
    const statDayFrac = document.getElementById('stat_dayfrac');
    if (statPhase) statPhase.textContent = `${ph.name} (${(ph.light * 100).toFixed(0)}%)`;
    if (statTime) statTime.textContent = `${pad2(hh)}:${pad2(mm)}`;
    if (statDayFrac) statDayFrac.textContent = frac.toFixed(3);

    const statCols = document.getElementById('stat_colonies');
    if (statCols) {
      const lines = colonies.map((c) => {
        const popA = ants.filter(a => a.team === c.team && a.caste !== CASTE.EGG).length;
        const eggsA = ants.filter(a => a.team === c.team && a.caste === CASTE.EGG).length;
        const males = ants.filter(a => a.team === c.team && a.caste === CASTE.MALE && a.y === SURFACE_WALK_Y);
        const malesOnTrees = males.filter(m => trees.some(t => t.x === m.x)).length;
        const ch = (c.thrive?.maleEggChance ?? c.maleEggChance ?? 0).toFixed(2);
        const tgt = (c.maleTargetOnTrees || 1);
        const fs = (c.thrive?.qbFailStreak ?? 0);
        return `team ${c.team}  pop ${popA}/${eggsA}  phase ${phaseNames[c.phase]}`
          + `\n  malesOnTrees ${malesOnTrees}/${tgt}  maleEggChance ${ch}  qbFailStreak ${fs}`;
      });
      statCols.textContent = lines.join('\n\n');
    }
  }

  /* =========================================================
     6) Main Loop
  ========================================================= */
  let lastT = 0;
  function loop(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;

    try {
      checkToggles();
      tickSimulation(dt);
      autoBalance(dt);
      diagTick(dt);
      draw();
      updateUI();
    } catch (e) {
      console.error(e);
      ctx.fillStyle = "red";
      ctx.font = "20px monospace";
      ctx.fillText("CRASH: " + e.message, 50, 50);
      return; // Stop loop
    }

    requestAnimationFrame(loop);
  }

  // Initialize
  console.log("Swarm: Initializing...");
  resize(); // Ensure canvas size is set
  genWorld();
  requestAnimationFrame(loop);

})();
