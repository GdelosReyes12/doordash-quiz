'use strict';

// ─────────────── STATE ───────────────
const state = {
  ws: null,
  playerId: null,
  lobbyCode: null,
  isHost: false,
  avatar: '🧙',
  playerName: 'PLAYER',
  players: [],
  questions: [],
  currentQuestion: null,
  questionIndex: 0,
  totalQuestions: 0,
  phase: 'lobby',
  timerInterval: null,
  timeLeft: 15,
  myAnswer: null,
  questionsLoaded: false,
  lastMove: 0,
};

const AVATARS = ['🧙','🧝','🧟','🧛','🧜','🐉','🦊','🐺','🐸','🐱','🦁','🐯'];
const COLORS  = ['#c17f3a','#3a6a9a','#5a8a3c','#9a5a9a','#c04040','#40a0c0','#c0a040','#804060'];

// ─────────────── INIT ───────────────
window.addEventListener('DOMContentLoaded', () => {
  buildAvatarPicker();
  document.getElementById('player-name').addEventListener('input', e => { state.playerName = e.target.value.toUpperCase() || 'PLAYER'; });
  document.getElementById('pdf-input').addEventListener('change', onFileUpload);
  window.addEventListener('resize', resizeCanvas);
});

function buildAvatarPicker() {
  const row = document.getElementById('avatar-row');
  AVATARS.forEach((av, i) => {
    const el = document.createElement('div');
    el.className = 'avatar-opt' + (i === 0 ? ' selected' : '');
    el.textContent = av;
    el.onclick = () => {
      document.querySelectorAll('.avatar-opt').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      state.avatar = av;
      state.playerColor = COLORS[i % COLORS.length];
    };
    row.appendChild(el);
  });
  state.avatar = AVATARS[0];
  state.playerColor = COLORS[0];
}

// ─────────────── LOBBY ACTIONS ───────────────
async function createLobby() {
  state.playerName = document.getElementById('player-name').value.toUpperCase() || 'HOST';
  const res = await fetch('/api/lobby/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName: state.playerName, avatar: state.avatar, color: state.playerColor })
  });
  const data = await res.json();
  state.lobbyCode = data.code;
  state.playerId  = data.playerId;
  state.isHost    = true;
  connectWS(data.code, data.playerId);
  showScreen('waiting');
}

function showJoin() {
  document.getElementById('panel-start').classList.add('hidden');
  document.getElementById('panel-join').classList.remove('hidden');
}
function hideJoin() {
  document.getElementById('panel-join').classList.add('hidden');
  document.getElementById('panel-start').classList.remove('hidden');
}

async function joinLobby() {
  state.playerName = document.getElementById('player-name').value.toUpperCase() || 'PLAYER';
  const code = document.getElementById('join-code').value.toUpperCase().trim();
  if (code.length < 4) return alert('Enter a 5-letter code');
  state.lobbyCode = code;
  state.playerId  = 'p_' + Math.random().toString(36).substr(2, 8);
  state.isHost    = false;
  connectWS(code, state.playerId);
}

// ─────────────── WEBSOCKET ───────────────
function connectWS(code, playerId) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${proto}://${location.host}`);

  state.ws.onopen = () => {
    state.ws.send(JSON.stringify({
      type: 'join', code, playerId,
      playerName: state.playerName,
      avatar: state.avatar, color: state.playerColor
    }));
  };

  state.ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  };

  state.ws.onclose = () => {
    console.log('WS closed');
    setTimeout(() => connectWS(code, playerId), 2000);
  };
}

