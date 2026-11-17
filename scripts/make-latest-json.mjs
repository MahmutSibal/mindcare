// Güncelleme bildirimi (latest.json) üretir. `npm run build:win` sonrası çalıştırılır; çıktıdaki
// kurulum dosyası + .sig imzası ve latest.json GitHub Release'e yüklenir (bkz. YAYIN.md → "Otomatik güncelleme").
// Kullanım: node scripts/make-latest-json.mjs [notlar]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;
const dir = join(root, "src-tauri/target/release/bundle/nsis");
const exe = readdirSync(dir).find((f) => f.endsWith(`${version}_x64-setup.exe`));
if (!exe) throw new Error(`${version} sürümünün kurulum dosyası bulunamadı: önce npm run build:win çalıştırın.`);
let signature;
try {
  signature = readFileSync(join(dir, exe + ".sig"), "utf8").trim();
} catch {
  throw new Error("İmza dosyası (.sig) yok. TAURI_SIGNING_PRIVATE_KEY ayarlı olmadan derlenmiş olabilir.");
}

// GitHub, dosya adındaki boşlukları noktaya çevirir ("Mavi Ruh_1.0.2_x64-setup.exe" → "Mavi.Ruh_1.0.2_x64-setup.exe").
const assetName = exe.replace(/ /g, ".");
const repo = "MahmutSibal/mindcare";
const latest = {
  version,
  notes: process.argv[2] ?? `Mavi Ruh ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${repo}/releases/download/v${version}/${assetName}`,
    },
  },
};
writeFileSync(join(dir, "latest.json"), JSON.stringify(latest, null, 2));
console.log(`latest.json yazıldı (${version}). Yüklenecek dosyalar:\n  ${join(dir, exe)}  (GitHub'da "${assetName}" adıyla)\n  ${join(dir, "latest.json")}`);
