import { promises as fs } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.RUNNER_DATA_DIR || '/app/data';
const STORE_DIR = path.join(DATA_DIR, 'api');
const STORE_PATH = path.join(STORE_DIR, 'schedules.json');

async function ensureStore() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.writeFile(STORE_PATH, JSON.stringify({ schedules: {} }, null, 2));
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  if (!parsed.schedules || typeof parsed.schedules !== 'object') {
    return { schedules: {} };
  }
  return parsed;
}

async function writeStore(store) {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

export async function putSchedule(id, value) {
  const store = await readStore();
  store.schedules[id] = value;
  await writeStore(store);
  return store.schedules[id];
}

export async function getSchedule(id) {
  const store = await readStore();
  return store.schedules[id] || null;
}

export async function listSchedules() {
  const store = await readStore();
  return Object.values(store.schedules);
}

export async function removeSchedule(id) {
  const store = await readStore();
  const existing = store.schedules[id] || null;
  if (existing) {
    delete store.schedules[id];
    await writeStore(store);
  }
  return existing;
}

export async function updateSchedule(id, patch) {
  const store = await readStore();
  const existing = store.schedules[id];
  if (!existing) return null;
  store.schedules[id] = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await writeStore(store);
  return store.schedules[id];
}
