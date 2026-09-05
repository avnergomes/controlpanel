// Assemble the deployable site into dist/ (allowlist copy: no tests, node_modules,
// shapefiles or source GeoJSON) and stamp every first-party asset reference with a
// version query so a cached index.html never mixes module versions after a deploy.
// Usage: node scripts/build.mjs [--out dist] [--version <sha>]
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const out = resolve(argOf("--out", "dist"));
const root = resolve(".");
const version = argOf("--version", process.env.GITHUB_SHA || gitSha() || String(Date.now())).slice(0, 12);

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const FILES = [
  "index.html",
  "404.html",
  "styles.css",
  "favicon.svg",
  "og-image.png",
  "config.local.js",
  "assets/world-paths.json",
  "vendor/chart.umd.min.js",
  "vendor/chart.LICENSE.md",
  "i18n/i18n-dict.js",
  "i18n/i18n-text-map.js",
  "i18n/i18n.js",
  "i18n/i18n-runtime.js",
  "i18n/i18n-switcher.css",
];
const DIRS = ["src"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const missing = [];
for (const file of FILES) {
  const from = join(root, file);
  if (!existsSync(from)) {
    missing.push(file);
    continue;
  }
  mkdirSync(join(out, file, ".."), { recursive: true });
  cpSync(from, join(out, file));
}
for (const dir of DIRS) cpSync(join(root, dir), join(out, dir), { recursive: true });

// GitHub Pages: skip Jekyll processing.
writeFileSync(join(out, ".nojekyll"), "");

// Version stamping: index.html references and relative imports inside src/.
const stamp = (text) => text
  .replace(/(href|src)="((?:src|vendor|i18n|assets)\/[^"?]+|styles\.css|config\.local\.js)"/g, `$1="$2?v=${version}"`);
const indexPath = join(out, "index.html");
writeFileSync(indexPath, stamp(readFileSync(indexPath, "utf8")));
stampImports(join(out, "src"));
writeFileSync(join(out, "version.txt"), `${version}\n`);

function stampImports(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      stampImports(p);
      continue;
    }
    if (!entry.endsWith(".js")) continue;
    const src = readFileSync(p, "utf8").replace(/(from\s+")(\.{1,2}\/[^"?]+\.js)(")/g, `$1$2?v=${version}$3`);
    writeFileSync(p, src);
  }
}

if (missing.length) {
  const fatal = missing.filter((f) => f !== "config.local.js");
  if (fatal.length) {
    console.error(`build: missing required files: ${fatal.join(", ")}`);
    process.exit(1);
  }
  console.warn("build: config.local.js not found (CI generates it from the TRACKING_URL secret)");
}

function sizeOf(dir) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    total += s.isDirectory() ? sizeOf(p) : s.size;
  }
  return total;
}
console.log(`build: ${out} v=${version} (${(sizeOf(out) / 1024).toFixed(0)} KB)`);
