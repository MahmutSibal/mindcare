fn main() {
    // Simgeler değişince exe'ye gömülü simge de yeniden üretilsin (aksi halde eski simge kalabiliyor).
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
