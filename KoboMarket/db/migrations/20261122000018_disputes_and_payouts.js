// Block 6: disputes and vendor payouts. Additive only (older migrations stay untouched).
exports.up = async (knex) => {
  // ---------- payouts ----------
  await knex.schema.alterTable('payouts', (t) => {
    // What the bank details looked like when the payout was requested. The
    // account number is MASKED here: the full number stays only in the vendor profile.
    t.jsonb('bank_snapshot').nullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.text('last_error').nullable();
    t.timestamp('processed_at', { useTz: true }).nullable();

    t.check('attempts >= 0', [], 'payouts_attempts_non_negative');
    // A finished payout (SUCCESS or FAILED) always records when it finished.
    t.check("status NOT IN ('SUCCESS', 'FAILED') OR processed_at IS NOT NULL", [], 'payouts_finished_has_processed_at');
    // Vendor's list (newest first) and the job's queue (oldest PENDING first).
    t.index(['vendor_id', 'created_at', 'id'], 'payouts_vendor_list_index');
    t.index(['status', 'created_at'], 'payouts_status_queue_index');
  });

  // ---------- disputes ----------
  await knex.schema.alterTable('disputes', (t) => {
    // OPEN = no resolution yet; RESOLVED = resolution, who and when are all set.
    t.check(
      `(status = 'OPEN' AND resolution IS NULL AND resolved_at IS NULL)
       OR (status = 'RESOLVED' AND resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)`,
      [],
      'disputes_resolution_matches_status'
    );
    // Refund amounts only for refunds; a REJECTED dispute refunds nothing.
    t.check(
      "(resolution IN ('FULL_REFUND', 'PARTIAL_REFUND')) = (refund_kobo IS NOT NULL) OR resolution IS NULL",
      [],
      'disputes_refund_matches_resolution'
    );
    t.index(['status', 'created_at', 'id'], 'disputes_admin_list_index');
    t.index(['sub_order_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('disputes', (t) => {
    t.dropIndex(['sub_order_id']);
    t.dropIndex(['status', 'created_at', 'id'], 'disputes_admin_list_index');
    t.dropChecks(['disputes_resolution_matches_status', 'disputes_refund_matches_resolution']);
  });
  await knex.schema.alterTable('payouts', (t) => {
    t.dropIndex(['status', 'created_at'], 'payouts_status_queue_index');
    t.dropIndex(['vendor_id', 'created_at', 'id'], 'payouts_vendor_list_index');
    t.dropChecks(['payouts_attempts_non_negative', 'payouts_finished_has_processed_at']);
    t.dropColumn('bank_snapshot');
    t.dropColumn('attempts');
    t.dropColumn('last_error');
    t.dropColumn('processed_at');
  });
};
