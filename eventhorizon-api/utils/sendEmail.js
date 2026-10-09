const nodemailer = require('nodemailer');

// The "transporter" is the connection to the email service (Mailtrap here)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Sends the verification email. The token goes inside the link.
exports.sendVerificationEmail = async (to, token) => {
const link = `${process.env.API_URL}/api/auth/verify-email?token=${token}`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Verify your EventHorizon account',
    html: `
      <p>Welcome to EventHorizon!</p>
      <p>Click the link below to verify your email. It expires in 1 hour.</p>
      <p><a href="${link}">Verify my email</a></p>
    `,
  });
};