# Project Instructions

- Keep changes lean and aligned with `plans/full-session-control.md`.
- After implementation changes, run `node ./build-host.mjs`; this is the canonical test, bundle, and local Pi install/update command.
- Restart Pi or use `/reload` after extension changes.
- Build Windows artifacts with `build-windows.ps1`; add `-PortableOnly` when no installer is needed.
- Do not add services, cloud infrastructure, multi-process orchestration, or broad test suites for this personal LAN MVP.
