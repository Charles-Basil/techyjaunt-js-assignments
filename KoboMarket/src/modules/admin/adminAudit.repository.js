// admin_audit_log: append-only record of admin decisions. `db` may be a
// transaction, so the log row commits (or rolls back) together with the change.
const { knex } = require('../../config/knex');

function record(db, { adminId, action, targetType, targetId, before = null, after = null, note = null }) {
  return db('admin_audit_log').insert({
    admin_id: String(adminId),
    action,
    target_type: targetType,
    target_id: String(targetId),
    before: before === null ? null : JSON.stringify(before),
    after: after === null ? null : JSON.stringify(after),
    note,
  });
}

function list({ after, limit }) {
  return knex('admin_audit_log as l')
    .modify((q) => {
      if (after) q.whereRaw('(l.created_at, l.id) < (?::timestamptz, ?::uuid)', [after.sortValue, after.id]);
    })
    .orderBy([{ column: 'l.created_at', order: 'desc' }, { column: 'l.id', order: 'desc' }])
    .limit(limit)
    .select('l.*', knex.raw('l.created_at::text AS cursor_created_at'));
}

module.exports = { record, list };
