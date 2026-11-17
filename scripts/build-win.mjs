// Windows yayını: sürümü +1 yükseltir, imzalı kurulum dosyasını derler, latest.json üretir.
// Güncelleme imza anahtarı: TAURI_SIGNING_PRIVATE_KEY(_PATH) ya da varsayılan ~/maviruh-updater/updater.key
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ?? join(homedir(), "maviruh-updater", "updater.key");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !existsSync(keyPath)) {
  console.error(`Güncelleme imza anahtarı bulunamadı: ${keyPath}\nTAURI_SIGNING_PRIVATE_KEY_PATH ile yolunu verin.`);
  process.exit(1);
}
const env = { ...process.env };
if (!env.TAURI_SIGNING_PRIVATE_KEY) env.TAURI_SIGNING_PRIVATE_KEY = keyPath;
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const notes = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ");
if (!process.argv.includes("--no-bump")) run("node", ["scripts/bump-version.mjs"]);
run("npx", ["tauri", "build"]);
run("node", ["scripts/make-latest-json.mjs", ...(notes ? [notes] : [])]);
