// Catches any error that wasn't handled elsewhere, so the server never crashes or leaks details
module.exports = (err, req, res, next) => {
  console.error(err);
  if (err.code === 11000) {
    return res.status(409).json({ message: 'Email already registered' });
  }
  res.status(500).json({ message: 'Something went wrong' });
};