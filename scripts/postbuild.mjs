// Copies the built Tauri bundles into release/<version>/. Plain Node fs
// calls instead of shell `mkdir -p` / `cp -r` so this runs the same on
// Windows (cmd/PowerShell has neither) as it does on macOS/Linux.
import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const version = process.env.npm_package_version
if (!version) {
  console.error('postbuild: npm_package_version is not set — run this via `npm run build`, not directly.')
  process.exit(1)
}

const src = join('src-tauri', 'target', 'release', 'bundle')
const dest = join('release', version)

if (!existsSync(src)) {
  console.error(`postbuild: no bundle output at ${src} — did the Tauri build actually run?`)
  process.exit(1)
}

mkdirSync(dest, { recursive: true })
// dereference: true — some bundlers (AppImage) leave same-directory symlinks
// (e.g. .DirIcon -> Sojourner.png) that Node's recursive cp chokes on
// (ERR_FS_CP_EINVAL) and that would be broken anyway if preserved: an
// absolute-path symlink copied into release/ still points back at the
// original build dir, not the copy.
cpSync(src, dest, { recursive: true, dereference: true })
console.log(`postbuild: copied ${src} -> ${dest}`)
