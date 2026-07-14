import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Bind on all interfaces (not just localhost) so the UI is reachable from a
  // tablet on the LAN when the dev/preview server runs on the Ubuntu box.
  server: { host: true, port: 5173 },
  preview: { host: true, port: 5173 },
});
