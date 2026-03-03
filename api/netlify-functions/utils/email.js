// ===========================================
// POSTMARK EMAIL UTILITY
// ===========================================

const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

async function sendEmail({ to, subject, htmlBody, textBody }) {
  const apiKey = process.env.POSTMARK_SERVER_TOKEN;
	const fromEmail = process.env.FROM_EMAIL || 'agha.zahid@patienttrac.com';

  if (!apiKey) {
    console.error('POSTMARK_SERVER_TOKEN is not set');
    throw new Error('Email service not configured');
  }

  const payload = {
    From: fromEmail,
    To: to,
    Subject: subject,
    HtmlBody: htmlBody,
    TextBody: textBody || subject,
    MessageStream: 'outbound'
  };

  const response = await fetch(POSTMARK_API_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': apiKey
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
	console.error('Postmark status:', response.status);
	console.error('Postmark raw response:', await response.text());
    throw new Error('Failed to send email: ' + (err.Message || response.statusText));
  }

  return await response.json();
}

function buildTempPasswordEmail(fullName, tempPassword) {
  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a2e; color: #e0e0e0; padding: 40px; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #c9a84c; margin: 0; font-size: 28px;">AegisIQ</h1>
        <p style="color: #888; font-size: 14px; margin-top: 5px;">Stock Ledger Platform</p>
      </div>
      <h2 style="color: #fff; font-size: 20px;">Welcome, ${fullName}!</h2>
      <p style="color: #ccc; line-height: 1.6;">Your account has been created successfully. Here is your temporary password:</p>
      <div style="background: #2a2a4a; border: 1px solid #c9a84c; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
        <span style="font-size: 24px; font-weight: 700; color: #c9a84c; letter-spacing: 2px;">${tempPassword}</span>
      </div>
      <p style="color: #ccc; line-height: 1.6;">Please log in with this temporary password and change it as soon as possible for security.</p>
      <hr style="border: none; border-top: 1px solid #333; margin: 30px 0;">
      <p style="color: #888; font-size: 12px; text-align: center;">This is an automated message from AegisIQ. Please do not reply.</p>
    </div>
  `;
  return { subject: 'Welcome to AegisIQ – Your Temporary Password', htmlBody: html, textBody: `Welcome ${fullName}! Your temporary password is: ${tempPassword}` };
}

function buildForgotPasswordEmail(fullName, tempPassword) {
  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a2e; color: #e0e0e0; padding: 40px; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #c9a84c; margin: 0; font-size: 28px;">AegisIQ</h1>
        <p style="color: #888; font-size: 14px; margin-top: 5px;">Stock Ledger Platform</p>
      </div>
      <h2 style="color: #fff; font-size: 20px;">Password Reset</h2>
      <p style="color: #ccc; line-height: 1.6;">Hi ${fullName}, we received a password reset request for your account. Here is your new temporary password:</p>
      <div style="background: #2a2a4a; border: 1px solid #c9a84c; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
        <span style="font-size: 24px; font-weight: 700; color: #c9a84c; letter-spacing: 2px;">${tempPassword}</span>
      </div>
      <p style="color: #ccc; line-height: 1.6;">Please log in with this password and change it immediately. If you did not request this reset, contact support.</p>
      <hr style="border: none; border-top: 1px solid #333; margin: 30px 0;">
      <p style="color: #888; font-size: 12px; text-align: center;">This is an automated message from AegisIQ. Please do not reply.</p>
    </div>
  `;
  return { subject: 'AegisIQ – Password Reset', htmlBody: html, textBody: `Hi ${fullName}, your new temporary password is: ${tempPassword}` };
}

function generateTempPassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

module.exports = { sendEmail, buildTempPasswordEmail, buildForgotPasswordEmail, generateTempPassword };
