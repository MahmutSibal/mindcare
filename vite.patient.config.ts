import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Danışan web istemcisi. Statik olarak herhangi bir HTTPS sunucusunda yayınlanabilir
// (kamera/mikrofon erişimi için HTTPS zorunludur; localhost hariç).
export default defineConfig({
  root: "patient",
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { port: 5174, strictPort: true },
  build: { outDir: "../dist-patient", emptyOutDir: true },
});
