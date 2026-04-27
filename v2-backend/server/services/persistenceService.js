const fs = require('fs');
const path = require('path');
const GAMES_DIR = path.join(__dirname, '..', 'games');
if (!fs.existsSync(GAMES_DIR)) fs.mkdirSync(GAMES_DIR, { recursive: true });
function gamePath(id) { return path.join(GAMES_DIR, id.replace(/[^a-zA-Z0-9\-]/g, '') + '.json'); }
function saveGame(id, state) { fs.writeFileSync(gamePath(id), JSON.stringify(state, null, 2), 'utf8'); }
function loadGame(id) { const p = gamePath(id); if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); }
function listGames() { return fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')); }
module.exports = { saveGame, loadGame, listGames };
