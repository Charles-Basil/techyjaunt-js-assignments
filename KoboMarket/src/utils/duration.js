// Converts "30s", "15m", "24h", "7d" into milliseconds.
// (env.js already checks the format, so bad input here is a programming error.)
const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

function durationToMs(value) {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  return Number(match[1]) * UNIT_MS[match[2]];
}

module.exports = { durationToMs };
