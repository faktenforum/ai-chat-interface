/**
 * Credential-switching test for the per-user GitHub token.
 *
 * Needs root, useradd and runuser, so it runs inside the container - not on the host:
 *   podman exec -e MCP_GITHUB_PAT=shared-token <container> \
 *     node --experimental-strip-types --experimental-transform-types --no-warnings \
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

  /* The test accounts stay behind - there is no delete path, so run this in a throwaway container. */
  console.log('\n=== All tests passed ===');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
