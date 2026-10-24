import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";

// The hub is a React app; games/* are extra static entry pages built by the
// same Vite run (multi-page). Relative base keeps every page portable under
// /unfiled/.
export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    __BUILD_STAMP__: JSON.stringify(stamp),
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        rakugaki: "games/rakugaki/index.html",
        everest: "games/everest/index.html",
        alpine: "games/alpine-rail/index.html",
      },
    },
  },
});
