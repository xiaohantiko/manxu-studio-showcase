import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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
  server: { host: "127.0.0.1" },
});
