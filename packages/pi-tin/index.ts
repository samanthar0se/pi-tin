import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTokenStore } from "./token-store.ts";

export default function piTinSettings(pi: ExtensionAPI): void {
  const tokenStore = createTokenStore();
  pi.registerCommand("pi-tin", {
    description: "Open Pi Tin settings",
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select("Pi Tin settings", ["Generate new token", "Display token"]);
      if (choice === "Generate new token") {
        const token = tokenStore.rotate();
        ctx.ui.notify(`New Pi Tin token: ${token}`, "info");
      } else if (choice === "Display token") {
        ctx.ui.notify(`Pi Tin token: ${tokenStore.get()}`, "info");
      }
    },
  });
}
