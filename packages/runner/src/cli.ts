#!/usr/bin/env bun

// Usage:
//   bun run runner ~/git/space-ship-simulator          # local path
//   bun run runner Victorp1811/Space-ship-Simulator     # GitHub shorthand
//   bun run runner https://github.com/Lord-Raven/bar-keeper  # full URL
//   bun run runner github:Victorp1811/Space-ship-Simulator   # GitHub protocol
//   bun run runner gitlab:user/stage                         # GitLab protocol
//   bun run runner sourcehut:~user/stage                     # sourcehut protocol
//   bun run runner git+https://my.server/repo.git            # arbitrary git host
//   bun run runner git+ssh://git@host/repo                   # arbitrary git host over ssh
//   bun run runner path:/home/me/git/foo                     # explicit local path
//   bun run runner npm:@lord-raven/statosphere                # npm package (not yet implemented)
//   bun run runner --refresh Victorp1811/Space-ship-Simulator  # re-pull cached
//   bun run runner                                      # uses STAGE_PATH env or factory's own stage

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runnerDir = resolve(__dirname, "..");

interface RemoteRef {
  url: string;
  cacheDir: string;
  label: string;
}

function parseArgs(argv: string[]): { refresh: boolean; specifier?: string } {
  let refresh = false;
  let specifier: string | undefined;
  for (const arg of argv) {
    if (arg === "--refresh") {
      refresh = true;
    } else if (!specifier) {
      specifier = arg;
    }
  }
  return { refresh, specifier };
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function isLocalPathSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("/") ||
    specifier.startsWith("~") ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier === "."
  );
}

function getCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME
    ? process.env.XDG_CACHE_HOME
    : join(homedir(), ".cache");
  return join(base, "chub-runner", "stages");
}

function githubRef(owner: string, repo: string): RemoteRef {
  return {
    url: `https://github.com/${owner}/${repo}.git`,
    cacheDir: join(getCacheDir(), "github", owner, repo),
    label: `${owner}/${repo}`,
  };
}

function gitlabRef(owner: string, repo: string): RemoteRef {
  return {
    url: `https://gitlab.com/${owner}/${repo}.git`,
    cacheDir: join(getCacheDir(), "gitlab", owner, repo),
    label: `${owner}/${repo}`,
  };
}

function sourcehutRef(user: string, repo: string): RemoteRef {
  return {
    url: `https://git.sr.ht/~${user}/${repo}`,
    cacheDir: join(getCacheDir(), "sourcehut", user, repo),
    label: `~${user}/${repo}`,
  };
}

function gitPlusRef(strippedUrl: string): RemoteRef {
  const parsed = new URL(strippedUrl);
  const pathParts = parsed.pathname
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  return {
    url: strippedUrl,
    cacheDir: join(getCacheDir(), "git", parsed.host, ...pathParts),
    label: strippedUrl,
  };
}

function parseGitHubUrl(specifier: string): RemoteRef | undefined {
  const match = specifier.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  );
  if (!match) return undefined;
  const [, owner, repo] = match;
  return githubRef(owner, repo);
}

function parseGitHubShorthand(specifier: string): RemoteRef | undefined {
  const match = specifier.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!match) return undefined;
  const [, owner, repo] = match;
  return githubRef(owner, repo);
}

function splitOwnerRepo(rest: string): [string, string] | undefined {
  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  const repo = parts[parts.length - 1];
  const owner = parts.slice(0, -1).join("/");
  return [owner, repo];
}

function parseProtocolSpecifier(
  specifier: string,
): { protocol: string; rest: string } | undefined {
  const match = specifier.match(/^([a-zA-Z][a-zA-Z0-9+]*):(.*)$/);
  if (!match) return undefined;
  const [, protocol, rest] = match;
  return { protocol, rest };
}

function run(
  cmd: string[],
  cwd: string,
): Promise<{ code: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = Bun.spawn(cmd, {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    proc.exited
      .then((code) => resolvePromise({ code }))
      .catch(rejectPromise);
  });
}

async function ensureRemoteStage(
  ref: RemoteRef,
  refresh: boolean,
): Promise<string> {
  const stageDir = ref.cacheDir;
  const exists = existsSync(stageDir);

  if (!exists) {
    console.log(`[cli] cloning ${ref.url} into ${stageDir}`);
    const { code } = await run(
      ["git", "clone", "--depth", "1", ref.url, stageDir],
      runnerDir,
    );
    if (code !== 0) {
      throw new Error(`git clone failed with exit code ${code}`);
    }
  } else if (refresh) {
    console.log(`[cli] pulling latest for ${ref.label}`);
    const { code } = await run(["git", "pull"], stageDir);
    if (code !== 0) {
      throw new Error(`git pull failed with exit code ${code}`);
    }
  } else {
    console.log(`[cli] using cached stage at ${stageDir}`);
  }

  await ensureDepsInstalled(stageDir, refresh);
  return stageDir;
}

