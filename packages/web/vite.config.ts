import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sudoku-fight/shared": path.join(dir, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
  },
});
