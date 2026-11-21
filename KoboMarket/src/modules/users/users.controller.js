const usersService = require('./users.service');

async function getMe(req, res) {
  const user = await usersService.getMe(req.user._id);
  res.json({ success: true, data: { user } });
}

async function updateMe(req, res) {
  const user = await usersService.updateMe(req.user._id, req.body);
  res.json({ success: true, data: { user } });
}

module.exports = { getMe, updateMe };
