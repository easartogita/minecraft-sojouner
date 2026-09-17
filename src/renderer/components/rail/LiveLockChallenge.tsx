import { useState } from 'react'

// Gate shown when a write was refused because the destination world's
// session.lock looks held by a live Minecraft client (see session_lock in
// structure_copy/mod.rs). Deliberately not a checkbox or a typed "yes" —
// the point is a small amount of real friction so bypassing it never
// happens by reflex click. The problem generator/checker below is fully
// self-contained and swappable independent of the override plumbing in
// StructureCopyFlyout.tsx and tauriAPI.ts — change what's asked here
// without touching anything else.

type Problem = { prompt: string; answer: number }

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function makeProblem(): Problem {
  if (Math.random() < 0.5) {
    // Power-rule derivative at a point: f(x) = a·x^n, f'(x) = a·n·x^(n-1).
    const a = randInt(1, 5)
    const n = randInt(2, 3)
    const x0 = randInt(-4, 4)
    return { prompt: `d/dx of ${a}x^${n}, evaluated at x = ${x0}. What's the value?`, answer: a * n * Math.pow(x0, n - 1) }
  }
  // Definite integral of a monomial: integral[p,q] a·x^n dx = a/(n+1) · (q^(n+1) - p^(n+1)).
  const a = randInt(1, 5)
  const n = randInt(1, 2)
  const p = randInt(-4, 3)
  const q = randInt(p + 1, 4)
  return {
    prompt: `∫ from ${p} to ${q} of ${a}x^${n} dx. What's the value?`,
    answer: (a / (n + 1)) * (Math.pow(q, n + 1) - Math.pow(p, n + 1)),
  }
}

export default function LiveLockChallenge({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [problem, setProblem] = useState<Problem>(() => makeProblem())
  const [input, setInput] = useState('')
  const [wrong, setWrong] = useState(false)

  const submit = () => {
    const parsed = parseFloat(input)
    if (!Number.isNaN(parsed) && Math.abs(parsed - problem.answer) < 1e-6) {
      onConfirm()
    } else {
      setWrong(true)
      setProblem(makeProblem())
      setInput('')
    }
  }

  return (
    <div className="mp-empty" style={{ border: '1px solid var(--danger, #e55)', borderRadius: 6, padding: 8, marginTop: 8 }}>
      <div style={{ color: 'var(--danger, #e55)', fontWeight: 600, marginBottom: 4 }}>
        Destination world looks open in a live Minecraft client.
      </div>
      <div style={{ fontSize: 12, marginBottom: 6 }}>
        Writing into it now risks corrupting or losing whatever MC hasn't saved yet.
        Answer this to confirm you really mean it:
      </div>
      <div style={{ fontSize: 13, marginBottom: 6 }}>{problem.prompt}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="number" step="any" value={input}
          onChange={e => { setInput(e.target.value); setWrong(false) }}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          style={{ width: 90 }}
          autoFocus
        />
        <button className="btn-sm" onClick={submit}>Write anyway</button>
        <button className="btn-sm" onClick={onCancel}>Cancel</button>
      </div>
      {wrong && (
        <div style={{ fontSize: 11, color: 'var(--danger, #e55)', marginTop: 4 }}>
          Not quite — here's a new one.
        </div>
      )}
    </div>
  )
}
