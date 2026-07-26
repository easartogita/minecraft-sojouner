import { useEffect, useRef } from 'react'

// Sky color keyframes: [tick, [r, g, b]]
const SKY_KEYS: [number, [number, number, number]][] = [
  [0,     [255, 130,  60]],  // sunrise
  [2000,  [170, 210, 245]],  // morning
  [6000,  [ 65, 130, 210]],  // noon
  [10000, [ 65, 130, 210]],  // afternoon
  [12000, [255, 130,  60]],  // sunset
  [13500, [ 70,  35,  70]],  // dusk
  [15000, [ 18,  18,  55]],  // early night
  [18000, [  6,   6,  18]],  // midnight
  [21000, [ 18,  18,  55]],  // late night
  [23000, [ 40,  20,  60]],  // pre-dawn
  [24000, [255, 130,  60]],  // back to sunrise
]

function skyColor(tick: number): [number, number, number] {
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const [t0, c0] = SKY_KEYS[i]
    const [t1, c1] = SKY_KEYS[i + 1]
    if (tick >= t0 && tick <= t1) {
      const t = (tick - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ]
    }
  }
  return SKY_KEYS[0][1]
}

// 30 pseudo-random star positions, fixed for all instances
const STARS: [number, number][] = (() => {
  const stars: [number, number][] = []
  let s = 42
  for (let i = 0; i < 30; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    const x = (s & 0xffff) / 0xffff        // 0..1 fraction of width
    s = (s * 1664525 + 1013904223) >>> 0
    const y = (s & 0xff) / 0xff * 0.9      // 0..0.9 fraction of height
    stars.push([x, y])
  }
  return stars
})()

function mcTimeLabel(tick: number): string {
  const mcHour = Math.floor(tick / 1000 + 6) % 24
  const mcMin  = Math.floor((tick % 1000) / 1000 * 60)
  return `${String(mcHour).padStart(2, '0')}:${String(mcMin).padStart(2, '0')}`
}

export default function DayNightBar({ dayTime }: { dayTime: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const tick = dayTime % 24000
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight
      if (w === 0 || h === 0) return
      if (canvas.width !== w)  canvas.width  = w
      if (canvas.height !== h) canvas.height = h

      const ctx = canvas.getContext('2d')!

      // Sky background
      const [sr, sg, sb] = skyColor(tick)
      ctx.fillStyle = `rgb(${sr},${sg},${sb})`
      ctx.fillRect(0, 0, w, h)

      // Stars — fade in after sunset (12500), fade out before sunrise (23500)
      const starIn  = Math.max(0, Math.min(1, (tick - 12500) / 1000))
      const starOut = Math.max(0, Math.min(1, (23500 - tick) / 1000))
      const starOpacity = Math.min(starIn, starOut)
      if (starOpacity > 0) {
        ctx.fillStyle = `rgba(255,255,255,${starOpacity * 0.9})`
        for (const [fx, fy] of STARS) {
          ctx.fillRect(Math.round(fx * w), Math.round(fy * h), 1, 1)
        }
      }

      // Sun: visible ticks 0–12000
      if (tick <= 12000) {
        const p  = tick / 12000
        const sx = p * w
        const sy = h - 5 - Math.sin(p * Math.PI) * (h - 10)
        ctx.save()
        ctx.shadowColor  = 'rgba(255, 220, 80, 0.7)'
        ctx.shadowBlur   = 10
        ctx.fillStyle    = '#ffe066'
        ctx.beginPath()
        ctx.arc(sx, sy, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // Moon: visible ticks 12000–24000
      if (tick >= 12000) {
        const p  = (tick - 12000) / 12000
        const mx = p * w
        const my = h - 5 - Math.sin(p * Math.PI) * (h - 10)
        ctx.save()
        ctx.shadowColor  = 'rgba(200, 220, 255, 0.5)'
        ctx.shadowBlur   = 8
        ctx.fillStyle    = '#d0d8f0'
        ctx.beginPath()
        ctx.arc(mx, my, 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // Time label
      const label = mcTimeLabel(tick)
      ctx.font         = "11px 'IBM Plex Mono', 'DejaVu Sans Mono', monospace"
      ctx.textBaseline = 'middle'
      ctx.textAlign    = 'right'
      ctx.fillStyle    = 'rgba(255,255,255,0.65)'
      ctx.fillText(label, w - 8, h / 2)
    }

    draw()

    // Redraw on container resize (e.g. sidebar width change, window resize)
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [dayTime])

  return (
    <div className="day-night-bar">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  )
}