async function ensureNpmStage(packageName: string): Promise<never> {
  console.log(
    `[cli] npm: protocol support coming soon (requested ${packageName})`,
  );
  process.exit(1);
}

async function ensureLocalStage(specifier: string): Promise<string> {
  const stagePath = resolve(expandHome(specifier));
  if (!existsSync(stagePath)) {
    throw new Error(`local stage path does not exist: ${stagePath}`);
  }
  const stageTsx = join(stagePath, "src", "Stage.tsx");
  if (!existsSync(stageTsx)) {
    throw new Error(`not a valid stage: ${stageTsx} not found`);
  }
  await ensureDepsInstalled(stagePath, false);
  return stagePath;
}

async function ensureDepsInstalled(
  stageDir: string,
  force: boolean,
): Promise<void> {
  const nodeModules = join(stageDir, "node_modules");
  if (!force && existsSync(nodeModules)) {
    return;
  }
  console.log(`[cli] installing deps in ${stageDir}`);
  const { code } = await run(["bun", "install"], stageDir);
  if (code !== 0) {
    throw new Error(`bun install failed with exit code ${code}`);
  }
}

async function resolveStagePath(
  specifier: string | undefined,
  refresh: boolean,
): Promise<string | undefined> {
  if (!specifier) {
    if (process.env.STAGE_PATH) {
      return resolve(expandHome(process.env.STAGE_PATH));
    }
    return undefined;
  }

  if (isLocalPathSpecifier(specifier)) {
    return ensureLocalStage(specifier);
  }

  const protocolSpecifier = parseProtocolSpecifier(specifier);
  if (protocolSpecifier) {
    const { protocol, rest } = protocolSpecifier;

    switch (protocol) {
      case "github": {
        const ownerRepo = splitOwnerRepo(rest);
        if (!ownerRepo) {
          throw new Error(`invalid github: specifier: ${specifier}`);
        }
        return ensureRemoteStage(githubRef(...ownerRepo), refresh);
      }
      case "gitlab": {
        const ownerRepo = splitOwnerRepo(rest);
        if (!ownerRepo) {
          throw new Error(`invalid gitlab: specifier: ${specifier}`);
        }
        return ensureRemoteStage(gitlabRef(...ownerRepo), refresh);
      }
      case "sourcehut": {
        const match = rest.match(/^~([^/]+)\/(.+)$/);
        if (!match) {
          throw new Error(
            `invalid sourcehut: specifier: ${specifier} (expected sourcehut:~user/repo)`,
          );
        }
        const [, user, repo] = match;
        return ensureRemoteStage(sourcehutRef(user, repo), refresh);
      }
      case "git+https":
      case "git+ssh": {
        const strippedUrl = specifier.slice("git+".length);
        return ensureRemoteStage(gitPlusRef(strippedUrl), refresh);
      }
      case "path": {
        return ensureLocalStage(rest);
      }
      case "npm": {
        return ensureNpmStage(rest);
      }
      case "http":
      case "https": {
        const githubUrlRef = parseGitHubUrl(specifier);
        if (githubUrlRef) {
          return ensureRemoteStage(githubUrlRef, refresh);
        }
        throw new Error(
          `unsupported ${protocol}: URL: ${specifier} (only github.com URLs are supported directly; use git+${protocol}: for other hosts)`,
        );
      }
      default:
        throw new Error(
          `unknown protocol "${protocol}:" in specifier: ${specifier}`,
        );
    }
  }

  const shorthandRef = parseGitHubShorthand(specifier);
  if (shorthandRef) {
    return ensureRemoteStage(shorthandRef, refresh);
  }

  throw new Error(
    `could not resolve stage specifier: ${specifier} (expected local path, owner/repo, or GitHub URL)`,
  );
}

async function main() {
  const { refresh, specifier } = parseArgs(process.argv.slice(2));

  let stagePath: string | undefined;
  try {
    stagePath = await resolveStagePath(specifier, refresh);
  } catch (err) {
    console.error(`[cli] ${(err as Error).message}`);
    process.exit(1);
  }

  const env = { ...process.env };
  if (stagePath) {
    env.STAGE_PATH = stagePath;
    console.log(`[cli] STAGE_PATH=${stagePath}`);
  } else {
    console.log(`[cli] running factory's own stage (no STAGE_PATH set)`);
  }

  const children = [
    Bun.spawn(["bun", "run", "dev:server"], {
      cwd: runnerDir,
      env,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }),
    Bun.spawn(["bun", "run", "dev:client"], {
      cwd: runnerDir,
      env,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }),
  ];

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[cli] shutting down...");
    for (const child of children) {
      child.kill();
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await Promise.race(children.map((child) => child.exited));
  shutdown();
}

main();
