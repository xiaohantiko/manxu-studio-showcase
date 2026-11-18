import { defineConfig, normalizePath } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const appRoot = normalizePath(fileURLToPath(new URL(".", import.meta.url)));
const privateFolders = [
  ".git",
  "public",
  "private",
  "electron",
  "dist",
  "output",
  "release",
  ".cache",
  ".playwright-cli",
  "scripts",
  "tests",
];
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "production-csp",
      transformIndexHtml(html, context) {
        return context.server
          ? html
          : html.replace(
              "<head>",
              "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'\"/>",
            );
      },
    },
  ],
  base: "./",
  // `public/` may still hold original local material from older versions.
  publicDir: "demo-public",
  server: {
    host: "127.0.0.1",
    fs: {
      strict: true,
      allow: [appRoot],
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key}",
        ...privateFolders.map((folder) => `${appRoot}${folder}/**`),
      ],
    },
  },
});
