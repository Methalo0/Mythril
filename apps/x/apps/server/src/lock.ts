import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// One mythril-server per workdir, whoever hosts it (Electron main in the
// slice, the standalone entrypoint after the flip). Two hosts on one
// ~/.mythril double-run schedulers and split-brain the session index, so the
// lock is acquired by the transport itself — not by individual entrypoints —
// and a live holder is a hard error, never a silent fallback.

const LOCK_FILE = 'server.lock';

// process.kill(pid, 0) is unreliable on Windows — signalling a dead PID can
// succeed or throw EPERM (PID reuse / handle semantics), so a stale lock
// file would permanently brick startup. On Windows, ask the OS whether a
// process with this PID actually exists via tasklist instead.
async function isPidAlive(pid: number): Promise<boolean> {
  if (process.platform === 'win32') {
    try {
      const { execFile } = await import('node:child_process');
      const out = await new Promise<string>((resolve, reject) => {
        execFile('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], (err, stdout) => {
          if (err) reject(err); else resolve(stdout);
        });
      });
      return new RegExp(`^"${pid}"|,"${pid}",`, 'm').test(out);
    } catch {
      return false; // can't verify — treat as dead rather than bricking startup
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM'; // EPERM = exists, owned by someone else
  }
}

export async function acquireWorkdirLock(workDir: string): Promise<() => Promise<void>> {
  const lockPath = path.join(workDir, LOCK_FILE);
  try {
    const existing = parseInt(await fs.readFile(lockPath, 'utf8'), 10);
    if (Number.isFinite(existing) && existing !== process.pid && await isPidAlive(existing)) {
      throw new Error(
        `another mythril-server host (pid ${existing}) already owns ${workDir} — refusing to split-brain`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(lockPath, String(process.pid));
  return async () => {
    // Only remove our own claim (a crashed-then-restarted host may have
    // re-written it).
    try {
      const current = parseInt(await fs.readFile(lockPath, 'utf8'), 10);
      if (current === process.pid) await fs.rm(lockPath, { force: true });
    } catch {
      // already gone
    }
  };
}
