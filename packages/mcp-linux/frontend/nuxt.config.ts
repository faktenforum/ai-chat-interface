import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  ssr: false,

  compatibilityDate: "2025-12-16",

  srcDir: "app",

  app: {
    buildAssetsDir: "/assets/",
  },

  modules: ["@nuxt/ui", "@pinia/nuxt", "@nuxt/eslint"],

  // ModuleOptions only allow fonts + theme here; colors and component defaults go in app.config.ts.
  ui: {
    fonts: false,
    theme: {
      colors: [
        "primary",
        "secondary",
        "tertiary",
        "info",
        "success",
        "warning",
        "error",
        "neutral",
      ],
    },
  },

  vite: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: [tailwindcss() as any],
  },

  css: ["~/assets/css/main.css"],

  imports: {
    dirs: ["composables/**"],
  },

  runtimeConfig: {
    public: {
      // Same-origin by default; override with NUXT_PUBLIC_API_BASE for local dev
      apiBase: "",
    },
  },
});
