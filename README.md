# QR Battleship v2 

A re-architected version of [QR Battleship v1](https://github.com/GreenHamze/QR-Battleship). The game itself is unchanged from the player's perspective. What changed is how the work is divided between the CPEE process and the Node.js backend, and how visible the decision-making is when reading the process graph.

This v2 lives in its own repository so the two versions can be compared side by side. The v1 repo is preserved as-is.

## Architectural Improvements

After v1 was presented, three concerns about the architecture were raised:

1. **No real separation of concerns.** The project was built like a developer would write it, not like an architect would design it. UI, state, and decision logic were entangled.
2. **No real mediator.** CPEE was technically between the UI and the backend, but it was orchestrating at too high a level — the backend was making most of the interesting decisions.
3. **Computer logic should be swappable without touching backend code.** Because the computer's strategy lived inside the backend's `ensure-player-turn` endpoint, swapping strategies required editing the Node.js source.

A fourth, related observation: **the CPEE log should tell you everything without needing Celonis.** In v1, the log read "called `ensure-player-turn` → got result back." The interesting decisions (whose turn, where to shoot, did someone win) were inside the backend, invisible to CPEE's log.

v2 addresses each of these concerns with a specific change.

### What Changed and Why

**The `ensure-player-turn` endpoint was split into two narrower endpoints.**
v1's `ensure-player-turn` bundled three concerns into one call: check whose turn it is, choose a coordinate if the computer is up, apply the move. v2 separates these. `_whose-turn` is a pure read — given a game ID, return whose turn it is and whether the game is over. `_apply-move` is a neutral mutation — given a game ID, an actor (`player` or `computer`), and a coordinate, apply the move. The two are composed by the CPEE process, not bundled inside the backend.

**Computer strategy moved into the CPEE process as a Script block.**
v1 had a `pickRandomTarget` function inside `services/computerService.js`, called automatically by `ensure-player-turn`. To change the computer's strategy, you had to edit Node.js code, redeploy the service, and restart it. In v2, the strategy lives in a CPEE Script block named `Strategy: Pick Target`. It reads the player's board state from `_view`, picks a coordinate in plain Ruby, and writes it to a CPEE data variable. To swap strategies, you edit one block in the CPEE cockpit. No code deploy, no backend touch, no service restart. 

**The CPEE process became an explicit state machine.**
v1's main loop alternated between `Ensure Player Turn`, `Start Board & Wait`, and `Apply Player Move` — three blocks per iteration, with the actual decisions (whose turn, did the move hit, is the game over) happening inside the backend responses. v2's main loop contains a single Alternative that branches on a `data.state` variable. Eight named states cover every situation the system can be in: `init`, `choosing_mode`, `loading_game`, `check_turn`, `player_turn`, `apply_player_move`, `computer_turn`, `apply_computer_move`. Every state transition is set explicitly in a Finalize block. This makes the process graph readable as a state diagram and makes the execution log self-documenting — every interesting decision shows up as a CPEE event.

**The frontend now reports events, not raw values.**
In v1, scanning a board QR code sent the raw coordinate string `"A1"` to CPEE. In v2, it sends a JSON event `{"action":"shoot","coordinate":"A1"}`. The Finalize block in the CPEE process parses the event with a uniform template and dispatches based on the action. This matches a mediator pattern I was seeking: the frontend says what happened, the process decides what it means.

### Responsibility Shift: CPEE vs. Backend

| Concern | v1 | v2 |
|---|---|---|
| Whose turn is it? | Backend implicitly tracked, returned in `ensure-player-turn` | CPEE asks the backend explicitly via `_whose-turn`, routes on the result |
| When does the computer move? | Backend, automatically inside `ensure-player-turn` | CPEE, after `check_turn` routes to the `computer_turn` state |
| Which coordinate does the computer attack? | Backend, via `pickRandomTarget` | **CPEE, via the `Strategy: Pick Target` Script block** |
| Applying the move | Backend (separate `playerMove` and `computerMove` functions) | Backend, via one neutral `_apply-move` handler |
| Hit/miss/sunk detection | Backend | Backend, unchanged |
| Game-over detection | Backend, returned in response | Backend, returned in response |
| Reading game state | Backend, via `/status` and friends | Backend, via `_view` and `_whose-turn` |
| State transitions | Implicit in v1's loop structure | Explicit `data.state` writes in CPEE Finalize blocks |

### What Intentionally Stayed on the Backend, and Why

Two responsibilities that could have moved to CPEE were kept on the backend deliberately.

**Hit/miss/sunk detection** stays in the backend's `applyAttack` function. Hit detection is plumbing — given a coordinate and a board, did it hit a ship? — not a rule anyone would want to swap. Implementing it as Ruby in CPEE would add code without adding architectural mobility.

**Game-over detection** stays in the backend, returned as `game_over` and `winner` fields on the `_apply-move` response. The rule "all ships sunk = game over" is fixed; it's not a strategy or a policy choice. CPEE reads the boolean and routes accordingly, but it doesn't recompute the condition.

The principle: the architectural mobility belongs at the points where the customization gap was named clearly (computer strategy) and at the points that make the process graph readable as a decision diagram (state transitions, turn routing). Other backend logic e.g., hit detection, win detection, ship placement, persistence, stays where it is, because making it swappable adds complexity without addressing the actual concerns.

### What's Still Open

This refactor addresses the named complaints. There is more architectural mobility achievable if desired — for example, the backend could be reduced to a key-value store with the entire game-rule layer moved into CPEE, more in line with mediator patterns where the backend has no domain knowledge. Whether that's worthwhile is a judgment call about how much process-level customization is wanted versus how much domain logic genuinely belongs server-side. The current submission is the version that addresses the specific feedback; further iteration is a conversation to have, not a change to make unilaterally.

## The CPEE Process

![CPEE Process Graph](screenshots/cpee_graph.png)

The graph shows the v2 process. The dominant structure is the state-routing Alternative inside the main loop — every named state branch is visible, each guarded by a `data.state == "..."` condition. The architectural change from v1 is visible at a glance: in v1, the loop body had three sequential blocks; in v2, the loop body is a state machine with eight branches.

### Top-level structure

```
Init Script
  ↓
Init Frame
  ↓
Parallel (Wait = 1, Cancel After Last Task)
├── Branch 1: Main Loop
│     while data.state != "game_over" && data.state != "timeout":
│       Alternative on data.state
│       ├── "init"               → Init State Recovery
│       ├── "choosing_mode"      → Choose the Mode (frame)
│       ├── "loading_game"       → Get Last Unfinished / Create New Game
│       ├── "check_turn"         → Check Whose Turn (service call)
│       ├── "player_turn"        → Player Board Frame (frame)
│       ├── "apply_player_move"  → Apply Player Move (service call)
│       ├── "computer_turn"      → Fetching Current Game State + Strategy: Pick Target
│       ├── "apply_computer_move"→ Apply Computer Move (service call)
│       └── otherwise            → Unknown State Recovery
│
└── Branch 2: Inactivity Heartbeat
      while Time.now.to_i - data.update < 90:
        Inactivity Check (powernap, duration=1)
      Set Timeout State
  ↓
End Frame
```

### Key blocks

**Strategy: Pick Target.** The architectural payoff. A Script block in the `computer_turn` state branch. Reads `data.board_state` (populated by the preceding `Fetching Current Game State` block), picks a coordinate, writes it to `data.chosen_coordinate`, and advances state to `apply_computer_move`. The currently implemented strategy is `random` — pick uniformly from untargeted cells. To swap strategies (for example, to a parity strategy that prefers cells where `(col + row) % 2 == 0`), edit the body of this one block in the CPEE cockpit. Nothing else changes.

**Check Whose Turn.** A service call that hits `_whose-turn`. Its Finalize reads the response and routes to `player_turn`, `computer_turn`, or `game_over`. This block is the pivot of the state machine — after every move, control returns here, and the routing decision is logged as a CPEE event.

**Apply Player Move and Apply Computer Move.** Two service calls, both targeting the same `_apply-move` endpoint with different `actor` parameters. Same response shape, same Finalize structure. The neutrality of the underlying endpoint is what makes this symmetry possible.

### Data variables

| Variable | Purpose |
|---|---|
| `data.state` | The state machine spine. Every Alternative branch routes on this. |
| `data.game_id` | The current game on the backend. |
| `data.mode` | `"new"` or `"continue"`, set from the choose-mode scan. |
| `data.found` | Whether `_get-last-unfinished` found a resumable game. |
| `data.player_move` | The coordinate the player just scanned. |
| `data.chosen_coordinate` | The coordinate the strategy block picked. |
| `data.actor` | `"player"` or `"computer"`, set before each `_apply-move` call. |
| `data.board_state` | The player's board, fetched before the strategy runs. |
| `data.game_over`, `data.winner` | Set from `_apply-move` and `_whose-turn` responses. |
| `data.update` | Unix timestamp of last user activity, polled by the heartbeat. |
| `data.last_update_raw` | Raw payload from the last block, for log readability. |

### Finalize templates

Two uniform templates are used across the process. Frame callbacks (board scans, choose-mode scans) come in as Ruby Hashes when the JSON event is sent through `send_new.php` with `Content-Type: application/json`. The template handles both Hash-already-parsed and string-needs-parsing cases:

```ruby
cmd = result.is_a?(Hash) ? result : (JSON.parse(result.to_s) rescue {})
event = cmd['action'] || ''
data.last_update_raw = result.to_s
data.update = Time.now.to_i
case event
when 'shoot'
  data.player_move = cmd['coordinate'] || ''
  data.actor = 'player'
  data.state = 'apply_player_move'
else
  data.state = 'player_turn'
end
```

Service call responses arrive auto-parsed by CPEE as Ruby Hashes:

```ruby
cmd = result.is_a?(Hash) ? result : {}
data.last_update_raw = result.to_s
data.last_apply_result = cmd
data.game_over = cmd['game_over'] || false
data.winner = cmd['winner']
if data.game_over
  data.state = 'game_over'
else
  data.state = 'check_turn'
end
```

The shape repetition is deliberate. Reading the cockpit, you see the same template across every block, and immediately understand: every event becomes a state transition.

## Project Structure

```
qr-battleship-v2/
├── README.md
├── cpee/
│   └── Hamze_Prak_BattleShip_V2_Final.bpmn   # Exported CPEE process
├── server/                                     # Node.js backend (port 3001)
│   ├── app.js
│   ├── package.json
│   ├── routes/
│   │   └── gameRoutes.js
│   ├── services/
│   │   ├── gameService.js
│   │   └── persistenceService.js
│   ├── utils/
│   │   ├── boardUtils.js
│   │   └── coordinateUtils.js
│   └── games/                                  # Persisted game JSON files
├── frontend/
│   ├── init_new.html
│   ├── choose_new.html
│   ├── board_new.html
│   ├── end_new.html
│   ├── api_new.php
│   ├── send_new.php
│   └── qrcode.min.js
└── screenshots/
    └── cpee_graph.png
```

## Tech Stack

- **CPEE** — process orchestration (cpee.org)
- **Node.js + Express** — backend service (port 3001)
- **PHP** — request proxy and QR callback bridge (Apache on the Lehre server)
- **HTML/JavaScript** — static frontend pages with QR code generation via `qrcode.min.js`

Identical to v1's stack. No new dependencies were introduced for the refactor.

## Local Setup & Run

```bash
cd server
npm install
node app.js
# Server starts on port 3001
```

Production deployment with auto-restart:

```bash
nohup bash -c 'while true; do node app.js; echo "Restarting..."; sleep 3; done' > server.log 2>&1 &
```

Smoke test with curl:

```bash
curl -X POST http://localhost:3001/game
curl "http://localhost:3001/game/_view?game_id=GAME_ID"
curl "http://localhost:3001/game/_apply-move?game_id=GAME_ID&actor=player&coordinate=A1"
curl "http://localhost:3001/game/_whose-turn?game_id=GAME_ID"
```

## REST API Reference

All endpoints accessed through the PHP proxy at `https://lehre.bpm.in.tum.de/~ga53muj/battleship/api_new.php`.

### Endpoints introduced in v2

#### `GET /game/_whose-turn?game_id=X`

Pure read. Returns whose turn it is and whether the game is over.

```json
{ "game_id": "57ee0ffa", "turn": "player", "status": "active", "game_over": false, "winner": null }
```

#### `GET /game/_apply-move?game_id=X&actor=player|computer&coordinate=B4`

Applies a move for either actor. One neutral handler. Validates that `actor` matches the current turn.

Parameters:
- `game_id` — the game ID
- `actor` — `"player"` or `"computer"`
- `coordinate` — target cell, e.g., `"B4"` (A–F, 1–6)

Success response:
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

Error responses (always include `game_over` and `winner`):
```json
{ "error": "wrong_turn", "game_over": false, "winner": null }
{ "error": "invalid_coordinate", "game_over": false, "winner": null }
{ "error": "already_targeted", "game_over": false, "winner": null }
{ "error": "game_not_found", "game_over": false, "winner": null }
{ "error": "game_over", "game_over": true, "winner": "player" }
```

#### `GET /game/_view?game_id=X`

Full game view. Hides enemy ship positions in the rendered grids; exposes both boards' `hits_received` and `misses_received` as iterable arrays of objects (the format change that makes Ruby iteration in CPEE clean).

```json
{
  "game_id": "57ee0ffa",
  "status": "active",
  "turn": "player",
  "game_over": false,
  "winner": null,
  "enemy_grid": [[null, "hit", "miss", null, null, null], ...],
  "player_grid": [[null, "ship", "hit", null, null, null], ...],
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

### Endpoints carried over from v1

#### `POST /game`

Creates a new game with random ship placement.

```json
{ "game_id": "57ee0ffa", "status": "active", "turn": "player", "game_over": false, "winner": null }
```

#### `GET /game/last-unfinished`

Returns the most recently created active game, or `{ found: false }`.

```json
{ "found": true, "game_id": "57ee0ffa" }
```

#### `GET /game/:id`

Raw game state dump for debugging. Exposes all ship positions; not used by the CPEE process or frontend.

### Endpoints removed in v2

| v1 Endpoint | Why Removed |
|---|---|
| `POST /game/:id/ensure-player-turn` | Split into `_whose-turn` and `_apply-move`. |
| `POST /game/:id/player-move` | Replaced by neutral `_apply-move`. |
| `GET /game/:id/player-move-debug` | Replaced by neutral `_apply-move`. |
| `POST /computer/:id/move` | No separate computer endpoint — `_apply-move` handles both actors. |
| `GET /game/:id/status` | Replaced by `_whose-turn`. |
| `GET /timeout/:seconds` | Timeout handling lives in CPEE's heartbeat branch (powernap polling), not as a backend endpoint. |

The removed endpoints have no replacements that bundle multiple concerns. Where a v2 caller needs more than one piece of information, it composes multiple narrow endpoint calls — which is exactly what makes the responsibility shift visible.

## Game Specifications

- 6×6 board, columns A–F, rows 1–6
- Three ships per side: Cruiser (size 3), Destroyer (size 2), Patrol (size 2)
- Random placement — no manual ship positioning
- Game state persisted as JSON files in `server/games/`

## Infrastructure Notes

### PHP Proxy

The Lehre server's firewall blocks direct access to Node.js ports. `api_new.php` is the Apache-served proxy that forwards requests to `localhost:3001`. The v1 proxy (`api.php` → port 3000) is separate and untouched, so both versions can run side by side.

### Frontend Pages

All v2 pages use a `_new` suffix to coexist with v1's original pages. Functionally they mirror v1 except for the JSON event payloads:

- `init_new.html` sends `{"action":"start"}`
- `choose_new.html` sends `{"action":"new"}` or `{"action":"continue"}`
- `board_new.html` sends `{"action":"shoot","coordinate":"B4"}` (TV landscape layout)
- `end_new.html` reads `?winner=` from the URL, no events
- `send_new.php` is the QR callback bridge — passes JSON payloads to CPEE unchanged with `Content-Type: application/json`

### Coexistence with v1

The v1 backend (`battleship-server` on port 3000), the v1 PHP proxy (`api.php`), and the v1 HTML pages remain in place and untouched. v2 was deliberately built as a parallel system rather than an in-place migration, so the two architectures can be compared directly.
