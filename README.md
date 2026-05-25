# 🚪 Door Dash Quiz

A real-time multiplayer study game where players walk their pixel avatars into doors to answer quiz questions. Upload any PDF — AI generates the questions automatically.

---

## How to Play

1. **Host** creates a lobby and gets a 5-letter code
2. **Friends** join by entering that code on the same URL
3. Host uploads a PDF (or uses the demo quiz)
4. Host clicks **Start Game**
5. A question appears at the top — four doors appear on screen, each labeled with a choice
6. Players move their avatar with **WASD** or arrow keys and **walk into a door** to answer
7. Correct door → 🎉 confetti rains down; wrong door → 💩 falls from the sky
8. Faster correct answers earn more points — highest score at the end wins
9. Winners appear on a podium: 1st on a dragon peak, 2nd on a tower, 3rd on a mountain

---

## Project Structure

```
doordash-quiz/
├── server/
│   └── index.js          # Express + WebSocket server, lobby logic, Anthropic API call
├── public/
│   ├── index.html        # All game screens (lobby, waiting room, game, podium)
│   ├── css/
│   │   └── style.css     # Pixel/cozy aesthetic, all UI components
│   └── js/
│       └── game.js       # Canvas game engine, WASD, door mechanics, confetti/poop
├── package.json
├── vercel.json
├── .env.example
└── .gitignore
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js 18+ with Express |
| Real-time | WebSockets (ws library) |
| Game rendering | HTML5 Canvas (2D context) |
| AI question generation | Anthropic Claude Sonnet via REST API |
| PDF parsing | Sent directly to Claude as base64 document |
| Hosting | Vercel (Node runtime) |
| Font | Press Start 2P + VT323 (Google Fonts) |

---

## Local Development

### Prerequisites
- Node.js 18 or higher
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

### Steps

```bash
# 1. Clone or download this project
cd doordash-quiz

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env
# Open .env and paste your Anthropic API key

# 4. Start the server
npm start

# 5. Open your browser
# http://localhost:3000
```

To test multiplayer locally, open two browser tabs — create a lobby in one, join with the code in the other.

---

## Deploy to Vercel

### Option A — Vercel CLI (recommended)

```bash
# Install Vercel CLI globally
npm install -g vercel

# Deploy from the project folder
cd doordash-quiz
vercel

# Follow the prompts:
#   Set up and deploy? Yes
#   Which scope? (your account)
#   Link to existing project? No
#   Project name: doordash-quiz
#   Directory: ./
```

After the first deploy, Vercel gives you a URL like `https://doordash-quiz.vercel.app`.

**Add your API key as an environment variable:**
```bash
vercel env add ANTHROPIC_API_KEY
# Paste your key when prompted
# Select: Production, Preview, Development

# Redeploy to apply the env var
vercel --prod
```

### Option B — Vercel Dashboard (no CLI)

1. Push this folder to a GitHub repository
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import your repo
3. Vercel auto-detects `vercel.json` — no build settings needed
4. Before deploying, go to **Environment Variables** and add:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your key from console.anthropic.com
5. Click **Deploy**

Your friends can now join just by visiting your Vercel URL and entering a lobby code — no install needed.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key for question generation |
| `PORT` | No | Port for local dev (default: 3000). Vercel sets this automatically. |

---

## Game Mechanics

### Scoring
- Base points per correct answer: **100**
- Time bonus: up to **+100** extra points (faster = more)
- Formula: `score = 100 + floor((15000ms - timeTaken) / 150)`
- No lives — pure score competition

### Timer
- 15 seconds per question
- Server auto-resolves if time runs out before all players answer
- Round ends early if every online player answers

### Door interaction
- Doors appear at the top of the screen, labeled with answer choices (A/B/C/D)
- Walk your avatar within **70px** of a door → it opens (swings animation)
- Walk within **42px** → automatically submits that answer
- You can only answer once per question

### Multiplayer sync
- All player positions broadcast via WebSocket every ~50ms while moving
- Answer submission and reveal are server-authoritative
- Disconnected players don't block the round from advancing

---

## Customization

### Change number of questions
In `server/index.js`, find the AI prompt and change `exactly 10` to any number:
```
...create exactly 10 quiz questions...
```

### Change timer duration
In `server/index.js`:
```js
// Change 18000 (18 seconds server timeout) to match
lobby.answerTimeout = setTimeout(() => { ... }, 18000);
```
In `public/js/game.js`:
```js
state.timeLeft = 15;   // visual countdown in seconds
```

### Change answer time bonus
In `server/index.js` `resolveQuestion()`:
```js
pts = 100 + Math.max(0, Math.floor((15000 - timeTaken) / 150));
//               ↑ base   ↑ 15s window               ↑ divisor (lower = more bonus)
```

### Add more avatars
In `public/js/game.js`, edit the `AVATARS` array at the top.

---

## Known Limitations

- **Vercel serverless + WebSockets**: Vercel's Edge/Serverless functions don't natively support persistent WebSocket connections. For best results, deploy using Vercel's **Node.js runtime** (the `vercel.json` in this project uses `@vercel/node` which does support WebSockets for the duration of a request). For production at scale, consider [Railway](https://railway.app), [Render](https://render.com), or [Fly.io](https://fly.io) — all support persistent Node.js servers with WebSockets natively and have free tiers.
- **No persistence**: Lobbies are in-memory. Server restart clears all games.
- **Max players**: Tested comfortably with 8 players. No hard limit, but canvas gets crowded beyond ~10.
