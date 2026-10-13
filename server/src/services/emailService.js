import nodemailer from 'nodemailer';
import { formatForEmail } from '../utils/dateTime.js';

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD;
const EMAIL_FROM = process.env.EMAIL_FROM || EMAIL_USER;

// Gmail is the default. The three SMTP_* values only exist so the reminder
// flow can be pointed at a different mail server during testing.
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const SMTP_SECURE = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : true;

let transporter = null;

function isConfigured() {
  return Boolean(EMAIL_USER && EMAIL_APP_PASSWORD);
}

/** Keeps credentials out of logs and API responses. */
function safeErrorMessage(error) {
  const message = error?.message || 'Unknown email error';
  if (!EMAIL_APP_PASSWORD) return message;
  return message.split(EMAIL_APP_PASSWORD).join('***');
}

function getTransporter() {
  if (!isConfigured()) {
    throw new Error(
      'Email is not configured. Set EMAIL_USER and EMAIL_APP_PASSWORD in your .env file.'
    );
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_APP_PASSWORD.replace(/\s+/g, ''),
      },
    });
  }

  return transporter;
}

function buildEmailBody(task) {
  const deadline = formatForEmail(task.deadline);
  const reminderAt = formatForEmail(task.reminderAt);
  const minutes = task.reminderMinutes;

  const text = [
    'Reminder: Your task is approaching its deadline.',
    '',
    `Task: ${task.title}`,
    `Description: ${task.description || '-'}`,
    `Deadline: ${deadline}`,
    `Reminder sent: ${reminderAt} (${minutes} minutes before the deadline)`,
    '',
    'This reminder was sent automatically by your To-Do app.',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #1f2933; line-height: 1.6;">
      <p style="font-size: 16px;">Reminder: Your task is approaching its deadline.</p>
      <table cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
        <tr>
          <td style="font-weight: bold;">Task</td>
          <td>${task.title}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">Description</td>
          <td>${task.description || '-'}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">Deadline</td>
          <td>${deadline}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">Reminder sent</td>
          <td>${reminderAt} (${minutes} minutes before the deadline)</td>
        </tr>
      </table>
      <p style="color: #616e7c; font-size: 13px;">
        This reminder was sent automatically by your To-Do app.
      </p>
    </div>
  `;

  return { text, html };
}

export async function sendReminderEmail(task) {
  const mail = getTransporter();
  const { text, html } = buildEmailBody(task);

  const info = await mail.sendMail({
    from: EMAIL_FROM,
    to: task.recipientEmail,
    subject: `Reminder: ${task.title}`,
    text,
    html,
  });

  console.log(`Reminder email sent for task #${task.id} to ${task.recipientEmail}`);
  return info;
}

export function describeEmailErrors(error) {
  return { code: error?.code || 'EMAIL_ERROR', message: safeErrorMessage(error) };
}

export { isConfigured as isEmailConfigured };
