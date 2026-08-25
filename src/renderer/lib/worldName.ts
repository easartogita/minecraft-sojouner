const MAX_LEN = 60

// Minecraft §-formatting codes (color/bold/italic/reset etc.) — level names
// come straight from arbitrary NBT string data, not a controlled UI label.
const FORMAT_CODE_RE = /§[0-9a-fk-or]/gi

// C0/DEL control characters — stripped by code point rather than a regex
// control-character range, to avoid embedding raw unprintable bytes in source.
function stripControlChars(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) continue
    out += ch
  }
  return out
}

/** Display name for a loaded world: sanitized level name, falling back to
 * the save folder's name, then hard-capped so it can't blow out a fixed-width
 * label (callers still get the raw value for a tooltip/title). */
export function getWorldDisplayName(worldDir: string | null | undefined, levelName: string | null | undefined): string {
  const cleaned = stripControlChars((levelName ?? '').replace(FORMAT_CODE_RE, ''))
    .replace(/\s+/g, ' ')
    .trim()

  const base = cleaned || (worldDir ? (worldDir.replace(/\\/g, '/').split('/').pop() ?? worldDir) : '')

  return base.length > MAX_LEN ? `${base.slice(0, MAX_LEN)}…` : base
}
