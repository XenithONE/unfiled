import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The hub is a React app; games/* are extra static entry pages built by the
// same Vite run (multi-page). Relative base keeps every page portable under
// /unfiled/.
export default defineConfig({
  plugins: [react()],
  base: "./",
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
