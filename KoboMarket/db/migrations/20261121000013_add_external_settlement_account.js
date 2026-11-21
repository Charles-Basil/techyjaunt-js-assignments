exports.up = (knex) =>
  knex('accounts')
    .insert({
      owner_type: 'SYSTEM',
      owner_id: 'PLATFORM_EXTERNAL_SETTLEMENT',
      code: 'PLATFORM_EXTERNAL_SETTLEMENT',
    })
    .onConflict('code')
    .ignore();

exports.down = (knex) =>
  knex('accounts').where({ code: 'PLATFORM_EXTERNAL_SETTLEMENT' }).del();
