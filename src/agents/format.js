const MINUS = '−';
function money(v, signed) {
  const a = Math.abs(v), s = v < 0 ? MINUS : (signed ? '+' : '');
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + '$' + Math.round(a / 1e3).toLocaleString('en-US') + 'K';
  return s + '$' + Math.round(a);
}
const pct = (v, dp = 1) => (v * 100).toFixed(dp) + '%';
module.exports = { money, pct };