function send(obj) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj));
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'joined':
      state.playerId = msg.playerId;
      state.isHost   = msg.isHost;
      showScreen('waiting');
      document.getElementById('lobby-code-display').textContent = msg.code;
      if (state.isHost) {
        document.getElementById('host-panel').classList.remove('hidden');
        document.getElementById('guest-panel').classList.add('hidden');
      } else {
        document.getElementById('host-panel').classList.add('hidden');
        document.getElementById('guest-panel').classList.remove('hidden');
      }
      break;

    case 'lobby_state':
      state.players = msg.players;
      renderPlayerList(msg.players, msg.host);
      document.getElementById('player-count').textContent = msg.players.length;
      break;

    case 'questions_ready':
      state.questionsLoaded = true;
      state.totalQuestions  = msg.total;
      if (state.isHost) {
        document.getElementById('start-btn').disabled = false;
        setStatus(`✅ ${msg.total} questions ready!`);
      } else {
        document.getElementById('quiz-status').textContent = `✅ ${msg.total} questions ready!`;
      }
      break;

    case 'countdown':
      showCountdown(msg.count);
      break;

    case 'question':
      state.currentQuestion = { q: msg.question, choices: msg.choices };
      state.questionIndex   = msg.index;
      state.totalQuestions  = msg.total;
      state.myAnswer        = null;
      startQuestion();
      break;

    case 'reveal':
      showReveal(msg);
      break;

    case 'player_moved':
      updateRemotePlayer(msg);
      break;

    case 'game_over':
      showPodium(msg);
      break;

    case 'error':
      alert(msg.message);
      break;
  }
}

// ─────────────── WAITING ROOM ───────────────
function renderPlayerList(players, host) {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <span class="player-avatar-sm">${p.avatar}</span>
      <span class="player-name-txt">${p.name}</span>
      ${p.id === host ? '<span class="player-host-badge">HOST</span>' : ''}
      <span class="player-score-sm">${p.score} pts</span>
    `;
    list.appendChild(row);
  });
}

function setStatus(msg) {
  document.getElementById('upload-status').textContent = msg;
}

async function onFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  setStatus('Reading file...');
  const fd = new FormData();
  fd.append('pdf', file);
  try {
    const res = await fetch('/api/generate', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    await uploadQuestions(data.questions);
  } catch (err) {
    setStatus('⚠️ Error: ' + err.message);
  }
  e.target.value = '';
}

async function useSample() {
  const sample = [
    {q:"What is the powerhouse of the cell?",choices:["Mitochondria","Nucleus","Ribosome","Vacuole"],correct:0},
    {q:"What does DNA stand for?",choices:["Deoxyribonucleic Acid","Dynamic Nuclear Atom","Double Neutron Arch","Dense Nano Acid"],correct:0},
    {q:"How many planets are in our solar system?",choices:["7","8","9","10"],correct:1},
    {q:"What gas do plants absorb?",choices:["Oxygen","Nitrogen","Carbon Dioxide","Helium"],correct:2},
    {q:"What is H₂O?",choices:["Hydrogen gas","Oxygen","Water","Salt"],correct:2},
    {q:"What force keeps planets in orbit?",choices:["Magnetism","Friction","Gravity","Electricity"],correct:2},
    {q:"What is the speed of light (approx)?",choices:["300,000 km/s","150,000 km/s","1,000 km/s","3,000 km/s"],correct:0},
    {q:"Earth orbits the Sun in roughly...?",choices:["180 days","365 days","400 days","300 days"],correct:1},
  ];
  await uploadQuestions(sample);
}

async function uploadQuestions(questions) {
  state.questions = questions;
  const res = await fetch(`/api/lobby/${state.lobbyCode}/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions })
  });
  const data = await res.json();
  if (!data.ok) setStatus('⚠️ Could not save questions');
}

function startGame() {
  if (!state.questionsLoaded) return;
  send({ type: 'start_game' });
}

