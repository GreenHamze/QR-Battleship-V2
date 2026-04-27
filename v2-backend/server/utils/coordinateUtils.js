const COLS = 'ABCDEF';
const ROWS = 6;
function parse(coord) {
  if (typeof coord !== 'string') return null;
  const c = coord.trim().toUpperCase();
  if (c.length < 2 || c.length > 2) return null;
  const col = COLS.indexOf(c[0]);
  if (col === -1) return null;
  const row = parseInt(c.slice(1), 10);
  if (isNaN(row) || row < 1 || row > ROWS) return null;
  return { col, row: row - 1 };
}
function toLabel(col, row) { return COLS[col] + (row + 1); }
function allCoordinates() {
  const coords = [];
  for (let c = 0; c < COLS.length; c++) for (let r = 0; r < ROWS; r++) coords.push(toLabel(c, r));
  return coords;
}
module.exports = { COLS, ROWS, parse, toLabel, allCoordinates };
