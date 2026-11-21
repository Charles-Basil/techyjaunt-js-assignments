// Controllers: read the (already validated) request, call the service, send the response.
// No business rules here.
const authService = require('./auth.service');

// Who is making the request; stored with each refresh token.
function requestContext(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

async function register(req, res) {
  const user = await authService.register(req.body);
  res.status(201).json({ success: true, data: { user } });
}

async function verifyEmail(req, res) {
  const user = await authService.verifyEmail(req.body.token);
  res.json({ success: true, data: { user } });
}

async function login(req, res) {
  const tokens = await authService.login(req.body, requestContext(req));
  res.json({ success: true, data: tokens });
}

async function refresh(req, res) {
  const tokens = await authService.refresh(req.body.refreshToken, requestContext(req));
  res.json({ success: true, data: tokens });
}

async function logout(req, res) {
  await authService.logout(req.body.refreshToken);
  res.json({ success: true, data: { message: 'Logged out' } });
}

async function forgotPassword(req, res) {
  await authService.forgotPassword(req.body.email);
  res.json({
    success: true,
    data: { message: 'If an account exists for this email, a reset link has been sent' },
  });
}

async function resetPassword(req, res) {
  await authService.resetPassword(req.body);
  res.json({ success: true, data: { message: 'Password has been reset. Please log in again.' } });
}

module.exports = { register, verifyEmail, login, refresh, logout, forgotPassword, resetPassword };
