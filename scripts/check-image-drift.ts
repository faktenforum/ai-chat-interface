#!/usr/bin/env -S node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Answers one question per published image: was the `latest` tag in ghcr built
 * from a commit whose sources still match this ref?
 *
 * Every build workflow fires on a `paths:` filter, and GitHub evaluates those
 * filters against the two-dot diff between base and head. A merge whose diff is
 * empty (a squash of an already-merged branch, for instance) matches no path, so
 * every build is skipped and the merge ships nothing. Same for a source change
 * that nobody thought to list under `paths:`. This finds those cases from the
 * outside, by comparing what the registry says against what git says.
 *
 * No image is pulled and no build runs. The revision comes from the
 * `org.opencontainers.image.revision` label that docker/metadata-action writes,
 * read out of the image config blob over the registry API: anonymous token ->
 * manifest -> config blob.
 *
 * The (image, paths) pairs are not maintained here. They are read out of
 * .github/workflows/build-*.yml, so a new build workflow is covered the day it
 * lands and a changed `paths:` filter changes this check with it.
 *
 *   npm run verify:images                     # against HEAD
 *   npm run verify:images -- --ref b93c4ff    # against some other commit
 *   npm run verify:images -- --wait 20        # give running builds 20 min to finish
 */

import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOW_DIR = join(ROOT, '.github/workflows');
const REVISION_LABEL = 'org.opencontainers.image.revision';

const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

interface Target {
  workflow: string;
  image: string;
  /** The workflow's `paths:` filter, translated to git pathspecs. */
  pathspecs: string[];
}

type Result =
  | { target: Target; state: 'ok'; revision: string }
  | { target: Target; state: 'drift'; revision: string; files: string[] }
  /* `pending` is a state a running build can still resolve; `error` never resolves
   * on its own, so waiting on it would only waste the runner. */
  | { target: Target; state: 'pending'; reason: string }
  | { target: Target; state: 'error'; reason: string };

interface WorkflowFile {
  on?: {
    push?: { paths?: string[] };
  };
  jobs?: Record<string, { steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
}

/**
 * GitHub's `paths:` globs and git's pathspecs are different languages. Only the
 * trailing `/**` needs translating: a bare directory is already "everything below
 * it" to git, and it keeps matching the gitlink of a submodule directory too.
 */
function toPathspec(pattern: string): string {
  return pattern.replace(/\/\*\*$/, '');
}

function readTargets(): Target[] {
  const targets: Target[] = [];

  for (const file of readdirSync(WORKFLOW_DIR).sort()) {
    if (!file.startsWith('build-') || !file.endsWith('.yml')) {
      continue;
    }

    const workflow = yaml.load(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as WorkflowFile;
    const paths = workflow.on?.push?.paths;
    const images = Object.values(workflow.jobs ?? {})
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith('docker/metadata-action'))
      .flatMap((step) => String(step.with?.images ?? '').split('\n'))
      .map((image) => image.trim())
      .filter(Boolean);

    if (!paths?.length || images.length !== 1) {
      throw new Error(
        `${file}: expected one docker/metadata-action image and a push paths filter, ` +
          `found ${images.length} image(s) and ${paths?.length ?? 0} path(s). ` +
          'Either the workflow is shaped differently now or this check needs updating.',
      );
    }

    targets.push({
      workflow: file,
      image: images[0],
      pathspecs: [...new Set(paths.map(toPathspec))],
    });
  }

  return targets;
}

class RegistryError extends Error {
  constructor(
    message: string,
    /** True while a build could still make this succeed. */
    readonly pending = false,
  ) {
    super(message);
  }
}

async function fetchJson(url: string, token?: string, accept?: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(accept ? { Accept: accept } : {}),
    },
  });
  if (!response.ok) {
    throw new RegistryError(
      `${response.status} ${response.statusText} for ${url}`,
      response.status === 404,
    );
  }
  return response.json();
}

