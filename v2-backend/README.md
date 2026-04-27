# QR Battleship v2 — Refactored Architecture

CPEE-orchestrated, QR-driven Battleship with a cleaner backend architecture. Computer strategy logic has been moved entirely into the CPEE process — the backend is a neutral game-state service.

## What Changed from v1

### Removed Endpoints
| v1 Endpoint | Why Removed |
|---|---|
| `POST /game/:id/player-move` | Replaced by neutral `_apply-move` |
| `GET /game/:id/player-move-debug` | Replaced by neutral `_apply-move` |
| `POST /computer/:id/move` | Replaced by neutral `_apply-move` |
| `POST /game/:id/ensure-player-turn` | No longer needed — CPEE controls turn flow explicitly |
| `GET /game/:id/status` | Replaced by `_whose-turn` |
| `GET /timeout/:seconds` | Moved to CPEE-level timeout handling |
| All `/computer/...` routes | No separate computer route group — one neutral `_apply-move` handles both actors |

### New Endpoints
| v2 Endpoint | Purpose |
|---|---|
| `GET /game/_whose-turn?game_id=X` | Pure read: whose turn, game status |
| `GET /game/_apply-move?game_id=X&actor=Y&coordinate=Z` | Neutral move application for either actor |
| `GET /game/_view?game_id=X` | Enhanced view with iterable `hits_received`/`misses_received` arrays |

### Key Architecture Difference
**v1:** Backend contained computer strategy logic (`computerService.js` with `pickRandomTarget`). The `ensure-player-turn` endpoint bundled "check turn + auto-play computer move" into one call.

**v2:** Backend has no strategy logic. It only validates and applies moves. CPEE decides which coordinate the computer attacks. The `_apply-move` endpoint is actor-neutral — it works identically for `actor=player` and `actor=computer`.

### Data Format Change
**v1:** `hits_received` and `misses_received` were arrays of coordinate strings: `["A1", "B3"]`

**v2:** They are arrays of objects: `[{"coordinate": "A1"}, {"coordinate": "B3"}]` — enabling clean iteration in CPEE's Ruby expressions.

### Frontend Change
**v1:** QR callbacks sent raw strings (`"A1"`, `"start"`, `"new"`)

**v2:** QR callbacks send JSON events (`{"action":"shoot","coordinate":"A1"}`, `{"action":"start"}`, `{"action":"new"}`)

## v2 API Reference

All endpoints are accessed through the PHP proxy:
`https://lehre.bpm.in.tum.de/~ga53muj/battleship/api_new.php`

### POST /game
Creates a new game with random ship placement for both sides.

**Response (201):**
```json
{ "game_id": "57ee0ffa", "status": "active", "turn": "player", "game_over": false, "winner": null }
```

### GET /game/last-unfinished
Finds the most recently created active game.

**Response:**
```json
{ "found": true, "game_id": "57ee0ffa" }
// or
{ "found": false, "game_id": null }
```

### GET /game/_whose-turn?game_id=X
Pure read — returns current turn and game status.

**Response:**
```json
{ "game_id": "57ee0ffa", "turn": "player", "status": "active", "game_over": false, "winner": null }
```

### GET /game/_view?game_id=X
Full game view for the UI. Hides enemy ship positions, shows masked grids.

**Response:**
```json
{
  "game_id": "57ee0ffa",
  "status": "active",
  "turn": "player",
  "game_over": false,
  "winner": null,
  "enemy_grid": [[null, "hit", "miss", ...], ...],
  "player_grid": [[null, "ship", "hit", ...], ...],
  "player_board": {
    "ships": [{ "name": "Cruiser", "size": 3, "hits": 1, "sunk": false }, ...],
    "hits_received": [{ "coordinate": "A3" }],
    "misses_received": [{ "coordinate": "B1" }]
  },
  "computer_board": {
    "ships_sunk": [{ "name": "Patrol", "size": 2 }],
    "hits_received": [{ "coordinate": "C2" }],
    "misses_received": [{ "coordinate": "D4" }]
  },
  "last_player_move": { "actor": "player", "coordinate": "C2", "result": "hit", "ship": "Destroyer", "sunk": false },
  "last_computer_move": { "actor": "computer", "coordinate": "A3", "result": "hit", "ship": "Cruiser", "sunk": false }
}
```

