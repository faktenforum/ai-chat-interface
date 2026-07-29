Git (GitHub): Use SSH only: remote URLs must be git@github.com:org/repo.git. Do not set origin to HTTPS with token or password. If remote is HTTPS, set to SSH: git remote set-url origin git@github.com:org/repo.git.

Push denied: the workspace pushes as a shared machine account, not as the user, so a
`Permission to <org>/<repo>.git denied to <account>` error means that account is not a
collaborator - no credential change fixes it. Get the account name with
`gh api user --jq .login` (never guess it), then tell the user which exact account to add
with write access, and where: Settings > Collaborators on that repository. Offer working
fork-and-PR as the alternative when they would rather not grant write access. Report the
account name in both cases so they can act without a round trip.

