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
    // Opciones de pool y timeouts para robustez
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  return transporter;
}

async function sendEmailDirect({ to, subject, html, text, cc, bcc, replyTo }) {
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

async function sendTemplatedEmailDirect({ to, template, data, cc, bcc, replyTo }) {
  const { subject, html, text } = renderTemplate(template, data);
  return sendEmailDirect({ to, subject, html, text, cc, bcc, replyTo });
}

async function sendBatchEmailsDirect(emails) {
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const results = [];
  const BATCH_CONCURRENCY = 5;

  for (let i = 0; i < emails.length; i += BATCH_CONCURRENCY) {
    const chunk = emails.slice(i, i + BATCH_CONCURRENCY);
    const chunkPromises = chunk.map(async (email) => {
      try {
        const result = await sendEmailDirect(email);
        return { to: email.to, success: true, ...result };
      } catch (error) {
        return { to: email.to, success: false, error: error.message };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  return results;
}

async function verifyConnection() {
  const transport = getTransporter();
  return transport.verify();
}

module.exports = {
  sendEmail: sendEmailDirect,
  sendTemplatedEmail: sendTemplatedEmailDirect,
  sendBatchEmails: sendBatchEmailsDirect,
  sendEmailDirect,
  sendTemplatedEmailDirect,
  sendBatchEmailsDirect,
  verifyConnection,
};
