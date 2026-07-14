# Project Instructions

- Keep the product lean: one configured host, up to five persistent Pi RPC sessions, compact session tabs, and no host or saved-session browser.
- After implementation changes, run `node ./build-host.mjs`; this is the canonical test, bundle, and local Pi install/update command.
- After completing any repository change, commit the task's changes to Git and push the commit to the configured remote; do not leave completed work uncommitted or unpushed.
- Restart Pi or use `/reload` after extension changes.
- Build Windows artifacts with `build-windows.ps1`; add `-PortableOnly` when no installer is needed.
- Do not add services, cloud infrastructure, multi-process orchestration, or broad test suites for this personal LAN MVP.
