// Returns the logged-in user's details (req.user was set by the auth middleware)
exports.getProfile = (req, res) => {
  const { _id, name, email, isVerified, createdAt } = req.user;
  res.json({ user: { id: _id, name, email, isVerified, createdAt } });
};