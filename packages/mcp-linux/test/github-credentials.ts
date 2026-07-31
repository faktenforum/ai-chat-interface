/**
 * Credential-switching test for the per-user GitHub token.
 *
 * Needs root, useradd and runuser, so it runs inside the container - not on the host:
 *   podman exec -e MCP_GITHUB_PAT=shared-token -e GIT_SSH_KEY=$(printf fake-key | base64 -w0) \
 *     <container> node --experimental-strip-types --experimental-transform-types --no-warnings \
 *     test/github-credentials.ts
 *
 * The GitHub API is not reachable with the fake tokens used here, so identity resolution is
 * expected to fail; what is asserted is the file and config state around it.
 */

import { promises as fs } from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { UserManager } from '../src/user-manager.ts';

const execFile = promisify(execFileCb);
const TEST_EMAIL = 'credential.test@example.com';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function gitConfigValues(username: string, key: string): Promise<string[]> {
  try {
    const { stdout } = await execFile('runuser', [
      '-u',
      username,
      '--',
      'git',
      'config',
      '--global',
      '--get-all',
      key,
    ]);
    return stdout.trim().split('\n').filter((line) => line !== '');
  } catch {
    return [];
  }
}

async function gitConfigValue(username: string, key: string): Promise<string | null> {
  const values = await gitConfigValues(username, key);
  return values.length > 0 ? values[values.length - 1] : null;
}

