# Pi Remote

A small Windows desktop client for attaching to an already-running [Pi](https://github.com/earendil-works/pi) coding-agent session on a trusted local network. It mirrors the live conversation and tool lifecycle, exposes model/thinking/plan controls, and opens [Plannotator](https://github.com/backnotprop/plannotator) plan and code reviews inside the app.

## MVP boundaries

- One active connection at a time; multiple host profiles can be saved.
- Pi is started manually on the remote host. Pi Remote does not use SSH or supervise processes.
- Current live session only—no historical session browser, file manager, attachments, or cloud service.
- Control traffic is token-authenticated but uses plain WebSocket on the LAN.
- Plannotator's transient review port is currently unauthenticated upstream. Restrict both ports with the host firewall and do not expose them to the internet.

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

The builder:

1. installs the locked workspace dependencies through Corepack;
2. runs tests and type-checking;
3. bundles the protocol, Zod, and WebSocket server into a self-contained `packages/pi-remote/dist/index.mjs`;
4. installs or refreshes that built directory as a global local-path Pi package;
5. installs or updates `@plannotator/pi-extension`;
6. explains how to display or rotate the extension-generated token.

Re-run the file after `git pull` to rebuild and update the extension on that host. Use `--skip-tests` for a faster repeat build or `--skip-plannotator` to leave the installed Plannotator version unchanged.

Set matching ports before starting Pi. Each extension installation automatically generates a cryptographically random token and persists it in `~/.pi/agent/pi-remote.json` with user-only permissions. Use unique control and review ports for each simultaneous Pi process on the same machine.

```bash
export PI_REMOTE_HOST=0.0.0.0
export PI_REMOTE_PORT=31415
export PLANNOTATOR_REMOTE=1
export PLANNOTATOR_PORT=19432

# Start normally, or begin in Plannotator plan mode
pi
# pi --plan
```

Run `/pi-remote` inside Pi to open its settings menu. Choose **Display token** when configuring the desktop client, or **Generate new token** to rotate it and disconnect clients authenticated with the old value. `PLANNOTATOR_REMOTE=1` makes Plannotator bind its transient UI to the LAN; it does not try to open a browser on the remote machine.

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
3. Run `/pi-remote` → **Display token** on the host, then enter that token with the host name/IP, `31415`, and `19432`.
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

## Build the Windows executable on another computer

Clone the repository, open PowerShell in its root, and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
```

The script checks prerequisites, installs locked JavaScript dependencies, runs tests and type-checking, then copies both the portable application and Tauri NSIS installer into `artifacts\`. The portable file is named `Pi-Remote-portable.exe` and can be run without installation.

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
