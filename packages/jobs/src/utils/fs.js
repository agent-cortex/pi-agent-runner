import fs from 'node:fs/promises';

export async function ensureDir(path) {
  await fs.mkdir(path, { recursive: true });
}

export async function writeText(path, content) {
  await fs.writeFile(path, content, 'utf8');
}
