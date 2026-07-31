/**
 * GitHub's SSH host keys, baked in so every workspace can verify github.com instead of trusting
 * whatever answers on port 22.
 *
 * Source: https://api.github.com/meta, field `ssh_keys`. Fingerprints below are the ones GitHub
 * publishes in the same response (`ssh_key_fingerprints`), checked on 2026-07-31:
 *   SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU  (ED25519)
 *   SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM  (ECDSA)
 *   SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s  (RSA)
 *
 * Baked in rather than fetched at runtime: user creation must not depend on an outbound HTTP call,
 * and a key fetched over an unverified channel at the moment of first use adds nothing. GitHub
 * announces host key rotations in advance (as with the 2023 RSA key), so update this file then and
 * verify the fingerprints against api.github.com/meta before shipping.
 */

const GITHUB_HOST_KEYS = [
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=',
  'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=',
];

/**
 * Content for a per-user `~/.ssh/known_hosts`. Covers `ssh.github.com` on 22 and 443 as well,
 * because a user behind a port-22 block switches to that host and would otherwise be back to an
 * unverified key. All three names serve the same keys (verified with ssh-keyscan).
 */
export const GITHUB_KNOWN_HOSTS =
  GITHUB_HOST_KEYS.flatMap((key) => [
    `github.com ${key}`,
    `ssh.github.com ${key}`,
    `[ssh.github.com]:443 ${key}`,
  ]).join('\n') + '\n';
