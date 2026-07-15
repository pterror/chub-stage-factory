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
//   bun run runner my.gitea.instance/user/repo               # bare domain (dotted first segment)
//   bun run runner path:/home/me/git/foo                     # explicit local path
//   bun run runner npm:@lord-raven/statosphere                # npm package (not yet implemented)
//   bun run runner --refresh Victorp1811/Space-ship-Simulator  # re-pull cached
//   bun run runner --netns chub-vpn Victorp1811/Space-ship-Simulator  # start SOCKS proxy bridge over netns
//   bun run runner                                      # uses STAGE_PATH env or factory's own stage
//
// RUNNER_NETNS env var is equivalent to --netns.

import { existsSync } from "node:fs";
import { createServer } from "node:net";
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

function parseArgs(
  argv: string[],
): { refresh: boolean; specifier?: string; netns?: string } {
  let refresh = false;
  let specifier: string | undefined;
  let netns = process.env.RUNNER_NETNS || undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--refresh") {
      refresh = true;
    } else if (arg === "--netns") {
      netns = argv[++i];
    } else if (arg.startsWith("--netns=")) {
      netns = arg.slice("--netns=".length);
    } else if (!specifier) {
      specifier = arg;
    }
  }
  return { refresh, specifier, netns };
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

const KNOWN_FORGES: Record<string, string> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "git.sr.ht": "sourcehut",
};

function bareDomainRef(specifier: string): RemoteRef {
  const parts = specifier.split("/").filter(Boolean);
  const domain = parts[0];
  const pathParts = parts.slice(1);
  return {
    url: `https://${domain}/${pathParts.join("/")}.git`,
    cacheDir: join(getCacheDir(), "git", domain, ...pathParts),
    label: specifier,
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

async function cloneWithFallback(ref: RemoteRef, stageDir: string): Promise<void> {
  console.log(`[cli] cloning ${ref.url} into ${stageDir}`);
  let { code } = await run(
    ["git", "clone", "--depth", "1", ref.url, stageDir],
    runnerDir,
  );

  if (code !== 0 && ref.url.startsWith("https://")) {
    const httpUrl = `http://${ref.url.slice("https://".length)}`;
    console.warn("warn: HTTPS clone failed, falling back to HTTP (unencrypted)");
    ({ code } = await run(
      ["git", "clone", "--depth", "1", httpUrl, stageDir],
      runnerDir,
    ));
  }

  if (code !== 0) {
    throw new Error(`git clone failed with exit code ${code}`);
  }
}

async function ensureRemoteStage(
  ref: RemoteRef,
  refresh: boolean,
): Promise<string> {
  const stageDir = ref.cacheDir;
  const exists = existsSync(stageDir);

  if (!exists) {
    await cloneWithFallback(ref, stageDir);
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

async function resolveByProtocol(
  protocol: string,
  rest: string,
  refresh: boolean,
  specifier: string,
): Promise<string> {
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
    return resolveByProtocol(
      protocolSpecifier.protocol,
      protocolSpecifier.rest,
      refresh,
      specifier,
    );
  }

  const slashIdx = specifier.indexOf("/");
  const firstSegment = slashIdx === -1 ? specifier : specifier.slice(0, slashIdx);
  if (firstSegment.includes(".")) {
    const knownProtocol = KNOWN_FORGES[firstSegment];
    const rest = slashIdx === -1 ? "" : specifier.slice(slashIdx + 1);
    if (knownProtocol) {
      return resolveByProtocol(knownProtocol, rest, refresh, specifier);
    }
    return ensureRemoteStage(bareDomainRef(specifier), refresh);
  }

  const shorthandRef = parseGitHubShorthand(specifier);
  if (shorthandRef) {
    return ensureRemoteStage(shorthandRef, refresh);
  }

  throw new Error(
    `could not resolve stage specifier: ${specifier} (expected local path, owner/repo, or GitHub URL)`,
  );
}

interface ProxyHandle {
  port: number;
  processes: Bun.Subprocess[];
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.once("listening", () => {
      server.close(() => resolvePromise(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort(start: number): Promise<number> {
  let port = start;
  while (!(await isPortFree(port))) {
    port++;
  }
  return port;
}

async function killProcessOnPort(port: number): Promise<boolean> {
  const lsofPath = Bun.which("lsof");
  if (!lsofPath) return false;

  const proc = Bun.spawn([lsofPath, "-ti", `tcp:${port}`], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  const pids = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (pids.length === 0) return false;

  console.log(`[cli] killing stale process on port ${port}`);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {}
  }

  for (let i = 0; i < 20; i++) {
    if (await isPortFree(port)) return true;
    await Bun.sleep(100);
  }
  return false;
}

async function ensureRunnerPort(preferred: number): Promise<number> {
  if (await isPortFree(preferred)) {
    return preferred;
  }
  const killed = await killProcessOnPort(preferred);
  if (killed && (await isPortFree(preferred))) {
    return preferred;
  }
  const fallbackPort = await findFreePort(preferred + 1);
  console.log(
    `[cli] port ${preferred} still in use, using ${fallbackPort} instead`,
  );
  return fallbackPort;
}

function requireBinary(name: string): string {
  const path = Bun.which(name);
  if (!path) {
    console.error(
      `[cli] "${name}" not found on PATH. Run inside "nix develop" (it provides microsocks and socat via the devShell).`,
    );
    process.exit(1);
  }
  return path;
}

async function startNetnsProxy(netns: string): Promise<ProxyHandle> {
  const microsocksPath = requireBinary("microsocks");
  const socatPath = requireBinary("socat");
  const port = await findFreePort(1080);

  console.log(
    `[cli] starting SOCKS proxy bridge for netns "${netns}" on port ${port}`,
  );

  const microsocksProc = Bun.spawn(
    ["sudo", "ip", "netns", "exec", netns, microsocksPath, "-p", String(port)],
    { stdout: "inherit", stderr: "inherit", stdin: "inherit" },
  );

  const socatProc = Bun.spawn(
    [
      "sudo",
      socatPath,
      `TCP-LISTEN:${port},fork,reuseaddr`,
      `EXEC:ip netns exec ${netns} ${socatPath} STDIO TCP:127.0.0.1:${port}`,
    ],
    { stdout: "inherit", stderr: "inherit", stdin: "inherit" },
  );

  await Bun.sleep(500);

  return { port, processes: [microsocksProc, socatProc] };
}

async function stopNetnsProxy(handle: ProxyHandle): Promise<void> {
  for (const proc of handle.processes) {
    if (proc.exitCode !== null) continue;
    await run(["sudo", "kill", String(proc.pid)], runnerDir).catch(() => {});
  }
}

async function main() {
  const { refresh, specifier, netns } = parseArgs(process.argv.slice(2));

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

  let proxyHandle: ProxyHandle | undefined;
  if (netns) {
    proxyHandle = await startNetnsProxy(netns);
    env.CHUB_PROXY = `socks5://localhost:${proxyHandle.port}`;
    console.log(`[cli] CHUB_PROXY=${env.CHUB_PROXY}`);
  }

  const runnerPort = await ensureRunnerPort(Number(env.RUNNER_PORT ?? 3001));
  env.RUNNER_PORT = String(runnerPort);
  console.log(`[cli] RUNNER_PORT=${runnerPort}`);

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
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[cli] shutting down...");
    for (const child of children) {
      child.kill();
    }
    if (proxyHandle) {
      await stopNetnsProxy(proxyHandle);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await Promise.race(children.map((child) => child.exited));
  await shutdown();
}

main();
