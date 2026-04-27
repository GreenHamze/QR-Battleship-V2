const express = require('express');
const router = express.Router();
const gs = require('../services/gameService');

router.post('/', (req, res) => {
  try { res.status(201).json(gs.createGame()); }
  catch (e) { res.status(500).json({ error: e.message, game_over: false, winner: null }); }
});

router.get('/last-unfinished', (req, res) => { res.json(gs.lastUnfinished()); });

router.get('/_whose-turn', (req, res) => {
  var id = req.query.game_id;
  if (!id) return res.status(400).json({ error: 'missing_game_id', game_over: false, winner: null });
  var r = gs.whoseTurn(id);
  if (r.error) return res.status(404).json(r);
  res.json(r);
});

router.get('/_view', (req, res) => {
  var id = req.query.game_id;
  if (!id) return res.status(400).json({ error: 'missing_game_id', game_over: false, winner: null });
  var v = gs.getView(id);
  if (!v) return res.status(404).json({ error: 'game_not_found', game_over: false, winner: null });
  res.json(v);
});

router.get('/_apply-move', (req, res) => {
  var id = req.query.game_id;
  var actor = req.query.actor;
  var coordinate = req.query.coordinate;
  if (!id) return res.status(400).json({ error: 'missing_game_id', game_over: false, winner: null });
  if (!actor || !['player','computer'].includes(actor)) return res.status(400).json({ error: 'invalid_actor', game_over: false, winner: null });
  if (!coordinate) return res.status(400).json({ error: 'missing_coordinate', game_over: false, winner: null });
  var r = gs.applyMove(id, actor, coordinate);
  if (r.error) {
    var code = r.error === 'game_not_found' ? 404 : 400;
    return res.status(code).json(r);
  }
  res.json(r);
});

router.get('/:id', (req, res) => {
  var s = require('../services/persistenceService').loadGame(req.params.id);
  if (!s) return res.status(404).json({ error: 'game_not_found', game_over: false, winner: null });
  res.json(s);
});

module.exports = router;
