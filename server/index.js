const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ─── In-memory lobby store ───
const lobbies = new Map();

function genCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function broadcast(lobby, msg) {
  const data = JSON.stringify(msg);
  lobby.players.forEach(p => {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  });
}

function getLobbyState(lobby) {
  return {
    type: 'lobby_state',
    code: lobby.code,
    host: lobby.host,
    players: lobby.players.map(p => ({
      id: p.id, name: p.name, score: p.score,
      avatar: p.avatar, color: p.color, ready: p.ready
    })),
    phase: lobby.phase,
    questionIndex: lobby.questionIndex,
    totalQuestions: lobby.questions.length
  };
}

// ─── Generate questions via Anthropic ───
app.post('/api/generate', upload.single('pdf'), async (req, res) => {
  try {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'No API key configured on server' });

    let messageContent;
    if (req.file) {
      const base64 = req.file.buffer.toString('base64');
      const mime = req.file.mimetype === 'application/pdf' ? 'application/pdf' : 'text/plain';
      messageContent = [
        { type: 'document', source: { type: 'base64', media_type: mime, data: base64 } },
        { type: 'text', text: 'Read this document and create exactly 10 quiz questions from it.\nReturn ONLY a valid JSON array — no markdown, no backticks, no explanation.\nFormat: [{"q":"question","choices":["A","B","C","D"],"correct":0},...]\nRules: 4 choices each. correct = index 0-3. Keep choices under 6 words. Questions under 20 words.' }
      ];
    } else if (req.body.text) {
      messageContent = [{ type: 'text', text: `Study material:\n\n${req.body.text.substring(0, 5000)}\n\nCreate exactly 10 quiz questions.\nReturn ONLY valid JSON array.\nFormat: [{"q":"question","choices":["A","B","C","D"],"correct":0},...]\nRules: 4 choices, correct = index 0-3, short labels.` }];
    } else {
      return res.status(400).json({ error: 'No content provided' });
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: messageContent }]
      })
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    const raw = data.content.map(b => b.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    const questions = JSON.parse(clean);
    if (!Array.isArray(questions) || !questions.length) throw new Error('No questions returned');
    res.json({ questions });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Create lobby ───
app.post('/api/lobby/create', (req, res) => {
  const { playerName, avatar, color } = req.body;
  const code = genCode();
  const playerId = uuidv4();
  const lobby = {
    code, host: playerId, phase: 'waiting',
    players: [{ id: playerId, name: playerName || 'HOST', avatar: avatar || '🧙', color: color || '#c17f3a', score: 0, ready: false, ws: null, answer: null, answerTime: null }],
    questions: [], questionIndex: 0, questionStart: null, answerTimeout: null
  };
  lobbies.set(code, lobby);
  res.json({ code, playerId });
});

// ─── Set questions ───
app.post('/api/lobby/:code/questions', (req, res) => {
  const lobby = lobbies.get(req.params.code);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  lobby.questions = req.body.questions;
  broadcast(lobby, { type: 'questions_ready', total: lobby.questions.length });
  res.json({ ok: true });
});

// ─── WebSocket ───
wss.on('connection', (ws) => {
  let playerId = null;
  let lobbyCode = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      const lobby = lobbies.get(msg.code);
      if (!lobby) { ws.send(JSON.stringify({ type: 'error', message: 'Lobby not found. Check the code!' })); return; }

      let player = lobby.players.find(p => p.id === msg.playerId);
      if (!player) {
        if (lobby.phase !== 'waiting') { ws.send(JSON.stringify({ type: 'error', message: 'Game already in progress' })); return; }
        player = { id: msg.playerId || uuidv4(), name: msg.playerName || 'PLAYER', avatar: msg.avatar || '🧝', color: msg.color || '#3a6a9a', score: 0, ready: false, ws: null, answer: null, answerTime: null };
        lobby.players.push(player);
      }
      player.ws = ws;
      playerId = player.id;
      lobbyCode = lobby.code;
      ws.send(JSON.stringify({ type: 'joined', playerId: player.id, code: lobby.code, isHost: lobby.host === player.id }));
      broadcast(lobby, getLobbyState(lobby));
    }

    if (msg.type === 'start_game') {
      const lobby = lobbies.get(lobbyCode);
      if (!lobby || lobby.host !== playerId) return;
      if (!lobby.questions.length) { ws.send(JSON.stringify({ type: 'error', message: 'Load questions first!' })); return; }
      lobby.phase = 'countdown';
      lobby.questionIndex = 0;
      lobby.players.forEach(p => { p.score = 0; p.answer = null; });
      broadcast(lobby, { type: 'countdown', count: 3 });
      let c = 3;
      const iv = setInterval(() => {
        c--;
        if (c > 0) broadcast(lobby, { type: 'countdown', count: c });
        else { clearInterval(iv); startQuestion(lobby); }
      }, 1000);
    }

    if (msg.type === 'answer') {
      const lobby = lobbies.get(lobbyCode);
      if (!lobby || lobby.phase !== 'playing') return;
      const player = lobby.players.find(p => p.id === playerId);
      if (!player || player.answer !== null) return;
      player.answer = msg.answer;
      player.answerTime = Date.now();
      checkAllAnswered(lobby);
    }

    if (msg.type === 'player_move') {
      const lobby = lobbies.get(lobbyCode);
      if (!lobby) return;
      broadcast(lobby, { type: 'player_moved', playerId, x: msg.x, y: msg.y, facing: msg.facing });
    }
  });

  ws.on('close', () => {
    if (!lobbyCode || !playerId) return;
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;
    const player = lobby.players.find(p => p.id === playerId);
    if (player) player.ws = null;
    broadcast(lobby, getLobbyState(lobby));
  });
});

