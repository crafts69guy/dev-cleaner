# Developer Cleaner

Developer Cleaner is a local-first Raycast extension for reviewing and cleaning stale developer tools, caches, and generated project artifacts on macOS.

Nothing is removed automatically. You choose every cleanup candidate and confirm the operation before it runs.

## Cleanup Sources

- Old Codex and Claude Code installations, while preserving the current version and one rollback version
- Codex and Claude temporary staging data older than seven days
- npm cache verification and stale `npx` workspaces
- pnpm and uv native cache pruning, plus pnpm stores from older store formats
- Old fnm-managed Node.js versions while preserving the default and one rollback version
- Inactive rustup toolchains and regenerable Cargo registry/Git caches
- Gradle caches, wrapper distributions, Android user cache, and SDK temporary downloads
- Optional Bun cache clearing and Homebrew cleanup
- Xcode DerivedData
- Docker unused images and build cache; containers, networks, and volumes are preserved
- Selected `node_modules`, `.next`, `dist`, `build`, and `target` directories under configured project roots

## Safety Model

- File and directory candidates move to the macOS Trash and remain recoverable until the Trash is emptied.
- Package-manager, Homebrew, and Docker cleanup commands permanently remove their own data.
- Native commands are executed directly without a shell.
- Cleanup paths must be below an approved root. Project artifacts also require an allowlisted directory name.
- Symlinks are not followed while calculating sizes or scanning projects.
- AI sessions, project history, credentials, configuration, plugins, Docker volumes, and active containers are outside the cleanup scope.
- fnm, rustup, Cargo, Gradle, and Android candidates are never selected by default.

## Development

Requires Node.js 24 LTS and Raycast for macOS.

```fish
npm install
npm run dev
npm test
npm run test:coverage
npm run typecheck
npm run lint
npm run build
```

The first launch offers an optional directory picker for project artifacts. Additional command lookup paths can be configured in the extension preferences.

Project scanning is optional. Continue without selecting a directory to scan developer tools and caches only. Scan results appear progressively and an in-progress scan can be canceled from the action panel.

Completed operations are recorded in a local cleanup history with per-item success and failure details. Displayed cache sizes represent the current footprint; native tools determine how much of that footprint is actually reclaimable.

## Privacy

Developer Cleaner has no telemetry and performs no network requests. All scanning and cleanup happen locally on the Mac where Raycast is running.
