/**
 * Regression test for #106: the uid in users.json, the account in /etc/passwd and the owner of
 * the home must agree, or every worker dies on EACCES.
 *
 * Needs root, useradd and runuser, so it runs inside the container - not on the host:
 *   podman exec <container> node --experimental-strip-types --experimental-transform-types \
 *     --no-warnings test/uid-consistency.ts
 */

import { promises as fs } from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { UserManager } from '../src/user-manager.ts';

const execFile = promisify(execFileCb);
const USERS_FILE = '/app/data/users.json';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function passwdUid(username: string): Promise<number> {
  const { stdout } = await execFile('id', ['-u', username]);
  return Number(stdout.trim());
}

async function homeOwner(username: string): Promise<number> {
  return (await fs.stat(`/home/${username}`)).uid;
}

async function main(): Promise<void> {
  console.log('=== uid consistency (#106) ===\n');
  assert(process.getuid?.() === 0, 'must run as root inside the container');

  const email = `uid.race.${Date.now()}@example.com`;

  {
    const manager = new UserManager();
    await manager.initialize();
    const results = await Promise.all(Array.from({ length: 5 }, () => manager.ensureUser(email)));
    const uids = new Set(results.map((r) => r.uid));
    const { username } = results[0];
    assert(uids.size === 1, `concurrent first requests got one uid, got ${[...uids].join(',')}`);
    assert(results[0].uid === await passwdUid(username), 'stored uid is the passwd uid');
    assert(await homeOwner(username) === results[0].uid, 'home belongs to the account');
    await execFile('runuser', ['-u', username, '--', 'mkdir', '-p', `/home/${username}/workspaces/probe`]);
    console.log('✓ concurrent first requests create one account with one uid');
  }

  const db = JSON.parse(await fs.readFile(USERS_FILE, 'utf-8'));
  const { username, uid } = db.users[email];

  {
    /* The state #106 left behind: home owned by a uid the account no longer has. */
    await execFile('chown', ['-R', `${uid + 500}:${uid + 500}`, `/home/${username}`]);
    const manager = new UserManager();
    await manager.initialize();
    await manager.restoreUsers();
    assert(await homeOwner(username) === uid, 'restore hands the home back to the account');
    console.log('✓ restore repairs a home owned by another uid');
  }

  {
    /* Mapping says one uid, passwd another - what concurrent requests used to store. */
    db.users[email].uid = uid + 700;
    await fs.writeFile(USERS_FILE, JSON.stringify(db, null, 2), 'utf-8');
    const manager = new UserManager();
    await manager.initialize();
    await manager.restoreUsers();
    const info = await manager.getUserInfo(email);
    assert(info?.uid === uid, `restore corrects the stored uid, got ${info?.uid}`);
    console.log('✓ restore corrects a stored uid that passwd does not have');
  }

  {
    /* Account gone (new image), home still on the volume but owned by a stale uid: useradd
     * leaves an existing home alone, so the recreated account must get it handed back. */
    await execFile('userdel', [username]);
    await execFile('chown', ['-R', `${uid + 900}:${uid + 900}`, `/home/${username}`]);
    const manager = new UserManager();
    await manager.initialize();
    const mapping = await manager.ensureUser(email);
    const actual = await passwdUid(username);
    assert(mapping.uid === actual, `mapping follows the recreated account (${mapping.uid} vs ${actual})`);
    assert(await homeOwner(username) === actual, 'home follows the recreated account');
    await execFile('runuser', ['-u', username, '--', 'touch', `/home/${username}/workspaces/probe/ok`]);
    console.log('✓ a recreated account gets its stale home back');
  }

  console.log('\nAll uid consistency checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
