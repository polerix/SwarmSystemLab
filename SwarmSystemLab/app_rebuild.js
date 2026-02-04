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
  const TILE = { AIR: 0, SOIL: 1, TUNNEL: 2, ROCKS: 3, ROCKM: 4, ROCKL: 5 };

  const tile = new Uint8Array(W * H);
  const moisture = new Float32Array(W * H);

  const tileAt = (x, y) => tile[idx(wrapX(x), y)];
  const setTile = (x, y, t) => tile[idx(wrapX(x), y)] = t;
  const isSoil = (x, y) => inb(x, y) && tileAt(x, y) === TILE.SOIL;

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
    EGG: 1,        // dormant, hatches after time
    NANITIC: 2,    // first-gen workers, small, forage-focused
    WORKER: 3,     // standard workers: dig, haul, feed queen
    SOLDIER: 4     // defenders (future)
  };

  const ROLE = {
    IDLE: 0,
    FORAGE: 1,     // go to surface, find food, return
    DIG: 2,        // expand tunnels
    HAUL_DIRT: 3,  // carry dirt to surface mound
    FEED_QUEEN: 4, // bring food to queen
    DEFEND: 5      // attack threats
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
  const colonies = [
    { 
      team: 0, homeX: 0, homeY: 0, queenId: -1,
      phase: PHASE.FOUNDING,
      foodStore: 10,      // food available to queen
      eggTimer: 0,
      naniticCount: 0,
      workerCount: 0
    },
    { 
      team: 1, homeX: 0, homeY: 0, queenId: -1,
      phase: PHASE.FOUNDING,
      foodStore: 10,
      eggTimer: 0,
      naniticCount: 0,
      workerCount: 0
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
      role: ROLE.IDLE, carried: null, carriedKind: null,
      moveT: 0, age: 0, hatchTime: 0,
      life: 2000 + Math.random() * 500,
      target: null  // {x, y} for pathfinding goals
    };
    
    if (caste === CASTE.QUEEN) { 
      a.hpMax = 5000; a.hp = 5000; a.life = 999999; 
    } else if (caste === CASTE.EGG) {
      a.hp = 50; a.hpMax = 50;
      a.hatchTime = 8 + Math.random() * 4; // seconds to hatch
      a.willBe = CASTE.NANITIC; // what it hatches into
    } else if (caste === CASTE.NANITIC) {
      a.hp = 60; a.hpMax = 60; a.life = 800 + Math.random() * 200;
      a.role = ROLE.FORAGE;
    } else if (caste === CASTE.WORKER) {
      a.hp = 100; a.hpMax = 100; a.life = 1500 + Math.random() * 500;
      a.role = ROLE.IDLE;
    }
    
    ants.push(a);
    return a;
  }

  function spawnMob(type, x, y) {
    const m = { type, x: wrapX(x), y, hp: 50, hpMax: 50, moveT: 0, dead: false };
    if (type === 'worm') { m.hp = 150; m.hpMax = 150; }
    if (type === 'spider') { m.hp = 80; m.hpMax = 80; }
    mobs.push(m);
  }

  function addRes(kind, x, y) {
    resources.push({ id: nextId++, kind, x: wrapX(x), y, amt: 10, dead: false });
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
  }
  function respawnColony(team) {
    if (colonies[team].queenId !== -1) return;
    const c = colonies[team];
    setTile(c.homeX, c.homeY, TILE.TUNNEL);
    // Dig initial chamber
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (inb(c.homeX + dx, c.homeY + dy)) {
          setTile(c.homeX + dx, c.homeY + dy, TILE.TUNNEL);
        }
      }
    }
    const q = spawnAnt(team, CASTE.QUEEN, c.homeX, c.homeY);
    c.queenId = q.id;
    c.phase = PHASE.FOUNDING;
    c.foodStore = 10;
    c.eggTimer = 0;
    c.naniticCount = 0;
    c.workerCount = 0;
  }

  // --- AI LOGIC ---
  function tickSimulation(dt) {
    // 1. Ants
    for (const a of ants) {
      if (a.hp <= 0) continue;

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
        diag.antDeaths++;
        if (ants[i]._killedByMob) diag.antDeathsByPredator++;
        addRes('protein', ants[i].x, ants[i].y);
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
        addRes('protein', mobs[i].x, mobs[i].y);
        mobs.splice(i, 1);
      }
    }

    // 3. Spawners
    if (Math.random() < 0.05) {
      if (PLAY_FLAGS.leaf && Math.random() < 0.4) {
        addRes('leaf', irand(0, W), SURFACE_WALK_Y);
      }
      if (PLAY_FLAGS.beetle && Math.random() < 0.03) spawnMob('beetle', irand(0, W), SURFACE_WALK_Y);
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
          a.hp = 60; a.hpMax = 60;
          a.role = ROLE.FORAGE;
          c.naniticCount++;
        } else if (a.caste === CASTE.WORKER) {
          a.hp = 100; a.hpMax = 100;
          a.role = ROLE.IDLE;
          c.workerCount++;
        }
      }
      return;
    }
    
    // === QUEEN: lay eggs based on colony phase ===
    if (a.caste === CASTE.QUEEN) {
      c.eggTimer += 0.15;
      
      if (c.phase === PHASE.FOUNDING) {
        // Lay nanitic eggs (2-4 total), then wait
        const naniticEggs = ants.filter(ant => ant.team === a.team && ant.caste === CASTE.EGG && ant.willBe === CASTE.NANITIC).length;
        if (naniticEggs < 4 && c.eggTimer > 3 && c.foodStore > 2) {
          const egg = spawnAnt(a.team, CASTE.EGG, a.x, a.y);
          egg.willBe = CASTE.NANITIC;
          c.foodStore -= 2;
          c.eggTimer = 0;
        }
        // Transition to NANITIC phase when first nanitic hatches
        if (c.naniticCount >= 1) {
          c.phase = PHASE.NANITIC;
        }
      } else if (c.phase === PHASE.NANITIC) {
        // Wait for nanitics to bring food; transition to GROWING when fed
        if (c.foodStore >= 15 && c.naniticCount >= 2) {
          c.phase = PHASE.GROWING;
        }
      } else if (c.phase === PHASE.GROWING || c.phase === PHASE.MATURE) {
        // Lay worker eggs when food available
        if (c.eggTimer > 2 && c.foodStore > 3) {
          const egg = spawnAnt(a.team, CASTE.EGG, a.x, a.y);
          egg.willBe = CASTE.WORKER;
          c.foodStore -= 3;
          c.eggTimer = 0;
        }
        if (c.workerCount >= 5) {
          c.phase = PHASE.MATURE;
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
  }

  function stepNanitic(a, c) {
    // Priority: if carrying food, go to queen. Else, go to surface and find food.
    if (a.carried) {
      // Heading home with food
      moveToward(a, c.homeX, c.homeY);
      if (wrappedDist(a.x, a.y, c.homeX, c.homeY) < 3) {
        // Deliver food
        if (a.carriedKind === 'leaf' || a.carriedKind === 'protein') {
          c.foodStore += 5;
          diag.foodGathered++;
        }
        dropCarried(a);
      }
    } else {
      // Look for food on surface or nearby
      const food = findNearestResource(a, ['leaf', 'protein']);
      if (food) {
        moveToward(a, food.x, food.y);
        if (a.x === food.x && a.y === food.y) {
          pickUp(a, food);
        }
      } else {
        // Go to surface to search
        if (a.y > SURFACE_WALK_Y) {
          moveToward(a, a.x, SURFACE_WALK_Y);
        } else {
          // Wander on surface
          wanderSurface(a);
        }
      }
    }
  }

  function stepWorker(a, c) {
    // Assign role if idle
    if (a.role === ROLE.IDLE) {
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
    
    if (a.role === ROLE.FORAGE) {
      if (a.carried) {
        moveToward(a, c.homeX, c.homeY);
        if (wrappedDist(a.x, a.y, c.homeX, c.homeY) < 3) {
          if (a.carriedKind === 'leaf' || a.carriedKind === 'protein') {
            c.foodStore += 5;
            diag.foodGathered++;
          }
          dropCarried(a);
          a.role = ROLE.IDLE;
        }
      } else {
        const food = findNearestResource(a, ['leaf', 'protein']);
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
    // If food, remove from world (consumed)
    if (r.kind === 'leaf' || r.kind === 'protein') {
      const idx = resources.indexOf(r);
      if (idx > -1) resources.splice(idx, 1);
    }
    a.carried = null;
    a.carriedKind = null;
  }

  function stepMob(m) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let move = choice(dirs);
    const nx = wrapX(m.x + move[0]);
    const ny = m.y + move[1];

    let canPass = false;
    if (m.type === 'worm') canPass = inb(nx, ny);
    else canPass = passableForAnt(nx, ny) || (ny === SURFACE_WALK_Y);

    if (canPass) {
      m.x = nx; m.y = ny;
      if (m.type === 'worm' && isSoil(nx, ny)) setTile(nx, ny, TILE.TUNNEL);
    }
    for (const a of ants) {
      if (a.x === m.x && a.y === m.y) {
        a.hp -= 20;
        a._killedByMob = true;
      }
    }
  }

  // --- AUTO BALANCE ---
  let balanceTimer = 0;
  function autoBalance(dt) {
    balanceTimer += dt;
    if (balanceTimer < 2.0) return;
    balanceTimer = 0;

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
    // Clear screen
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, innerWidth, innerHeight); // This assumes identity transform or consistent?
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
    loopDraw((off) => {
      for (const a of ants) {
        const s = worldToScreen(a.x + off, a.y);
        if (s.sx < -50 || s.sx > innerWidth + 50) continue;

        // Render based on caste
        if (a.caste === CASTE.EGG) {
          // Small egg dot
          ctx.fillStyle = (a.team === 0) ? "rgba(255,200,150,0.8)" : "rgba(150,220,255,0.8)";
          ctx.beginPath();
          ctx.arc(s.sx, s.sy, camera.scale * 0.3, 0, Math.PI * 2);
          ctx.fill();
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
          ctx.fillStyle = (a.team === 0) ? "orange" : "cyan";
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
        else if (r.kind === 'dirt') char = "🪨";
        ctx.fillText(char, s.sx, s.sy);
      }
    });

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
      worms: mobs.filter(m => m.type === 'worm').length
    };
    
    const phaseNames = ['Founding', 'Nanitic', 'Growing', 'Mature'];

    const lMap = {
      'stat_orange': `${pop.orange} (${pop.orangeEggs}🥚) [${phaseNames[c0.phase]}]`,
      'stat_cyan': `${pop.cyan} (${pop.cyanEggs}🥚) [${phaseNames[c1.phase]}]`,
      'stat_beetle': pop.beetles,
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