function startQuestion(lobby) {
  const q = lobby.questions[lobby.questionIndex];
  if (!q) { endGame(lobby); return; }
  lobby.phase = 'playing';
  lobby.questionStart = Date.now();
  lobby.players.forEach(p => { p.answer = null; p.answerTime = null; });
  broadcast(lobby, {
    type: 'question',
    index: lobby.questionIndex,
    total: lobby.questions.length,
    question: q.q,
    choices: q.choices
  });
  if (lobby.answerTimeout) clearTimeout(lobby.answerTimeout);
  lobby.answerTimeout = setTimeout(() => {
    if (lobby.phase === 'playing') resolveQuestion(lobby);
  }, 18000);
}

function checkAllAnswered(lobby) {
  const online = lobby.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
  if (online.every(p => p.answer !== null)) resolveQuestion(lobby);
}

function resolveQuestion(lobby) {
  if (lobby.answerTimeout) { clearTimeout(lobby.answerTimeout); lobby.answerTimeout = null; }
  lobby.phase = 'reveal';
  const q = lobby.questions[lobby.questionIndex];
  const results = lobby.players.map(p => {
    const correct = p.answer === q.correct;
    let pts = 0;
    if (correct) {
      const timeTaken = p.answerTime ? p.answerTime - lobby.questionStart : 15000;
      pts = 100 + Math.max(0, Math.floor((15000 - timeTaken) / 150));
      p.score += pts;
    }
    return { playerId: p.id, answer: p.answer, correct, pts, totalScore: p.score };
  });
  broadcast(lobby, { type: 'reveal', correctIndex: q.correct, results, correctText: q.choices[q.correct] });
  setTimeout(() => {
    lobby.questionIndex++;
    if (lobby.questionIndex >= lobby.questions.length) endGame(lobby);
    else startQuestion(lobby);
  }, 4000);
}

function endGame(lobby) {
  lobby.phase = 'ended';
  const sorted = [...lobby.players].sort((a, b) => b.score - a.score);
  broadcast(lobby, {
    type: 'game_over',
    podium: sorted.slice(0, 3).map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score, avatar: p.avatar, color: p.color })),
    allScores: sorted.map(p => ({ id: p.id, name: p.name, score: p.score, avatar: p.avatar }))
  });
  setTimeout(() => lobbies.delete(lobby.code), 600000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚪 Door Dash Quiz on port ${PORT}`));