// ─────────────── COUNTDOWN ───────────────
function showCountdown(n) {
  showScreen('game');
  resizeCanvas();
  initGameWorld();
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:50;pointer-events:none`;
  el.innerHTML = `<div style="font-family:'Press Start 2P',monospace;font-size:80px;color:#f0c040;text-shadow:6px 6px 0 #7a5010">${n}</div>`;
  document.getElementById('screen-game').appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// ─────────────── GAME WORLD ───────────────
const canvas = { el: null, ctx: null, w: 0, h: 0 };
const world = {
  players: {},     // id → { x, y, avatar, name, color, facing, moving }
  doors: [],       // { x, y, w, h, label, index, open, openAmt }
  initialized: false
};
const keys = {};

function resizeCanvas() {
  canvas.el = document.getElementById('game-canvas');
  canvas.ctx = canvas.el.getContext('2d');
  canvas.w = canvas.el.width  = window.innerWidth;
  canvas.h = canvas.el.height = window.innerHeight;
}

function initGameWorld() {
  if (world.initialized) return;
  world.initialized = true;
  resizeCanvas();

  // Init all player positions
  state.players.forEach((p, i) => {
    const angle = (i / state.players.length) * Math.PI * 2;
    world.players[p.id] = {
      x: canvas.w / 2 + Math.cos(angle) * 80,
      y: canvas.h * 0.65,
      avatar: p.avatar, name: p.name, color: p.color || '#c17f3a',
      facing: 1, moving: false, vx: 0, vy: 0,
      answeredDoor: null, correct: null
    };
  });
  world.doors = [];

  window.addEventListener('keydown', e => { keys[e.code] = true; });
  window.addEventListener('keyup',   e => { keys[e.code] = false; });
  requestAnimationFrame(gameLoop);
}

let lastTime = 0;
function gameLoop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  update(dt);
  draw();
  requestAnimationFrame(gameLoop);
}

const SPEED = 180;
const DOOR_W = 72, DOOR_H = 100;

function update(dt) {
  const me = world.players[state.playerId];
  if (!me || state.phase !== 'playing') return;

  let dx = 0, dy = 0;
  if (keys['KeyA'] || keys['ArrowLeft'])  dx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) dx += 1;
  if (keys['KeyW'] || keys['ArrowUp'])    dy -= 1;
  if (keys['KeyS'] || keys['ArrowDown'])  dy += 1;

  if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

  me.x = Math.max(24, Math.min(canvas.w - 24, me.x + dx * SPEED * dt));
  me.y = Math.max(80, Math.min(canvas.h - 24, me.y + dy * SPEED * dt));
  if (dx !== 0) me.facing = dx > 0 ? 1 : -1;
  me.moving = (dx !== 0 || dy !== 0);

  // Throttle movement broadcast
  if (me.moving && ts - state.lastMove > 50) {
    state.lastMove = ts;
    send({ type: 'player_move', x: me.x, y: me.y, facing: me.facing });
  }

  // Door proximity → open animation + auto-enter
  world.doors.forEach((door, i) => {
    const cx = door.x + DOOR_W / 2, cy = door.y + DOOR_H / 2;
    const dist = Math.hypot(me.x - cx, me.y - cy);
    const near = dist < 70;
    door.open = near;
    door.openAmt = near ? Math.min(1, (door.openAmt || 0) + dt * 4) : Math.max(0, (door.openAmt || 0) - dt * 4);

    // Auto-answer if walking into door and haven't answered yet
    if (near && dist < 42 && state.myAnswer === null && state.phase === 'playing') {
      state.myAnswer = i;
      send({ type: 'answer', answer: i });
    }
  });
}

// ─────────────── DRAWING ───────────────
const DOOR_COLORS = ['#c04040','#3a6a9a','#5a8a3c','#9a5a9a'];
const DOOR_BORDER = ['#6a1010','#1a3060','#1a4a0c','#5a2a5a'];

function draw() {
  const { ctx, w, h } = canvas;
  ctx.clearRect(0, 0, w, h);

  // Sky
  const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.45);
  skyGrad.addColorStop(0, '#2a1a5e');
  skyGrad.addColorStop(0.5, '#5a3a8e');
  skyGrad.addColorStop(1, '#b87040');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, h * 0.45);

  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 30; i++) {
    const sx = (i * 97 + 13) % w;
    const sy = (i * 61 + 7)  % (h * 0.4);
    const sz = i % 3 === 0 ? 2 : 1;
    ctx.fillRect(sx, sy, sz, sz);
  }

  // Ground
  ctx.fillStyle = '#7ab648';
  ctx.fillRect(0, h * 0.45, w, h * 0.55);
  ctx.fillStyle = '#5a9632';
  ctx.fillRect(0, h * 0.45, w, 8);

  // Stone path
  ctx.fillStyle = '#a89878';
  const pw = 200, ph = h * 0.2;
  ctx.fillRect(w / 2 - pw / 2, h * 0.6, pw, ph);
  ctx.fillStyle = '#887858';
  ctx.fillRect(w / 2 - pw / 2, h * 0.6, pw, 4);

  // Cobblestone pattern
  ctx.strokeStyle = '#7a6848';
  ctx.lineWidth = 1;
  for (let row = 0; row < 5; row++) {
    const yy = h * 0.6 + row * 18;
    for (let col = 0; col < 6; col++) {
      const xx = w / 2 - pw / 2 + col * 34 + (row % 2 === 0 ? 0 : 17);
      ctx.strokeRect(xx, yy, 32, 16);
    }
  }

  // Draw doors
  drawDoors(ctx, w, h);

  // Draw all players
  Object.entries(world.players).forEach(([id, p]) => {
    drawPlayer(ctx, p, id === state.playerId);
  });

  // Controls hint
  if (state.phase === 'playing') {
    ctx.font = "7px 'Press Start 2P'";
    ctx.fillStyle = 'rgba(160,140,110,0.8)';
    ctx.textAlign = 'center';
    ctx.fillText('WASD or Arrow Keys to move  •  Walk into a door to answer', w / 2, h - 10);
  }
}

function drawDoors(ctx, w, h) {
  const doors = world.doors;
  if (!doors.length) return;
  const totalW = doors.length * (DOOR_W + 20) - 20;
  const startX = w / 2 - totalW / 2;
  const doorY  = h * 0.38;

  doors.forEach((door, i) => {
    door.x = startX + i * (DOOR_W + 20);
    door.y = doorY;
    const ox = door.openAmt || 0;

    // Frame
    ctx.fillStyle = DOOR_BORDER[i % 4];
    ctx.fillRect(door.x - 5, door.y - 5, DOOR_W + 10, DOOR_H + 10);

    // Door body (skewed when open)
    ctx.save();
    ctx.translate(door.x, door.y);
    if (ox > 0) {
      ctx.transform(1 - ox * 0.85, 0, 0, 1, 0, 0);
    }
    ctx.fillStyle = DOOR_COLORS[i % 4];
    ctx.fillRect(0, 0, DOOR_W, DOOR_H);

    // Panel
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(8, 8, DOOR_W - 16, 40);
    ctx.fillRect(8, 54, DOOR_W - 16, 36);

    // Knob
    ctx.fillStyle = '#f0c040';
    ctx.beginPath();
    ctx.arc(DOOR_W - 12, DOOR_H / 2, 5, 0, Math.PI * 2);
    ctx.fill();

    // Letter
    ctx.font = "8px 'Press Start 2P'";
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'center';
    ctx.fillText(['A','B','C','D'][i], DOOR_W / 2, DOOR_H - 10);
    ctx.restore();

    // Label above door
    const label = door.label || '';
    ctx.font = "13px 'VT323'";
    ctx.textAlign = 'center';
    // Word-wrap label in ~100px
    const words = label.split(' ');
    let lines = [], cur = '';
    words.forEach(w => {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > 110) { lines.push(cur); cur = w; }
      else cur = test;
    });
    if (cur) lines.push(cur);
    const boxH = lines.length * 16 + 10;
    ctx.fillStyle = '#2d1b0ecc';
    ctx.fillRect(door.x + DOOR_W / 2 - 62, door.y - boxH - 8, 124, boxH);
    ctx.strokeStyle = '#f0c040';
    ctx.lineWidth = 2;
    ctx.strokeRect(door.x + DOOR_W / 2 - 62, door.y - boxH - 8, 124, boxH);
    ctx.fillStyle = '#f5f0e8';
    lines.forEach((ln, li) => {
      ctx.fillText(ln, door.x + DOOR_W / 2, door.y - boxH - 8 + 14 + li * 16);
    });

    // Reveal tint
    if (door.revealState === 'correct') {
      ctx.fillStyle = 'rgba(80,200,80,0.45)';
      ctx.fillRect(door.x - 5, door.y - 5, DOOR_W + 10, DOOR_H + 10);
    } else if (door.revealState === 'wrong') {
      ctx.fillStyle = 'rgba(200,60,60,0.35)';
      ctx.fillRect(door.x - 5, door.y - 5, DOOR_W + 10, DOOR_H + 10);
    }
  });
}

function drawPlayer(ctx, p, isMe) {
  if (!p) return;
  const { x, y, avatar, name, color, moving, facing } = p;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y + 10, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Answered-door highlight ring
  if (p.answeredDoor !== null && state.phase === 'reveal') {
    ctx.strokeStyle = p.correct ? '#80ff80' : '#ff6060';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y - 10, 26, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Avatar emoji with bob
  const bob = moving ? Math.sin(Date.now() / 100) * 3 : 0;
  ctx.save();
  ctx.translate(x, y + bob);
  if (facing < 0) { ctx.scale(-1, 1); }
  ctx.font = '28px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(avatar, 0, 0);
  ctx.restore();

  // Name tag
  ctx.font = "7px 'Press Start 2P'";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const nameW = ctx.measureText(name).width + 10;
  ctx.fillStyle = isMe ? '#2d1b0ecc' : '#1a1208cc';
  ctx.fillRect(x - nameW / 2, y - 50, nameW, 14);
  if (isMe) {
    ctx.strokeStyle = '#f0c040';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - nameW / 2, y - 50, nameW, 14);
  }
  ctx.fillStyle = isMe ? '#f0c040' : '#e8dfc8';
  ctx.fillText(name, x, y - 39);
}

// ─────────────── QUESTION / DOORS ───────────────
function startQuestion() {
  state.phase = 'playing';
  const q = state.currentQuestion;

  // Build doors
  world.doors = q.choices.map((choice, i) => ({
    x: 0, y: 0, label: choice, index: i,
    open: false, openAmt: 0, revealState: null
  }));

  // Reset players to starting positions
  const ps = Object.values(world.players);
  ps.forEach((p, i) => {
    const angle = (i / ps.length) * Math.PI * 2;
    p.x = canvas.w / 2 + Math.cos(angle) * 80;
    p.y = canvas.h * 0.72;
    p.answeredDoor = null;
    p.correct = null;
  });

  // HUD
  document.getElementById('question-text').textContent = q.q;
  document.getElementById('q-counter').textContent = `Q ${state.questionIndex + 1}/${state.totalQuestions}`;
  document.getElementById('feedback-layer').classList.add('hidden');
  document.getElementById('confetti-container').innerHTML = '';
  document.getElementById('poop-container').innerHTML = '';

  startTimer();
}

function startTimer() {
  clearInterval(state.timerInterval);
  state.timeLeft = 15;
  updateTimerUI();
  state.timerInterval = setInterval(() => {
    state.timeLeft--;
    updateTimerUI();
    if (state.timeLeft <= 0) clearInterval(state.timerInterval);
  }, 1000);
}

function updateTimerUI() {
  document.getElementById('timer-num').textContent = state.timeLeft;
  const pct = (state.timeLeft / 15) * 100;
  const bar = document.getElementById('timer-bar');
  bar.style.width = pct + '%';
  bar.style.background = state.timeLeft <= 5 ? '#ff6060' : '#f0c040';
  document.getElementById('timer-num').style.color = state.timeLeft <= 5 ? '#ff6060' : '#f0c040';
}

// ─────────────── REVEAL ───────────────
function showReveal(msg) {
  clearInterval(state.timerInterval);
  state.phase = 'reveal';

  // Tint doors
  world.doors.forEach((d, i) => {
    d.revealState = i === msg.correctIndex ? 'correct' : 'wrong';
    d.openAmt = i === msg.correctIndex ? 1 : 0;
  });

  // Mark player results
  msg.results.forEach(r => {
    const p = world.players[r.playerId];
    if (p) { p.answeredDoor = r.answer; p.correct = r.correct; }
    // Update score in state
    const sp = state.players.find(x => x.id === r.playerId);
    if (sp) sp.score = r.totalScore;
  });

  // My result
  const myResult = msg.results.find(r => r.playerId === state.playerId);
  if (myResult) {
    if (myResult.correct) {
      spawnConfetti();
      showFeedbackMsg(`✨ CORRECT! +${myResult.pts} pts`, '#80ff80');
    } else {
      spawnPoops();
      showFeedbackMsg(`💥 WRONG!\nCorrect: ${msg.correctText}`, '#ff8080');
    }
  }

  // Update scoreboard mini
  renderScoreboardMini();
}

function showFeedbackMsg(text, color) {
  const el = document.getElementById('feedback-msg');
  el.style.color = color;
  el.style.whiteSpace = 'pre';
  el.textContent = text;
  document.getElementById('feedback-layer').classList.remove('hidden');
}

function renderScoreboardMini() {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const rows = document.getElementById('score-rows');
  rows.innerHTML = sorted.map(p => `
    <div class="score-row-mini">
      <span>${p.avatar}</span>
      <span>${p.name.substring(0,8)}</span>
      <span class="score-pts">${p.score}</span>
    </div>`).join('');
  document.getElementById('scoreboard-mini').classList.remove('hidden');
}

// ─────────────── CONFETTI / POOP ───────────────
const CONFETTI_COLORS = ['#f0c040','#c04040','#3a6a9a','#5a8a3c','#9a5a9a','#40c0a0','#ff8040'];

function spawnConfetti() {
  const cont = document.getElementById('confetti-container');
  for (let i = 0; i < 80; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.cssText = `
      left:${Math.random() * 100}%;
      top:${Math.random() * -10}%;
      background:${CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]};
      transform:rotate(${Math.random() * 360}deg);
      width:${6 + Math.random() * 8}px;
      height:${6 + Math.random() * 8}px;
      border-radius:${Math.random() > 0.5 ? '50%' : '0'};
      --dur:${1.2 + Math.random() * 2}s;
      animation-delay:${Math.random() * 0.5}s;
    `;
    cont.appendChild(p);
  }
  setTimeout(() => { cont.innerHTML = ''; }, 4000);
}

function spawnPoops() {
  const cont = document.getElementById('poop-container');
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'poop-piece';
    p.textContent = '💩';
    p.style.cssText = `
      left:${Math.random() * 100}%;
      --dur:${1.5 + Math.random() * 1.5}s;
      animation-delay:${Math.random() * 0.6}s;
    `;
    cont.appendChild(p);
  }
  setTimeout(() => { cont.innerHTML = ''; }, 4000);
}

// ─────────────── REMOTE PLAYERS ───────────────
function updateRemotePlayer(msg) {
  if (msg.playerId === state.playerId) return;
  const p = world.players[msg.playerId];
  if (p) {
    p.x = msg.x; p.y = msg.y; p.facing = msg.facing; p.moving = true;
    clearTimeout(p._stopTimer);
    p._stopTimer = setTimeout(() => { if (p) p.moving = false; }, 200);
  }
}

// ─────────────── PODIUM ───────────────
function showPodium(msg) {
  state.phase = 'ended';
  showScreen('podium');
  clearInterval(state.timerInterval);

  const stage = document.getElementById('podium-stage');
  stage.innerHTML = '';

  // Order: 2nd (left), 1st (center), 3rd (right)
  const orderedRanks = [2, 1, 3];
  orderedRanks.forEach(rank => {
    const entry = msg.podium.find(p => p.rank === rank);
    if (!entry) return;
    const slot = document.createElement('div');
    slot.className = 'podium-slot';

    let sceneIcon = '';
    if (rank === 1) sceneIcon = `<span class="scene-icon dragon">🐉</span>`;
    if (rank === 2) sceneIcon = `<span class="scene-icon tower">🏰</span>`;
    if (rank === 3) sceneIcon = `<span class="scene-icon mountain">⛰️</span>`;

    slot.innerHTML = `
      <div class="podium-character rank${rank}">${entry.avatar}</div>
      <div class="podium-name">${entry.name}</div>
      <div class="podium-score">${entry.score} pts</div>
      <div class="podium-block rank${rank}">
        ${sceneIcon}
        <span class="podium-rank">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</span>
      </div>
      <div class="podium-scene-label">${rank === 1 ? '🌋 DRAGON\'S PEAK' : rank === 2 ? '🏰 TOWER' : '⛰️ MOUNTAIN'}</div>
    `;
    stage.appendChild(slot);
  });

  // All scores
  const all = document.getElementById('all-scores');
  all.innerHTML = msg.allScores.map((p, i) => `
    <div class="score-chip">
      <span>${p.avatar}</span>
      <span>${p.name}</span>
      <span class="chip-pts">${p.score} pts</span>
    </div>`).join('');

  // Winner confetti
  spawnConfetti();
}

function backToLobby() {
  world.initialized = false;
  world.doors = [];
  world.players = {};
  state.phase = 'lobby';
  state.questionsLoaded = false;
  document.getElementById('upload-status').textContent = '';
  document.getElementById('start-btn').disabled = true;
  showScreen('waiting');
}

// ─────────────── SCREEN HELPERS ───────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const id = `screen-${name}`;
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}
