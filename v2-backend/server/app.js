const express = require('express');
const path = require('path');
const gameRoutes = require('./routes/gameRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/game', gameRoutes);

app.get('/', (req, res) => {
  res.json({
    service: 'Battleship New Backend', version: '2.0.0',
    endpoints: {
      'POST /game': 'Create new game',
      'GET /game/last-unfinished': 'Find most recent active game',
      'GET /game/_whose-turn?game_id=X': 'Whose turn is it',
      'GET /game/_view?game_id=X': 'Full game view',
      'GET /game/_apply-move?game_id=X&actor=Y&coordinate=Z': 'Apply a move',
      'GET /game/:id': 'Raw game state (debug)',
    },
  });
});

app.listen(PORT, () => { console.log('Battleship NEW server on http://localhost:' + PORT); });