### GET /game/_apply-move?game_id=X&actor=player|computer&coordinate=B4
Applies a move for either actor. One neutral handler.

**Parameters:**
- `game_id` — the game ID
- `actor` — `"player"` or `"computer"`
- `coordinate` — target cell, e.g., `"B4"` (A-F, 1-6)

**Success Response:**
```json
{
  "game_id": "57ee0ffa",
  "actor": "player",
  "coordinate": "B4",
  "result": "hit",
  "ship": "Cruiser",
  "sunk": false,
  "game_over": false,
  "winner": null,
  "next_turn": "computer"
}
```

**Error Responses (all include `game_over` and `winner`):**
```json
{ "error": "wrong_turn", "game_over": false, "winner": null }
{ "error": "invalid_coordinate", "game_over": false, "winner": null }
{ "error": "already_targeted", "game_over": false, "winner": null }
{ "error": "game_not_found", "game_over": false, "winner": null }
{ "error": "game_over", "game_over": true, "winner": "player" }
```

### GET /game/:id
Raw game state dump for debugging. Exposes all ship positions.

## Game Specifications
- 6×6 board (columns A-F, rows 1-6)
- 3 ships: Cruiser (3), Destroyer (2), Patrol (2)
- Random placement, no manual ship positioning
- JSON file persistence in `server/games/`

## Setup & Run

```bash
cd server
npm install
node app.js        # Starts on port 3001
```

Production (with auto-restart):
```bash
nohup bash -c 'while true; do node app.js; echo "Restarting..."; sleep 3; done' > server.log 2>&1 &
```

Test with curl:
```bash
curl -X POST http://localhost:3001/game
curl "http://localhost:3001/game/_view?game_id=GAME_ID"
curl "http://localhost:3001/game/_apply-move?game_id=GAME_ID&actor=player&coordinate=A1"
```

## Infrastructure Notes

### PHP Proxy
The Lehre server firewall blocks direct Node.js port access. `api_new.php` forwards Apache requests to `localhost:3001`. The v1 proxy (`api.php` → port 3000) is separate and untouched.

### Frontend Pages
All v2 pages use `_new` suffix to coexist with v1:
- `init_new.html` — start screen, sends `{"action":"start"}`
- `choose_new.html` — new/continue choice, sends `{"action":"new"}` or `{"action":"continue"}`
- `board_new.html` — game board (TV landscape layout), sends `{"action":"shoot","coordinate":"B4"}`
- `end_new.html` — game over screen, reads `?winner=` from URL
- `send_new.php` — callback bridge, passes JSON payloads unchanged with `Content-Type: application/json`

### Coexistence with v1
v1 (`battleship-server` on port 3000, `api.php`, original HTML pages) runs independently. Nothing in v1 was modified.

## Project Structure
```
server/
  app.js                          # Express entry point (port 3001)
  package.json
  routes/gameRoutes.js            # All endpoints in one route file
  services/gameService.js         # Game logic: create, view, whose-turn, apply-move
  services/persistenceService.js  # JSON file read/write
  utils/boardUtils.js             # Ship placement, attack logic, grid masking
  utils/coordinateUtils.js        # A1-F6 coordinate parsing
  games/                          # Persisted game state files

frontend/
  init_new.html                   # Start screen
  choose_new.html                 # New game / continue
  board_new.html                  # Main game board
  end_new.html                    # Game over screen
  api_new.php                     # PHP proxy → localhost:3001
  send_new.php                    # QR callback bridge (JSON payloads)
  qrcode.min.js                   # QR code generation library
```
