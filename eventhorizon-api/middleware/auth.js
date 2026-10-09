const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Guards a route: only requests with a valid token from a verified user get through
module.exports = async (req, res, next) => {
  try {
    // The token arrives in the header as: Authorization: Bearer <token>
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const token = header.split(' ')[1];

    // verify() throws if the token is fake, edited, or expired
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }
    if (!user.isVerified) {
      return res.status(403).json({ message: 'Account not verified' });
    }

    req.user = user; // make the user available to the route
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};