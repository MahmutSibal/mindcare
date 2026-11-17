// Sürümü tüm dosyalarda birlikte yükseltir: package.json, package-lock.json, tauri.conf.json,
// Cargo.toml, Cargo.lock (mindcare paketi) ve src/lib/brand.ts (Hakkında kartı).
// Kullanım: node scripts/bump-version.mjs [patch|minor|major|x.y.z]   (varsayılan: patch)
// `npm run build:win` ve `npm run build:android` bunu otomatik çalıştırır.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (f) => join(root, f);
const read = (f) => readFileSync(p(f), "utf8");
const write = (f, s) => writeFileSync(p(f), s);

const pkg = JSON.parse(read("package.json"));
const cur = pkg.version.split(".").map(Number);
const arg = process.argv[2] ?? "patch";
let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else if (arg === "major") next = `${cur[0] + 1}.0.0`;
else if (arg === "minor") next = `${cur[0]}.${cur[1] + 1}.0`;
else next = `${cur[0]}.${cur[1]}.${cur[2] + 1}`;

const replaceOnce = (file, re, to) => {
  const s = read(file);
  if (!re.test(s)) throw new Error(`${file}: sürüm satırı bulunamadı`);
  write(file, s.replace(re, to));
};

replaceOnce("package.json", /("version":\s*")[^"]+(")/, `$1${next}$2`);
// package-lock.json: en üstteki iki "version" (kök ve packages[""])
{
  let s = read("package-lock.json");
  let n = 0;
  s = s.replace(/("version":\s*")[^"]+(")/g, (m, a, b) => (n++ < 2 ? `${a}${next}${b}` : m));
  write("package-lock.json", s);
}
replaceOnce("src-tauri/tauri.conf.json", /("version":\s*")[^"]+(")/, `$1${next}$2`);
replaceOnce("src-tauri/Cargo.toml", /^version = ".*"$/m, `version = "${next}"`);
replaceOnce("src-tauri/Cargo.lock", /(name = "mindcare"\r?\nversion = ")[^"]+(")/, `$1${next}$2`);
replaceOnce("src/lib/brand.ts", /(APP_VERSION = ")[^"]+(")/, `$1${next}$2`);

console.log(`Sürüm: ${pkg.version} → ${next}`);
