const { v4: uuidv4 } = require('uuid');
const persistence = require('./persistenceService');
const { randomPlacement, applyAttack, maskedGrid, ownerGrid } = require('../utils/boardUtils');
const { parse, toLabel } = require('../utils/coordinateUtils');

function createGame() {
  const gameId = uuidv4().slice(0, 8);
  const p = randomPlacement(), c = randomPlacement();
  const state = {
    game_id: gameId, status: 'active', turn: 'player', winner: null,
    created_at: new Date().toISOString(),
    player_board: { grid: p.grid, ships: p.ships, hits_received: [], misses_received: [] },
    computer_board: { grid: c.grid, ships: c.ships, hits_received: [], misses_received: [] },
    history: [], last_player_move: null, last_computer_move: null,
  };
  persistence.saveGame(gameId, state);
  return { game_id: gameId, status: 'active', turn: 'player', game_over: false, winner: null };
}

function lastUnfinished() {
  const games = persistence.listGames();
  let latest = null, latestTime = 0;
  for (const id of games) {
    const s = persistence.loadGame(id);
    if (s && s.status === 'active') {
      const t = new Date(s.created_at).getTime() || 0;
      if (t > latestTime) { latestTime = t; latest = s.game_id; }
    }
  }
  return latest ? { found: true, game_id: latest } : { found: false, game_id: null };
}

function whoseTurn(gameId) {
  const s = persistence.loadGame(gameId);
  if (!s) return { error: 'game_not_found', game_over: false, winner: null };
  return { game_id: s.game_id, turn: s.turn, status: s.status, game_over: s.status === 'finished', winner: s.winner };
}

function getView(gameId) {
  const s = persistence.loadGame(gameId);
  if (!s) return null;
  return {
    game_id: s.game_id, status: s.status, turn: s.turn,
    game_over: s.status === 'finished', winner: s.winner,
    enemy_grid: maskedGrid(s.computer_board),
    player_grid: ownerGrid(s.player_board),
    player_board: {
      ships: s.player_board.ships.map(sh => ({ name: sh.name, size: sh.size, hits: sh.hits.length, sunk: sh.sunk })),
      hits_received: s.player_board.hits_received,
      misses_received: s.player_board.misses_received,
    },
    computer_board: {
      ships_sunk: s.computer_board.ships.filter(sh => sh.sunk).map(sh => ({ name: sh.name, size: sh.size })),
      hits_received: s.computer_board.hits_received,
      misses_received: s.computer_board.misses_received,
    },
    last_player_move: s.last_player_move,
    last_computer_move: s.last_computer_move,
  };
}

function applyMove(gameId, actor, coordinate) {
  const s = persistence.loadGame(gameId);
  if (!s) return { error: 'game_not_found', game_over: false, winner: null };
  if (s.status !== 'active') return { error: 'game_over', game_over: true, winner: s.winner };
  if (s.turn !== actor) return { error: 'wrong_turn', game_over: false, winner: null };

  const parsed = parse(coordinate);
  if (!parsed) return { error: 'invalid_coordinate', game_over: false, winner: null };
  const { col, row } = parsed;

  const targetBoard = (actor === 'player') ? s.computer_board : s.player_board;
  const attack = applyAttack(targetBoard, col, row);
  if (attack.result === 'already_targeted') return { error: 'already_targeted', game_over: false, winner: null };

  const moveRecord = { actor, coordinate: toLabel(col, row), result: attack.result, ship: attack.shipName, sunk: attack.sunk };
  s.history.push(moveRecord);
  if (actor === 'player') s.last_player_move = moveRecord; else s.last_computer_move = moveRecord;

  if (attack.allSunk) { s.status = 'finished'; s.winner = actor; }
  else { s.turn = (actor === 'player') ? 'computer' : 'player'; }

  persistence.saveGame(gameId, s);
  return {
    game_id: gameId, actor, coordinate: moveRecord.coordinate, result: attack.result,
    ship: attack.shipName, sunk: attack.sunk,
    game_over: s.status === 'finished', winner: s.winner, next_turn: s.turn,
  };
}

module.exports = { createGame, lastUnfinished, whoseTurn, getView, applyMove };
