const nodemailer = require("nodemailer");
const config = require("../config");
const { renderTemplate } = require("./templateService");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    requireTLS: true,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });

  return transporter;
}

async function sendEmail({ to, subject, html, text, cc, bcc, replyTo }) {
  const transport = getTransporter();

  const mailOptions = {
    from: `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`,
    to,
    subject,
    html,
    text,
    cc,
    bcc,
    replyTo,
  };

  const info = await transport.sendMail(mailOptions);

  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
  };
}

async function sendTemplatedEmail({ to, template, data, cc, bcc, replyTo }) {
  const { subject, html, text } = renderTemplate(template, data);

  return sendEmail({ to, subject, html, text, cc, bcc, replyTo });
}

async function sendBatchEmails(emails) {
  const results = [];

  for (const email of emails) {
    try {
      const result = await sendEmail(email);
      results.push({ to: email.to, success: true, ...result });
    } catch (error) {
      results.push({ to: email.to, success: false, error: error.message });
    }
  }

  return results;
}

async function verifyConnection() {
  const transport = getTransporter();
  return transport.verify();
}

module.exports = {
  sendEmail,
  sendTemplatedEmail,
  sendBatchEmails,
  verifyConnection,
};
