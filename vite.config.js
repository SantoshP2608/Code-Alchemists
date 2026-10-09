import { defineConfig } from "vite";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp"
};

export default defineConfig({
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: {
    format: "es"
  },

  build: {
    outDir: "dist",
    rollupOptions: {
      input: resolve(projectRoot, "frontend/index.html")
    }
  },

  plugins: [{
    name: "calcink-deployment-files",

    closeBundle() {
      copyFileSync(
        resolve(projectRoot, "dist/frontend/index.html"),
        resolve(projectRoot, "dist/index.html")
      );
    }
  }]
});
