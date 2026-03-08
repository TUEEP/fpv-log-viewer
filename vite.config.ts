import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // 2D/3D viewers are lazy-loaded feature chunks; their rendering stacks are
    // intentionally larger than Vite's generic 500 kB warning threshold.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("/three/") ||
            id.includes("/@react-three/") ||
            id.includes("/three-stdlib/") ||
            id.includes("/@react-spring/")
          ) {
            return "three-stack";
          }

          if (id.includes("/maplibre-gl/")) {
            return "map-stack";
          }

          if (
            id.includes("/@mui/") ||
            id.includes("/@emotion/")
          ) {
            return "mui-stack";
          }

          if (
            id.includes("/i18next/") ||
            id.includes("/react-i18next/")
          ) {
            return "i18n-stack";
          }

          return "vendor";
        }
      }
    }
  }
});
