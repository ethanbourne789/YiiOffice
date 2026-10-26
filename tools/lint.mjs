#!/usr/bin/env node
/**
 * Per-package parallel ESLint with an on-disk cache.
 *
 * `eslint .` over this repo needs a ~4 GB heap and ~19 minutes: one process
 * builds a program-wide bound on every file at once. Splitting the work per
 * workspace keeps each process small, lets them run concurrently, and `--cache`
 * makes an unchanged package cost one stat pass instead of a full lint.
 *
 * Usage:
 *   node tools/lint.mjs                # lint every workspace (parallel + cache)
 *   node tools/lint.mjs apps/shell     # lint selected paths only
 *   node tools/lint.mjs --no-cache     # cold run (what CI should use)
 *
 * Exit code is 1 when any package reports an error, so it works as a gate.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const eslintBin = join(root, "node_modules", "eslint", "bin", "eslint.js");
const cacheDir = join(root, "node_modules", ".cache", "eslint");

/** Everything outside the workspaces that still holds lintable code. */
const ROOT_TARGETS = ["eslint.config.mjs", "tools", "e2e", "scripts"].filter(
  (path) => {
    const full = join(root, path);
    if (!existsSync(full)) return false;
    try {
      return readdirSync(full, { withFileTypes: true }).some((e) => e.isFile());
    } catch {
      return true; // a file target, not a directory
    }
  },
);

function workspaceDirs() {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dirs = [];
  for (const pattern of manifest.workspaces ?? []) {
    const base = pattern.replace(/\/\*$/, "");
    if (!existsSync(join(root, base))) continue;
    for (const entry of readdirSync(join(root, base), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) dirs.push(`${base}/${entry.name}`);
    }
  }
  return dirs;
}

const argv = process.argv.slice(2);
const useCache = !argv.includes("--no-cache");
const requested = argv.filter((arg) => !arg.startsWith("--"));

const units = (
  requested.length > 0
    ? requested.map((path) => ({
        name: path.replace(/\/$/, ""),
        targets: [path],
      }))
    : [
        ...workspaceDirs().map((dir) => ({ name: dir, targets: [dir] })),
        { name: ".", targets: ROOT_TARGETS },
      ]
).filter((unit) => unit.targets.length > 0);

/** Keep the process count modest: each worker still holds a full TS AST set. */
const concurrency = Math.max(
  1,
  Math.min(4, Number(process.env.LINT_CONCURRENCY) || cpus().length),
);

function run(unit) {
  return new Promise((resolveRun) => {
    const args = [eslintBin, ...unit.targets];
    if (useCache) {
      args.push(
        "--cache",
        "--cache-location",
        join(cacheDir, `${unit.name.replace(/[\\/]/g, "_")}.cache`),
      );
    }
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=2048",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) =>
      resolveRun({ unit, code: code ?? 1, stdout, stderr }),
    );
    child.on("error", (error) =>
      resolveRun({ unit, code: 1, stdout: "", stderr: String(error) }),
    );
  });
}

async function main() {
  const started = Date.now();
  const results = new Array(units.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, units.length) }, async () => {
      while (next < units.length) {
        const index = next++;
        const unit = units[index];
        process.stderr.write(`lint ${unit.name}\n`);
        results[index] = await run(unit);
      }
    }),
  );

  const failed = results.filter((result) => result.code !== 0);
  for (const result of failed) {
    process.stdout.write(`\n── ${result.unit.name} ──\n`);
    process.stdout.write(result.stdout);
    if (result.stderr) process.stdout.write(result.stderr);
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (failed.length === 0) {
    console.log(
      `\nlint clean: ${results.length} units in ${seconds}s${useCache ? " (cached)" : ""}`,
    );
    return 0;
  }
  console.log(
    `\nlint failed: ${failed.length}/${results.length} units in ${seconds}s → ${failed
      .map((result) => result.unit.name)
      .join(", ")}`,
  );
  return 1;
}

main().then((code) => process.exit(code));
