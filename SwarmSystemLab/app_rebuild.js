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

  let nextId = 1;
  const ants = [];
  const mobs = [];
  const resources = [];
  const plants = [];
  const colonies = [
    { team: 0, homeX: 0, homeY: 0, queenId: -1 },
    { team: 1, homeX: 0, homeY: 0, queenId: -1 }
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
      role: 0, carried: null, moveT: 0, age: 0, life: 2000 + Math.random() * 500
    };
    if (caste === 0) { a.hpMax = 5000; a.hp = 5000; a.life = 999999; } // Queen
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
  }
  function respawnColony(team) {
    if (colonies[team].queenId !== -1) return;
    const c = colonies[team];
    setTile(c.homeX, c.homeY, TILE.TUNNEL);
    const q = spawnAnt(team, 0, c.homeX, c.homeY);
    c.queenId = q.id;
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
    if (a.caste === 0) { // Queen
      if (Math.random() < 0.02) spawnAnt(a.team, 1, a.x, a.y);
      return;
    }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const d = choice(dirs);
    const nx = wrapX(a.x + d[0]);
    const ny = a.y + d[1];

    if (passableForAnt(nx, ny)) {
      a.x = nx; a.y = ny;
    } else if (isSoil(nx, ny) && Math.random() < 0.1) {
      setTile(nx, ny, TILE.TUNNEL);
      addRes('dirt', nx, ny);
      diag.tunnelsDug++;
    } else {
      diag.stuckMoves++;
    }
    diag.totalMoves++;

    if (!a.carried) {
      for (let i = 0; i < resources.length; i++) {
        const r = resources[i];
        if (r.x === a.x && r.y === a.y && !r.carried) {
          a.carried = r;
          r.carried = true;
          break;
        }
      }
    } else {
      const c = colonies[a.team];
      if (wrappedDist(a.x, a.y, c.homeX, c.homeY) < 2) {
        a.carried.carried = false;
        a.carried.x = a.x; a.carried.y = a.y;
        if (a.carried.kind === 'leaf' || a.carried.kind === 'protein') {
          const idx = resources.indexOf(a.carried);
          if (idx > -1) resources.splice(idx, 1); // consumed
          diag.foodGathered++;
        }
        a.carried = null;
      } else {
        a.carried.x = a.x;
        a.carried.y = a.y;
      }
    }
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

        // Simple emoji render
        ctx.fillText(EMOJI.ANT, s.sx, s.sy);

        // Team dot indicator
        ctx.beginPath();
        ctx.fillStyle = (a.team === 0) ? "orange" : "cyan";
        ctx.arc(s.sx + camera.scale * 0.4, s.sy + camera.scale * 0.4, camera.scale * 0.3, 0, Math.PI * 2);
        ctx.fill();
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
    const pop = {
      orange: ants.filter(a => a.team === 0).length,
      cyan: ants.filter(a => a.team === 1).length,
      beetles: mobs.filter(m => m.type === 'beetle').length,
      worms: mobs.filter(m => m.type === 'worm').length
    };

    const lMap = {
      'stat_orange': pop.orange,
      'stat_cyan': pop.cyan,
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
