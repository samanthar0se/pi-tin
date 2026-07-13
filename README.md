# Pi Remote

A small Windows desktop client for attaching to an already-running [Pi](https://github.com/earendil-works/pi) coding-agent session on a trusted local network. It mirrors the live conversation and tool lifecycle, exposes model/thinking/plan controls, and opens [Plannotator](https://github.com/backnotprop/plannotator) plan and code reviews inside the app.

## MVP boundaries

- One active connection at a time; multiple host profiles can be saved.
- Pi is started manually on the remote host. Pi Remote does not use SSH or supervise processes.
- Current live session only—no historical session browser, file manager, attachments, or cloud service.
- Control traffic is token-authenticated but uses plain WebSocket on the LAN.
- Plannotator's transient review port is currently unauthenticated upstream. Restrict both ports with the host firewall and do not expose them to the internet.

## Remote host setup

Requirements: Pi >= 0.74, Node.js, pnpm, and a clone of this repository.

```bash
# Install Plannotator into Pi once
pi install npm:@plannotator/pi-extension

# Prepare this extension
cd /path/to/pi-remote
corepack enable
pnpm install
pnpm typecheck

# Register the local package with Pi
pi install /path/to/pi-remote/packages/pi-remote
```

Set matching values before starting Pi. Use a long random token and unique ports for each simultaneous Pi process on the same machine.

```bash
export PI_REMOTE_HOST=0.0.0.0
export PI_REMOTE_PORT=31415
export PI_REMOTE_TOKEN='replace-with-a-long-random-token'
export PLANNOTATOR_REMOTE=1
export PLANNOTATOR_PORT=19432

# Start normally, or begin in Plannotator plan mode
pi
# pi --plan
```

The extension refuses to listen when `PI_REMOTE_TOKEN` is empty. `PLANNOTATOR_REMOTE=1` makes Plannotator bind its transient UI to the LAN; it does not try to open a browser on the remote machine.

Allow only your local subnet through the firewall. Example with UFW:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 31415 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 19432 proto tcp
```

Example for a Windows Pi host (run PowerShell as Administrator and adjust the subnet):

```powershell
New-NetFirewallRule -DisplayName "Pi Remote control" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 31415 -RemoteAddress 192.168.1.0/24
New-NetFirewallRule -DisplayName "Pi Remote Plannotator" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 19432 -RemoteAddress 192.168.1.0/24
```

## Add the host in the Windows app

1. Start Pi manually on the remote host with the environment above.
2. Open Pi Remote and choose **+** in the instance sidebar.
3. Enter a name, the remote IP/hostname, `31415`, `19432`, and the same token.
4. Save. A green indicator and session working directory confirm that the authoritative snapshot arrived.

The token is stored in Tauri Store as local application data, not Windows Credential Manager. This is an explicit personal-project tradeoff.

## Chat and reviews

- Send normally while Pi is idle. Sending while it runs is delivered as steering guidance.
- Use Stop to call Pi's abort operation.
- Model, thinking level, compact, and plan mode act on the remote Pi session.
- In plan mode, `plannotator_submit_plan` automatically opens the Review tab. Approve, reject, or annotate there; the blocked tool resumes directly from Plannotator.
- **Review changes** opens an uncommitted-change code review. Submitted feedback is sent back to Pi as a follow-up.
- You can return to Chat while a review is open; the Review tab remains visible until the matching review completes.

If review loading stalls, verify `PLANNOTATOR_PORT`, `PLANNOTATOR_REMOTE=1`, the firewall rule, and that `@plannotator/pi-extension` is installed. Only one review can use a configured Plannotator port at a time.

## Development

Windows prerequisites for the native shell:

- Node.js 22+ and pnpm
- Rust stable (`rustup`)
- Microsoft C++ Build Tools with the Desktop C++ workload
- WebView2 Runtime (included on current Windows releases)

```powershell
cd C:\git\pi-remote
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm dev                 # browser UI only
pnpm tauri dev           # native development window
```

The browser-only UI falls back to `localStorage` for profiles. A Tauri build uses the Store plugin.

## Build Windows installers

```powershell
cd C:\git\pi-remote
pnpm test
pnpm typecheck
pnpm --filter @pi-remote/desktop tauri build --bundles msi,nsis
```

Artifacts are written below `apps/desktop/src-tauri/target/release/bundle/`.

## Focused smoke test

Use a Windows client and a second LAN machine running Pi:

- connect and receive the existing session snapshot;
- send and observe streaming text/thinking;
- run a tool and inspect running/completed output;
- stop a run;
- interrupt the network mid-stream, restore it, and verify snapshot replacement;
- switch model/thinking and compact;
- enter plan mode, then approve, reject, annotate, and revise a plan;
- submit code-review feedback and verify it reaches Pi;
- launch the packaged MSI/NSIS app and reconnect.

## Design and licenses

The transport intentionally follows Tau's excellent in-process Pi extension pattern: raw lifecycle events over WebSocket, request-ID commands, reconnect backoff, and a fresh authoritative snapshot. Tau is MIT-licensed. Plannotator is MIT OR Apache-2.0, and assistant-ui is MIT. See each dependency/repository for its license text.
