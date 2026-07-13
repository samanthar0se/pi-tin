import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTokenStore } from "./token-store.ts";

export default function piRemoteSettings(pi: ExtensionAPI): void {
  const tokenStore = createTokenStore();
  pi.registerCommand("pi-remote", {
    description: "Open Pi Remote settings",
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select("Pi Remote settings", ["Generate new token", "Display token"]);
      if (choice === "Generate new token") {
        const token = tokenStore.rotate();
        ctx.ui.notify(`New Pi Remote token: ${token}`, "info");
      } else if (choice === "Display token") {
        ctx.ui.notify(`Pi Remote token: ${tokenStore.get()}`, "info");
      }
    },
  });
}
