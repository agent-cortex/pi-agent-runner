import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DATA_DIR = process.env.RUNNER_DATA_DIR || '/app/data';
const MANIFEST_DIR = path.join(DATA_DIR, 'systemd-manifests');
const SYSTEMD_DIR = process.env.SYSTEMD_DIR || '/etc/systemd/system';
const POLL_MS = Number(process.env.INSTALLER_POLL_MS || 15000);
const APPLY_SYSTEMD = String(process.env.APPLY_SYSTEMD || 'false').toLowerCase() === 'true';
const API_URL = process.env.API_URL || 'http://127.0.0.1:8787';
const INSTALLER_TOKEN = process.env.INSTALLER_TOKEN || '';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function timerForSchedule(schedule) {
  if (!schedule) throw new Error('schedule missing');

  if (schedule.everySeconds) {
    const sec = Number(schedule.everySeconds);
    if (!Number.isFinite(sec) || sec < 1) throw new Error('invalid everySeconds');
    return { kind: 'interval', onUnitActiveSec: `${Math.floor(sec)}s` };
  }

  if (schedule.runAt) {
    const dt = new Date(schedule.runAt);
    if (!Number.isFinite(dt.getTime())) throw new Error('invalid runAt');
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    const HH = String(dt.getUTCHours()).padStart(2, '0');
    const MM = String(dt.getUTCMinutes()).padStart(2, '0');
    const SS = String(dt.getUTCSeconds()).padStart(2, '0');
    return { kind: 'at', onCalendar: `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS} UTC` };
  }

  if (schedule.cron) {
    const parts = String(schedule.cron).trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('only 5-field cron is supported for systemd backend');

    const [min, hour, dom, mon, dow] = parts;
    const onlyStar = (v) => v === '*';
    const onlyNum = (v) => /^\d+$/.test(v);

    if (onlyNum(min) && onlyStar(hour) && onlyStar(dom) && onlyStar(mon) && onlyStar(dow)) {
      const m = Number(min);
      return { kind: 'cron', onCalendar: `*-*-* *:${String(m).padStart(2, '0')}:00` };
    }

    if (onlyNum(min) && onlyNum(hour) && onlyStar(dom) && onlyStar(mon) && onlyStar(dow)) {
      const m = Number(min);
      const h = Number(hour);
      return { kind: 'cron', onCalendar: `*-*-* ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00` };
    }

    if (onlyNum(min) && onlyNum(hour) && onlyStar(dom) && onlyStar(mon) && onlyNum(dow)) {
      const m = Number(min);
      const h = Number(hour);
      const d = Number(dow);
      if (d < 0 || d > 6) throw new Error('cron day-of-week must be 0..6');
      return { kind: 'cron', onCalendar: `${DOW[d]} *-*-* ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00` };
    }

    throw new Error('unsupported cron pattern for systemd backend (supported: M * * * * | M H * * * | M H * * D)');
  }

  throw new Error('schedule missing trigger (runAt/everySeconds/cron)');
}

function renderService(unitName, manifestId) {
  const tokenArg = INSTALLER_TOKEN ? ` -H "x-installer-token: ${INSTALLER_TOKEN}"` : '';
  return `[Unit]\nDescription=pi-agent-runner trigger ${manifestId}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/curl -fsS -X POST ${API_URL}/internal/systemd/trigger/${manifestId}${tokenArg}\n\n[Install]\nWantedBy=multi-user.target\n`;
}

function renderTimer(unitName, timerConfig, enabled) {
  const lines = [
    '[Unit]',
    `Description=Timer for ${unitName}`,
    '',
    '[Timer]',
    'Persistent=true',
  ];

  if (timerConfig.onCalendar) lines.push(`OnCalendar=${timerConfig.onCalendar}`);
  if (timerConfig.onUnitActiveSec) lines.push(`OnUnitActiveSec=${timerConfig.onUnitActiveSec}`);
  if (!enabled) lines.push('UnitInactiveSec=3650d');

  lines.push('', '[Install]', 'WantedBy=timers.target', '');
  return `${lines.join('\n')}\n`;
}