/** Reads the revision label of a tag without pulling anything. */
async function readRevision(image: string, tag = 'latest'): Promise<string> {
  const [registry, ...rest] = image.split('/');
  const repository = rest.join('/');
  if (registry !== 'ghcr.io') {
    throw new Error(`only ghcr.io is supported, got ${registry}`);
  }

  /* ghcr wants a bearer token even for public reads, and hands one out without
   * credentials for images that are public. */
  const auth = (await fetchJson(
    `https://${registry}/token?service=${registry}&scope=repository:${repository}:pull`,
  )) as { token: string };

  const base = `https://${registry}/v2/${repository}`;
  let manifest = (await fetchJson(`${base}/manifests/${tag}`, auth.token, MANIFEST_TYPES)) as {
    manifests?: { digest: string; platform?: { os?: string; architecture?: string } }[];
    config?: { digest: string };
  };

  if (manifest.manifests) {
    /* Multi-platform index. Attestation entries carry platform unknown/unknown
     * and no image config, so they have to be skipped. */
    const entry =
      manifest.manifests.find((m) => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64') ??
      manifest.manifests.find((m) => m.platform?.architecture !== 'unknown');
    if (!entry) {
      throw new Error(`no image manifest in the index for :${tag}`);
    }
    manifest = (await fetchJson(`${base}/manifests/${entry.digest}`, auth.token, MANIFEST_TYPES)) as {
      config?: { digest: string };
    };
  }

  if (!manifest.config?.digest) {
    throw new Error(`manifest for :${tag} has no config descriptor`);
  }

  const config = (await fetchJson(`${base}/blobs/${manifest.config.digest}`, auth.token)) as {
    config?: { Labels?: Record<string, string> };
  };
  const revision = config.config?.Labels?.[REVISION_LABEL];
  if (!revision) {
    throw new Error(
      `:${tag} carries no ${REVISION_LABEL} label, so it cannot be traced to a commit`,
    );
  }
  return revision;
}

function git(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function driftingFiles(revision: string, ref: string, pathspecs: string[]): string[] {
  const diff = git(['diff', '--name-only', revision, ref, '--', ...pathspecs]);
  if (diff.status !== 0) {
    throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  }
  return diff.stdout.split('\n').filter(Boolean);
}

async function check(target: Target, ref: string): Promise<Result> {
  let revision: string;
  try {
    revision = await readRevision(target.image);
  } catch (error) {
    const pending = error instanceof RegistryError && error.pending;
    return { target, state: pending ? 'pending' : 'error', reason: (error as Error).message };
  }

  if (git(['cat-file', '-e', `${revision}^{commit}`]).status !== 0) {
    return {
      target,
      state: 'error',
      reason: `revision ${revision} is not in this clone - fetch the full history, or the image was built from a commit that no longer exists`,
    };
  }

  const files = driftingFiles(revision, ref, target.pathspecs);
  return files.length ? { target, state: 'drift', revision, files } : { target, state: 'ok', revision };
}

function report(results: Result[], ref: string, resolved: string): void {
  console.log(`Comparing ghcr :latest against ${ref} (${resolved.slice(0, 7)})\n`);

  for (const result of results.sort((a, b) => a.target.image.localeCompare(b.target.image))) {
    const name = result.target.image.replace(/^ghcr\.io\//, '');
    if (result.state === 'ok') {
      console.log(`✓ ${name} @ ${result.revision.slice(0, 7)}`);
      continue;
    }
    if (result.state === 'error' || result.state === 'pending') {
      console.log(`? ${name}: ${result.reason}`);
      continue;
    }
    console.log(
      `✗ ${name} @ ${result.revision.slice(0, 7)}: ${result.files.length} file(s) differ since that build ` +
        `(re-run ${result.target.workflow}):`,
    );
    for (const file of result.files.slice(0, 10)) {
      console.log(`    ${file}`);
    }
    if (result.files.length > 10) {
      console.log(`    ... and ${result.files.length - 10} more`);
    }
  }
}

function parseArgs(argv: string[]): { ref: string; waitMinutes: number } {
  let ref = 'HEAD';
  let waitMinutes = 0;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--ref') {
      ref = argv[++i] ?? ref;
    } else if (argv[i] === '--wait') {
      waitMinutes = Number(argv[++i]);
      if (!Number.isFinite(waitMinutes) || waitMinutes < 0) {
        throw new Error('--wait takes a number of minutes');
      }
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }

  return { ref, waitMinutes };
}

async function main(): Promise<void> {
  const { ref, waitMinutes } = parseArgs(process.argv.slice(2));
  const resolved = git(['rev-parse', ref]);
  if (resolved.status !== 0) {
    console.error(`Cannot resolve ${ref}: ${resolved.stderr.trim()}`);
    process.exit(1);
  }

  const targets = readTargets();
  let results = await Promise.all(targets.map((target) => check(target, ref)));

  /* On a push to main the builds for that same commit are still running, and an
   * image mid-rebuild looks exactly like a missed build. Re-poll rather than
   * reporting the race as a defect. */
  const unsettled = (result: Result) => result.state === 'drift' || result.state === 'pending';
  const deadline = Date.now() + waitMinutes * 60_000;
  while (results.some(unsettled) && Date.now() < deadline) {
    const waiting = results.filter(unsettled);
    console.log(`${waiting.length} image(s) not current yet, waiting for builds to finish...`);
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    const rechecked = await Promise.all(waiting.map((r) => check(r.target, ref)));
    results = [...results.filter((r) => !unsettled(r)), ...rechecked];
  }

  report(results, ref, resolved.stdout.trim());

  const failed = results.filter((r) => r.state !== 'ok');
  if (failed.length) {
    console.error(
      `\n${failed.length} of ${results.length} images do not match ${ref}. ` +
        'Re-run the build workflow for each (Actions -> the workflow -> Run workflow) ' +
        'and check whether its paths filter should have caught the change.',
    );
    process.exit(1);
  }

  console.log(`\nAll ${results.length} images were built from ${ref}.`);
}

try {
  await main();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
