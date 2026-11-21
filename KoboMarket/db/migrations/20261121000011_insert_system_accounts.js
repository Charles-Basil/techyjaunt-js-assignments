// The platform's own accounts in the ledger.
//   PLATFORM_ESCROW          - holds buyer money until the order completes
//   PLATFORM_REVENUE         - commission the platform earns
//   PLATFORM_PAYOUT_CLEARING - money on its way out to vendor bank accounts
const SYSTEM_CODES = ['PLATFORM_ESCROW', 'PLATFORM_REVENUE', 'PLATFORM_PAYOUT_CLEARING'];

exports.up = (knex) =>
  knex('accounts')
    .insert(SYSTEM_CODES.map((code) => ({ owner_type: 'SYSTEM', owner_id: code, code })))
    .onConflict('code')
    .ignore(); // safe to run twice

// Fails (on purpose) if ledger entries already reference these accounts.
exports.down = (knex) => knex('accounts').whereIn('code', SYSTEM_CODES).del();
