import { readFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

const file = process.argv[2];

if (!file) {
  console.log("Usage: npm run send -- <report-file>");
  process.exit(1);
}

const requiredEnv = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
const missing = requiredEnv.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing email environment variables: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env, fill it in, then export the variables before sending.");
  process.exit(1);
}

const reportPath = path.resolve(file);
const report = await readFile(reportPath, "utf8");
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const to = process.env.REPORT_TO || "vitinchen@gmail.com";
const from = process.env.REPORT_FROM || process.env.SMTP_USER;

await transporter.sendMail({
  from,
  to,
  subject: process.env.REPORT_SUBJECT || "本周 AI 资讯周报",
  text: report,
  attachments: [
    {
      filename: path.basename(reportPath),
      path: reportPath
    }
  ]
});

console.log(`Report sent to ${to}`);
