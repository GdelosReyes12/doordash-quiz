# 📓 Door Dash Quiz — Project Log

---

## Project Summary

**Name:** Door Dash Quiz
**Type:** Real-time multiplayer browser game
**Concept:** Players upload a study PDF, AI generates quiz questions, and players race to walk their pixel avatars into the correct door on a shared canvas.
**Stack:** Node.js + WebSockets + HTML5 Canvas + Anthropic Claude API
**Target Deployment:** Vercel

---

## Session 1 — Concept & Solo Prototype

### Initial Request
User wanted a browser-based study game mixing gaming with learning. Core idea:
- Upload a PDF → AI reads it → generates questions
- 3–4 doors on screen, each labeled with an answer choice
- Character/avatar walks into the correct door
- Question shown at the top
- Highscores like a real game

### Design Additions (proposed and accepted)
- Streak counter for consecutive correct answers
- Timer per question (faster = more points)
- 3 lives system
- Animated pixel-art avatar
- End screen with score + grade (S/A/B/C/D)
- Local leaderboard via localStorage

### Style Decision
**Pixel / cozy aesthetic** — warm browns, sunset sky, cobblestone path, Press Start 2P + VT323 fonts.
Subject: general (any PDF topic).

### First Build
Built as a single self-contained HTML artifact with:
- File upload → base64 → Anthropic API call (claude-sonnet-4-20250514)
- AI returns JSON array of `{q, choices[], correct}` objects
- CSS-drawn pixel doors (SVG-based per door)
- Simple avatar emoji that slides toward chosen door
- Feedback overlay (correct = green, wrong = red + screen shake)
- localStorage leaderboard

---

## Session 2 — Multiplayer Redesign

### New Requirements
User wanted a full redesign for multiplayer. Specific requests:

| Feature | Decision |
|---|---|
| Multiplayer | Real-time via WebSocket — lobby + join by code |
| Controls | WASD + Arrow Keys for avatar movement |
| Deployment | Vercel — friends join via URL + lobby code |
| Lives | **Removed** — pure high-score competition |
| Correct answer feedback | Confetti rains down 🎉 |
| Wrong answer feedback | Poop falls from sky 💩 |
| End screen | Podium: 1st = dragon peak (center), 2nd = tower (right), 3rd = mountain (left) |
| Doors | Smaller, open when player gets close, players can go in and out |

### Architecture Decisions

**Why WebSockets over polling?**
Multiplayer movement (all players see each other moving) requires near-real-time updates. WebSockets give persistent bidirectional connection with ~50ms broadcast intervals. HTTP polling would be too slow and wasteful.

**Why keep lobbies in-memory?**
Simple, fast, no database setup required. Trade-off: server restart clears all games. Acceptable for a personal/school use case. A Redis layer could be added later for persistence.

**Why native `fetch` instead of `node-fetch`?**
Node 18+ includes `fetch` globally. Removing `node-fetch` simplifies the dependency tree and avoids the ESM/CJS mismatch issues that `node-fetch` v3 introduces.

**Canvas vs DOM for game world?**
HTML Canvas was chosen for the game screen because:
- Multiple player avatars moving simultaneously is easier to manage in a single draw loop
- Door open/close animation (transform skew) is simpler in canvas than CSS transforms on many elements
- Canvas clears and redraws every frame — no stale DOM state to manage

DOM is still used for the HUD (question text, timer bar, scoreboard) because those elements benefit from CSS transitions and don't need per-frame redrawing.

### File Structure

```
server/index.js     — Express HTTP + WebSocket server
                      Endpoints: POST /api/generate, POST /api/lobby/create,
                                 POST /api/lobby/:code/questions
                      WS messages: join, start_game, answer, player_move

public/index.html   — Four screens: lobby, waiting room, game, podium
public/css/style.css — Full cozy pixel design system
public/js/game.js   — WebSocket client, canvas game loop, WASD, door logic,
                       confetti/poop spawners, podium builder
```

### Game Loop Design

