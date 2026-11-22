const disputesService = require('./disputes.service');

async function open(req, res) {
  const dispute = await disputesService.openDispute(req.user, req.params.id, req.body);
  res.status(201).json({ success: true, data: { dispute } });
}

async function list(req, res) {
  const { items, pagination } = await disputesService.listDisputes(req.validated.query);
  res.json({ success: true, data: items, pagination });
}

async function getOne(req, res) {
  const dispute = await disputesService.getDisputeForUser(req.user, req.params.id);
  res.json({ success: true, data: { dispute } });
}

async function resolve(req, res) {
  const dispute = await disputesService.resolveDispute(req.user, req.params.id, req.body);
  res.json({ success: true, data: { dispute } });
}

module.exports = { open, list, getOne, resolve };
