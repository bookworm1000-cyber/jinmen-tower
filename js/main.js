(() => {
  const { Engine, Composite, Bodies, Body, Events } = Matter;
  const $ = s => document.querySelector(s);
  const TAU = Math.PI * 2;
  const INK = '#3a2a1e';

  // 顔画像は縦長の楕円 (幅:高さ = 0.8:1)
  const FW = 240, FH = 300, GW = 0.56, GH = 0.70;
  const VIEW_W = 440, VIEW_H = 760, TABLE_W = 300, FLOOR_Y = 150, XLIM = 200;
  const STEP = 1000 / 60;

  // ---------- 画面 ----------
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }

  // ---------- 音 ----------
  // 効果音ラボ (https://soundeffect-lab.info/) の音。スマホは最初のタップまで鳴らせないので、そこで AudioContext を作る。
  const SOUNDS = ['button', 'rotate', 'release', 'land', 'fall', 'win', 'lose', 'shutter'];
  const VOL = { land: 0.8, fall: 0.9, win: 0.8, lose: 0.8 };
  let actx = null, muted = false;
  const buffers = {};
  try { muted = localStorage.getItem('jinmen-mute') === '1'; } catch (e) {}
  function unlockAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    for (const n of SOUNDS) {
      fetch(`sound/${n}.mp3`).then(r => r.arrayBuffer())
        .then(b => new Promise((ok, ng) => actx.decodeAudioData(b, ok, ng)))
        .then(buf => { buffers[n] = buf; }).catch(() => {});
    }
  }
  function sfx(n) {
    if (muted || !actx || !buffers[n]) return;
    const src = actx.createBufferSource(), gain = actx.createGain();
    src.buffer = buffers[n];
    gain.gain.value = VOL[n] || 0.6;
    src.connect(gain).connect(actx.destination);
    src.start();
  }
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);
  document.addEventListener('click', e => {
    const b = e.target.closest('.btn');
    if (b && b.id !== 'btnShoot') sfx('button');
  });
  const muteBtn = $('#btnMute');
  const showMute = () => { muteBtn.textContent = muted ? '音 OFF' : '音 ON'; };
  showMute();
  muteBtn.onclick = () => {
    muted = !muted;
    try { localStorage.setItem('jinmen-mute', muted ? '1' : '0'); } catch (e) {}
    showMute();
    sfx('button');
  };

  // ---------- 顔の取り込み ----------
  const video = $('#video'), shotCv = $('#shot');
  let stream = null, currentShot = null;
  let mode = 'cpu', players = [], capIndex = 0;

  function makeFace(src, sx, sy, sw, sh, mirror) {
    const c = document.createElement('canvas');
    c.width = FW; c.height = FH;
    const g = c.getContext('2d');
    g.beginPath();
    g.ellipse(FW / 2, FH / 2, FW / 2, FH / 2, 0, 0, TAU);
    g.clip();
    if (mirror) { g.translate(FW, 0); g.scale(-1, 1); }
    g.drawImage(src, sx, sy, sw, sh, 0, 0, FW, FH);
    return c;
  }

  function drawnFace(kind) {
    const c = document.createElement('canvas');
    c.width = FW; c.height = FH;
    const g = c.getContext('2d');
    const skin = ['#f6c9a0', '#e9b18a', '#c9d3dc'][kind];
    g.beginPath(); g.ellipse(FW / 2, FH / 2, FW / 2, FH / 2, 0, 0, TAU); g.clip();
    g.fillStyle = skin; g.fillRect(0, 0, FW, FH);
    g.fillStyle = kind === 2 ? '#7a8794' : '#2a1d16';
    g.beginPath(); g.ellipse(FW / 2, 20, FW * 0.62, 90, 0, 0, TAU); g.fill();
    g.strokeStyle = '#2a1d16'; g.lineWidth = 7; g.lineCap = 'round';
    if (kind === 2) {
      // CPU はロボっぽい顔
      g.fillStyle = '#2a1d16';
      g.fillRect(62, 128, 40, 24); g.fillRect(138, 128, 40, 24);
      g.fillStyle = '#ff5a4a';
      g.fillRect(70, 134, 12, 12); g.fillRect(146, 134, 12, 12);
      g.beginPath(); g.moveTo(80, 225);
      for (let i = 1; i <= 8; i++) g.lineTo(80 + i * 10, i % 2 ? 235 : 225);
      g.stroke();
    } else {
      g.beginPath(); g.moveTo(60, 112); g.lineTo(100, 106); g.moveTo(140, 106); g.lineTo(180, 112); g.stroke();
      g.fillStyle = '#2a1d16';
      g.beginPath(); g.ellipse(82, 142, 11, 15, 0, 0, TAU); g.ellipse(158, 142, 11, 15, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(240,110,110,.45)';
      g.beginPath(); g.arc(62, 190, 18, 0, TAU); g.arc(178, 190, 18, 0, TAU); g.fill();
      g.beginPath();
      if (kind === 0) g.arc(120, 205, 34, 0.15 * Math.PI, 0.85 * Math.PI);
      else { g.moveTo(90, 230); g.lineTo(120, 210); g.lineTo(150, 230); }
      g.stroke();
    }
    return c;
  }

  async function startCamera() {
    $('#camMsg').textContent = '';
    if (stream) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false,
      });
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      stream = null;
      $('#camMsg').textContent = 'カメラが使えません。「写真を選ぶ」か「顔なしで遊ぶ」を使ってください。';
    }
  }
  function stopCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
  }

  function capName(i) {
    if (mode === '2p') return `プレイヤー${i + 1}`;
    return 'あなた';
  }
  function openCapture() {
    show('capture');
    $('#capTitle').textContent = mode === '2p' ? `プレイヤー${capIndex + 1}の顔をとろう` : 'あなたの顔をとろう';
    setShot(null);
    startCamera();
  }
  function setShot(c) {
    currentShot = c;
    shotCv.classList.toggle('hidden', !c);
    video.classList.toggle('hidden', !!c);
    $('#capButtons').classList.toggle('hidden', !!c);
    $('#altButtons').classList.toggle('hidden', !!c);
    $('#okButtons').classList.toggle('hidden', !c);
    if (c) {
      const g = shotCv.getContext('2d');
      g.clearRect(0, 0, FW, FH);
      g.drawImage(c, 0, 0);
    }
  }

  $('#btnShoot').onclick = () => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) { $('#camMsg').textContent = 'カメラの準備ができていません。'; return; }
    const m = Math.min(vw, vh), sw = m * GW, sh = m * GH;
    sfx('shutter');
    setShot(makeFace(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, true));
  };
  $('#btnRetake').onclick = () => setShot(null);
  $('#btnSkip').onclick = () => setShot(drawnFace(capIndex % 2));
  $('#file').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      let sw, sh, sx, sy;
      if (w / h > FW / FH) { sh = h; sw = h * FW / FH; sx = (w - sw) / 2; sy = 0; }
      else { sw = w; sh = w * FH / FW; sx = 0; sy = (h - sh) * 0.3; }
      setShot(makeFace(img, sx, sy, sw, sh, false));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
    e.target.value = '';
  };
  $('#btnOk').onclick = () => {
    players.push({ name: capName(capIndex), face: currentShot, thumb: currentShot.toDataURL() });
    capIndex++;
    const need = mode === '2p' ? 2 : 1;
    if (capIndex < need) { openCapture(); return; }
    stopCamera();
    if (mode === 'cpu') {
      const f = drawnFace(2);
      players.push({ name: 'CPU', face: f, thumb: f.toDataURL(), cpu: true });
    }
    startGame();
  };

  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    players = [];
    capIndex = 0;
    openCapture();
  });

  // ---------- どうぶつの準備 ----------
  // 写真の座標(ピクセル)をゲーム内単位に直し、左右反転した版も用意する
  function makeBody(def) {
    const parts = def.rects.map(([x, y, w, h]) => Bodies.rectangle(x, y, w, h));
    parts.push(Bodies.circle(def.face.x, def.face.y, def.face.r));
    return Body.create({ parts, friction: 0.8, frictionStatic: 1, restitution: 0, frictionAir: 0.01 });
  }

  const DEFS = ANIMALS.flatMap(a => [1, -1].map(fl => {
    const s = a.s;
    const img = new Image();
    img.src = a.src;
    const def = {
      name: a.name, img, flip: fl < 0,
      w: a.w * s, h: a.h * s,
      rects: a.parts.map(([x, y, w, h]) => [x * s * fl, y * s, w * s, h * s]),
      face: { x: a.face[0] * s * fl, y: a.face[1] * s, r: a.face[2] * s },
    };
    const b = makeBody(def);
    def.com = { x: b.position.x, y: b.position.y };
    let R = 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      R = Math.max(R, Math.hypot(sx * def.w / 2 - def.com.x, sy * def.h / 2 - def.com.y));
    }
    const f = def.face;
    def.R = Math.max(R, Math.hypot(f.x - def.com.x, f.y - def.com.y) + f.r * 1.3);
    return def;
  }));

  // ---------- ゲーム状態 ----------
  const cv = $('#cv'), ctx = cv.getContext('2d');
  let dpr = 1, W = 0, H = 0, scale = 1;
  let engine = null, bodies = [], state = 'idle', cur = null;
  let curPlayer = 0, lastDropper = 0, placed = 0, lastDef = -1;
  let hold = { x: 0, y: -200, a: 0 };
  let camTop = 0, settleFrames = 0, dropSteps = 0, drag = null, cpu = null;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.round(innerWidth * dpr);
    H = Math.round(innerHeight * dpr);
    cv.width = W; cv.height = H;
    scale = Math.min(W / VIEW_W, H / VIEW_H);
  }
  window.addEventListener('resize', resize);
  const camBase = () => -(H * 0.7) / scale;

  function addStage(eng) {
    Composite.add(eng.world, [
      Bodies.rectangle(0, 15, TABLE_W, 30, { isStatic: true, friction: 1, frictionStatic: 1 }),
      Bodies.rectangle(0, FLOOR_Y + 50, 4000, 100, { isStatic: true }),
    ]);
  }

  function startGame() {
    show('game');
    resize();
    engine = Engine.create();
    engine.positionIterations = 10;
    engine.velocityIterations = 8;
    addStage(engine);
    Events.on(engine, 'collisionStart', onHit);
    bodies = [];
    placed = 0;
    curPlayer = 0;
    lastDropper = 0;
    lastDef = -1;
    camTop = camBase();
    $('#result').classList.add('hidden');
    $('#hint').classList.remove('hidden');
    nextTurn();
  }

  function towerTop() {
    let top = 0;
    for (const b of bodies) top = Math.min(top, b.bounds.min.y);
    return top;
  }

  function nextTurn() {
    let i;
    do { i = Math.floor(Math.random() * DEFS.length); } while (lastDef >= 0 && DEFS[i].name === DEFS[lastDef].name);
    lastDef = i;
    cur = DEFS[i];
    hold = { x: 0, y: towerTop() - cur.R - 30, a: 0 };
    cpu = null;
    state = 'hold';
    updateHud();
  }

  function updateHud() {
    const p = players[curPlayer];
    $('#count').textContent = placed;
    $('#turnFace').src = p.thumb;
    $('#turnName').textContent = mode === 'solo' ? 'あなたの番' : `${p.name}の番`;
    $('#animalName').textContent = cur.name;
    $('#btnRotate').disabled = !!p.cpu;
  }

  function drop() {
    if (state !== 'hold') return;
    const b = makeBody(cur);
    Body.setPosition(b, { x: hold.x, y: hold.y });
    Body.setAngle(b, hold.a);
    b.plugin.def = cur;
    b.plugin.face = players[curPlayer].face;
    Composite.add(engine.world, b);
    bodies.push(b);
    lastDropper = curPlayer;
    state = 'drop';
    sfx('release');
    settleFrames = 0;
    dropSteps = 0;
    if (!players[curPlayer].cpu) $('#hint').classList.add('hidden');
  }

  let lastHit = 0;
  function onHit(ev) {
    if (state !== 'drop') return;
    const now = performance.now();
    if (now - lastHit < 300) return;
    for (const pr of ev.pairs) {
      const a = pr.bodyA.parent, b = pr.bodyB.parent;
      const fast = Math.max(a.speed, b.speed);
      if (fast > 1.5) { sfx('land'); lastHit = now; return; }
    }
  }

  function fallen(list) {
    for (const b of list) if (b.bounds.max.y > FLOOR_Y - 2 || Math.abs(b.position.x) > 900) return true;
    return false;
  }

  function physicsCheck() {
    if (state !== 'hold' && state !== 'drop') return;
    if (fallen(bodies)) { lose(); return; }
    if (state === 'drop') {
      let moving = false;
      for (const b of bodies) if (b.speed > 0.25 || b.angularSpeed > 0.008) { moving = true; break; }
      settleFrames = moving ? 0 : settleFrames + 1;
      dropSteps++;
      if ((settleFrames > 20 && dropSteps > 30) || dropSteps > 270) {
        placed++;
        if (mode !== 'solo') curPlayer = 1 - curPlayer;
        nextTurn();
      }
    }
  }

  function lose() {
    state = 'over';
    drag = null;
    sfx('fall');
    setTimeout(showResult, 1300);
  }

  let best = 0;
  try { best = +localStorage.getItem('jinmen-best') || 0; } catch (e) {}

  function showResult() {
    const loser = players[lastDropper];
    if (mode === 'solo') {
      if (placed > best) { best = placed; try { localStorage.setItem('jinmen-best', best); } catch (e) {} }
      $('#resFace').src = loser.thumb;
      $('#resTitle').textContent = 'くずれた!';
      sfx('lose');
      $('#resText').textContent = `${placed}匹 積めました(最高 ${best}匹)`;
    } else {
      const winner = players[1 - lastDropper];
      $('#resFace').src = winner.thumb;
      $('#resTitle').textContent = winner.cpu ? 'CPUの勝ち' : `${winner.name}の勝ち!`;
      sfx(winner.cpu ? 'lose' : 'win');
      $('#resText').textContent = `${loser.name}が落としました(${placed}匹 積んだところ)`;
    }
    $('#result').classList.remove('hidden');
  }

  $('#btnAgain').onclick = startGame;
  $('#btnTop').onclick = () => { engine = null; state = 'idle'; show('title'); };
  $('#btnSave').onclick = () => {
    cv.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'jinmen-tower.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };

  // ---------- CPU ----------
  // 候補ごとに今の塔を別の物理世界に複製して落としてみて、いちばん崩れにくい手を選ぶ。
  function planCpu() {
    const snap = bodies.map(b => ({ def: b.plugin.def, x: b.position.x, y: b.position.y, a: b.angle }));
    const cands = [];
    for (let k = 0; k < 8; k++) {
      for (let x = -120; x <= 120; x += 30) cands.push({ x: x + (Math.random() - 0.5) * 16, k });
    }
    cands.sort(() => Math.random() - 0.5);
    cpu = { snap, cands: cands.slice(0, 24), i: 0, best: null, bestScore: -Infinity, start: performance.now(), phase: 'think' };
  }

  function evalCand(c, snap) {
    const eng = Engine.create();
    eng.positionIterations = 4;
    eng.velocityIterations = 3;
    addStage(eng);
    const sim = snap.map(s => {
      const b = makeBody(s.def);
      Body.setPosition(b, { x: s.x, y: s.y });
      Body.setAngle(b, s.a);
      Composite.add(eng.world, b);
      return b;
    });
    const nb = makeBody(cur);
    Body.setPosition(nb, { x: c.x, y: hold.y });
    Body.setAngle(nb, c.k * Math.PI / 4);
    Composite.add(eng.world, nb);
    const all = sim.concat(nb);
    for (let s = 0; s < 90; s++) {
      Engine.update(eng, STEP);
      if (s % 10 === 9 && fallen(all)) return -1e6 + Math.random();
    }
    let disp = 0;
    sim.forEach((b, i) => {
      const s = snap[i];
      disp = Math.max(disp, Math.hypot(b.position.x - s.x, b.position.y - s.y) + Math.abs(b.angle - s.a) * 30);
    });
    return -disp * 4 - nb.speed * 30 - nb.angularSpeed * 300 + nb.bounds.min.y * 0.3 - Math.abs(c.x) * 0.05
      + Math.random() * 6;
  }

  function cpuUpdate(now) {
    if (!cpu) planCpu();
    if (cpu.phase === 'think') {
      const t0 = performance.now();
      while (cpu.i < cpu.cands.length && performance.now() - t0 < 14) {
        const c = cpu.cands[cpu.i++];
        const s = evalCand(c, cpu.snap);
        if (s > cpu.bestScore) { cpu.bestScore = s; cpu.best = c; }
      }
      if (cpu.i >= cpu.cands.length && now - cpu.start > 700) {
        cpu.phase = 'move';
        cpu.turns = 0;
        cpu.lastRot = now;
      }
      return;
    }
    if (cpu.phase === 'move') {
      const tgt = cpu.best;
      if (cpu.turns < tgt.k) {
        if (now - cpu.lastRot > 220) { hold.a += Math.PI / 4; sfx('rotate'); cpu.turns++; cpu.lastRot = now; }
        return;
      }
      const dx = tgt.x - hold.x;
      hold.x += Math.sign(dx) * Math.min(Math.abs(dx), 4);
      if (Math.abs(dx) < 0.5) { cpu.phase = 'wait'; cpu.waitStart = now; }
      return;
    }
    if (cpu.phase === 'wait' && now - cpu.waitStart > 300) drop();
  }

  // ---------- 入力 ----------
  const humanTurn = () => state === 'hold' && !players[curPlayer].cpu;
  const clampX = x => Math.max(-XLIM, Math.min(XLIM, x));
  cv.addEventListener('pointerdown', e => {
    if (!humanTurn()) return;
    drag = { id: e.pointerId, x: e.clientX, hx: hold.x };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id || !humanTurn()) return;
    hold.x = clampX(drag.hx + (e.clientX - drag.x) * dpr / scale);
  });
  cv.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    if (humanTurn()) drop();
  });
  cv.addEventListener('pointercancel', () => { drag = null; });
  const rotate = () => { hold.a += Math.PI / 4; sfx('rotate'); };
  $('#btnRotate').onclick = () => { if (humanTurn()) rotate(); };
  window.addEventListener('keydown', e => {
    if (!humanTurn()) return;
    if (e.key === 'ArrowLeft') hold.x = clampX(hold.x - 6);
    else if (e.key === 'ArrowRight') hold.x = clampX(hold.x + 6);
    else if (e.key === 'ArrowUp' || e.key === 'r') rotate();
    else if (e.key === 'ArrowDown' || e.key === ' ') drop();
    else return;
    e.preventDefault();
  });

  // ---------- 描画 ----------
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // 顔は頭より少し大きく、縦長の楕円で貼る。切り抜いたシールのように白フチと影をつける。
  function drawFace(g, p, face) {
    const w = p.r * 2.1, h = w * FH / FW, cy = p.y - p.r * 0.1;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.35)';
    g.shadowBlur = 5;
    g.shadowOffsetY = 2;
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(p.x, cy, w / 2 + 2, h / 2 + 2, 0, 0, TAU); g.fill();
    g.restore();
    g.drawImage(face, p.x - w / 2, cy - h / 2, w, h);
  }

  function drawPiece(g, def, x, y, a, face) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.translate(-def.com.x, -def.com.y);
    if (def.img.complete && def.img.naturalWidth) {
      g.save();
      if (def.flip) g.scale(-1, 1);
      g.drawImage(def.img, -def.w / 2, -def.h / 2, def.w, def.h);
      g.restore();
    }
    drawFace(g, def.face, face);
    g.restore();
  }

  function drawBg(g) {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#6fd0f6');
    grd.addColorStop(1, '#c8efff');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }

  function drawRoom(g) {
    g.fillStyle = '#d9b382';
    g.fillRect(-2000, FLOOR_Y, 4000, 3000);
    g.fillStyle = '#a77a4a';
    g.fillRect(-2000, FLOOR_Y, 4000, 5);
    g.strokeStyle = '#c49a68';
    g.lineWidth = 2;
    for (let y = FLOOR_Y + 30; y < FLOOR_Y + 600; y += 30) {
      g.beginPath(); g.moveTo(-2000, y); g.lineTo(2000, y); g.stroke();
    }
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.fillStyle = '#8a5228';
    for (const x of [-118, 100]) { g.fillRect(x, 30, 18, FLOOR_Y - 30); g.strokeRect(x, 30, 18, FLOOR_Y - 30); }
    g.fillStyle = '#9a5f2e';
    g.fillRect(-132, 30, 264, 10); g.strokeRect(-132, 30, 264, 10);
    g.fillStyle = '#b8763b';
    rr(g, -TABLE_W / 2, 0, TABLE_W, 30, 8); g.fill(); g.stroke();
    g.strokeStyle = '#d39555';
    g.beginPath(); g.moveTo(-TABLE_W / 2 + 10, 7); g.lineTo(TABLE_W / 2 - 10, 7); g.stroke();
  }

  function render(now) {
    const g = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    drawBg(g);
    g.setTransform(scale, 0, 0, scale, W / 2, -camTop * scale);
    drawRoom(g);
    for (const b of bodies) drawPiece(g, b.plugin.def, b.position.x, b.position.y, b.angle, b.plugin.face);
    if (state === 'hold') {
      g.save();
      g.strokeStyle = 'rgba(58,42,30,.3)';
      g.lineWidth = 2;
      g.setLineDash([8, 8]);
      g.beginPath(); g.moveTo(hold.x, hold.y); g.lineTo(hold.x, towerTop()); g.stroke();
      g.restore();
      drawPiece(g, cur, hold.x, hold.y, hold.a, players[curPlayer].face);
      if (players[curPlayer].cpu && cpu && cpu.phase === 'think') {
        g.fillStyle = INK;
        g.font = '800 22px "M PLUS Rounded 1c", sans-serif';
        g.textAlign = 'center';
        g.fillText('考え中' + '.'.repeat(1 + Math.floor(now / 300) % 3), hold.x, hold.y - cur.R - 12);
      }
    }
  }

  // ---------- ループ ----------
  let last = performance.now(), acc = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!engine) return;
    acc += Math.min(100, now - last);
    last = now;
    while (acc >= STEP) {
      Engine.update(engine, STEP);
      physicsCheck();
      acc -= STEP;
    }
    if (state === 'hold' && players[curPlayer].cpu) cpuUpdate(now);
    if (state === 'hold' || state === 'drop') {
      const target = Math.min(camBase(), hold.y - cur.R - 90 * dpr / scale);
      camTop += (target - camTop) * 0.06;
    }
    render(now);
  }
  requestAnimationFrame(t => { last = t; loop(t); });
})();
