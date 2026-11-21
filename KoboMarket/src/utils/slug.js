const crypto = require('crypto');

// "Ada's Shoes & Bags!" -> "adas-shoes-bags"
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD') // split accented letters: "é" -> "e" + accent
    .replace(/[̀-ͯ]/g, '') // drop the accents
    .replace(/[^a-z0-9]+/g, '-') // anything else becomes a dash
    .replace(/^-+|-+$/g, '') // no dashes at the start/end
    .slice(0, 60) || 'item';
}

// "Red Sneakers" -> "red-sneakers-4f9a1c" (6 random hex chars make clashes very unlikely)
function slugWithSuffix(text) {
  return `${slugify(text)}-${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = { slugify, slugWithSuffix };