async function main(): Promise<void> {
  console.log('=== per-user GitHub credentials ===\n');
  assert(process.getuid?.() === 0, 'must run as root inside the container');
  assert(!!process.env.MCP_GITHUB_PAT, 'MCP_GITHUB_PAT must be set to test the shared default');
  assert(
    !!(process.env.GIT_SSH_KEY || process.env.MCP_LINUX_GIT_SSH_KEY),
    'GIT_SSH_KEY must be set (any base64 value) to test the ssh setup',
  );

  const userManager = new UserManager();
  await userManager.initialize();

  const { username } = await userManager.ensureUser(TEST_EMAIL);
  const home = `/home/${username}`;
  console.log(`user: ${username}`);

  {
    const hosts = await readFileOrNull(`${home}/.config/gh/hosts.yml`);
    assert(hosts?.includes(`oauth_token: ${process.env.MCP_GITHUB_PAT}`) === true, 'shared token written');
    assert(hosts?.includes('git_protocol: ssh') === true, 'shared account uses ssh');
    assert((await readFileOrNull(`${home}/.git-credentials`)) === null, 'no https credentials yet');
    assert((await gitConfigValue(username, 'faktenforum.ownCredentials')) === null, 'no marker yet');
    console.log('✓ starts on the shared bot account over ssh');
  }

  {
    /* ~/.config is created on the way to gh/, so it has to end up the user's - otherwise no other
     * tool they install can put its config there. */
    const { uid } = await fs.stat(`${home}/.config`);
    const { stdout } = await execFile('id', ['-u', username]);
    assert(
      uid === Number(stdout.trim()),
      `~/.config must belong to ${username}, owner uid is ${uid}`,
    );
    await execFile('runuser', ['-u', username, '--', 'mkdir', '-p', `${home}/.config/probe-writable`]);
    console.log('✓ the user owns ~/.config and can add their own config dirs');
  }

  {
    const sshConfig = await readFileOrNull(`${home}/.ssh/config`);
    const knownHosts = await readFileOrNull(`${home}/.ssh/known_hosts_github`);
    assert(sshConfig?.includes('StrictHostKeyChecking yes') === true, 'host key checking is strict');
    assert(sshConfig?.includes('UserKnownHostsFile /dev/null') !== true, 'known hosts is a real file');
    assert(
      sshConfig?.includes(`UserKnownHostsFile ${home}/.ssh/known_hosts_github`) === true,
      'the config points at the shipped known_hosts',
    );
    assert(knownHosts?.includes('github.com ssh-ed25519 ') === true, 'ed25519 host key present');
    assert(knownHosts?.includes('github.com ssh-rsa ') === true, 'rsa host key present');
    assert(knownHosts?.includes('github.com ecdsa-sha2-nistp256 ') === true, 'ecdsa host key present');
    console.log('✓ github.com is verified against the shipped host keys');
  }

  {
    const missing = userManager.describeGitHubCredentials('nobody.configured@example.com');
    assert(missing.tokenSource === 'shared', 'falls back to the shared token when set');
    const shared = process.env.MCP_GITHUB_PAT;
    delete process.env.MCP_GITHUB_PAT;
    try {
      const none = userManager.describeGitHubCredentials('nobody.configured@example.com');
      assert(none.tokenSource === 'none', 'reports no token when there is none');
      assert(
        none.message.includes('GITHUB_PAT in the Linux Workspace server settings in LibreChat'),
        `the message names the setting, got: ${none.message}`,
      );
      assert(
        none.message.includes('Never ask the user to paste a token into the chat.'),
        'the message keeps tokens out of the chat',
      );
    } finally {
      process.env.MCP_GITHUB_PAT = shared;
    }
    console.log('✓ a missing token is reported as such, naming the setting that fixes it');
  }

  await userManager.setUserGitHubPat(TEST_EMAIL, 'ghp_ownuser_token');

  {
    const hosts = await readFileOrNull(`${home}/.config/gh/hosts.yml`);
    assert(hosts?.includes('oauth_token: ghp_ownuser_token') === true, 'own token written to gh');
    assert(hosts?.includes('git_protocol: https') === true, 'own token uses https');

    const credentials = await readFileOrNull(`${home}/.git-credentials`);
    assert(
      credentials?.includes('https://x-access-token:ghp_ownuser_token@github.com') === true,
      'own token stored as an https credential',
    );
    const { mode } = await fs.stat(`${home}/.git-credentials`);
    assert((mode & 0o777) === 0o600, `credentials file must be 0600, got ${(mode & 0o777).toString(8)}`);

    assert((await gitConfigValue(username, 'credential.helper')) === 'store', 'helper configured');
    const rewrites = await gitConfigValues(username, 'url.https://github.com/.insteadOf');
    assert(
      rewrites.includes('git@github.com:') && rewrites.includes('ssh://git@github.com/'),
      `both ssh url forms rewritten to https, got ${JSON.stringify(rewrites)}`,
    );
    assert((await gitConfigValue(username, 'faktenforum.ownCredentials')) === 'true', 'marker set');
    console.log('✓ own token replaces the bot: https credential, url rewrite, marker');
  }

  {
    const before = await fs.stat(`${home}/.config/gh/hosts.yml`);
    await userManager.setUserGitHubPat(TEST_EMAIL, 'ghp_ownuser_token');
    const after = await fs.stat(`${home}/.config/gh/hosts.yml`);
    assert(before.mtimeMs === after.mtimeMs, 'unchanged token must not rewrite anything');
    console.log('✓ repeating the same token writes nothing');
  }

  await userManager.setUserGitHubPat(TEST_EMAIL, null);

  {
    const hosts = await readFileOrNull(`${home}/.config/gh/hosts.yml`);
    assert(hosts?.includes(`oauth_token: ${process.env.MCP_GITHUB_PAT}`) === true, 'back to shared token');
    assert(hosts?.includes('git_protocol: ssh') === true, 'back to ssh');
    assert((await readFileOrNull(`${home}/.git-credentials`)) === null, 'https credential removed');
    assert((await gitConfigValue(username, 'credential.helper')) === null, 'helper removed');
    assert(
      (await gitConfigValues(username, 'url.https://github.com/.insteadOf')).length === 0,
      'url rewrites removed',
    );
    assert((await gitConfigValue(username, 'faktenforum.ownCredentials')) === null, 'marker removed');
    console.log('✓ removing the token reverts to the shared bot account');
  }

  {
    /* Production order: the header arrives before any tool call has created the account, so the
     * token is only recorded here and has to be applied as part of user setup. */
    const newEmail = 'first.request@example.com';
    await userManager.setUserGitHubPat(newEmail, 'ghp_before_account');
    const { username: newUsername } = await userManager.ensureUser(newEmail);
    const hosts = await readFileOrNull(`/home/${newUsername}/.config/gh/hosts.yml`);
    assert(hosts?.includes('oauth_token: ghp_before_account') === true, 'token applied at setup');
    assert(hosts?.includes('git_protocol: https') === true, 'setup used https for the own token');
    assert(
      (await gitConfigValue(newUsername, 'faktenforum.ownCredentials')) === 'true',
      'marker set at setup',
    );
    console.log('✓ a token seen before the account exists is applied when it is created');
  }

  {
    /* A revoked token must go even when no shared token exists to fall back to, or git would keep
     * using the credential the user just removed. */
    const email = 'revoked.without.fallback@example.com';
    const shared = process.env.MCP_GITHUB_PAT;
    delete process.env.MCP_GITHUB_PAT;
    try {
      await userManager.setUserGitHubPat(email, 'ghp_soon_revoked');
      const { username: revokeUsername } = await userManager.ensureUser(email);
      assert(
        (await readFileOrNull(`/home/${revokeUsername}/.git-credentials`)) !== null,
        'own token applied without a shared fallback',
      );

      await userManager.setUserGitHubPat(email, null);
      assert(
        (await readFileOrNull(`/home/${revokeUsername}/.git-credentials`)) === null,
        'revoked token removed without a shared fallback',
      );
      assert(
        (await gitConfigValue(revokeUsername, 'faktenforum.ownCredentials')) === null,
        'marker removed without a shared fallback',
      );
    } finally {
      process.env.MCP_GITHUB_PAT = shared;
    }
    console.log('✓ revoking a token clears it even with no shared token to fall back to');
  }

  {
    /* A restart must leave a user who configured their own token alone: startup has no token to
     * apply, so anything it wrote would be the shared bot one, over their configuration. */
    const email = 'survives.restart@example.com';
    await userManager.setUserGitHubPat(email, 'ghp_own_before_restart');
    const { username: restartUsername } = await userManager.ensureUser(email);
    assert(
      (await gitConfigValue(restartUsername, 'faktenforum.ownCredentials')) === 'true',
      'own token applied before the restart',
    );

    /* The restart itself: new process, empty in-memory token map, same home on the volume. */
    const afterRestart = new UserManager();
    await afterRestart.initialize();
    await afterRestart.restoreUsers();

    const hosts = await readFileOrNull(`/home/${restartUsername}/.config/gh/hosts.yml`);
    assert(
      hosts?.includes('oauth_token: ghp_own_before_restart') === true,
      'the own token is still configured after the restart',
    );
    assert(
      (await readFileOrNull(`/home/${restartUsername}/.git-credentials`)) !== null,
      'the https credential survives the restart',
    );
    assert(
      (await gitConfigValue(restartUsername, 'faktenforum.ownCredentials')) === 'true',
      'the marker survives the restart',
    );
    console.log('✓ a restart does not overwrite a user who has their own token');

    /* The other half: a user who has no token must still end up on the shared account, and that
     * now happens on their first request - where the token is unchanged (still none). */
    await afterRestart.setUserGitHubPat(email, null);
    const reverted = await readFileOrNull(`/home/${restartUsername}/.config/gh/hosts.yml`);
    assert(
      reverted?.includes(`oauth_token: ${process.env.MCP_GITHUB_PAT}`) === true,
      'the shared token is applied on the first request after a restart',
    );
    assert(
      (await readFileOrNull(`/home/${restartUsername}/.git-credentials`)) === null,
      'the own credential is cleared once the token is gone',
    );
    console.log('✓ the first request after a restart reconciles even an unchanged token');
  }

  /* The test accounts stay behind - there is no delete path, so run this in a throwaway container. */
  console.log('\n=== All tests passed ===');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
