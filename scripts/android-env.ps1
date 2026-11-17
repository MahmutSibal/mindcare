# Android derlemesi için ortam değişkenleri.
# Kullanım (PowerShell, proje kökünde):   . .\scripts\android-env.ps1
# Sonra:                                  npx tauri android build --target aarch64 --apk
#
# Gerekenler: Android Studio (SDK + NDK 28), JDK 17+, `rustup target add aarch64-linux-android`,
# Android için derlenmiş OpenSSL (scripts/build-openssl-android.sh, WSL içinde bir kez çalıştırılır).

$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not (Test-Path $sdk)) { throw "Android SDK bulunamadı: $sdk (Android Studio kurun)" }
$ndk = Get-ChildItem (Join-Path $sdk "ndk") -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $ndk) { throw "Android NDK kurulu değil (Android Studio > SDK Manager > SDK Tools > NDK)" }
$jdk = Get-ChildItem "C:\Program Files\Java" -Directory -Filter "jdk-*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $jdk) { $jdk = Get-Item "C:\Program Files\Android\Android Studio\jbr" -ErrorAction SilentlyContinue }
if (-not $jdk) { throw "JDK bulunamadı" }

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:NDK_HOME = $ndk.FullName
$env:JAVA_HOME = $jdk.FullName
$env:CARGO_BUILD_JOBS = "4"
$env:PATH = "$env:USERPROFILE\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;" + $env:PATH

# OpenSSL: Windows'ta kaynaktan derlenemez (Strawberry Perl Unix yolu üretmez); hazır kütüphane kullanılır.
$ssl = Join-Path $env:USERPROFILE "android-openssl\aarch64"
if (-not (Test-Path (Join-Path $ssl "lib\libcrypto.a"))) { Write-Warning "OpenSSL (Android) yok: $ssl. scripts/build-openssl-android.sh betiğini WSL'de çalıştırın." }
$env:OPENSSL_NO_VENDOR = "1"
$env:OPENSSL_STATIC = "1"
$env:AARCH64_LINUX_ANDROID_OPENSSL_DIR = $ssl
$env:AARCH64_LINUX_ANDROID_OPENSSL_LIB_DIR = Join-Path $ssl "lib"
$env:AARCH64_LINUX_ANDROID_OPENSSL_INCLUDE_DIR = Join-Path $ssl "include"

Write-Host "Android ortamı hazır. SDK: $sdk | NDK: $($ndk.Name) | JDK: $($jdk.Name)"
