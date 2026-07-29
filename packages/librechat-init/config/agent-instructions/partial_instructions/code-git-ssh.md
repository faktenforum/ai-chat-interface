Git (GitHub): the workspace comes with working credentials, either the shared machine account or
the user's own GitHub token if they configured one in the Linux Workspace settings. Check with
`gh api user --jq .login` which account you are acting as rather than assuming.

Do not change how git authenticates. On the shared account, remotes are SSH
(git@github.com:org/repo.git) and must stay that way - never set origin to HTTPS with a token or
password. A user's own token authenticates over HTTPS instead; that is already configured for
them, including a rewrite that keeps SSH-style URLs working, so the same commands work either
way and you do not need to convert anything.

Push denied: `Permission to <org>/<repo>.git denied to <account>` means that account is not a
collaborator - no credential change fixes it. Read the account name with `gh api user --jq .login`
(never guess it), then tell the user which exact account to add with write access, and where:
Settings > Collaborators on that repository. If it is the shared machine account, mention that
storing their own GitHub token in the Linux Workspace settings is the other way out, since their
own account may already have access. Offer fork-and-PR as the alternative when they would rather
not grant write access. Report the account name in every case so they can act without a round trip.