```
connect WS
  → join message → server adds player to lobby
  → lobby_state broadcast → waiting room updates

host uploads PDF
  → POST /api/generate → Anthropic API → JSON questions
  → POST /api/lobby/:code/questions → server stores, broadcasts questions_ready

host clicks Start
  → start_game WS message → server sends countdown (3, 2, 1)
  → startQuestion() → broadcasts {type:'question', q, choices}

client receives question
  → builds 4 doors on canvas
  → resets player positions to center
  → starts 15s visual timer

player moves (WASD)
  → canvas update loop checks proximity to each door
  → within 42px → sends {type:'answer', answer: doorIndex}
  → server records answer + timestamp

all answered OR 18s timeout
  → resolveQuestion() → calculates pts with time bonus
  → broadcasts {type:'reveal', correctIndex, results[]}

client shows confetti or poop
  → doors tint green/red
  → 4 seconds later: next question or game_over

game_over
  → sorted podium data sent
  → podium screen built with dragon/tower/mountain scene
```

### Scoring Formula
```
base = 100 pts (correct answer)
time_bonus = max(0, floor((15000ms - ms_taken) / 150))
total = base + time_bonus   → max ~200 pts per question
wrong answer = 0 pts
```
Time bonus ranges from 0 (answered at exactly 15s) to ~100 (answered instantly). Rewards fast thinking without punishing slower readers too harshly.

### Door Proximity Mechanics
- Doors rendered at top of canvas, spaced evenly
- Each door has `openAmt` float (0→1) driven by player distance
- Opening animation: canvas `transform(1 - openAmt * 0.85, 0, 0, 1, ...)` — door appears to swing inward (perspective skew)
- Answer triggered at 42px center-to-center distance
- After answering, player's avatar stays where it is; server resolves when all answer or timer ends

### Confetti & Poop
Both use absolutely-positioned DOM elements animated with CSS `@keyframes`:
- **Confetti**: 80 colored squares/circles, random left positions, fall from top, rotate 720°, fade out
- **Poop**: 20 `💩` emoji, random positions, fall with slight spin, fade at bottom
- Both containers cleared after 4 seconds to avoid DOM buildup

### Podium Design
Three-slot layout ordered **2nd (left) → 1st (center) → 3rd (right)**, matching classic podium convention. Heights: 1st = 160px block, 2nd = 110px, 3rd = 80px.

Scene theming:
- 1st place: 🐉 dragon floats above the gold block (Dragon's Peak)
- 2nd place: 🏰 tower icon on the silver block
- 3rd place: ⛰️ mountain icon on the bronze block

Podium character bobbing: CSS `@keyframes podiumBob` with staggered `animation-delay` so the three avatars don't bob in sync.

---

## Deployment Notes

### Vercel Consideration
Standard Vercel Serverless Functions time out after 10–30 seconds and don't maintain persistent state between invocations. WebSocket connections require a persistent process.

**Solution used:** `vercel.json` routes everything to `server/index.js` using `@vercel/node` (the Node.js runtime), not Edge Functions. This supports WebSockets within a single deployment.

**Caveat:** For heavy production use, a persistent server platform is better — Railway, Render, or Fly.io all support Node.js with WebSockets natively and have free tiers.

### Required Environment Variable
`ANTHROPIC_API_KEY` — must be set in Vercel's dashboard under Project → Settings → Environment Variables before the PDF-to-questions feature works. The demo quiz works without it.

---

## Customization Reference

| What to change | Where | What to edit |
|---|---|---|
| Number of questions | `server/index.js` prompt | Change `exactly 10` |
| Timer length | `server/index.js` + `game.js` | `18000` ms timeout + `timeLeft = 15` |
| Score formula | `server/index.js` `resolveQuestion()` | pts calculation |
| Avatars | `game.js` `AVATARS` array | Add/remove emoji |
| Door colors | `game.js` `DOOR_COLORS` array | Hex values |
| Movement speed | `game.js` `SPEED` constant | Default 180 px/s |
| Door trigger radius | `game.js` update loop | `dist < 42` for answer, `dist < 70` for open |
| Max lobby lifetime | `server/index.js` `endGame()` | `600000` ms (10 min) |

---

## Future Ideas

- [ ] Persistent leaderboard (database or Redis)
- [ ] Custom avatar upload (image)
- [ ] Question difficulty tiers
- [ ] Spectator mode
- [ ] Sound effects (door creak, correct chime, wrong buzzer)
- [ ] Mobile touch controls (virtual joystick)
- [ ] Team mode (2v2)
- [ ] Question review screen at game end (see all correct answers)
- [ ] Host ability to kick players
- [ ] Rejoin after disconnect with preserved score
