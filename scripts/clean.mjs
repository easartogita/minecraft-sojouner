// Cross-platform `rm -rf` for every build artifact dir — the shell version
// only worked on a POSIX shell; Windows has neither `rm` nor the `-rf` flags.
import { rmSync } from 'node:fs'

for (const dir of ['dist', 'src-tauri/target', 'release', 'node_modules/.vite']) {
  rmSync(dir, { recursive: true, force: true })
  console.log(`clean: removed ${dir}`)
}
