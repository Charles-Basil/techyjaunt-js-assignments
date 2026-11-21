// Cursor ("keyset") pagination for MongoDB, used instead of skip().
//
// Why not skip? skip(10000) makes MongoDB walk past 10,000 documents, and if
// items are added/removed between page requests you get duplicates or gaps.
// With a cursor we remember WHERE the last page ended ({ sortValue, _id } of the
// last item) and ask for "items after that point".
//
// _id is the tie-breaker: many products can share a price, but never an _id,
// so (sortValue, _id) is a unique, stable position in the list.
const mongoose = require('mongoose');
const AppError = require('./AppError');

// { sortValue, _id } -> base64 text the client sends back as ?cursor=
function encodeCursor(sortValue, id) {
  const json = JSON.stringify({ sortValue, _id: String(id) });
  return Buffer.from(json, 'utf8').toString('base64url');
}

// Reverse of encodeCursor. `parseValue` turns the JSON value back into the right
// type (e.g. an ISO string back into a Date). Bad cursors are a client error.
function decodeCursor(cursor, parseValue = (v) => v) {
  try {
    const { sortValue, _id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!mongoose.isValidObjectId(_id) || sortValue === undefined) throw new Error('bad shape');
    const value = parseValue(sortValue);
    if (value === null || Number.isNaN(value) || (value instanceof Date && Number.isNaN(value.getTime()))) {
      throw new Error('bad value');
    }
    return { sortValue: value, id: new mongoose.Types.ObjectId(_id) };
  } catch {
    throw new AppError('INVALID_CURSOR', 'The cursor is invalid', 400);
  }
}

// Builds the "after the cursor" condition for a sort on `field` in `direction`
// (1 = ascending, -1 = descending). Example for price ascending, last item at
// price 5000 with _id X:
//   { $or: [ { priceKobo: { $gt: 5000 } }, { priceKobo: 5000, _id: { $gt: X } } ] }
// i.e. "a higher price, OR the same price but a later _id".
function afterCursorFilter(field, direction, { sortValue, id }) {
  const op = direction === 1 ? '$gt' : '$lt';
  return {
    $or: [{ [field]: { [op]: sortValue } }, { [field]: sortValue, _id: { [op]: id } }],
  };
}

// The matching sort: always sort by _id too, in the same direction.
function sortSpec(field, direction) {
  return { [field]: direction, _id: direction };
}

// We fetched limit + 1 docs. If we got the extra one, there is another page.
function buildPage(docs, limit, field) {
  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  const last = items[items.length - 1];
  const nextCursor = hasMore ? encodeCursor(last[field], last._id) : null;
  return { items, pagination: { nextCursor, hasMore, limit } };
}

// Converters for decodeCursor
const parseDate = (v) => (typeof v === 'string' ? new Date(v) : null);
const parseNumber = (v) => (typeof v === 'number' ? v : null);

module.exports = { encodeCursor, decodeCursor, afterCursorFilter, sortSpec, buildPage, parseDate, parseNumber };
