# Pi Remote

A small Windows desktop client for controlling one persistent [Pi](https://github.com/earendil-works/pi) coding-agent session on a trusted local network. It mirrors live chat/tool activity and embeds [Plannotator](https://github.com/backnotprop/plannotator) reviews.

## MVP boundaries

- Exactly one host connection and one persistent Pi RPC session; there is no host or session browser.
- A foreground host controller owns the RPC child process. It is not a system service and does not use SSH.
- Session management, simultaneous agents, file management, attachments, and cloud services are intentionally out of scope.
- Control traffic is token-authenticated but uses plain WebSocket on the LAN.
- Plannotator's transient review port remains unauthenticated upstream. Restrict both ports with the host firewall and do not expose them to the internet.

## Remote host setup

Requirements: Pi >= 0.74, Node.js 22+ with Corepack, and a clone of this repository.

Run the cross-platform host builder from the repository root:

```bash
node ./build-host.mjs
```

On Windows PowerShell, the same command is:

```powershell
node .\build-host.mjs
```

The builder installs dependencies, runs focused validation, bundles the foreground host controller, installs the small `/pi-remote` settings extension, and installs/updates Plannotator.

Re-run it after `git pull`, then start remote control from the repository root:

```bash
export PI_REMOTE_HOST=0.0.0.0
export PI_REMOTE_PORT=31415
export PLANNOTATOR_PORT=19432
node ./start-host.mjs
```

The controller prints its cryptographically random token at startup and persists it in `~/.pi/agent/pi-remote.json`. It starts one Pi `--mode rpc` child and restores that session after restart. Run a separate normal TUI process only when local terminal use is wanted; it is independent of the controller.

Run `/pi-remote` in a normal Pi TUI to display or rotate the shared token. Rotation disconnects authenticated desktop clients. Use `--skip-tests` for a quick host rebuild or `--skip-plannotator` to leave Plannotator unchanged.

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

1. Start `node ./start-host.mjs` on the remote machine and copy the printed token.
2. Open Connection Settings from the gear in the top toolbar.
3. Enter the host/IP, `31415`, `19432`, and token, then save and connect.
4. Reopen Settings whenever the single connection needs to be changed or removed.

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

The browser-only UI falls back to `localStorage` for connection settings. A Tauri build uses the Store plugin.

## Build the Windows executable on another computer

Clone the repository, open PowerShell in its root, and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
```

The script checks prerequisites, installs locked JavaScript dependencies, runs tests and type-checking, removes all cached release output so fresh frontend assets are embedded, then copies both the portable application and Tauri NSIS installer into `artifacts\`. The portable file is named `Pi-Remote-portable.exe` and can be run without installation.

On a new Windows development machine, open PowerShell as Administrator and allow the script to install missing Node.js, Rust, and Visual C++ Build Tools through `winget`:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-windows.ps1 -InstallPrerequisites
```

Optional flags:

- `-PortableOnly` builds only `artifacts\Pi-Remote-portable.exe` and skips installer generation.
- `-Clean` removes previous frontend, Rust, and artifact output first.
- `-SkipTests` skips tests and type-checking for a faster repeat build.

For a portable-only build:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-windows.ps1 -PortableOnly
```

The portable executable is self-contained except for Microsoft WebView2 Runtime, which is already present on current Windows 10/11 systems. On older or stripped-down Windows installations, install the WebView2 Evergreen Runtime before launching it.

You can still invoke Tauri directly when both NSIS and MSI installers are wanted:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm --filter @pi-remote/desktop tauri build --bundles msi,nsis
```

Native bundle output is written below `apps/desktop/src-tauri/target/release/bundle/`.

## Focused smoke test

Use a Windows client and a second LAN machine running Pi:

- connect and receive the current session snapshot;
- send and observe streaming text/thinking;
- run a tool and inspect running/completed output;
- stop a run;
- interrupt the network mid-stream, restore it, and verify snapshot replacement;
- switch model/thinking and compact;
- enter plan mode, then approve, reject, annotate, and revise a plan;
- submit code-review feedback and verify it reaches Pi;
- launch the packaged MSI/NSIS app and reconnect.

## Design and licenses

The transport retains Tau's excellent WebSocket ideas—raw lifecycle events, request-ID commands, reconnect backoff, and authoritative snapshots—while the host controller uses Pi's public RPC API for one persistent session. Tau is MIT-licensed. Plannotator is MIT OR Apache-2.0, and assistant-ui is MIT. See each dependency/repository for its license text.
