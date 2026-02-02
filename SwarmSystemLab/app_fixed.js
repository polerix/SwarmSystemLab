/*
  app.js
  Portable extraction of the inline script from the original single-file demo.
  Drop this alongside index.html and open index.html in a browser.
*/

(() => {
  "use strict";

  /* =========================================================
     0) Utilities
  ========================================================= */
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const irand = (a,b) => a + ((Math.random()*(b-a+1))|0);
  const choice = (arr) => arr[(Math.random()*arr.length)|0];
  const lerp = (a,b,t) => a + (b-a)*t;
  const smoothstep = (a,b,t) => {
    const x = clamp((t-a)/(b-a), 0, 1);
    return x*x*(3 - 2*x);
  };
  const b36 = (n) => {
    const s = Math.max(0, Math.floor(n)).toString(36).toUpperCase();
    return s;
  };
  const hashStr = (s) => {
    let h = 2166136261 >>> 0;
    for(let i=0;i<s.length;i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };
  async function copyText(txt){
    try{
      await navigator.clipboard.writeText(txt);
      return true;
    } catch {
      try{
        const ta = document.createElement("textarea");
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch {
        return false;
      }
    }
  }

  /* =========================================================
     1) Tunable parameters (Balance Lab adjusts these)
  ========================================================= */
  const CFG = {
    scoutFrac: 0.12,
    diggerFrac: 0.20,
    foragePersistence: 0.65,
    leafFallMult: 1.05,
    leafCutBias: 1.10,
    mushEff: 0.70,
    mushLoss: 0.22,
    mushMinDepth: 28,
    foodTargetPerAnt: 0.55,
    subTargetPerAnt: 0.35,
    queenSurplusGate: 30,
  };

  function fmtCfg(){
    return `scoutFrac ${CFG.scoutFrac.toFixed(2)}, diggerFrac ${CFG.diggerFrac.toFixed(2)}, forage ${CFG.foragePersistence.toFixed(2)}, leafMult ${CFG.leafFallMult.toFixed(2)}, cut ${CFG.leafCutBias.toFixed(2)}, mushEff ${CFG.mushEff.toFixed(2)}, mushMinDepth ${CFG.mushMinDepth}`;
  }

  /* =========================================================
     2) Canvas and camera
  ========================================================= */
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha:false });

  let DPR = 1;
  function resize(){
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(innerWidth * DPR);
    canvas.height = Math.floor(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  addEventListener("resize", resize);
  resize();

  const camera = {
    x: 110, y: 70,
    scale: 8.0,
    minScale: 4.0,
    maxScale: 22.0
  };

  function worldToScreen(wx, wy){
    const sx = (wx - camera.x) * camera.scale + innerWidth * 0.5;
    const sy = (wy - camera.y) * camera.scale + innerHeight * 0.5;
    return { sx, sy };
  }
  function screenToWorld(sx, sy){
    const wx = (sx - innerWidth*0.5) / camera.scale + camera.x;
    const wy = (sy - innerHeight*0.5) / camera.scale + camera.y;
    return { wx, wy };
  }

  let draggingCam = false;
  let lastMX = 0, lastMY = 0;
  canvas.addEventListener("mousedown", (e) => {
    draggingCam = true;
    lastMX = e.clientX; lastMY = e.clientY;
  });
  addEventListener("mouseup", () => draggingCam = false);
  addEventListener("mousemove", (e) => {
    if(!draggingCam) return;
    const dx = e.clientX - lastMX;
    const dy = e.clientY - lastMY;
    lastMX = e.clientX; lastMY = e.clientY;
    camera.x -= dx / camera.scale;
    camera.y -= dy / camera.scale;
  });

  const rngZoom = document.getElementById("rngZoom");
  const valZoom = document.getElementById("valZoom");
  const setZoomLabel = () => valZoom.textContent = Number(rngZoom.value).toFixed(1) + "x";
  setZoomLabel();
  rngZoom.addEventListener("input", setZoomLabel);

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const sens = Number(rngZoom.value);
    const delta = -Math.sign(e.deltaY);
    const factor = (delta > 0) ? (1.10 * sens) : (1.0 / (1.10 * sens));

    const before = screenToWorld(e.clientX, e.clientY);
    camera.scale = clamp(camera.scale * factor, camera.minScale, camera.maxScale);
    const after = screenToWorld(e.clientX, e.clientY);
    camera.x += (before.wx - after.wx);
    camera.y += (before.wy - after.wy);
  }, { passive:false });

  /* =========================================================
     3) UI menu (show/hide + drag)
  ========================================================= */
      // --- UI REFACTOR: Tab Switching & Migration ---
      function setupTabs() {
        // Collapsible "orb" panel (requested for mobile):
        // - tap the ◦ button to collapse into a circle
        // - tap the circle to expand back
        const unifiedPanel = document.getElementById('unifiedPanel');
        const btnPanelCollapse = document.getElementById('btnPanelCollapse');
        const setCollapsed = (v) => {
          if(!unifiedPanel) return;
          unifiedPanel.classList.toggle('is-collapsed', !!v);
        };
        if(btnPanelCollapse){
          btnPanelCollapse.addEventListener('click', (e) => {
            e.stopPropagation();
            setCollapsed(!unifiedPanel.classList.contains('is-collapsed'));
          });
        }
        if(unifiedPanel){
          unifiedPanel.addEventListener('mouseenter', () => {
            if(unifiedPanel.classList.contains('is-collapsed')) setCollapsed(false);
          });
        }

        const tabs = document.querySelectorAll('.tab-btn');
        const contents = document.querySelectorAll('.tab-content');

        tabs.forEach(btn => {
          btn.addEventListener('click', () => {
            // Remove active class
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            // Add active class
            btn.classList.add('active');
            const targetId = `tab_${btn.dataset.tab}`;
            document.getElementById(targetId).classList.add('active');
          });
        });

        // Migrate Controls
        const menuBody = document.getElementById('menuBody');
        const controlsContainer = document.getElementById('controlsContainer');
        if (menuBody && controlsContainer) {
          // Move specific sections
          while (menuBody.childNodes.length > 0) {
            const node = menuBody.childNodes[0];
            // Filter out the Lab section for separate tab
            if (node.classList && node.classList.contains('labBox')) {
              document.getElementById('labContainer').appendChild(node);
            } else if (node.tagName === 'DETAILS') {
              // Skip hints (redundant with Info tab)
              menuBody.removeChild(node);
            } else {
              controlsContainer.appendChild(node);
            }
          }
        }

        // Migrate Status
        const statusBoard = document.getElementById('status');
        const statusContainer = document.getElementById('statusContainer');
        if (statusBoard && statusContainer) {
          // Clone children to preserve IDs for JS updates
          Array.from(statusBoard.children).forEach(child => {
            if (!child.classList.contains('floating-close')) {
              statusContainer.appendChild(child);
            }
          });
        }

        // Wire allow toggles (remove existing instances when unchecked) and persist states
        const TOGGLE_IDS = ['chkAllowMealworm','chkAllowBeetle','chkAllowWorm','chkAllowSpider','chkAllowOrange','chkAllowCyan'];
        const confirmModal = document.getElementById('confirmModal');
        const confirmTitle = document.getElementById('confirmTitle');
        const confirmMsg = document.getElementById('confirmMsg');
        const confirmYes = document.getElementById('confirmYes');
        const confirmNo = document.getElementById('confirmNo');

        function showConfirm(title, msg){
          return new Promise((resolve) => {
            confirmTitle.textContent = title;
            confirmMsg.textContent = msg;
            confirmModal.classList.remove('is-hidden');
            const cleanup = () => {
              confirmModal.classList.add('is-hidden');
              confirmYes.removeEventListener('click', onYes);
              confirmNo.removeEventListener('click', onNo);
              document.removeEventListener('keydown', onKey);
            };
            const onYes = () => { cleanup(); resolve(true); };
            const onNo = () => { cleanup(); resolve(false); };
            const onKey = (e) => { if(e.key === 'Escape') { onNo(); } };
            confirmYes.addEventListener('click', onYes);
            confirmNo.addEventListener('click', onNo);
            document.addEventListener('keydown', onKey);
          });
        }

        const getBadgeIdFromToggle = (id) => 'badge' + id.slice(3);
        const updateBadgeFor = (id) => {
          const badge = document.getElementById(getBadgeIdFromToggle(id));
          const el = document.getElementById(id);
          if(!badge) return;
          if(el && el.checked) badge.classList.remove('visible'); else badge.classList.add('visible');
          badge.classList.toggle('disabled', !(el && el.checked));
        };

        function saveToggles(){
          const obj = {};
          TOGGLE_IDS.forEach(id => {
            const el = document.getElementById(id);
            if(el) obj[id] = el.checked;
          });
          try{ localStorage.setItem('swarm:toggles', JSON.stringify(obj)); }catch(e){}
        }

        const applyToggleState = (id, checked, silent=false) => {
          const el = document.getElementById(id);
          if(!el) return;
          el.checked = checked;
          if(!checked){
            // NOTE: mobs/ants are defined later as `const` arrays; mutate in-place (do not reassign).
            const removeMobs = (pred) => {
              for(let i=mobs.length-1;i>=0;i--) if(pred(mobs[i])) mobs.splice(i,1);
            };
            const removeAnts = (pred) => {
              for(let i=ants.length-1;i>=0;i--) if(pred(ants[i])) ants.splice(i,1);
            };

            if(id === 'chkAllowMealworm') removeMobs(m => m.type === 'mealworm');
            if(id === 'chkAllowBeetle') removeMobs(m => (m.type === 'beetle' || m.type === 'beetleEgg'));
            if(id === 'chkAllowWorm') removeMobs(m => m.type === 'worm');
            if(id === 'chkAllowSpider') removeMobs(m => m.type === 'spider');

            if(id === 'chkAllowOrange') { removeAnts(a => a.team === TEAM.ORANGE); colonies[TEAM.ORANGE].queenId = -1; }
            if(id === 'chkAllowCyan') { removeAnts(a => a.team === TEAM.CYAN); colonies[TEAM.CYAN].queenId = -1; }
          }
          updateBadgeFor(id);
          if(!silent) updateStatus();
        };

        const togglePop = (id) => {
          const el = document.getElementById(id);
          if(!el) return;

          el.addEventListener('click', async (e) => {
            e.preventDefault(); // Prevent the checkbox from changing state immediately

            const isChecked = el.checked;
            const populationName = el.parentElement.textContent.trim().split(' ')[0];
            const action = !isChecked ? 'enable' : 'disable';

            const ok = await showConfirm(`Confirm ${action}`, `Are you sure you want to ${action} ${populationName}?`);

            if (ok) {
              applyToggleState(id, !isChecked);
              saveToggles();
            }
          });
        };

        TOGGLE_IDS.forEach(togglePop);

        // Initialize from localStorage (silent)
        try{
          const stored = JSON.parse(localStorage.getItem('swarm:toggles') || '{}');
          TOGGLE_IDS.forEach(id => {
            if(Object.prototype.hasOwnProperty.call(stored, id)) applyToggleState(id, !!stored[id], true);
            else updateBadgeFor(id);
          });
        }catch(e){ TOGGLE_IDS.forEach(id => updateBadgeFor(id)); }
      }

      // Run setup
      window.addEventListener('DOMContentLoaded', setupTabs);
      
  const unifiedPanel = document.getElementById('unifiedPanel');
  if (unifiedPanel) {
    unifiedPanel.classList.add('is-collapsed');
  }
      // ----------------------------------------------

  /* =========================================================
     4) World grid
  ========================================================= */
  const W = 220;
  const H = 140;
  const surfaceY = 34;
  const SURFACE_WALK_Y = surfaceY;

  const TILE = { AIR:0, SOIL:1, TUNNEL:2, ROCKS:3, ROCKM:4, ROCKL:5 };
  const TEAM = { ORANGE:0, CYAN:1 };
  const idx = (x,y) => x + y*W;
  const inb = (x,y) => x>=0 && y>=0 && x<W && y<H;

  const tile = new Uint8Array(W*H);
  const owner = new Uint8Array(W*H);
  const moisture = new Float32Array(W*H);
  const nutrients = new Float32Array(W*H);
  const antOcc = new Uint8Array(W*H);

  const bonusType = new Uint8Array(W*H);
  const bonusAmt  = new Float32Array(W*H);

  const tileAt = (x,y) => tile[idx(x,y)];
  const setTile = (x,y,t) => tile[idx(x,y)] = t;
  const getOwner = (x,y) => owner[idx(x,y)];
  const setOwner = (x,y,v) => owner[idx(x,y)] = v;

  const isSoil = (x,y) => inb(x,y) && tileAt(x,y) === TILE.SOIL;
  const isTunnel = (x,y) => inb(x,y) && tileAt(x,y) === TILE.TUNNEL;
  const isRock = (x,y) => {
    if(!inb(x,y)) return false;
    const t = tileAt(x,y);
    return t===TILE.ROCKS || t===TILE.ROCKM || t===TILE.ROCKL;
  };

  function passableForAnt(x,y){
    if(!inb(x,y)) return false;
    if(y === SURFACE_WALK_Y) return true;
    return tileAt(x,y) === TILE.TUNNEL;
  }
  function passableForMob(x,y){
    if(!inb(x,y)) return false;
    if(y === SURFACE_WALK_Y) return true;
    const t = tileAt(x,y);
    return t === TILE.TUNNEL || t === TILE.SOIL;
  }

  /* =========================================================
     5) Pheromones
  ========================================================= */
  const PH = { HOME:0, FOOD:1, DANGER:2, N:3 };
  const pher = [
    Array.from({length:PH.N}, () => new Float32Array(W*H)),
    Array.from({length:PH.N}, () => new Float32Array(W*H))
  ];

  const rngPh = document.getElementById("rngPh");
  const valPh = document.getElementById("valPh");
  const setPhLabel = () => valPh.textContent = Number(rngPh.value) + "s";
  setPhLabel();
  rngPh.addEventListener("input", setPhLabel);

  function decayPher(dt){
    const hl = Number(rngPh.value);
    const k = Math.pow(0.5, dt/hl);
    for(let team=0; team<2; team++){
      for(let t=0; t<PH.N; t++){
        const arr = pher[team][t];
        for(let i=0;i<arr.length;i++){
          arr[i] *= k;
        }
      }
    }
  }
  function depositPher(team, type, x,y, amt){
    if(!inb(x,y)) return;
    const i = idx(x,y);
    pher[team][type][i] = Math.min(1, pher[team][type][i] + amt);
  }
  function bestNeighborForPher(team, type, x,y, wantHigh=true){
    let best = { x, y, v: pher[team][type][idx(x,y)] };
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){
      const nx=x+dx, ny=y+dy;
      if(!passableForAnt(nx,ny)) continue;
      const v = pher[team][type][idx(nx,ny)];
      if(wantHigh){
        if(v > best.v) best = { x:nx, y:ny, v };
      } else {
        if(v < best.v) best = { x:nx, y:ny, v };
      }
    }
    return best;
  }

  /* =========================================================
     6) Sky: smooth day/night + clouds + rain
  ========================================================= */
  let simTime = 0;
  const DAY_PERIOD = 140;

  const dayPhase01 = () => (simTime % DAY_PERIOD) / DAY_PERIOD;
  function sun01(){
    const p = dayPhase01();
    return clamp((Math.cos((p - 0.25) * Math.PI * 2) + 1) * 0.5, 0, 1);
  }
  function dayMix01(){
    const s = sun01();
    return smoothstep(0.06, 0.22, s);
  }
  function nightMix01(){
    return 1 - dayMix01();
  }
  function isNight(){
    return nightMix01() > 0.70;
  }

  const clouds = [];
  const stars = [];
  function initSky(){
    clouds.length = 0;
    stars.length = 0;
    for(let i=0;i<7;i++){
      clouds.push({
        x: Math.random()*W,
        y: 4 + Math.random()*(surfaceY-10),
        w: 18 + Math.random()*26,
        h: 4 + Math.random()*7,
        speed: 2.4 + Math.random()*3.0,
        alpha: 0.35 + Math.random()*0.35
      });
    }
    for(let i=0;i<220;i++){
      stars.push({
        x: Math.random()*W,
        y: Math.random()*(surfaceY-2),
        tw: Math.random()*999,
        a: 0.35 + Math.random()*0.55
      });
    }
  }
  function tickSky(dt){
    for(const cl of clouds){
      cl.x += cl.speed * dt;
      if(cl.x > W + cl.w) cl.x = -cl.w;
    }
  }
  function cloudCoverAtX(x){
    let c = 0;
    for(const cl of clouds){
      let dx = Math.abs(x - cl.x);
      dx = Math.min(dx, W - dx);
      const sigma = cl.w * 0.35;
      const gauss = Math.exp(-(dx*dx)/(2*sigma*sigma));
      c += cl.alpha * gauss;
    }
    return clamp(c, 0, 1);
  }

  const rain = { active:false, t:0, dur:0, intensity:0, cooldown: 12 + Math.random()*18 };
  function tickRain(dt){
    rain.cooldown -= dt;
    if(!rain.active && rain.cooldown <= 0){
      rain.active = true;
      rain.t = 0;
      rain.dur = 8 + Math.random()*10;
      rain.intensity = 0.35 + Math.random()*0.55;
    }
    if(rain.active){
      rain.t += dt;
      if(rain.t >= rain.dur){
        rain.active = false;
        rain.intensity = 0;
        rain.cooldown = 14 + Math.random()*26;
      }
    }
  }
  function surfaceLight01AtX(x){
    const base = sun01();
    const cover = cloudCoverAtX(x);
    return clamp(base * (1.0 - 0.65*cover) * (1.0 - 0.55*rain.intensity), 0, 1);
  }

  /* =========================================================
     7) Resources
  ========================================================= */
  let nextResId = 1;
  const resources = [];
  const CAP = {
    antsPerTeam: 180,
    worms: 6,
    beetles: 8,
    beetleEggs: 16,
    resources: 900
  };

  function addRes(kind, x,y, mass, energy){
    if(resources.length >= CAP.resources) return null;
    const r = {
      id: nextResId++,
      kind, x,y,
      mass: Math.max(0.1, mass),
      energy: Math.max(0, energy),
      dead:false,
      locked:false,
      team:-1
    };
    resources.push(r);
    return r;
  }
  function resourceAt(x,y, pred){
    for(const r of resources){
      if(r.dead) continue;
      if(r.x===x && r.y===y && pred(r)) return r;
    }
    return null;
  }
  function findNearestRes(x,y, pred, maxDist=40){
    let best = null;
    let bestD = 1e9;
    for(const r of resources){
      if(r.dead) continue;
      if(r.locked) continue;
      if(!pred(r)) continue;
      const d = Math.abs(r.x-x) + Math.abs(r.y-y);
      if(d < bestD && d <= maxDist){
        bestD = d;
        best = r;
      }
    }
    return best;
  }
  function resChar(r){
    if(r.kind==="leaf") return "L";
    if(r.kind==="leafBit") return "l";
    if(r.kind==="protein") return "P";
    if(r.kind==="spore") return "*";
    if(r.kind==="dirt") return ".";
    if(r.kind==="corpseAnt") return "a";
    if(r.kind==="corpseBeetle") return "b";
    if(r.kind==="wormSeg") return "#";
    return "?";
  }
  function resColor(r){
    if(r.kind==="leaf" || r.kind==="leafBit") return getComputedStyle(document.documentElement).getPropertyValue("--leaf").trim();
    if(r.kind==="protein") return getComputedStyle(document.documentElement).getPropertyValue("--protein").trim();
    if(r.kind==="spore") return getComputedStyle(document.documentElement).getPropertyValue("--spore").trim();
    if(r.kind==="dirt") return getComputedStyle(document.documentElement).getPropertyValue("--dirt").trim();
    if(r.kind==="corpseAnt") return "rgb(170,120,120)";
    if(r.kind==="corpseBeetle") return "rgb(150,150,165)";
    if(r.kind==="wormSeg") return "rgb(210,210,255)";
    return "rgb(230,230,230)";
  }

  function cutResource(r, pieceMass){
    if(resources.length >= CAP.resources) return;
    const totalMass = r.mass;
    const take = Math.min(pieceMass, r.mass);
    const frac = (totalMass > 0) ? (take/totalMass) : 0;
    const eTake = r.energy * frac;

    r.mass -= take;
    r.energy -= eTake;

    const pieceKind = (r.kind==="leaf") ? "leafBit" : r.kind;
    addRes(pieceKind, r.x, r.y, take, eTake);

    if(r.mass <= 0.12) r.dead = true;
  }

  function mergeOrLockDirtDrop(r, x, y){
    for(const rr of resources){
      if(rr.dead) continue;
      if(rr.kind !== "dirt") continue;
      if(!rr.locked) continue;
      if(Math.abs(rr.x - x) <= 2 && Math.abs(rr.y - y) <= 1){
        rr.mass += r.mass;
        r.dead = true;
        return;
      }
    }
    r.x = x; r.y = y;
    r.locked = true;
  }

  function isCoverAt(x,y){
    if(y !== SURFACE_WALK_Y) return false;
    for(const r of resources){
      if(r.dead) continue;
      if(r.kind !== "leaf") continue;
      if(r.y !== SURFACE_WALK_Y) continue;
      if(Math.abs(r.x - x) <= 2) return true;
    }
    return false;
  }

  /* =========================================================
     8) Plants
  ========================================================= */
  const rngSolar = document.getElementById("rngSolar");
  const valSolar = document.getElementById("valSolar");
  const setSolarLabel = () => valSolar.textContent = Number(rngSolar.value) + "%";
  setSolarLabel();
  rngSolar.addEventListener("input", setSolarLabel);

  const plants = [];
  function tickPlants(dt){
    const solarMult = Number(rngSolar.value)/100;
    for(const p of plants){
      const lightHere = surfaceLight01AtX(p.x);
      if(lightHere > 0.06){
        p.e = Math.min(42, p.e + dt * 0.70 * solarMult * lightHere);
      } else {
        p.e = Math.max(0, p.e - dt*0.06);
      }

      p.leafTimer -= dt;
      if(p.leafTimer <= 0){
        p.leafTimer = (p.kind==="branch" ? 9 : 14) + Math.random()*18;
        if(Math.random() < (p.kind==="branch" ? 0.70 : 0.45)){
          const leafCost = 3.2 * CFG.leafFallMult;
          if(p.e >= leafCost){
            p.e -= leafCost;
            addRes("leaf", clamp(p.x + irand(-1,1), 1, W-2), SURFACE_WALK_Y, 6.0, leafCost);
          }
        }
      }

      p.bloom -= dt;
      if(p.bloom <= 0){
        p.bloom = 10 + Math.random()*18;
        if(p.kind==="grass" && p.e > 10 && lightHere > 0.30 && Math.random() < 0.35){
          const amt = Math.min(10, p.e*0.55);
          p.e -= amt;
          addRes("protein", p.x, SURFACE_WALK_Y, 1.8, amt);
        }
      }
    }
  }

  /* =========================================================
     9) Ants: castes and roles
  ========================================================= */
  const SPR = {
    queen: "000000:",
    worker: "xx",
    digger: "[]",
    warrior: "KKKK",
    hunter: "HHHH",
    beetle: "CD",
    worm: "########"
  };

  const CASTE = { QUEEN:0, WORKER:1, DIGGER:2, WARRIOR:3, HUNTER:4 };
  const ROLE = { DRONE:0, SCOUT:1 };

  function casteStats(caste){
    if(caste === CASTE.QUEEN)   return { hpMax:30, eMax:24, upkeep:0.11, moveE:0.06, movePeriod:0.18, cap:0, speed:1.0 };
    if(caste === CASTE.WORKER)  return { hpMax:10, eMax:10, upkeep:0.065, moveE:0.058, movePeriod:0.14, cap:2, speed:1.0 };
    if(caste === CASTE.DIGGER)  return { hpMax:12, eMax:11, upkeep:0.070, moveE:0.062, movePeriod:0.15, cap:2, speed:0.95 };
    if(caste === CASTE.WARRIOR) return { hpMax:50, eMax:14, upkeep:0.080, moveE:0.072, movePeriod:0.12, cap:4, speed:1.05 };
    if(caste === CASTE.HUNTER)  return { hpMax:70, eMax:12, upkeep:0.095, moveE:0.082, movePeriod:0.11, cap:0, speed:1.10 };
    return { hpMax:10, eMax:10, upkeep:0.065, moveE:0.058, movePeriod:0.14, cap:2, speed:1.0 };
  }
  function digCost(caste){
    if(caste === CASTE.DIGGER) return 0.18;
    if(caste === CASTE.WORKER) return 0.30;
    if(caste === CASTE.WARRIOR) return 0.38;
    return 0.38;
  }

  function antSprite(a){
    if(a.caste === CASTE.QUEEN) return SPR.queen;
    if(a.caste === CASTE.WORKER) return SPR.worker;
    if(a.caste === CASTE.DIGGER) return SPR.digger;
    if(a.caste === CASTE.WARRIOR) return SPR.warrior;
    if(a.caste === CASTE.HUNTER) return SPR.hunter;
    return "??";
  }
  function carryCapacity(a){ return casteStats(a.caste).cap; }
  function canCarry(a){ return carryCapacity(a) > 0 && a.caste !== CASTE.HUNTER && a.caste !== CASTE.QUEEN; }

  function spendEnergy(a, amt){
    a.e -= amt;
    if(a.e < 0){
      a.hp += a.e;
      a.e = 0;
    }
  }
  function eatEnergy(a, amt){
    a.e = Math.min(a.eMax, a.e + amt);
    a.hp = Math.min(a.hpMax, a.hp + amt*0.35);
  }

  let nextAntId = 1;
  const ants = [];

  const colonies = [
    {
      team:0, name:"Orange",
      homeX:0, homeY:0,
      queenId:-1,
      win:false, lose:false,
      eggT:0,
      foodStore:16,
      fungusStore:0,
      subMass:0,
      subE:0,
      deepestY: 0,
      galleriesActive: 0,
      rebT:0,
      endCode:""
    },
    {
      team:1, name:"Cyan",
      homeX:0, homeY:0,
      queenId:-1,
      win:false, lose:false,
      eggT:0,
      foodStore:16,
      fungusStore:0,
      subMass:0,
      subE:0,
      deepestY: 0,
      galleriesActive: 0,
      rebT:0,
      endCode:""
    }
  ];

  function spawnAnt(team, caste, x,y){
    const st = casteStats(caste);
    const a = {
      id: nextAntId++,
      team, caste,
      role: (caste===CASTE.WORKER) ? ROLE.DRONE : ROLE.DRONE,
      x, y,
      hp: st.hpMax,
      hpMax: st.hpMax,
      e: st.eMax * 0.78,
      eMax: st.eMax,
      age: 0,
      life: (caste===CASTE.QUEEN) ? 999999 : (caste===CASTE.WARRIOR ? 520 : 1500),
      carried: null,
      moveT: 0,
      actT: 0,
      intent: 0
    };
    ants.push(a);
    return a;
  }

  function moveToward(a, tx, ty){
    let best = { x:a.x, y:a.y, d: Math.abs(tx-a.x)+Math.abs(ty-a.y) };
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){
      const nx=a.x+dx, ny=a.y+dy;
      if(!passableForAnt(nx,ny)) continue;
      const d = Math.abs(tx-nx)+Math.abs(ty-ny);
      if(d < best.d) best = { x:nx, y:ny, d };
    }
    a.x = best.x; a.y = best.y;
  }
  function wanderAnt(a){
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for(let k=0;k<4;k++){
      const [dx,dy] = choice(dirs);
      const nx=a.x+dx, ny=a.y+dy;
      if(passableForAnt(nx,ny)){ a.x=nx; a.y=ny; return; }
    }
  }

  function antMoveBudget(a, dt){
    const st = casteStats(a.caste);
    const carrying = !!a.carried;
    const carrySlow = carrying ? 1.65 : 1.0;
    const period = (st.movePeriod * carrySlow) / st.speed;
    a.moveT += dt;
    return { st, period };
  }

  /* =========================================================
     10) Simple mushroom economy (abstract)
  ========================================================= */
  function updateDeepest(col){
    let deepest = col.deepestY;
    const teamOwner = col.team + 1;
    const x0 = clamp(col.homeX - 18, 0, W-1);
    const x1 = clamp(col.homeX + 18, 0, W-1);
    const y0 = surfaceY + 1;
    const y1 = H - 2;
    for(let y=y1; y>=y0; y--){
      for(let x=x0; x<=x1; x++){
        if(tileAt(x,y) === TILE.TUNNEL && getOwner(x,y) === teamOwner){
          deepest = Math.max(deepest, y);
        }
      }
      if(deepest === y) break;
    }
    col.deepestY = deepest;
  }

  function tickFungus(col, dt){
    col.galleriesActive = 0;

    const depth = col.deepestY - surfaceY;
    if(depth < CFG.mushMinDepth) return;
    if(col.subE <= 0.05) return;

    const sx = col.homeX;
    const sy = clamp(col.deepestY - 4, surfaceY+2, H-3);
    const m = moisture[idx(sx,sy)];
    const moistFactor = clamp(0.35 + 0.85*m, 0.35, 1.0);

    const throughput = Math.min(col.subE, (0.40 + 0.02*depth) * moistFactor) * dt;

    const produced = throughput * CFG.mushEff;
    const loss = throughput * CFG.mushLoss;

    col.subE = Math.max(0, col.subE - (produced + loss));
    col.subMass = Math.max(0, col.subMass - throughput*0.55);

    col.fungusStore = Math.min(200, col.fungusStore + produced);
    col.galleriesActive = 1 + Math.floor(depth / 24);
  }

  /* =========================================================
     11) Role rebalance and colony targets
  ========================================================= */
  function colonyPop(team){
    return ants.filter(a => a.hp>0 && a.team===team).length;
  }
  function countsBy(team){
    const alive = ants.filter(a => a.hp>0 && a.team===team);
    let drones=0, scouts=0, diggers=0, warriors=0, hunters=0;
    for(const a of alive){
      if(a.caste===CASTE.WORKER){
        if(a.role===ROLE.SCOUT) scouts++; else drones++;
      } else if(a.caste===CASTE.DIGGER) diggers++;
      else if(a.caste===CASTE.WARRIOR) warriors++;
      else if(a.caste===CASTE.HUNTER) hunters++;
    }
    return { drones, scouts, diggers, warriors, hunters, total: alive.length };
  }

  function rebalanceRoles(col){
    const workers = ants
      .filter(a => a.hp>0 && a.team===col.team && a.caste===CASTE.WORKER)
      .sort((a,b)=> (b.e - a.e)); // keep high-energy workers as scouts

    const pop = colonyPop(col.team);
    const { diggers } = countsBy(col.team);

    const foodTarget = 8 + pop * CFG.foodTargetPerAnt;
    const subTarget = 6 + pop * CFG.subTargetPerAnt;

    const subNeed = (col.subE < subTarget) ? 1 : 0;
    const foodNeed = ((col.foodStore + col.fungusStore) < foodTarget) ? 1 : 0;

    let targetScouts = Math.ceil(Math.max(1, workers.length * CFG.scoutFrac));
    if(subNeed) targetScouts += 1;
    if(foodNeed) targetScouts += 1;
    targetScouts = clamp(targetScouts, 1, Math.max(1, workers.length));

    for(let i=0;i<workers.length;i++){
      workers[i].role = (i < targetScouts) ? ROLE.SCOUT : ROLE.DRONE;
    }

    col.wantMoreDiggers = (diggers < Math.max(2, Math.floor((pop-1) * CFG.diggerFrac)));
  }

  /* =========================================================
     12) Feeding logic
  ========================================================= */
  function feedAtHome(a, col, dt){
    if(a.x !== col.homeX || a.y !== col.homeY) return false;
    if(a.e >= a.eMax*0.92) return false;

    let took = 0;
    const want = Math.min(0.9*dt, a.eMax - a.e);

    const takeF = Math.min(col.fungusStore, want*0.55);
    if(takeF > 0){
      col.fungusStore -= takeF;
      eatEnergy(a, takeF);
      took += takeF;
    }
    const takeFood = Math.min(col.foodStore, want - took);
    if(takeFood > 0){
      col.foodStore -= takeFood;
      eatEnergy(a, takeFood);
      took += takeFood;
    }
    return took > 0;
  }

  function shouldRefuel(a){
    const low = a.e < a.eMax*0.22;
    const hurt = a.hp < a.hpMax*0.55;
    return low || hurt;
  }

  /* =========================================================
     13) Hauling: deliver carried resources
  ========================================================= */
  function haulToQueen(a, col){
    const hx=col.homeX, hy=col.homeY;
    if(a.x !== hx || a.y !== hy){
      moveToward(a, hx, hy);
      return false;
    }

    const r = resources.find(rr => rr.id === a.carried && !rr.dead);
    if(r){
      if(r.kind==="protein"){
        col.foodStore += r.energy;
      } else if(r.kind==="leafBit" || r.kind==="leaf"){
        col.subE += r.energy;
        col.subMass += r.mass;
      } else if(r.kind==="spore"){
        nutrients[idx(hx,hy)] = clamp(nutrients[idx(hx,hy)] + 0.25, 0, 1);
        moisture[idx(hx,hy)] = clamp(moisture[idx(hx,hy)] + 0.10, 0, 1);
      } else if(r.kind==="corpseAnt" || r.kind==="corpseBeetle" || r.kind==="wormSeg"){
        nutrients[idx(hx,hy)] = clamp(nutrients[idx(hx,hy)] + 0.30, 0, 1);
        moisture[idx(hx,hy)] = clamp(moisture[idx(hx,hy)] + 0.12, 0, 1);
      } else if(r.kind==="dirt"){
        const dp = { x: clamp(col.homeX + irand(-4,4), 2, W-3), y: SURFACE_WALK_Y };
        r.x = dp.x; r.y = dp.y;
        mergeOrLockDirtDrop(r, dp.x, dp.y);
        a.carried = null;
        return true;
      }
      r.dead = true;
    }
    a.carried = null;
    return true;
  }

  /* =========================================================
     14) AI: queen, worker (drone/scout), digger, warrior, hunter
  ========================================================= */
  function nearestHostileMobDist(x,y){
    let best = 9999;
    for(const m of mobs){
      if(m.dead) continue;
      if(m.type!=="worm" && m.type!=="beetle") continue;
      const d = Math.abs(m.x-x)+Math.abs(m.y-y);
      if(d < best) best = d;
    }
    return best;
  }

  function stepQueen(a, dt){
    const col = colonies[a.team];

    col.rebT -= dt;
    if(col.rebT <= 0){
      col.rebT = 2.0 + Math.random()*0.6;
      rebalanceRoles(col);
      updateDeepest(col);
    }

    feedAtHome(a, col, dt);

    if((col.foodStore + col.fungusStore) <= 0.01 && a.e <= 0.05){
      a.hp -= 0.25*dt;
      if(a.hp <= 0){
        a.hp = 0;
        col.lose = true;
      }
    }

    col.eggT += dt;

    const pop = colonyPop(col.team);
    const cnt = countsBy(col.team);

    const foodTarget = 10 + pop * CFG.foodTargetPerAnt;
    const subTarget  = 8 + pop * CFG.subTargetPerAnt;

    const edible = col.foodStore + col.fungusStore;
    const wantWorkers = (cnt.drones + cnt.scouts) < 6;
    const wantScouts = cnt.scouts < Math.max(2, Math.floor((cnt.drones+cnt.scouts)*CFG.scoutFrac));
    const wantDiggers = col.wantMoreDiggers === true;

    const canMakeWarriors = edible > foodTarget*1.15 && pop >= 10 && col.galleriesActive >= 1;
    const canMakeHunters = edible > foodTarget*1.45 && pop >= 18 && col.galleriesActive >= 2;

    const eggCooldown = 3.6;
    if(col.eggT > eggCooldown && edible >= 1.0){
      const surplusOK = edible > foodTarget*0.90;
      const subOK = col.subE > subTarget*0.55;

      if(surplusOK || wantWorkers || wantDiggers || wantScouts || subOK){
        col.eggT = 0;

        let cost = 1.0;
        const takeFood = Math.min(col.foodStore, cost);
        col.foodStore -= takeFood;
        cost -= takeFood;
        if(cost > 0){
          const takeF = Math.min(col.fungusStore, cost);
          col.fungusStore -= takeF;
          cost -= takeF;
        }
        if(cost > 0){
          return;
        }

        let caste = CASTE.WORKER;
        if(wantDiggers && Math.random() < 0.55) caste = CASTE.DIGGER;
        else if(canMakeHunters && Math.random() < 0.08) caste = CASTE.HUNTER;
        else if(canMakeWarriors && Math.random() < 0.18) caste = CASTE.WARRIOR;

        const hatchX = a.x + (Math.random()<0.5?-1:1);
        const hatchY = a.y + (Math.random()<0.5?-1:1);
        spawnAnt(a.team, caste, clamp(hatchX,1,W-2), clamp(hatchY,surfaceY+1,H-2));
      }
    }
  }

  function stepHunter(a, dt){
    const col = colonies[a.team];
    const { st, period } = antMoveBudget(a, dt);

    if(shouldRefuel(a)){
      if(!feedAtHome(a, col, dt)){
        moveToward(a, col.homeX, col.homeY);
      }
      while(a.moveT >= period){
        a.moveT -= period;
        moveToward(a, col.homeX, col.homeY);
        spendEnergy(a, st.moveE);
      }
      return;
    }

    if(nearestHostileMobDist(a.x,a.y) <= 5) depositPher(a.team, PH.DANGER, a.x,a.y, 0.11);

    let target = null, bestD = 9999;
    for(const m of mobs){
      if(m.dead) continue;
      if(m.type!=="beetle" && m.type!=="worm") continue;
      const d = Math.abs(m.x-a.x)+Math.abs(m.y-a.y);
      if(d < bestD){ bestD=d; target=m; }
    }

    while(a.moveT >= period){
      a.moveT -= period;
      if(target && bestD <= 16){
        if(target.type==="beetle" && target.y===SURFACE_WALK_Y && isCoverAt(target.x, SURFACE_WALK_Y)){
          wanderAnt(a);
        } else {
          moveToward(a, target.x, target.y);
        }
      } else {
        const b = bestNeighborForPher(a.team, PH.DANGER, a.x,a.y, true);
        if(b.v > 0.08) { a.x=b.x; a.y=b.y; } else wanderAnt(a);
      }
      spendEnergy(a, st.moveE);
    }

    if(target && a.x===target.x && a.y===target.y){
      const dmg = (target.type==="beetle") ? 10 : 8;
      target.hp -= dmg*dt;
      if(target.hp <= 0){
        target.dead = true;
        if(target.type==="beetle") addRes("corpseBeetle", target.x, target.y, 4.0, 0.0);
        if(target.type==="worm") spawnWormCarcass(target.x, target.y);
      }
    }
  }

  function stepWarrior(a, dt){
    const col = colonies[a.team];
    const { st, period } = antMoveBudget(a, dt);

    if(shouldRefuel(a)){
      if(!feedAtHome(a, col, dt)){
        moveToward(a, col.homeX, col.homeY);
      }
      while(a.moveT >= period){
        a.moveT -= period;
        moveToward(a, col.homeX, col.homeY);
        spendEnergy(a, st.moveE);
      }
      return;
    }

    if(nearestHostileMobDist(a.x,a.y) <= 5) depositPher(a.team, PH.DANGER, a.x,a.y, 0.07);

    let target = null, bestD = 9999;
    for(const m of mobs){
      if(m.dead) continue;
      if(m.type!=="beetle") continue;
      const d = Math.abs(m.x-a.x)+Math.abs(m.y-a.y);
      if(d < bestD){ bestD=d; target=m; }
    }

    while(a.moveT >= period){
      a.moveT -= period;
      if(target && bestD <= 14){
        if(target.y===SURFACE_WALK_Y && isCoverAt(target.x, SURFACE_WALK_Y)){
          wanderAnt(a);
        } else moveToward(a, target.x, target.y);
      } else {
        const b = bestNeighborForPher(a.team, PH.HOME, a.x,a.y, false);
        if(b.v < 0.20 && Math.random() < 0.65) { a.x=b.x; a.y=b.y; }
        else wanderAnt(a);
      }
      spendEnergy(a, st.moveE);
    }

    if(target && a.x===target.x && a.y===target.y){
      target.hp -= 8*dt;
      if(target.hp <= 0){
        target.dead = true;
        addRes("corpseBeetle", target.x, target.y, 4.0, 0.0);
      }
    }
  }

  function stepWorkerDrone(a, col, dt){
    const { st, period } = antMoveBudget(a, dt);

    if(shouldRefuel(a)){
      if(!feedAtHome(a, col, dt)){
        moveToward(a, col.homeX, col.homeY);
      }
      while(a.moveT >= period){
        a.moveT -= period;
        moveToward(a, col.homeX, col.homeY);
        spendEnergy(a, st.moveE);
      }
      return;
    }

    if(a.carried){
      const r = resources.find(rr => rr.id===a.carried && !rr.dead);
      if(r){ r.x=a.x; r.y=a.y; } else a.carried=null;
    }

    while(a.moveT >= period){
      a.moveT -= period;

      if(isTunnel(a.x,a.y)) depositPher(a.team, PH.HOME, a.x,a.y, 0.07);
      if(nearestHostileMobDist(a.x,a.y) <= 4) depositPher(a.team, PH.DANGER, a.x,a.y, 0.06);

      if(a.carried){
        haulToQueen(a, col);
        spendEnergy(a, st.moveE);
        continue;
      }

      const pop = colonyPop(col.team);
      const foodTarget = 10 + pop * CFG.foodTargetPerAnt;
      const subTarget  = 8 + pop * CFG.subTargetPerAnt;

      const edible = col.foodStore + col.fungusStore;
      const needFood = edible < foodTarget;
      const needSub  = col.subE < subTarget;

      const target = findNearestRes(a.x,a.y, (r) => {
        if(!canCarry(a)) return false;
        if(r.kind==="dirt") return false;
        if(r.kind==="leaf") return false;
        if(r.kind==="leafBit") return needSub || (Math.random() < 0.35);
        if(r.kind==="protein") return needFood || (Math.random() < 0.25);
        if(r.kind==="spore") return true;
        if(r.kind==="corpseBeetle" || r.kind==="corpseAnt" || r.kind==="wormSeg") return true;
        return false;
      }, 32);

      if(target){
        if(a.x !== target.x || a.y !== target.y){
          moveToward(a, target.x, target.y);
          spendEnergy(a, st.moveE);
          continue;
        }

        if(target.mass > carryCapacity(a)){
          wanderAnt(a);
          spendEnergy(a, st.moveE);
          continue;
        }
        a.carried = target.id;
        depositPher(a.team, PH.FOOD, a.x,a.y, 0.10);
        spendEnergy(a, st.moveE*0.25);
        continue;
      }

      const b = bestNeighborForPher(a.team, PH.HOME, a.x,a.y, true);
      if(b.v > 0.06 && Math.random() < 0.70) { a.x=b.x; a.y=b.y; }
      else wanderAnt(a);

      spendEnergy(a, st.moveE);
    }
  }

  function stepWorkerScout(a, col, dt){
    const { st, period } = antMoveBudget(a, dt);

    if(shouldRefuel(a)){
      if(!feedAtHome(a, col, dt)){
        moveToward(a, col.homeX, col.homeY);
      }
      while(a.moveT >= period){
        a.moveT -= period;
        moveToward(a, col.homeX, col.homeY);
        spendEnergy(a, st.moveE);
      }
      return;
    }

    if(a.carried){
      const r = resources.find(rr => rr.id===a.carried && !rr.dead);
      if(r){ r.x=a.x; r.y=a.y; } else a.carried=null;
    }

    while(a.moveT >= period){
      a.moveT -= period;

      if(isTunnel(a.x,a.y)) depositPher(a.team, PH.HOME, a.x,a.y, 0.07);

      if(a.carried){
        haulToQueen(a, col);
        spendEnergy(a, st.moveE);
        continue;
      }

      const pop = colonyPop(col.team);
      const foodTarget = 10 + pop * CFG.foodTargetPerAnt;
      const subTarget  = 8 + pop * CFG.subTargetPerAnt;
      const edible = col.foodStore + col.fungusStore;

      const needFood = edible < foodTarget;
      const needSub  = col.subE < subTarget;

      const mustScout = needSub || needFood || (Math.random() < CFG.foragePersistence);

      if(mustScout && a.y !== SURFACE_WALK_Y){
        moveToward(a, col.homeX, SURFACE_WALK_Y);
        spendEnergy(a, st.moveE);
        continue;
      }

      if(a.y === SURFACE_WALK_Y){
        if(Math.random() < 0.55) a.x = clamp(a.x + (Math.random()<0.5?-1:1), 1, W-2);

        const target = findNearestRes(a.x,a.y, (r) => {
          if(!canCarry(a)) return false;
          if(r.kind==="leaf") return true;
          if(r.kind==="leafBit") return true;
          if(r.kind==="protein") return needFood || (Math.random() < 0.25);
          if(r.kind==="spore") return true;
          return false;
        }, 22);

        if(target){
          if(a.x !== target.x || a.y !== target.y){
            moveToward(a, target.x, target.y);
            spendEnergy(a, st.moveE);
            continue;
          }

          depositPher(a.team, PH.FOOD, a.x,a.y, 0.20);
          if(target.kind==="leaf"){
            const cap = carryCapacity(a);
            if(target.mass > cap){
              a.actT += dt;
              spendEnergy(a, 0.11*dt);
              if(a.actT > (0.38 / CFG.leafCutBias)){
                a.actT = 0;
                cutResource(target, cap);
              }
              const bit = resourceAt(a.x,a.y, rr => rr.kind==="leafBit" && rr.mass <= cap);
              if(bit) a.carried = bit.id;
              spendEnergy(a, st.moveE*0.15);
              continue;
            }
            a.carried = target.id;
            spendEnergy(a, st.moveE*0.25);
            continue;
          }

          if(target.mass <= carryCapacity(a)){
            a.carried = target.id;
            spendEnergy(a, st.moveE*0.25);
            continue;
          }
        }

        spendEnergy(a, st.moveE);
        continue;
      }

      const b = bestNeighborForPher(a.team, PH.FOOD, a.x,a.y, true);
      if(b.v > 0.07 && Math.random() < 0.70) { a.x=b.x; a.y=b.y; }
      else {
        const h = bestNeighborForPher(a.team, PH.HOME, a.x,a.y, true);
        if(h.v > 0.06 && Math.random() < 0.70) { a.x=h.x; a.y=h.y; }
        else wanderAnt(a);
      }
      spendEnergy(a, st.moveE);
    }
  }

  function findDigFrontier(team, x,y, rad){
    let best = null;
    let bestScore = -1e9;

    const x0 = clamp(Math.floor(x-rad), 1, W-2);
    const x1 = clamp(Math.floor(x+rad), 1, W-2);
    const y0 = clamp(Math.floor(y-rad), surfaceY+1, H-2);
    const y1 = clamp(Math.floor(y+rad), surfaceY+1, H-2);

    for(let yy=y0; yy<=y1; yy++){
      for(let xx=x0; xx<=x1; xx++){
        if(!isTunnel(xx,yy)) continue;
        if(getOwner(xx,yy) !== team+1) continue;

        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        for(const [dx,dy] of dirs){
          const sx=xx+dx, sy=yy+dy;
          if(!inb(sx,sy)) continue;
          if(!isSoil(sx,sy)) continue;
          if(isRock(sx,sy)) continue;

          const d = Math.abs(xx-x)+Math.abs(yy-y);
          const bt = bonusType[idx(sx,sy)];
          const bonusBoost = (bt===1? 2.8 : bt===3? 1.6 : bt===2? 1.0 : 0.0);
          const score = (50 - d) + bonusBoost + (sy - surfaceY)*0.02 + moisture[idx(sx,sy)]*0.5;

          if(score > bestScore){
            bestScore = score;
            best = { fx:xx, fy:yy, sx, sy };
          }
        }
      }
    }
    return best;
  }

  function stepDigger(a, dt){
    const col = colonies[a.team];
    const { st, period } = antMoveBudget(a, dt);

    if(shouldRefuel(a)){
      if(!feedAtHome(a, col, dt)){
        moveToward(a, col.homeX, col.homeY);
      }
      while(a.moveT >= period){
        a.moveT -= period;
        moveToward(a, col.homeX, col.homeY);
        spendEnergy(a, st.moveE);
      }
      return;
    }

    if(a.carried){
      const r = resources.find(rr => rr.id===a.carried && !rr.dead);
      if(r){ r.x=a.x; r.y=a.y; } else a.carried=null;
    }

    while(a.moveT >= period){
      a.moveT -= period;

      if(isTunnel(a.x,a.y)) depositPher(a.team, PH.HOME, a.x,a.y, 0.08);

      if(a.carried){
        const r = resources.find(rr => rr.id===a.carried && !rr.dead);
        if(r && r.kind==="dirt"){
          const dp = { x: clamp(col.homeX + irand(-5,5), 2, W-3), y: SURFACE_WALK_Y };
          if(a.x !== dp.x || a.y !== dp.y) moveToward(a, dp.x, dp.y);
          else {
            mergeOrLockDirtDrop(r, dp.x, dp.y);
            a.carried = null;
          }
          spendEnergy(a, st.moveE);
          continue;
        }
        haulToQueen(a, col);
        spendEnergy(a, st.moveE);
        continue;
      }

      const looseDirt = findNearestRes(a.x,a.y, r => r.kind==="dirt", 10);
      if(looseDirt && looseDirt.mass <= carryCapacity(a)){
        if(a.x !== looseDirt.x || a.y !== looseDirt.y){
          moveToward(a, looseDirt.x, looseDirt.y);
        } else {
          a.carried = looseDirt.id;
        }
        spendEnergy(a, st.moveE);
        continue;
      }

      const frontier = findDigFrontier(a.team, a.x, a.y, 22) || findDigFrontier(a.team, col.homeX, col.homeY, 40);

      if(frontier){
        const { fx, fy, sx, sy } = frontier;
        if(a.x !== fx || a.y !== fy){
          moveToward(a, fx, fy);
          spendEnergy(a, st.moveE);
          continue;
        }

        a.actT += dt;
        spendEnergy(a, digCost(a.caste) * dt);

        if(a.actT > 0.55){
          a.actT = 0;

          if(isSoil(sx,sy) && !isRock(sx,sy)){
            setTile(sx,sy, TILE.TUNNEL);
            setOwner(sx,sy, a.team+1);

            const bt = bonusType[idx(sx,sy)];
            const ba = bonusAmt[idx(sx,sy)];
            if(bt !== 0){
              bonusType[idx(sx,sy)] = 0;
              bonusAmt[idx(sx,sy)] = 0;

              if(bt === 1){
                addRes("protein", sx, sy, 2.0, ba);
                depositPher(a.team, PH.FOOD, sx, sy, 0.65);
              } else if(bt === 2){
                addRes("wormSeg", sx, sy, 2.5, 0.0);
                depositPher(a.team, PH.DANGER, sx, sy, 0.55);
              } else if(bt === 3){
                addRes("spore", sx, sy, 0.6, 0.0);
                depositPher(a.team, PH.FOOD, sx, sy, 0.35);
              }
            }

            const dirt = addRes("dirt", sx, sy, 1.0, 0.0);
            if(dirt && dirt.mass <= carryCapacity(a)){
              a.carried = dirt.id;
            }

            moisture[idx(sx,sy)] = clamp(moisture[idx(sx,sy)] + 0.08, 0, 1);
            nutrients[idx(sx,sy)] = clamp(nutrients[idx(sx,sy)] + 0.04, 0, 1);
          }
        }
        spendEnergy(a, st.moveE*0.18);
        continue;
      }

      const h = bestNeighborForPher(a.team, PH.HOME, a.x,a.y, true);
      if(h.v > 0.06 && Math.random() < 0.70) { a.x=h.x; a.y=h.y; }
      else wanderAnt(a);
      spendEnergy(a, st.moveE);
    }
  }

  function stepAnt(a, dt){
    a.age += dt;
    a.life -= dt;

    const col = colonies[a.team];
    const st = casteStats(a.caste);
    spendEnergy(a, st.upkeep * dt);

    if(a.life <= 0) a.hp = 0;

    if(a.hp <= 0){
      const c = addRes("corpseAnt", a.x, a.y, 2.5, 3.0);
      if(c) c.team = a.team;
      return;
    }

    if(a.caste === CASTE.QUEEN){ stepQueen(a, dt); return; }
    if(a.caste === CASTE.HUNTER){ stepHunter(a, dt); return; }
    if(a.caste === CASTE.WARRIOR){ stepWarrior(a, dt); return; }
    if(a.caste === CASTE.DIGGER){ stepDigger(a, dt); return; }

    if(a.role === ROLE.SCOUT) stepWorkerScout(a, col, dt);
    else stepWorkerDrone(a, col, dt);
  }

  /* =========================================================
     15) Worm triggers and mobs
  ========================================================= */
  const digDisturb = new Float32Array(W*H);
  const rainLeach = new Float32Array(W);
  let wormAlertT = 0;
  let prevRainActive = false;
  const WORM_SMELL_DEPTH = surfaceY + 60;

  function tickWormTriggers(dt){
    for(let i=0;i<digDisturb.length;i++){
      digDisturb[i] = Math.max(0, digDisturb[i] - dt*0.030);
    }
    for(let x=0;x<W;x++){
      rainLeach[x] = Math.max(0, rainLeach[x] - dt*0.018);
    }

    if(rain.active){
      for(let x=0;x<W;x++){
        let s = 0;
        for(let y=surfaceY; y<surfaceY+8; y++){
          const i = idx(x,y);
          const p0 = Math.max(pher[0][PH.HOME][i], pher[0][PH.FOOD][i], pher[0][PH.DANGER][i]);
          const p1 = Math.max(pher[1][PH.HOME][i], pher[1][PH.FOOD][i], pher[1][PH.DANGER][i]);
          s = Math.max(s, p0, p1);
        }
        rainLeach[x] = clamp(rainLeach[x] + s * dt * (0.45 + 0.75*rain.intensity), 0, 1);
      }
    }

    if(prevRainActive && !rain.active){
      wormAlertT = Math.max(wormAlertT, 8 + 10*rain.intensity);
    }
    prevRainActive = rain.active;

    wormAlertT = Math.max(0, wormAlertT - dt);
  }

  function wormScentAt(x,y){
    const i = idx(x,y);
    const p0 = Math.max(pher[0][PH.HOME][i], pher[0][PH.FOOD][i], pher[0][PH.DANGER][i]);
    const p1 = Math.max(pher[1][PH.HOME][i], pher[1][PH.FOOD][i], pher[1][PH.DANGER][i]);
    const localP = Math.max(p0, p1);
    const depth01 = clamp((y - surfaceY) / 80, 0.0, 1.0);
    const leach = rainLeach[x] * (0.25 + 0.75*depth01);
    const dist = digDisturb[i];
    return clamp(localP*0.55 + leach*0.85 + dist*1.15, 0, 2);
  }

  const mobs = [];
  function backfillSoilOnlyIfSafe(x,y){
    if(!inb(x,y)) return;
    if(tileAt(x,y) !== TILE.TUNNEL) return;
    if(antOcc[idx(x,y)] === 1) return;
    if(getOwner(x,y) !== 0) return;
    setTile(x,y, TILE.SOIL);
  }

  function spawnWorm(){
    const n = mobs.filter(m => m.type==="worm" && !m.dead).length;
    if(n >= CAP.worms) return;
    const x = irand(20, W-20);
    const y = irand(surfaceY+62, H-6);
    const w = { type:"worm", x,y, hp:100, hpMax:100, upTask:false, dead:false, seg:[], segLen:10, digSoilLast:false };
    for(let i=0;i<w.segLen;i++) w.seg.push({x, y});
    mobs.push(w);
  }
  function spawnBeetleImago(){
    const n = mobs.filter(m => m.type==="beetle" && !m.dead).length;
    if(n >= CAP.beetles) return;
    const x = irand(10, W-10);
    const y = irand(surfaceY+40, H-8);
    mobs.push({ type:"beetle", x,y, hp:30, hpMax:30, upTask:false, laidThisNight:false, dead:false, digSoilLast:false });
  }
  function spawnBeetleEgg(px){
    const eggs = mobs.filter(m => m.type==="beetleEgg" && !m.dead).length;
    if(eggs >= CAP.beetleEggs) return;
    mobs.push({ type:"beetleEgg", x:px, y:SURFACE_WALK_Y, t:0, dead:false });
  }
  function spawnWormCarcass(x,y){
    const n = 3 + irand(0,3);
    for(let i=0;i<n;i++){
      addRes("wormSeg", x + irand(-1,1), y + irand(-1,1), 2.5, 0.0);
    }
  }

  function stepMobGreedy(m, tx, ty){
    let best = { x:m.x, y:m.y, d: Math.abs(tx-m.x)+Math.abs(ty-m.y) };
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){
      const nx=m.x+dx, ny=m.y+dy;
      if(!passableForMob(nx,ny)) continue;
      if(isRock(nx,ny)) continue;
      const d = Math.abs(tx-nx)+Math.abs(ty-ny);
      if(d < best.d) best = { x:nx, y:ny, d };
    }
    m.x = best.x; m.y = best.y;
  }
  function mobWander(m){
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for(let k=0;k<4;k++){
      const [dx,dy] = choice(dirs);
      const nx=m.x+dx, ny=m.y+dy;
      if(!passableForMob(nx,ny)) continue;
      if(isRock(nx,ny)) continue;
      m.x=nx; m.y=ny;
      return;
    }
  }

  function manageBeetleSurfacing(nightNow){
    if(!nightNow) return;
    const beetles = mobs.filter(m => m.type==="beetle" && !m.dead);
    let upCount = 0;
    for(const b of beetles){
      if(b.upTask || b.y <= SURFACE_WALK_Y) upCount++;
    }
    const slots = Math.max(0, 2 - upCount);
    if(slots <= 0) return;
    const cands = beetles.filter(b => !b.laidThisNight && !b.upTask && b.y > SURFACE_WALK_Y).sort((a,b)=>a.y-b.y);
    for(let i=0;i<slots && i<cands.length;i++) cands[i].upTask = true;
  }

  function manageWormAscend(nightNow){
    const worms = mobs.filter(m => m.type==="worm" && !m.dead);
    if(worms.length === 0) return;
    if(rain.active){ for(const w of worms) w.upTask = false; return; }
    if(wormAlertT <= 0.1){ for(const w of worms) w.upTask = false; return; }

    const slots = nightNow ? 1 : 2;
    const scored = worms.map(w => ({ w, s: wormScentAt(w.x,w.y) })).sort((a,b)=>b.s-a.s);
    for(let i=0;i<scored.length;i++){
      scored[i].w.upTask = (i < slots && scored[i].s > 0.30);
    }
  }

  function stepBeetleEgg(e, dt, nightNow){
    e.t += dt;
    if(!nightNow) return;
    if(e.t > 10 + Math.random()*10){
      e.dead = true;
      spawnBeetleImago();
    }
  }

  function stepBeetle(b, dt, nightNow){
    if(!nightNow){ b.laidThisNight = false; b.upTask = false; }

    const oldX=b.x, oldY=b.y;

    if(nightNow && !b.laidThisNight && (b.upTask || b.y <= SURFACE_WALK_Y)){
      stepMobGreedy(b, b.x, SURFACE_WALK_Y);
      if(b.y === SURFACE_WALK_Y){
        const n = irand(1,3);
        for(let i=0;i<n;i++) spawnBeetleEgg(clamp(b.x + irand(-3,3), 2, W-3));
        b.laidThisNight = true;
      }
    } else if(nightNow && b.laidThisNight && b.y <= SURFACE_WALK_Y){
      stepMobGreedy(b, b.x, surfaceY+12);
    } else {
      let prey = null, bestD = 9999;
      for(const a of ants){
        if(a.hp<=0) continue;
        const d = Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
        if(d < bestD){ bestD=d; prey=a; }
      }
      if(prey && prey.y===SURFACE_WALK_Y && isCoverAt(prey.x, SURFACE_WALK_Y)) prey = null;
      if(prey && bestD <= 10){
        stepMobGreedy(b, prey.x, prey.y);
        if(b.x===prey.x && b.y===prey.y) prey.hp -= 6*dt;
      } else {
        mobWander(b);
      }
    }

    const nowT = tileAt(b.x,b.y);
    if(b.y >= surfaceY && nowT === TILE.SOIL){
      setTile(b.x,b.y, TILE.TUNNEL);
      setOwner(b.x,b.y, 0);
      if(b.digSoilLast) backfillSoilOnlyIfSafe(oldX, oldY);
      b.digSoilLast = true;
    } else b.digSoilLast = false;
  }

  function stepWorm(w, dt, nightNow){
    if(w.dead) return;

    if(rain.active && w.y <= surfaceY + 2) w.hp = 0;
    if(w.hp <= 0){ w.dead = true; spawnWormCarcass(w.x,w.y); return; }

    const oldX=w.x, oldY=w.y;

    const scentHere = wormScentAt(w.x,w.y);
    const upBias = (w.upTask && !nightNow && scentHere > 0.30) ? 0.32 : 0.0;
    const downBias = rain.active ? 0.60 : 0.10;

    let prey = null, bestD = 9999;
    if(w.upTask){
      for(const a of ants){
        if(a.hp<=0) continue;
        const d = Math.abs(a.x-w.x)+Math.abs(a.y-w.y);
        if(d < bestD){ bestD=d; prey=a; }
      }
      if(prey && prey.y===SURFACE_WALK_Y && isCoverAt(prey.x, SURFACE_WALK_Y)) prey = null;
    }

    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    let best = { x:w.x, y:w.y, s:-1e9 };
    for(const [dx,dy] of dirs){
      const nx=w.x+dx, ny=w.y+dy;
      if(!passableForMob(nx,ny)) continue;
      if(isRock(nx,ny)) continue;

      let s = 0;
      if(ny < surfaceY) s -= 999;
      if(tileAt(nx,ny) === TILE.SOIL) s += 0.35;
      if(tileAt(nx,ny) === TILE.TUNNEL && !w.upTask) s -= 0.9;

      s += (w.y - ny) * upBias;
      s += (ny - w.y) * downBias;

      if(scentHere < 0.20){
        s += (ny - w.y) * 0.22;
        if(tileAt(nx,ny) === TILE.TUNNEL) s -= 1.0;
      }
      if(prey){
        const d = Math.abs(prey.x-nx)+Math.abs(prey.y-ny);
        s += (18 - d) * 0.25;
      }
      s += (Math.random()-0.5)*0.10;

      if(s > best.s) best = { x:nx, y:ny, s };
    }

    w.x = best.x; w.y = best.y;

    for(const a of ants){
      if(a.hp<=0) continue;
      if(a.x===w.x && a.y===w.y){
        let dmg = (a.caste===CASTE.QUEEN) ? 0.8 : 0.5;
        if(w.upTask) dmg = (a.caste===CASTE.QUEEN) ? 10 : 6;
        a.hp -= dmg*dt;
      }
    }

    const nowT = tileAt(w.x,w.y);
    if(w.y >= surfaceY && nowT === TILE.SOIL){
      setTile(w.x,w.y, TILE.TUNNEL);
      setOwner(w.x,w.y, 0);

      if(w.digSoilLast){
        backfillSoilOnlyIfSafe(oldX, oldY);
        nutrients[idx(oldX,oldY)] = clamp(nutrients[idx(oldX,oldY)] + 0.07, 0, 1);
        moisture[idx(oldX,oldY)] = clamp(moisture[idx(oldX,oldY)] + 0.04, 0, 1);
      }
      w.digSoilLast = true;
    } else w.digSoilLast = false;

    w.seg[0].x = w.x; w.seg[0].y = w.y;
    for(let i=1;i<w.seg.length;i++){
      const prev = w.seg[i-1];
      const cur = w.seg[i];
      const dx = prev.x - cur.x;
      const dy = prev.y - cur.y;
      if(Math.abs(dx)+Math.abs(dy) > 1){
        cur.x += Math.sign(dx);
        cur.y += Math.sign(dy);
      }
    }
  }

  /* =========================================================
     16) Spawners
  ========================================================= */
  let beetleSpawnCD = 0;
  let wormSpawnCD = 0;

  function spawners(dt){
    beetleSpawnCD = Math.max(0, beetleSpawnCD - dt);
    wormSpawnCD = Math.max(0, wormSpawnCD - dt);

    const nightNow = isNight();

    if(beetleSpawnCD <= 0){
      if(Math.random() < 0.40){
        spawnBeetleImago();
        beetleSpawnCD = 22 + Math.random()*26;
      } else beetleSpawnCD = 12 + Math.random()*18;
    }

    if(wormSpawnCD <= 0 && wormAlertT > 0.1 && !nightNow){
      if(Math.random() < 0.35){
        spawnWorm();
        wormSpawnCD = 22 + Math.random()*24;
      } else wormSpawnCD = 12 + Math.random()*16;
    }
  }

  /* =========================================================
     17) Fields: moisture and nutrients
  ========================================================= */
  function tickFields(dt){
    if(rain.active){
      for(let y=surfaceY; y<surfaceY+6; y++){
        for(let x=0; x<W; x++){
          const i = idx(x,y);
          if(tile[i]===TILE.SOIL || tile[i]===TILE.TUNNEL){
            moisture[i] = clamp(moisture[i] + dt*(0.18*rain.intensity), 0, 1);
          }
        }
      }
    }

    const sun = sun01();
    for(let y=surfaceY; y<surfaceY+10; y++){
      for(let x=0; x<W; x++){
        const i = idx(x,y);
        const evap = dt*(0.002 + 0.003*sun) * (1.0 - rain.intensity);
        moisture[i] = clamp(moisture[i] - evap, 0, 1);
      }
    }
    for(let i=0;i<nutrients.length;i++){
      nutrients[i] = clamp(nutrients[i] - dt*0.0008, 0, 1);
    }
  }

  /* =========================================================
     18) World gen
  ========================================================= */
  function carveRoomRect(x0,y0,w,h, team){
    for(let y=y0;y<y0+h;y++){
      for(let x=x0;x<x0+w;x++){
        if(!inb(x,y)) continue;
        if(isRock(x,y)) continue;
        setTile(x,y, TILE.TUNNEL);
        setOwner(x,y, team+1);
        moisture[idx(x,y)] = clamp(moisture[idx(x,y)] + 0.15, 0, 1);
      }
    }
  }
  function carveShaft(x, y0, y1, team){
    const ya = Math.min(y0,y1), yb = Math.max(y0,y1);
    for(let y=ya;y<=yb;y++){
      if(!inb(x,y)) continue;
      if(isRock(x,y)) continue;
      setTile(x,y, TILE.TUNNEL);
      setOwner(x,y, team+1);
    }
  }
  function carveNest(team, cx, cy){
    const col = colonies[team];
    col.homeX = cx;
    col.homeY = cy;

    carveRoomRect(cx-4, cy-3, 9, 7, team);
    carveShaft(cx, cy-3, SURFACE_WALK_Y, team);
    carveRoomRect(cx+5, cy-2, 6, 5, team);

    const q = spawnAnt(team, CASTE.QUEEN, cx, cy);
    col.queenId = q.id;
    spawnAnt(team, CASTE.WORKER, cx-1, cy+1);
  }

  function genWorld(){
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        const i = idx(x,y);
        tile[i] = (y < surfaceY) ? TILE.AIR : TILE.SOIL;
        owner[i] = 0;
        moisture[i] = (y < surfaceY) ? 0 : clamp(0.45 + (y - surfaceY)*0.006, 0, 1);
        nutrients[i] = 0;
        bonusType[i] = 0;
        bonusAmt[i] = 0;
        for(let t=0;t<PH.N;t++){
          pher[0][t][i] = 0;
          pher[1][t][i] = 0;
        }
      }
    }

    for(let y=surfaceY+8;y<H;y++){
      for(let x=0;x<W;x++){
        const depth = y - surfaceY;
        const r = Math.random();
        if(depth > 20 && r < 0.020) tile[idx(x,y)] = TILE.ROCKL;
        else if(depth > 14 && r < 0.026) tile[idx(x,y)] = TILE.ROCKM;
        else if(depth > 10 && r < 0.030) tile[idx(x,y)] = TILE.ROCKS;
      }
    }

    for(let y=surfaceY+6;y<H;y++){
      for(let x=0;x<W;x++){
        if(isRock(x,y)) continue;
        const r = Math.random();
        if(r < 0.010){
          bonusType[idx(x,y)] = 1;
          bonusAmt[idx(x,y)] = 6 + Math.random()*10;
        } else if(r < 0.013){
          bonusType[idx(x,y)] = 2;
          bonusAmt[idx(x,y)] = 10 + Math.random()*18;
        } else if(r < 0.016){
          bonusType[idx(x,y)] = 3;
          bonusAmt[idx(x,y)] = 1;
        }
      }
    }

    plants.length = 0;
    for(let x=6;x<W-6;x+=3){
      if(Math.random() < 0.65){
        plants.push({
          x,
          kind:(Math.random()<0.85) ? "grass" : "branch",
          e: 6 + Math.random()*10,
          bloom: 10 + Math.random()*16,
          leafTimer: 8 + Math.random()*18
        });
      }
    }

    carveNest(TEAM.ORANGE, Math.floor(W*0.28), surfaceY+18);
    carveNest(TEAM.CYAN,   Math.floor(W*0.72), surfaceY+18);
  }

  /* =========================================================
     19) Controls: drop food pack, reset, center, keyboard D
  ========================================================= */
  document.getElementById("btnCenter").addEventListener("click", () => {
    camera.x = Math.floor(W*0.5);
    camera.y = Math.floor(surfaceY + 18);
  });

  function dropFoodPack(){
    const x = irand(8, W-8);
    addRes("protein", x, SURFACE_WALK_Y, 2.0, 16);
    addRes("protein", x+1, SURFACE_WALK_Y, 2.0, 12);
    addRes("leaf", x-1, SURFACE_WALK_Y, 6.0, 3.5);
  }
  document.getElementById("btnDropFood").addEventListener("click", dropFoodPack);
  addEventListener("keydown", (e) => {
    if(e.repeat) return;
    const tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName : "";
    if(tag === "INPUT" || tag === "TEXTAREA") return;
    if(e.key === "d" || e.key === "D") dropFoodPack();
  });

  /* =========================================================
     20) WIN/LOSE + end code
  ========================================================= */
  function endReason(){
    const o = colonies[TEAM.ORANGE];
    const c = colonies[TEAM.CYAN];
    if(o.win || c.win) return "W0";
    if(o.lose && c.lose) return "L0";
    if(o.lose) return "L1";
    if(c.lose) return "L2";
    return "OK";
  }

  function makeEndCode(){
    const now = Math.floor(simTime*10);
    const hl = Number(rngPh.value);
    const sol = Number(rngSolar.value);

    const o = colonies[TEAM.ORANGE];
    const c = colonies[TEAM.CYAN];

    const co = countsBy(TEAM.ORANGE);
    const cc = countsBy(TEAM.CYAN);

    const pack = (col, cnt) => {
      const q = ants.find(a => a.id===col.queenId);
      const qhp = q ? Math.round(q.hp) : 0;
      const pop = cnt.total;
      const f = Math.round(col.foodStore);
      const g = Math.round(col.fungusStore);
      const s = Math.round(col.subE);
      const d = col.deepestY - surfaceY;
      const ga = col.galleriesActive;
      return [
        b36(qhp), b36(pop),
        b36(cnt.drones), b36(cnt.scouts), b36(cnt.diggers), b36(cnt.warriors), b36(cnt.hunters),
        b36(f), b36(g), b36(s),
        b36(d), b36(ga)
      ].join(".");
    };

    const core =
      `AAS1-${b36(now)}-${b36(sol)}-${b36(hl)}-` +
      `${pack(o,co)}-${pack(c,cc)}-` +
      `${b36(mobs.filter(m=>m.type==="worm"&&!m.dead).length)}.${b36(mobs.filter(m=>m.type==="beetle"&&!m.dead).length)}-` +
      `${endReason()}-` +
      `${b36(Math.round(CFG.scoutFrac*100))}.${b36(Math.round(CFG.diggerFrac*100))}.${b36(Math.round(CFG.leafFallMult*100))}.${b36(Math.round(CFG.mushEff*100))}`;

    const crc = b36(hashStr(core) & 0xFFFF);
    return `${core}-${crc}`;
  }

  function checkWinLose(){
    for(const col of colonies){
      if(col.win || col.lose) continue;
      const q = ants.find(a => a.id===col.queenId);
      if(!q || q.hp<=0) col.lose = true;

      const pop = colonyPop(col.team);
      const edible = col.foodStore + col.fungusStore;
      if(pop >= 70 && col.galleriesActive >= 2 && edible >= CFG.queenSurplusGate){
        col.win = true;
      }
    }

    const o = colonies[TEAM.ORANGE];
    const c = colonies[TEAM.CYAN];
    if((o.win||o.lose) || (c.win||c.lose)){
      const code = makeEndCode();
      o.endCode = code;
      c.endCode = code;
    }
  }

  /* =========================================================
     21) Music (default off)
  ========================================================= */
  const chkMusic = document.getElementById("chkMusic");
  let audio = { ctx:null, on:false, t:0, osc:null, gain:null, lfo:null };

  function startMusic(){
    if(audio.on) return;
    audio.ctx = audio.ctx || new (window.AudioContext || window.webkitAudioContext)();
    const ac = audio.ctx;

    const osc = ac.createOscillator();
    osc.type = "sawtooth";
    const gain = ac.createGain();
    gain.gain.value = 0.0;

    const lfo = ac.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 2.0;

    const lfoGain = ac.createGain();
    lfoGain.gain.value = 18;

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    osc.connect(gain);
    gain.connect(ac.destination);

    osc.frequency.value = 55;
    osc.start();
    lfo.start();

    audio.osc = osc;
    audio.gain = gain;
    audio.lfo = lfo;
    audio.on = true;
    audio.t = 0;
  }
  function stopMusic(){
    if(!audio.on) return;
    try{
      audio.gain.gain.setValueAtTime(0, audio.ctx.currentTime);
      audio.osc.stop();
      audio.lfo.stop();
    } catch {}
    audio.osc=null; audio.gain=null; audio.lfo=null;
    audio.on=false;
  }
  chkMusic.checked = false;
  chkMusic.addEventListener("change", async () => {
    if(chkMusic.checked){
      startMusic();
      if(audio.ctx && audio.ctx.state === "suspended") await audio.ctx.resume();
    } else stopMusic();
  });
  function tickMusic(dt){
    if(!audio.on) return;
    audio.t += dt;
    const beat = 0.40;
    const phase = (audio.t % (beat*8)) / beat;
    const step = Math.floor(phase);
    const notes = [55, 55, 49, 55, 62, 55, 49, 55];
    const f = notes[step];
    const ac = audio.ctx;
    const now = ac.currentTime;
    audio.osc.frequency.setTargetAtTime(f, now, 0.02);
    const pulse = (phase - step);
    const a = Math.exp(-pulse*7.0);
    const vol = 0.06 * a;
    audio.gain.gain.setTargetAtTime(vol, now, 0.015);
  }

  /* =========================================================
     22) Balance Lab
  ========================================================= */
  const chkLab = document.getElementById("chkLab");
  const rngLabIters = document.getElementById("rngLabIters");
  const valLabIters = document.getElementById("valLabIters");
  const btnRunLab = document.getElementById("btnRunLab");
  const btnCopyLab = document.getElementById("btnCopyLab");
  const btnCopyEnd = document.getElementById("btnCopyEnd");
  const labOut = document.getElementById("labOut");
  const labParams = document.getElementById("labParams");

  valLabIters.textContent = rngLabIters.value;
  rngLabIters.addEventListener("input", () => valLabIters.textContent = rngLabIters.value);

  let lastLabCode = "";
  let lastLabSummary = "";

  function prng(seed){
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clampCfg(c){
    c.scoutFrac = clamp(c.scoutFrac, 0.06, 0.22);
    c.diggerFrac = clamp(c.diggerFrac, 0.12, 0.34);
    c.foragePersistence = clamp(c.foragePersistence, 0.25, 0.90);
    c.leafFallMult = clamp(c.leafFallMult, 0.70, 1.55);
    c.leafCutBias = clamp(c.leafCutBias, 0.70, 1.60);
    c.mushEff = clamp(c.mushEff, 0.45, 0.85);
    c.mushLoss = clamp(c.mushLoss, 0.12, 0.35);
    c.mushMinDepth = clamp(c.mushMinDepth|0, 22, 46);
    c.foodTargetPerAnt = clamp(c.foodTargetPerAnt, 0.40, 0.75);
    c.subTargetPerAnt = clamp(c.subTargetPerAnt, 0.22, 0.55);
    return c;
  }

  function simulateEconomyModel(seed, cfg, seconds=120){
    const r = prng(seed);
    const solar = (Number(rngSolar.value)/100);
    const hl = Number(rngPh.value);

    let pop = 2;
    let edible = 16;
    let fungus = 0;
    let subE = 0;
    let plantBank = 24;
    let leafOnSurface = 2;

    let deepest = 26;
    let surplusStreak = 0;
    let galleriesActive = 0;

    const moveTax = 0.06 + (0.02 * (14/hl));
    const baseUpkeep = 0.16;

    let bestProgress = 0;
    let alive = true;
    let t = 0;

    for(t=0; t<seconds; t++){
      const daylight = solar * (0.40 + 0.60*Math.min(1, (t/seconds)));
      plantBank = Math.min(70, plantBank + daylight*0.55);

      const leafCost = 3.2;
      const leafEvents = (r() < 0.55*cfg.leafFallMult) ? 1 : 0;
      for(let i=0;i<leafEvents;i++){
        if(plantBank >= leafCost){
          plantBank -= leafCost;
          leafOnSurface += 1;
        }
      }

      const workers = Math.max(0, pop - 1);
      const scouts = Math.max(1, Math.floor(workers * cfg.scoutFrac));
      const diggers = Math.max(1, Math.floor(workers * cfg.diggerFrac));

      const gatherRate = 0.18 + 0.03*(hl/14);
      const scoutEff = gatherRate * (0.85 + 0.30*cfg.leafCutBias);
      const take = Math.min(leafOnSurface, scouts * scoutEff);
      leafOnSurface -= take;

      subE += take * leafCost;

      deepest = Math.min(80, deepest + diggers * 0.05);

      if(deepest >= cfg.mushMinDepth && subE > 0.1){
        galleriesActive = 1 + Math.floor((deepest - cfg.mushMinDepth)/20);
        const moistFactor = 0.65;
        const throughput = Math.min(subE, (0.55 + 0.015*deepest) * moistFactor);
        const prod = throughput * cfg.mushEff * (1.0 - cfg.mushLoss);
        subE -= throughput;
        fungus += prod;
      }

      const upkeep = baseUpkeep + pop*0.06 + pop*moveTax*0.35;
      edible += fungus * 0.18;
      fungus *= 0.82;

      edible -= upkeep;
      if(edible < 0){
        pop -= Math.ceil(Math.abs(edible) * 0.9);
        edible = 0;
      }
      if(pop <= 1){
        alive = false;
        break;
      }

      const foodTarget = 10 + pop*cfg.foodTargetPerAnt;
      if(edible > foodTarget*0.95){
        const extra = edible - foodTarget*0.95;
        const eggs = Math.min(3, Math.floor(extra / 1.8));
        if(eggs > 0){
          pop += eggs;
          edible -= eggs * 1.0;
        }
      }

      const winGate = (pop >= 70) && (galleriesActive >= 2) && (edible >= cfg.queenSurplusGate);
      if(edible >= cfg.queenSurplusGate) surplusStreak++; else surplusStreak = Math.max(0, surplusStreak-2);

      const prog = clamp(
        (pop/70)*0.45 +
        (galleriesActive/2)*0.25 +
        (edible/cfg.queenSurplusGate)*0.25 +
        (surplusStreak/40)*0.05,
        0, 1
      );
      bestProgress = Math.max(bestProgress, prog);

      if(winGate && surplusStreak > 30){
        bestProgress = 1;
        break;
      }
    }

    const score =
      (alive ? 1 : 0) * 0.35 +
      bestProgress * 0.55 +
      clamp((t/seconds), 0, 1) * 0.10;

    return { score, alive, t, bestProgress, popEnd:pop, edibleEnd:edible, deepest:Math.round(deepest), galleriesActive };
  }

  function mutateCfg(base, rand){
    const c = JSON.parse(JSON.stringify(base));
    const jitter = (s) => (rand() - 0.5) * s;

    c.scoutFrac += jitter(0.10);
    c.diggerFrac += jitter(0.12);
    c.foragePersistence += jitter(0.35);
    c.leafFallMult += jitter(0.60);
    c.leafCutBias += jitter(0.60);
    c.mushEff += jitter(0.18);
    c.mushLoss += jitter(0.16);
    c.mushMinDepth += Math.round(jitter(10));
    c.foodTargetPerAnt += jitter(0.22);
    c.subTargetPerAnt += jitter(0.18);

    return clampCfg(c);
  }

  function makeLabCode(seed, iters, best, bestRes){
    const hl = Number(rngPh.value);
    const sol = Number(rngSolar.value);

    const core =
      `LAB1-${b36(seed)}-${b36(sol)}-${b36(hl)}-${b36(iters)}-` +
      `${b36(Math.round(bestRes.score*10000))}.${b36(Math.round(bestRes.bestProgress*10000))}.${b36(bestRes.t)}-` +
      `${b36(Math.round(best.scoutFrac*100))}.${b36(Math.round(best.diggerFrac*100))}.${b36(Math.round(best.foragePersistence*100))}-` +
      `${b36(Math.round(best.leafFallMult*100))}.${b36(Math.round(best.leafCutBias*100))}-` +
      `${b36(Math.round(best.mushEff*100))}.${b36(Math.round(best.mushLoss*100))}.${b36(best.mushMinDepth)}-` +
      `${b36(Math.round(best.foodTargetPerAnt*100))}.${b36(Math.round(best.subTargetPerAnt*100))}`;

    const crc = b36(hashStr(core) & 0xFFFF);
    return `${core}-${crc}`;
  }

  function applyCfg(best){
    for(const k of Object.keys(CFG)){
      if(best[k] !== undefined) CFG[k] = best[k];
    }
  }

  function runBalanceLab(){
    const iters = Number(rngLabIters.value);
    const seed = (Date.now() & 0x7fffffff) >>> 0;
    const rand = prng(seed);

    let best = JSON.parse(JSON.stringify(CFG));
    let bestRes = simulateEconomyModel(seed ^ 0xA53, best);

    for(let i=0;i<iters;i++){
      const cand = mutateCfg(CFG, rand);
      const res = simulateEconomyModel((seed + i*997) ^ 0xC01, cand);
      if(res.score > bestRes.score){
        best = cand;
        bestRes = res;
      }
    }

    applyCfg(best);

    lastLabCode = makeLabCode(seed, iters, best, bestRes);
    lastLabSummary =
      `Best score ${(bestRes.score*100).toFixed(1)}% | progress ${(bestRes.bestProgress*100).toFixed(1)}% | t ${bestRes.t}s | pop ${bestRes.popEnd} | edible ${bestRes.edibleEnd.toFixed(1)} | depth ${bestRes.deepest} | galleries ${bestRes.galleriesActive}`;

    labOut.textContent = `Lab code: ${lastLabCode}\n${lastLabSummary}`;
    labParams.textContent = `Tuning: ${fmtCfg()}`;
  }

  btnRunLab.addEventListener("click", () => runBalanceLab());
  btnCopyLab.addEventListener("click", async () => {
    if(!lastLabCode) return;
    await copyText(lastLabCode);
  });
  btnCopyEnd.addEventListener("click", async () => {
    const code = colonies[0].endCode || makeEndCode();
    await copyText(code);
  });

  /* =========================================================
     23) Rendering
  ========================================================= */
  function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function drawSky(){
    const dayMix = dayMix01();
    const nightMix = 1 - dayMix;

    const surfScreenY = worldToScreen(0, surfaceY).sy;
    const skyBottom = clamp(surfScreenY + camera.scale, 0, innerHeight);
    if(skyBottom <= 0) return;

    const dayTop = {r: 95, g: 175, b: 250};
    const dayBot = {r: 190, g: 235, b: 255};
    const nightTop = {r: 5, g: 10, b: 35};
    const nightBot = {r: 12, g: 18, b: 60};

    const top = {
      r: Math.floor(lerp(nightTop.r, dayTop.r, dayMix)),
      g: Math.floor(lerp(nightTop.g, dayTop.g, dayMix)),
      b: Math.floor(lerp(nightTop.b, dayTop.b, dayMix)),
    };
    const bot = {
      r: Math.floor(lerp(nightBot.r, dayBot.r, dayMix)),
      g: Math.floor(lerp(nightBot.g, dayBot.g, dayMix)),
      b: Math.floor(lerp(nightBot.b, dayBot.b, dayMix)),
    };

    const grad = ctx.createLinearGradient(0,0,0, skyBottom);
    grad.addColorStop(0, `rgb(${top.r},${top.g},${top.b})`);
    grad.addColorStop(1, `rgb(${bot.r},${bot.g},${bot.b})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,innerWidth, skyBottom);

    if(nightMix > 0.02){
      for(const st of stars){
        const ss = worldToScreen(st.x, st.y);
        if(ss.sy < 0 || ss.sy > skyBottom) continue;
        const tw = 0.65 + 0.35*Math.sin(performance.now()*0.002 + st.tw);
        ctx.globalAlpha = st.a * tw * nightMix;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillRect(ss.sx, ss.sy, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
    }

    const p = dayPhase01();
    const s01 = sun01();

    const sunXw = W*(0.08 + 0.84*p);
    const sunYw = 10 + (1 - s01)*18;

    const moonP = (p + 0.50) % 1;
    const m01 = clamp((Math.cos((moonP - 0.25) * Math.PI * 2) + 1) * 0.5, 0, 1);
    const moonXw = W*(0.08 + 0.84*moonP);
    const moonYw = 12 + (1 - m01)*18;

    const cover = cloudCoverAtX(sunXw);
    const sunA = 0.62 * dayMix * (1.0 - 0.85*cover) * (1.0 - 0.55*rain.intensity);
    if(sunA > 0.01){
      const s = worldToScreen(sunXw, sunYw);
      ctx.globalAlpha = sunA;
      ctx.fillStyle = "rgb(255,245,190)";
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, camera.scale*3.0, 0, Math.PI*2);
      ctx.fill();

      ctx.globalAlpha = sunA*0.25;
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, camera.scale*5.2, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const moonA = 0.48 * nightMix * (1.0 - 0.55*rain.intensity);
    if(moonA > 0.01){
      const m = worldToScreen(moonXw, moonYw);
      ctx.globalAlpha = moonA;
      ctx.fillStyle = "rgb(230,235,255)";
      ctx.beginPath();
      ctx.arc(m.sx, m.sy, camera.scale*2.6, 0, Math.PI*2);
      ctx.fill();

      ctx.globalAlpha = moonA*0.22;
      ctx.beginPath();
      ctx.arc(m.sx, m.sy, camera.scale*4.6, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for(const cl of clouds){
      const cs = worldToScreen(cl.x, cl.y);
      const cloudVis = cl.alpha * (0.18 + 0.82*dayMix);
      ctx.globalAlpha = cloudVis;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      const px = cs.sx, py = cs.sy;
      const w = cl.w * camera.scale * 0.22;
      const h = cl.h * camera.scale * 0.22;
      ctx.beginPath();
      ctx.ellipse(px, py, w, h, 0, 0, Math.PI*2);
      ctx.ellipse(px + w*0.6, py + h*0.1, w*0.9, h*0.95, 0, 0, Math.PI*2);
      ctx.ellipse(px - w*0.7, py + h*0.05, w*0.75, h*0.80, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if(rain.active){
      ctx.globalAlpha = 0.18 + 0.22*rain.intensity;
      ctx.fillStyle = "rgba(160,190,255,0.35)";
      ctx.fillRect(0,0,innerWidth, skyBottom);

      ctx.globalAlpha = 0.15 + 0.25*rain.intensity;
      ctx.strokeStyle = "rgba(210,230,255,0.75)";
      ctx.lineWidth = 1;
      const n = Math.floor(140 * rain.intensity);
      ctx.beginPath();
      for(let i=0;i<n;i++){
        const x = (Math.random()*innerWidth)|0;
        const y = (Math.random()*skyBottom)|0;
        ctx.moveTo(x, y);
        ctx.lineTo(x-4, y+10);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function renderPheromones(x0,y0,x1,y1){
    const hl = Number(rngPh.value);
    const alphaScale = clamp(hl/18, 0.4, 1.0);

    for(let y=y0;y<=y1;y++){
      for(let x=x0;x<=x1;x++){
        if(y < surfaceY) continue;
        if(tileAt(x,y) !== TILE.TUNNEL && y !== SURFACE_WALK_Y) continue;

        const i = idx(x,y);
        const home = Math.max(pher[0][PH.HOME][i], pher[1][PH.HOME][i]);
        const food = Math.max(pher[0][PH.FOOD][i], pher[1][PH.FOOD][i]);
        const dang = Math.max(pher[0][PH.DANGER][i], pher[1][PH.DANGER][i]);

        const s = worldToScreen(x,y);

        if(home > 0.05){
          ctx.globalAlpha = Math.min(0.55, home*0.85) * alphaScale;
          ctx.fillStyle = cssVar("--phHome");
          ctx.fillRect(s.sx, s.sy, camera.scale+0.5, camera.scale+0.5);
        }
        if(food > 0.05){
          ctx.globalAlpha = Math.min(0.55, food*0.85) * alphaScale;
          ctx.fillStyle = cssVar("--phFood");
          ctx.fillRect(s.sx, s.sy, camera.scale+0.5, camera.scale+0.5);
        }
        if(dang > 0.05){
          ctx.globalAlpha = Math.min(0.65, dang*0.95) * alphaScale;
          ctx.fillStyle = cssVar("--phDanger");
          ctx.fillRect(s.sx, s.sy, camera.scale+0.5, camera.scale+0.5);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawEndOverlay(){
    const o = colonies[TEAM.ORANGE];
    const c = colonies[TEAM.CYAN];
    const lose = o.lose && c.lose;
    const win = o.win || c.win;
    if(!lose && !win) return;

    const code = o.endCode || makeEndCode();

    ctx.globalAlpha = 0.78;
    ctx.fillStyle = "rgba(0,0,0,0.68)";
    ctx.fillRect(0,0,innerWidth,innerHeight);
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 48px ui-monospace, monospace";
    ctx.fillStyle = win ? "rgb(125,255,134)" : "rgb(255,92,122)";
    ctx.fillText(win ? "WIN" : "LOSE", innerWidth*0.5, innerHeight*0.5 - 40);

    ctx.font = "13px ui-monospace, monospace";
    ctx.fillStyle = "rgba(232,236,255,0.92)";
    ctx.fillText("Menu: Copy End Code, Reset", innerWidth*0.5, innerHeight*0.5 + 8);

    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = "rgba(232,236,255,0.75)";
    const short = (code.length > 120) ? (code.slice(0,120) + "...") : reminder(code);
    ctx.fillText(short, innerWidth*0.5, innerHeight*0.5 + 34);

    function reminder(s){ return s; }
  }

  function drawWorld(){
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0,0,innerWidth,innerHeight);

    drawSky();

    const w0 = screenToWorld(0,0);
    const w1 = screenToWorld(innerWidth, innerHeight);
    const x0 = clamp(Math.floor(Math.min(w0.wx,w1.wx)) - 2, 0, W-1);
    const x1 = clamp(Math.floor(Math.max(w0.wx,w1.wx)) + 2, 0, W-1);
    const y0 = clamp(Math.floor(Math.min(w0.wy,w1.wy)) - 2, 0, H-1);
    const y1 = clamp(Math.floor(Math.max(w0.wy,w1.wy)) + 2, 0, H-1);

    for(let y=y0; y<=y1; y++){
      for(let x=x0; x<=x1; x++){
        if(y < surfaceY) continue;

        const t = tileAt(x,y);
        const s = worldToScreen(x,y);

        let fill = "rgb(0,0,0)";
        if(t === TILE.SOIL) fill = ((x+y)&1) ? cssVar("--soil1") : cssVar("--soil2");
        else if(t === TILE.TUNNEL) fill = ((x+y)&1) ? cssVar("--tun1") : cssVar("--tun2");
        else if(t === TILE.ROCKS) fill = cssVar("--rockS");
        else if(t === TILE.ROCKM) fill = cssVar("--rockM");
        else if(t === TILE.ROCKL) fill = cssVar("--rockL");

        ctx.fillStyle = fill;
        ctx.fillRect(s.sx, s.sy, camera.scale+0.5, camera.scale+0.5);

        if(y === SURFACE_WALK_Y){
          ctx.globalAlpha = 0.14;
          ctx.fillStyle = "rgba(120,220,120,1)";
          ctx.fillRect(s.sx, s.sy, camera.scale+0.5, camera.scale+0.5);
          ctx.globalAlpha = 1;
        }
      }
    }

    renderPheromones(x0,y0,x1,y1);

    for(const p of plants){
      const s = worldToScreen(p.x, SURFACE_WALK_Y);
      if(p.kind==="grass"){
        ctx.fillStyle = "rgba(90,210,120,0.9)";
        ctx.fillRect(s.sx+camera.scale*0.35, s.sy+camera.scale*0.15, camera.scale*0.30, camera.scale*0.70);
      } else {
        ctx.fillStyle = "rgba(120,100,70,0.9)";
        ctx.fillRect(s.sx+camera.scale*0.40, s.sy+camera.scale*0.10, camera.scale*0.20, camera.scale*0.80);
      }
    }

    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.font = `${Math.max(10, camera.scale*0.9)}px ui-monospace, monospace`;
    for(const r of resources){
      if(r.dead) continue;
      const s = worldToScreen(r.x, r.y);
      ctx.fillStyle = resColor(r);
      let a = 0.95;
      if(r.kind === "dirt" && r.locked) a = clamp(0.35 + r.mass*0.10, 0.35, 0.90);
      ctx.globalAlpha = a;
      ctx.fillText(resChar(r), s.sx + camera.scale*0.5, s.sy + camera.scale*0.55);
      ctx.globalAlpha = 1;
    }

    for(const m of mobs){
      if(m.dead) continue;
      if(m.type==="beetle"){
        const s = worldToScreen(m.x, m.y);
        ctx.fillStyle = "rgb(210,210,210)";
        ctx.fillText(SPR.beetle, s.sx + camera.scale*0.5, s.sy + camera.scale*0.55);
      } else if(m.type==="worm"){
        ctx.fillStyle = "rgb(210,210,255)";
        for(let i=m.seg.length-1;i>=0;i--){
          const seg = m.seg[i];
          const s = worldToScreen(seg.x, seg.y);
          const ch = (i===0) ? "@" : "#";
          ctx.globalAlpha = (i===0) ? 1 : 0.55;
          ctx.fillText(ch, s.sx + camera.scale*0.5, s.sy + camera.scale*0.55);
        }
        ctx.globalAlpha = 1;
      } else if(m.type==="beetleEgg"){
        if(isNight()){
          const s = worldToScreen(m.x, m.y);
          ctx.globalAlpha = 0.65;
          ctx.fillStyle = "rgba(210,210,230,0.65)";
          ctx.fillText(".", s.sx + camera.scale*0.5, s.sy + camera.scale*0.55);
          ctx.globalAlpha = 1;
        }
      }
    }

    for(const a of ants){
      if(a.hp<=0) continue;
      const s = worldToScreen(a.x, a.y);
      ctx.fillStyle = (a.team===TEAM.ORANGE) ? cssVar("--orange") : cssVar("--cyan");
      let text = antSprite(a);
      if(a.carried){
        const r = resources.find(rr => rr.id===a.carried && !rr.dead);
        if(r) text = resChar(r) + text;
      } else if(a.caste===CASTE.WORKER && a.role===ROLE.SCOUT){
        text = "^" + text;
      }
      ctx.fillText(text, s.sx + camera.scale*0.5, s.sy + camera.scale*0.55);
    }

    drawEndOverlay();
  }

  /* =========================================================
     24) Status bar
  ========================================================= */
  const st_orange = document.getElementById("st_orange");
  const st_cyan = document.getElementById("st_cyan");
  const st_worm = document.getElementById("st_worm");
  const st_beetle = document.getElementById("st_beetle");

  const s_orange = document.getElementById("s_orange");
  const s_cyan = document.getElementById("s_cyan");
  const s_worm = document.getElementById("s_worm");
  const s_beetle = document.getElementById("s_beetle");

  const chkSO = document.getElementById("chkSO");
  const chkSC = document.getElementById("chkSC");
  const chkSW = document.getElementById("chkSW");
  const chkSB = document.getElementById("chkSB");

  function updateStatus(){
    const o = colonies[TEAM.ORANGE];
    const c = colonies[TEAM.CYAN];

    const co = countsBy(TEAM.ORANGE);
    const cc = countsBy(TEAM.CYAN);

    const worms = mobs.filter(m => m.type==="worm" && !m.dead).length;
    const beetles = mobs.filter(m => m.type==="beetle" && !m.dead).length;
    const eggs = mobs.filter(m => m.type==="beetleEgg" && !m.dead).length;

    const nightNow = isNight();
    const light = surfaceLight01AtX(camera.x);
    const rainTxt = rain.active ? ` Rain ${Math.round(rain.intensity*100)}%` : " clear";

    st_orange.innerHTML =
      `Orange <span class="pill">pop ${co.total}</span>` +
      ` <span class="pill">food ${o.foodStore.toFixed(1)}</span>` +
      ` <span class="pill">fung ${o.fungusStore.toFixed(1)}</span>` +
      ` <span class="pill">sub ${o.subE.toFixed(1)}</span>` +
      ` <span class="pill">G ${o.galleriesActive}</span>` +
      ` <span class="pill">D ${co.drones} S ${co.scouts} G ${co.diggers} W ${co.warriors} H ${co.hunters}</span>` +
      ` <span class="pill">${o.win ? '<span class="good">WIN</span>' : o.lose ? '<span class="bad">LOSE</span>' : 'OK'}</span>`;

    st_cyan.innerHTML =
      `Cyan <span class="pill">pop ${cc.total}</span>` +
      ` <span class="pill">food ${c.foodStore.toFixed(1)}</span>` +
      ` <span class="pill">fung ${c.fungusStore.toFixed(1)}</span>` +
      ` <span class="pill">sub ${c.subE.toFixed(1)}</span>` +
      ` <span class="pill">G ${c.galleriesActive}</span>` +
      ` <span class="pill">D ${cc.drones} S ${cc.scouts} G ${cc.diggers} W ${cc.warriors} H ${cc.hunters}</span>` +
      ` <span class="pill">${c.win ? '<span class="good">WIN</span>' : c.lose ? '<span class="bad">LOSE</span>' : 'OK'}</span>`;

    st_worm.innerHTML =
      `Worms <span class="pill">${worms}</span> <span class="pill">${nightNow ? "night" : "day"}</span> <span class="pill">alert ${wormAlertT.toFixed(1)}s</span> <span class="pill">${rainTxt}</span>`;

    st_beetle.innerHTML =
      `Beetles <span class="pill">${beetles}</span> <span class="pill">eggs ${eggs}</span> <span class="pill">light ${light.toFixed(2)}</span> <span class="pill">cfg ${fmtCfg()}</span>`;

    s_orange.style.display = chkSO.checked ? "flex" : "none";
    s_cyan.style.display   = chkSC.checked ? "flex" : "none";
    s_worm.style.display   = chkSW.checked ? "flex" : "none";
    s_beetle.style.display = chkSB.checked ? "flex" : "none";
  }

  /* =========================================================
     25) Reset and lab integration
  ========================================================= */
  function resetAll(){
    ants.length = 0;
    mobs.length = 0;
    resources.length = 0;

    nextAntId = 1;
    nextResId = 1;

    for(const col of colonies){
      col.foodStore = 16;
      col.fungusStore = 0;
      col.subMass = 0;
      col.subE = 0;
      col.queenId = -1;
      col.win = false;
      col.lose = false;
      col.eggT = 0;
      col.deepestY = surfaceY + 18;
      col.galleriesActive = 0;
      col.rebT = 0;
      col.endCode = "";
    }

    for(let i=0;i<digDisturb.length;i++) digDisturb[i]=0;
    for(let i=0;i<rainLeach.length;i++) rainLeach[i]=0;
    wormAlertT = 0;
    prevRainActive = false;

    genWorld();
    initSky();

    spawnBeetleImago();

    camera.x = Math.floor(W*0.5);
    camera.y = Math.floor(surfaceY + 20);

    beetleSpawnCD = 8 + Math.random()*10;
    wormSpawnCD = 12 + Math.random()*12;

    labParams.textContent = `Tuning: ${fmtCfg()}`;
  }

  document.getElementById("btnReset").addEventListener("click", () => {
    if(chkLab.checked){
      runBalanceLab();
    }
    resetAll();
  });

  /* =========================================================
     26) Main loop
  ========================================================= */
  let lastT = performance.now();

  function step(dt){
    simTime += dt;

    tickRain(dt);
    tickWormTriggers(dt);
    tickSky(dt);
    tickPlants(dt);
    tickFields(dt);

    spawners(dt);
    decayPher(dt);

    antOcc.fill(0);
    for(const a of ants){
      if(a.hp>0 && inb(a.x,a.y)) antOcc[idx(a.x,a.y)] = 1;
    }

    const nightNow = isNight();
    manageBeetleSurfacing(nightNow);
    manageWormAscend(nightNow);

    for(const m of mobs){
      if(m.dead) continue;
      if(m.type==="beetle") stepBeetle(m, dt, nightNow);
      else if(m.type==="worm") stepWorm(m, dt, nightNow);
      else if(m.type==="beetleEgg") stepBeetleEgg(m, dt, nightNow);
    }
    for(let i=mobs.length-1;i>=0;i--) if(mobs[i].dead) mobs.splice(i,1);

    for(const col of colonies){
      updateDeepest(col);
      tickFungus(col, dt);
    }

    for(const a of ants) stepAnt(a, dt);
    for(let i=ants.length-1;i>=0;i--) if(ants[i].hp<=0) ants.splice(i,1);

    for(let i=resources.length-1;i>=0;i--) if(resources[i].dead) resources.splice(i,1);

    tickMusic(dt);
    checkWinLose();
  }

  function loop(){
    const now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;
    dt = clamp(dt, 0, 0.05);

    step(dt);
    drawWorld();
    updateStatus();

    requestAnimationFrame(loop);
  }

  /* =========================================================
     27) Start
  ========================================================= */
  const menuCloseBtn = document.getElementById("menuClose");
  menuCloseBtn.addEventListener("click", () => menu.style.display = "none");

  resetAll();
  loop();

})();
