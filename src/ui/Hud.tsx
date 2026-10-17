import { useEffect, useState } from 'react'
import type { HudSnapshot } from '../game/hud'

const pad = (n: number) => String(n).padStart(2, '0')

function Crosshair({ hud }: { hud: HudSnapshot }) {
  const h = typeof window !== 'undefined' ? window.innerHeight : 900
  const gap = 5 + (Math.tan(hud.spread) / Math.tan((hud.fov * Math.PI) / 360)) * (h / 2)
  const len = 7
  return (
    <div className="crosshair" style={{ ['--gap' as string]: `${gap.toFixed(1)}px`, ['--len' as string]: `${len}px` }}>
      <i className="ch-dot" />
      <i className="ch-l top" />
      <i className="ch-l bottom" />
      <i className="ch-l left" />
      <i className="ch-l right" />
      {hud.hitMarker.id > 0 && <HitMarker key={hud.hitMarker.id} kind={hud.hitMarker.kind} />}
    </div>
  )
}

function HitMarker({ kind }: { kind: 'hit' | 'head' | 'kill' }) {
  return (
    <div className={`hitmarker hm-${kind}`} aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </div>
  )
}

function Banner({ hud }: { hud: HudSnapshot }) {
  if (!hud.banner) return null
  return (
    <div className="banner" key={hud.banner.id}>
      <div className="banner-title">{hud.banner.title}</div>
      <div className="banner-sub">{hud.banner.sub}</div>
    </div>
  )
}

function Objective({ hud }: { hud: HudSnapshot }) {
  let line: string
  if (hud.countdown > 1e5) line = 'Waves on hold (test mode)'
  else if (hud.phase === 'warmup') line = `First wave in ${Math.ceil(hud.countdown)}`
  else if (hud.phase === 'intermission') line = `Next wave in ${Math.ceil(hud.countdown)}`
  else if (hud.phase === 'wave') line = `${hud.waveRemaining} infected left`
  else if (hud.phase === 'cleared') line = 'Block secured'
  else line = 'Squad down'
  return (
    <div className="objective">
      <div className="eyebrow">
        {hud.district} · {hud.mapName}
      </div>
      <div className="obj-title">
        Hold the block <span className="obj-wave">Wave {Math.min(hud.wave, hud.waveTotal)}/{hud.waveTotal}</span>
      </div>
      <div className="obj-line">{line}</div>
    </div>
  )
}

function Health({ hud }: { hud: HudSnapshot }) {
  const frac = Math.max(0, hud.health / hud.maxHealth)
  const segments = 10
  return (
    <div className={`health ${frac < 0.35 ? 'low' : ''}`}>
      <div className="eyebrow">
        {hud.characterName}
        {hud.modelPlaceholder && <span className="tag">placeholder model</span>}
      </div>
      <div className="health-row">
        <div className="health-bar" role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={hud.maxHealth} aria-valuenow={hud.health}>
          {Array.from({ length: segments }, (_, i) => {
            const fill = Math.max(0, Math.min(1, frac * segments - i))
            return (
              <span key={i} className="seg">
                <span className="seg-fill" style={{ transform: `scaleX(${fill})` }} />
              </span>
            )
          })}
        </div>
        <div className="health-num">{hud.health}</div>
      </div>
    </div>
  )
}

function Ammo({ hud }: { hud: HudSnapshot }) {
  const low = hud.ammo <= Math.ceil(hud.magSize * 0.25)
  return (
    <div className="ammo">
      <div className="eyebrow">{hud.weaponName}</div>
      <div className="ammo-row">
        <span className={`ammo-mag ${low ? 'low' : ''} ${hud.ammo === 0 ? 'empty' : ''}`}>{pad(hud.ammo)}</span>
        <span className="ammo-res">/ {hud.reserve}</span>
      </div>
      {hud.reloadProgress !== null ? (
        <div className="reload">
          <span style={{ transform: `scaleX(${hud.reloadProgress})` }} />
          <em>Reloading</em>
        </div>
      ) : hud.ammo === 0 ? (
        <div className="reload-hint">{hud.reserve > 0 ? 'Press R to reload' : 'Out of ammo — melee (V)'}</div>
      ) : null}
    </div>
  )
}

function DamageIndicators({ hud }: { hud: HudSnapshot }) {
  return (
    <div className="damage-ring" aria-hidden>
      {hud.damage.map((d) => (
        // angle 0 = straight ahead (top of screen), positive = to the left.
        <div key={d.id} className="damage-arc" style={{ transform: `rotate(${(-d.angle * 180) / Math.PI}deg)` }}>
          <i />
        </div>
      ))}
    </div>
  )
}

function Vignette({ hud }: { hud: HudSnapshot }) {
  const frac = hud.health / hud.maxHealth
  const hurt = Math.max(0, 1 - frac / 0.6)
  const [flash, setFlash] = useState(0)
  const lastId = hud.damage.length ? hud.damage[hud.damage.length - 1].id : 0
  useEffect(() => {
    if (!lastId) return
    setFlash(1)
    const t = window.setTimeout(() => setFlash(0), 120)
    return () => window.clearTimeout(t)
  }, [lastId])
  return <div className="vignette" style={{ opacity: Math.min(1, hurt * 0.85 + flash * 0.5) }} aria-hidden />
}

export function Hud({ hud, onCapture }: { hud: HudSnapshot; onCapture: () => void }) {
  const needsCapture = hud.status === 'playing' && !hud.pointerLocked && !hud.freeLook && !hud.scripted
  return (
    <div className="hud">
      <Vignette hud={hud} />
      <DamageIndicators hud={hud} />
      <Objective hud={hud} />
      <div className="stats">
        <span>
          <b>{hud.kills}</b> kills
        </span>
        <span className="dim">{hud.fps} fps</span>
        {hud.muted && <span className="dim">muted</span>}
      </div>
      <Banner hud={hud} />
      {hud.status === 'playing' && <Crosshair hud={hud} />}
      <Health hud={hud} />
      <Ammo hud={hud} />
      {needsCapture && (
        <button className="capture" onClick={onCapture}>
          <b>Click to capture the mouse</b>
          <span>The encounter is frozen until you do</span>
        </button>
      )}
      {hud.freeLook && hud.status === 'playing' && <div className="freelook-hint">Mouse capture unavailable here — move the mouse over the game to look.</div>}
    </div>
  )
}
