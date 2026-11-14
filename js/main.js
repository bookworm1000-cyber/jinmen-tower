(() => {
  const { Engine, Composite, Bodies, Body, Events, Sleeping } = Matter;
  const $ = s => document.querySelector(s);
  const TAU = Math.PI * 2;
  const INK = '#3a2a1e';

  // 顔画像は縦長の楕円 (幅:高さ = 0.8:1)
  const FW = 240, FH = 300, GW = 0.56, GH = 0.70;
  const VIEW_W = 440, VIEW_H_MIN = 420, TABLE_W = 300, FLOOR_Y = 150, XLIM = 200;
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

  // 顔の輪郭は MediaPipe Face Landmarker で取る。読み込めなかったときや顔が見つからないときは楕円で切る。
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
    152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  let landmarkerP = null;
  function loadLandmarker() {
    if (!landmarkerP) {
      landmarkerP = import(`${MP}/vision_bundle.mjs`).then(async ({ FilesetResolver, FaceLandmarker }) => {
        const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
        return FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: 'models/face_landmarker.task', delegate: 'CPU' },
          runningMode: 'IMAGE', numFaces: 1,
        });
      }).catch(e => { console.warn(e); landmarkerP = null; return null; });
    }
    return landmarkerP;
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

  // 輪郭の多角形 pts(元画像のピクセル座標)の内側を、ふちをぼかして切り抜く
  function cutPolygon(src, pts, angle) {
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const lv = pts.map(p => ({ x: (p.x - cx) * cos - (p.y - cy) * sin, y: (p.x - cx) * sin + (p.y - cy) * cos }));
    const xs = lv.map(p => p.x), ys = lv.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const k = FW / (maxX - minX), pad = 6;
    const W = FW + pad * 2, H = Math.round((maxY - minY) * k) + pad * 2;
    const ox = pad - minX * k, oy = pad - minY * k;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.save();
    g.translate(ox, oy);
    g.scale(k, k);
    g.rotate(-angle);
    g.translate(-cx, -cy);
    g.drawImage(src, 0, 0);
    g.restore();
    // shadowBlur でぼかしたマスク (ctx.filter は Safari で使えないため)
    const m = document.createElement('canvas');
    m.width = W; m.height = H;
    const mg = m.getContext('2d');
    mg.shadowColor = '#000';
    mg.shadowBlur = 5;
    mg.shadowOffsetX = W * 2;
    mg.beginPath();
    lv.forEach((p, i) => {
      const x = ox + p.x * k * 0.985 - W * 2, y = oy + p.y * k * 0.985;
      i ? mg.lineTo(x, y) : mg.moveTo(x, y);
    });
    mg.closePath();
    mg.fill();
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(m, 0, 0);
    return c;
  }

  async function makeFace(src, mirror, guess) {
    const w = src.videoWidth || src.naturalWidth, h = src.videoHeight || src.naturalHeight;
    const frame = document.createElement('canvas');
    frame.width = w; frame.height = h;
    const fg = frame.getContext('2d');
    if (mirror) { fg.translate(w, 0); fg.scale(-1, 1); }
    fg.drawImage(src, 0, 0, w, h);
    const lm = await withTimeout(loadLandmarker(), 15000);
    let res = null;
    if (lm) { try { res = lm.detect(frame); } catch (e) { console.warn(e); } }
    const L = res && res.faceLandmarks && res.faceLandmarks[0];
    if (L) {
      const P = i => ({ x: L[i].x * w, y: L[i].y * h });
      const e1 = P(33), e2 = P(263);
      const angle = Math.atan2(e2.y - e1.y, e2.x - e1.x);
      const eyeY = (e1.y + e2.y) / 2;
      const c = P(1);
      // 輪郭の上端は額の途中までなので、目より上は少し上に伸ばす
      const pts = FACE_OVAL.map(i => {
        const p = P(i);
        const up = p.y < eyeY ? 1.12 : 1.02;
        return { x: c.x + (p.x - c.x) * 1.02, y: c.y + (p.y - c.y) * up };
      });
      return cutPolygon(frame, pts, angle);
    }
    const [sx, sy, sw, sh] = guess(w, h);
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const t = i / 48 * TAU;
      pts.push({ x: sx + sw / 2 + Math.cos(t) * sw * 0.42, y: sy + sh / 2 + Math.sin(t) * sh * 0.45 });
    }
    return cutPolygon(frame, pts, 0);
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
    loadLandmarker();
  }
  function setShot(c) {
    currentShot = c;
    if (c) { shotCv.width = c.width; shotCv.height = c.height; }
    shotCv.classList.toggle('hidden', !c);
    video.classList.toggle('hidden', !!c);
    $('.guide').classList.toggle('hidden', !!c);
    $('#capButtons').classList.toggle('hidden', !!c);
    $('#altButtons').classList.toggle('hidden', !!c);
    $('#okButtons').classList.toggle('hidden', !c);
    if (c) {
      const g = shotCv.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(c, 0, 0);
    }
  }

  let busy = false;
  async function capture(src, mirror, guess) {
    if (busy) return;
    busy = true;
    $('#camMsg').textContent = '顔を切り抜いています…';
    try {
      setShot(await makeFace(src, mirror, guess));
      $('#camMsg').textContent = '';
    } finally { busy = false; }
  }
  $('#btnShoot').onclick = () => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) { $('#camMsg').textContent = 'カメラの準備ができていません。'; return; }
    sfx('shutter');
    video.pause();
    capture(video, true, (w, h) => { const m = Math.min(w, h), sw = m * GW, sh = m * GH; return [(w - sw) / 2, (h - sh) / 2, sw, sh]; })
      .finally(() => video.play().catch(() => {}));
  };
  $('#btnRetake').onclick = () => setShot(null);
  $('#btnSkip').onclick = () => setShot(drawnFace(capIndex % 2));
  $('#file').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      capture(img, false, (w, h) => {
        if (w / h > FW / FH) { const sw = h * FW / FH; return [(w - sw) / 2, 0, sw, h]; }
        const sh = w * FH / FW; return [0, (h - sh) * 0.3, w, sh];
      }).finally(() => URL.revokeObjectURL(img.src));
    };
    img.src = URL.createObjectURL(f);
    e.target.value = '';
  };
  // CPU の顔はモナ・リザ (パブリックドメイン)。輪郭が取れないときは顔の位置を決め打ちで楕円に切る
  const cpuImg = new Image();
  cpuImg.src = 'img/cpu-face.jpg';
  let cpuFace = null;
  async function getCpuFace() {
    if (cpuFace) return cpuFace;
    try {
      if (!cpuImg.complete) await new Promise((ok, ng) => { cpuImg.onload = ok; cpuImg.onerror = ng; });
      if (!cpuImg.naturalWidth) throw new Error('no image');
      cpuFace = await makeFace(cpuImg, false, () => [55, 95, 230, 330]);
    } catch (e) {
      cpuFace = drawnFace(2);
    }
    return cpuFace;
  }

  $('#btnOk').onclick = async () => {
    if (busy) return;
    players.push({ name: capName(capIndex), face: currentShot, thumb: currentShot.toDataURL() });
    capIndex++;
    const need = mode === '2p' ? 2 : 1;
    if (capIndex < need) { openCapture(); return; }
    stopCamera();
    if (mode === 'cpu') {
      busy = true;
      $('#camMsg').textContent = 'CPUの準備中…';
      const f = await getCpuFace();
      busy = false;
      $('#camMsg').textContent = '';
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
  // 顔は drawFace で描く大きさに合わせた縦長の楕円 (16角形を縦に伸ばす)
  const FACE_W = 4.2, FACE_UP = 0.4, FACE_ASPECT = 1.25;
  function faceShape(f) {
    const a = f.r * FACE_W / 2 * 0.92;
    return { x: f.x, y: f.y - f.r * FACE_UP, a, b: a * FACE_ASPECT };
  }
  function makeBody(def) {
    const parts = def.rects.map(([x, y, w, h]) => Bodies.rectangle(x, y, w, h));
    const e = faceShape(def.face);
    const head = Bodies.polygon(e.x, e.y, 16, e.a);
    Body.scale(head, 1, FACE_ASPECT);
    parts.push(head);
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
    const e = faceShape(def.face);
    def.R = Math.max(R, Math.hypot(e.x - def.com.x, e.y - def.com.y) + e.b);
    return def;
  }));

  // ---------- ゲーム状態 ----------
  const cv = $('#cv'), ctx = cv.getContext('2d');
  let dpr = 1, W = 0, H = 0, scale = 1, baseScale = 1;
  let engine = null, bodies = [], state = 'idle', cur = null;
  let curPlayer = 0, lastDropper = 0, placed = 0, lastDef = -1;
  let hold = { x: 0, y: -200, a: 0, ta: 0 };
  let camTop = 0, settleFrames = 0, dropSteps = 0, drag = null, cpu = null;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.round(innerWidth * dpr);
    H = Math.round(innerHeight * dpr);
    cv.width = W; cv.height = H;
    // 横長の画面(PC)では縦の見える範囲を狭めて大きく映す。スマホは横幅で決まる
    baseScale = Math.min(W / VIEW_W, H / VIEW_H_MIN);
    scale = baseScale;
  }
  window.addEventListener('resize', resize);
  // 机の天板を画面の7割の高さに置く。ただし下のボタンに隠れない高さ (脚が少し見える位置) より下げない
  const BTN_H = 130, LEG_SHOW = 40;
  const camBase = () => -Math.min(H * 0.7, H - BTN_H * dpr - LEG_SHOW * scale) / scale;

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
    hold = { x: 0, y: towerTop() - cur.R - 30, a: 0, ta: 0 };
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
    for (const id of ['#btnRotate', '#btnLeft', '#btnRight']) $(id).disabled = !!p.cpu;
  }

  function drop() {
    if (state !== 'hold') return;
    const b = makeBody(cur);
    Body.setPosition(b, { x: hold.x, y: hold.y });
    Body.setAngle(b, hold.ta);
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
      for (let x = -140; x <= 140; x += 20) cands.push({ x: x + (Math.random() - 0.5) * 6, k });
    }
    cpu = { snap, cands, i: 0, scored: [], stage: 1, best: null, bestScore: -Infinity, start: performance.now(), phase: 'think' };
  }

  // fine=false: 止まっている体を眠らせ、精度も落として速く試す。fine=true: 本番と同じ精度で試す
  function evalCand(c, snap, steps, fine) {
    const eng = Engine.create({ enableSleeping: !fine });
    eng.positionIterations = fine ? 10 : 4;
    eng.velocityIterations = fine ? 8 : 3;
    addStage(eng);
    const sim = snap.map(s => {
      const b = makeBody(s.def);
      Body.setPosition(b, { x: s.x, y: s.y });
      Body.setAngle(b, s.a);
      Composite.add(eng.world, b);
      if (!fine) Sleeping.set(b, true);
      return b;
    });
    const nb = makeBody(cur);
    Body.setPosition(nb, { x: c.x, y: hold.y });
    Body.setAngle(nb, c.k * Math.PI / 4);
    Composite.add(eng.world, nb);
    const all = sim.concat(nb);
    for (let s = 0; s < steps; s++) {
      Engine.update(eng, STEP);
      if (s % 10 === 9 && fallen(all)) return -1e6 + Math.random();
    }
    let disp = 0;
    sim.forEach((b, i) => {
      const s = snap[i];
      disp = Math.max(disp, Math.hypot(b.position.x - s.x, b.position.y - s.y) + Math.abs(b.angle - s.a) * 30);
    });
    return -disp * 4 - nb.speed * 30 - nb.angularSpeed * 300 + nb.bounds.min.y * 0.5 - Math.abs(nb.position.x) * 0.15;
  }

  function cpuUpdate(now) {
    if (!cpu) planCpu();
    if (cpu.phase === 'think') {
      const t0 = performance.now();
      // 1段目: 全候補をざっと試す。2段目: 上位の手を長めに、少しずらした位置でも試し、いちばん悪い結果で比べる
      while (cpu.i < cpu.cands.length && performance.now() - t0 < 20) {
        const c = cpu.cands[cpu.i++];
        if (cpu.stage === 1) {
          cpu.scored.push({ c, s: evalCand(c, cpu.snap, 80) });
        } else {
          const s = Math.min(evalCand(c, cpu.snap, 150, true), evalCand({ x: c.x - 5, k: c.k }, cpu.snap, 150, true),
            evalCand({ x: c.x + 5, k: c.k }, cpu.snap, 150, true));
          if (s > cpu.bestScore) { cpu.bestScore = s; cpu.best = c; }
        }
      }
      if (cpu.stage === 1 && cpu.i >= cpu.cands.length) {
        cpu.scored.sort((a, b) => b.s - a.s);
        cpu.best = cpu.scored[0].c;
        cpu.cands = cpu.scored.slice(0, 5).map(o => o.c);
        cpu.i = 0;
        cpu.stage = 2;
      }
      if (cpu.stage === 2 && cpu.i >= cpu.cands.length && now - cpu.start > 700) {
        cpu.phase = 'move';
        cpu.turns = 0;
        cpu.lastRot = now;
      }
      return;
    }
    if (cpu.phase === 'move') {
      const tgt = cpu.best;
      if (cpu.turns < tgt.k) {
        if (now - cpu.lastRot > 220) { rotate(); cpu.turns++; cpu.lastRot = now; }
        return;
      }
      const dx = tgt.x - hold.x;
      hold.x += Math.sign(dx) * Math.min(Math.abs(dx), 4);
      if (Math.abs(dx) < 0.5 && Math.abs(hold.ta - hold.a) < 0.01) { cpu.phase = 'wait'; cpu.waitStart = now; }
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
  function rotate() { hold.ta += Math.PI / 4; sfx('rotate'); }
  $('#btnRotate').onclick = () => { if (humanTurn()) rotate(); };
  // 左右移動: キーやボタンを押している間ずっと動く
  const moveHeld = { left: false, right: false };
  const keyDir = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
  window.addEventListener('keydown', e => {
    if (keyDir[e.key]) {
      if (!moveHeld[keyDir[e.key]]) nudge(keyDir[e.key]);
      moveHeld[keyDir[e.key]] = true;
      e.preventDefault();
      return;
    }
    if (e.repeat || !humanTurn()) return;
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') rotate();
    else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 's' || e.key === 'S') drop();
    else return;
    e.preventDefault();
  });
  window.addEventListener('keyup', e => { if (keyDir[e.key]) moveHeld[keyDir[e.key]] = false; });
  window.addEventListener('blur', () => { moveHeld.left = moveHeld.right = false; });
  for (const [id, dir] of [['#btnLeft', 'left'], ['#btnRight', 'right']]) {
    const b = $(id);
    b.addEventListener('pointerdown', e => { nudge(dir); moveHeld[dir] = true; b.setPointerCapture(e.pointerId); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { moveHeld[dir] = false; });
  }
  function nudge(dir) { if (humanTurn()) hold.x = clampX(hold.x + (dir === 'right' ? 4 : -4)); }
  function updateHold(dt) {
    const d = hold.ta - hold.a;
    hold.a = Math.abs(d) < 0.01 ? hold.ta : hold.a + Math.sign(d) * Math.min(Math.abs(d), dt * 0.012);
    if (humanTurn() && !drag) {
      const v = (moveHeld.right ? 1 : 0) - (moveHeld.left ? 1 : 0);
      if (v) hold.x = clampX(hold.x + v * dt * 0.22);
    }
  }

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
    const w = p.r * FACE_W, h = w * face.height / face.width, cy = p.y - p.r * FACE_UP;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.4)';
    g.shadowBlur = 6;
    g.shadowOffsetY = 3;
    g.drawImage(face, p.x - w / 2, cy - h / 2, w, h);
    g.restore();
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
    const dt = Math.min(100, now - last);
    acc += dt;
    last = now;
    if (state === 'hold') updateHold(dt);
    while (acc >= STEP) {
      Engine.update(engine, STEP);
      physicsCheck();
      acc -= STEP;
    }
    if (state === 'hold' && players[curPlayer].cpu) cpuUpdate(now);
    if (state === 'hold' || state === 'drop') {
      // 塔が高くなったら引いて全体を映す (スマホは半分まで、PCは縦1600単位まで)。それより高ければ上へずらす
      const above = -(hold.y - cur.R - 70 * dpr / baseScale);
      const ts = Math.max(Math.min(baseScale * 0.5, H / 1600), Math.min(baseScale, (H - BTN_H * dpr) / (above + LEG_SHOW)));
      scale += (ts - scale) * 0.06;
      const target = Math.min(camBase(), hold.y - cur.R - 90 * dpr / scale);
      camTop += (target - camTop) * 0.06;
    }
    render(now);
  }
  requestAnimationFrame(t => { last = t; loop(t); });
})();
