import { watchFile, unwatchFile } from "node:fs";
import { HostController } from "./controller.ts";
import { HostWebSocketServer } from "./websocket-server.ts";

const host = process.env.PI_TIN_HOST || process.env.PI_REMOTE_HOST || "0.0.0.0";
const port = Number(process.env.PI_TIN_PORT || process.env.PI_REMOTE_PORT || 31415);
const controller = new HostController();
const server = new HostWebSocketServer(controller, host, port);

await controller.start();
await server.start();
console.log(`[pi-tin] Host ready on ws://${host}:${port}`);
console.log(`[pi-tin] Token: ${controller.tokenStore.get()}`);

const tokenPath = controller.tokenStore.path;
watchFile(tokenPath, { interval: 750 }, () => server.disconnectAuthenticated("Pi Tin token changed"));

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  unwatchFile(tokenPath);
  await server.stop();
  await controller.stop();
}
process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
