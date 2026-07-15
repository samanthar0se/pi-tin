# Project Instructions

- Keep the product lean: one configured host, up to five persistent Pi RPC sessions, compact session tabs, and no host or saved-session browser.
- After implementation changes, run `node ./build-host.mjs`; this is the canonical test, bundle, and local Pi install/update command.
- After completing any repository change, commit the task's changes to Git and push the commit to the configured remote; do not leave completed work uncommitted or unpushed.
- Restart Pi or use `/reload` after extension changes.
- Build Windows artifacts with `build-windows.ps1`; add `-PortableOnly` when no installer is needed.
- Do not add services, cloud infrastructure, multi-process orchestration, or broad test suites for this personal LAN MVP.
- When running Windows commands through bash, redirect to `/dev/null`, never `NUL`; MSYS-style shells can create an actual `NUL` file in the repository.
- For nontrivial PowerShell containing `$` variables or process management, write a temporary `.ps1` and invoke it with `powershell -File` instead of nesting it inside `bash` with `-Command`. Capture launched PIDs directly; do not stop processes with a command-line filter that can match the cleanup command itself.
- Confirm inferred dependency and generated-file paths with `rg --files` before calling `read`; package sources may use extensions such as `.tsx` rather than `.ts`.
