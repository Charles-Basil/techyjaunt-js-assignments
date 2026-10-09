const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendVerificationEmail } = require('../utils/sendEmail');

// Turns a token into a fixed scrambled string (one-way, can't be reversed)
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// ---------- REGISTER ----------
exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    // 1. Reject duplicate emails (409 = conflict)
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // 2. Hash the password. The 12 is how much work bcrypt does: higher = safer but slower
    const hashedPassword = await bcrypt.hash(password, 12);

    // 3. Make a random token. The raw one goes in the email, only its hash is stored
    const rawToken = crypto.randomBytes(32).toString('hex');

    // 4. Save the user, token valid for 1 hour
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      verificationTokenHash: hashToken(rawToken),
      verificationTokenExpires: Date.now() + 60 * 60 * 1000,
    });

    // 5. Email the link containing the raw token
    await sendVerificationEmail(user.email, rawToken);

    res.status(201).json({ message: 'Registered. Check your email to verify your account.' });
  } catch (err) {
    next(err); // hands any unexpected error to the error handler
  }
};

// ---------- VERIFY EMAIL ----------
exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.query; // the ?token=... part of the URL

    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    // Match the hash AND make sure it hasn't expired ($gt = greater than now)
    const user = await User.findOne({
      verificationTokenHash: hashToken(token),
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    user.isVerified = true;
    user.verificationTokenHash = undefined; // single use: remove it
    user.verificationTokenExpires = undefined;
    await user.save();

    res.json({ message: 'Email verified. You can now log in.' });
  } catch (err) {
    next(err);
  }
};

// ---------- LOGIN ----------
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // select('+password') brings back the password field we hid in the model
    const user = await User.findOne({ email }).select('+password');

    // Same message whether the email or the password is wrong
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Only verified users may log in (403 = forbidden)
    if (!user.isVerified) {
      return res.status(403).json({ message: 'Please verify your email before logging in' });
    }

    // Sign a JWT containing the user's id; it expires after JWT_EXPIRES_IN
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });

    res.json({ message: 'Login successful', token });
  } catch (err) {
    next(err);
  }
};