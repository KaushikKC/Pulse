import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// PULSE web client. Imports the shared protocol package straight from source
// (workspace), so server and client can never drift on the message contract.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow importing @pulse/shared source from the monorepo root.
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
});
