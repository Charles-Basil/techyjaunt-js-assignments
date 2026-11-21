const vendorsService = require('./vendors.service');

async function apply(req, res) {
  const application = await vendorsService.apply(req.user._id, req.body);
  res.status(201).json({ success: true, data: { application } });
}

async function getPublicProfile(req, res) {
  const vendor = await vendorsService.getPublicProfile(req.params.id);
  res.json({ success: true, data: { vendor } });
}

async function decide(req, res) {
  const application = await vendorsService.decide(req.params.id, req.body, req.user._id);
  res.json({ success: true, data: { application } });
}

async function listApplications(req, res) {
  const { items, pagination } = await vendorsService.listApplications(req.validated.query);
  res.json({ success: true, data: items, pagination });
}

module.exports = { apply, getPublicProfile, decide, listApplications };
