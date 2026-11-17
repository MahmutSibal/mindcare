#!/bin/bash
# OpenSSL'i Android (arm64) için derler. WSL (Ubuntu) içinde, bir kez çalıştırılır.
#
# Neden: SQLCipher OpenSSL ister. Windows'ta Strawberry Perl ile Android için OpenSSL derlenemez
# ("Unix benzeri yol üretmiyor"), o yüzden Linux'ta derlenip hazır kütüphane (.a) olarak Windows'a verilir.
#
# Gerekenler (WSL Ubuntu): build-essential, perl, curl, unzip   ->   sudo apt install build-essential perl curl unzip
# Önce Windows'ta bir kez `cd src-tauri && cargo fetch` çalıştırın (OpenSSL kaynağı cargo önbelleğinden alınır).
#
# Çalıştırma (WSL içinde, proje kökünden):   bash scripts/build-openssl-android.sh
# Çıktı: C:\Users\<kullanıcı>\android-openssl\aarch64\{include,lib}
set -euo pipefail

WINUSER="${WINUSER:-$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')}"
WORK="${WORK:-$HOME/android-ssl}"
OUT="${OUT:-/mnt/c/Users/$WINUSER/android-openssl/aarch64}"
SRC="$(ls -d /mnt/c/Users/"$WINUSER"/.cargo/registry/src/*/openssl-src-*/openssl 2>/dev/null | tail -1)"
NDK_VERSION="r28c"   # Windows'taki NDK 28.2.x ile aynı sürüm

[ -n "$SRC" ] || { echo "openssl-src bulunamadı. Windows'ta 'cargo fetch' çalıştırın."; exit 1; }
mkdir -p "$WORK"
cd "$WORK"

if [ ! -d ndk ]; then
  [ -f ndk.zip ] || curl -L --fail -o ndk.zip "https://dl.google.com/android/repository/android-ndk-$NDK_VERSION-linux.zip"
  # Önemli: sembolik bağlantıları koruyan `unzip` kullanılmalı (python zipfile bozar, clang çalışmaz).
  unzip -q ndk.zip -d ndk_tmp
  mv "ndk_tmp/android-ndk-$NDK_VERSION" ndk
  rm -rf ndk_tmp
fi

rm -rf openssl-src build && mkdir build
cp -r "$SRC" openssl-src
cd openssl-src

export ANDROID_NDK_ROOT="$WORK/ndk"
export PATH="$ANDROID_NDK_ROOT/toolchains/llvm/prebuilt/linux-x86_64/bin:$PATH"
# no-asm: perlasm adımı bu paketle çalışmıyor; veritabanı küçük, hız farkı önemsiz.
# no-apps: crate paketi apps/ klasörünü içermez.
./Configure android-arm64 -D__ANDROID_API__=24 no-asm no-shared no-tests no-apps no-docs no-comp no-ssl3 no-engine no-dso \
  --prefix="$WORK/build" --openssldir=/data/local/tmp/ssl > "$WORK/configure.log" 2>&1
make -j"$(nproc)" build_libs > "$WORK/make.log" 2>&1
make install_dev > "$WORK/install.log" 2>&1

rm -rf "$OUT/include" "$OUT/lib"
mkdir -p "$OUT/lib"
cp -r "$WORK/build/include" "$OUT/include"
cp "$WORK/build/lib"*/libssl.a "$WORK/build/lib"*/libcrypto.a "$OUT/lib/"
echo "TAMAM: $OUT"