async function systemctl(...args) {
  if (!APPLY_SYSTEMD) return;
  await execFileAsync('systemctl', args);
}

async function loadManifests() {
  await fs.mkdir(MANIFEST_DIR, { recursive: true });
  const files = (await fs.readdir(MANIFEST_DIR)).filter((f) => f.endsWith('.json'));
  const manifests = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(MANIFEST_DIR, file), 'utf8');
      const parsed = JSON.parse(raw);
      manifests.push(parsed);
    } catch (err) {
      console.error('[installer] failed parsing manifest', file, err?.message || err);
    }
  }
  return manifests;
}

async function syncManifest(manifest) {
  const id = manifest.id;
  const unitName = `piar-${id}`;
  const servicePath = path.join(SYSTEMD_DIR, `${unitName}.service`);
  const timerPath = path.join(SYSTEMD_DIR, `${unitName}.timer`);

  const timerCfg = timerForSchedule(manifest.payload?.schedule);
  const enabled = manifest.enabled !== false;

  await fs.mkdir(SYSTEMD_DIR, { recursive: true });
  await fs.writeFile(servicePath, renderService(unitName, id));
  await fs.writeFile(timerPath, renderTimer(unitName, timerCfg, enabled));

  if (APPLY_SYSTEMD) {
    if (enabled) {
      await systemctl('enable', '--now', `${unitName}.timer`);
    } else {
      await systemctl('disable', '--now', `${unitName}.timer`).catch(() => {});
    }
  }

  console.log(`[installer] synced ${id} (${enabled ? 'enabled' : 'paused'})`);
}

async function pruneRemovedManifests(manifests) {
  await fs.mkdir(SYSTEMD_DIR, { recursive: true });
  const activeUnitNames = new Set(
    manifests
      .filter((m) => m?.schema === 'pi-agent-runner.systemd-manifest.v1' && m?.id)
      .map((m) => `piar-${m.id}`)
  );

  const files = await fs.readdir(SYSTEMD_DIR);
  const managed = files.filter((name) => /^piar-sysd-.*\.(service|timer)$/.test(name));

  for (const name of managed) {
    const unitName = name.replace(/\.(service|timer)$/, '');
    if (activeUnitNames.has(unitName)) continue;

    const service = `${unitName}.service`;
    const timer = `${unitName}.timer`;

    if (APPLY_SYSTEMD) {
      await systemctl('disable', '--now', timer).catch(() => {});
    }

    await fs.rm(path.join(SYSTEMD_DIR, service), { force: true }).catch(() => {});
    await fs.rm(path.join(SYSTEMD_DIR, timer), { force: true }).catch(() => {});
    console.log(`[installer] pruned stale units for ${unitName}`);
  }
}

async function runOnce() {
  const manifests = await loadManifests();

  if (APPLY_SYSTEMD) {
    await systemctl('daemon-reload').catch((err) => {
      console.error('[installer] daemon-reload failed (pre-sync):', err?.message || err);
    });
  }

  for (const manifest of manifests) {
    if (manifest?.schema !== 'pi-agent-runner.systemd-manifest.v1') continue;
    try {
      await syncManifest(manifest);
    } catch (err) {
      console.error(`[installer] sync failed ${manifest.id}:`, err?.message || err);
    }
  }

  await pruneRemovedManifests(manifests);

  if (APPLY_SYSTEMD) {
    await systemctl('daemon-reload').catch((err) => {
      console.error('[installer] daemon-reload failed (post-prune):', err?.message || err);
    });
  }
}

async function main() {
  console.log(`[installer] starting poll=${POLL_MS}ms apply=${APPLY_SYSTEMD} manifestDir=${MANIFEST_DIR} systemdDir=${SYSTEMD_DIR}`);
  await runOnce();
  setInterval(runOnce, POLL_MS);
}

main().catch((err) => {
  console.error('[installer] fatal', err);
  process.exit(1);
});
