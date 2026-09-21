import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/auto-icons"],
  autoIcons: {
    baseIconPath: "assets/anti-dead.png",
    developmentIndicator: "grayscale",
  },
  manifest: {
    name: "Anti-dead internet",
    description: "Marks or hides tweets whose wording is likely AI-generated.",
    minimum_chrome_version: "102",
    permissions: ["storage"],
    host_permissions: ["https://api.typesafe.ai/*"],
    action: {
      default_title: "Anti-dead internet",
    },
  },
});
