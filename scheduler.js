/**
 * scheduler.js — Simplified scheduler for SurfAgent (reminders only)
 */

import cron from 'node-cron';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import crypto from 'crypto';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');

const activeJobs = new Map();

async function readJSON(file, fallback) {
  try {
    const data = await fs.readFile(file, 'utf-8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function writeJSON(file, data) {
  if (!existsSync(path.dirname(file))) mkdirSync(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function loadReminders() {
  return await readJSON(SCHEDULES_FILE, []);
}

async function saveReminders(reminders) {
  await writeJSON(SCHEDULES_FILE, reminders);
}

function scheduleReminder(reminder, sockRef) {
  if (activeJobs.has(reminder.id)) {
    activeJobs.get(reminder.id).stop();
  }

  if (!cron.validate(reminder.cron)) {
    console.error(`Invalid cron for reminder ${reminder.id}: ${reminder.cron}`);
    return false;
  }

  const job = cron.schedule(reminder.cron, async () => {
    try {
      const jid = reminder.chatJid || ADMIN_JID;
      await sockRef.sock.sendMessage(jid, { text: `Reminder: ${reminder.text}` });
      console.log(`Reminder ${reminder.id}: ${reminder.text}`);

      if (reminder.oneshot) {
        job.stop();
        activeJobs.delete(reminder.id);
        const reminders = await loadReminders();
        await saveReminders(reminders.filter(r => r.id !== reminder.id));
      }
    } catch (err) {
      console.error(`Reminder ${reminder.id} failed:`, err.message);
    }
  });

  activeJobs.set(reminder.id, job);
  return true;
}

export async function addReminder(chatJid, cronExpr, text, oneshot, sockRef) {
  if (!cron.validate(cronExpr)) return null;

  const id = crypto.randomBytes(4).toString('hex');
  const reminder = {
    id,
    cron: cronExpr,
    text,
    chatJid: chatJid || ADMIN_JID,
    oneshot: !!oneshot,
    createdAt: new Date().toISOString(),
  };

  const reminders = await loadReminders();
  reminders.push(reminder);
  await saveReminders(reminders);
  scheduleReminder(reminder, sockRef);

  return reminder;
}

export async function removeReminder(id) {
  if (activeJobs.has(id)) {
    activeJobs.get(id).stop();
    activeJobs.delete(id);
  }
  const reminders = await loadReminders();
  const filtered = reminders.filter(r => r.id !== id);
  if (filtered.length === reminders.length) return false;
  await saveReminders(filtered);
  return true;
}

export async function listReminders(chatJid) {
  const reminders = await loadReminders();
  if (chatJid) return reminders.filter(r => r.chatJid === chatJid);
  return reminders;
}

export async function startScheduler(sockRef) {
  console.log('Starting scheduler...');

  try {
    const reminders = await loadReminders();
    let loaded = 0;
    for (const r of reminders) {
      if (scheduleReminder(r, sockRef)) loaded++;
    }
    if (loaded > 0) console.log(`Restored ${loaded} reminder(s)`);
  } catch (err) {
    console.error('Failed to load reminders:', err.message);
  }

  console.log('Scheduler ready');
}
