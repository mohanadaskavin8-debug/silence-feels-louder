import { useEffect } from 'react'
import type { HudSnapshot } from '../game/hud'
import { ONLINE_MULTIPLAYER_AVAILABLE } from '../net/session'
import type { Settings } from './settings'

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Left click', 'Fire'],
  ['Right click', 'Aim'],
  ['Shift', 'Sprint'],
  ['R', 'Reload'],
  ['V', 'Melee shove'],
  ['Esc', 'Pause'],
  ['M', 'Mute'],
]

function Controls() {
  return (
    <dl className="controls">
      {CONTROLS.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Enter / Space trigger the primary action on menu screens. */
function useHotkey(handler: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handler])
}

export function TitleScreen({ hud, onStart }: { hud: HudSnapshot; onStart: () => void }) {
  useHotkey(onStart)
  return (
    <div className="screen title-screen">
      <div className="title-col">
        <div className="eyebrow">Milestone 1 · playable prototype</div>
        <h1 className="logo">
          KS BVNDZ
          <span>Silence Feels Louder</span>
        </h1>
        <div className="mission-card">
          <div className="eyebrow">
            Deploy · {hud.district || 'Dolly'} · {hud.mapName || 'Block 7'}
          </div>
          <div className="mission-name">{hud.encounterName || 'Hold Block 7'}</div>
          <p>The infected are pouring out of the alleys. Survive three waves in the courtyard.</p>
          <div className="mission-meta">
            <span>
              Operator <b>{hud.characterName || 'KsBvndz'}</b>
            </span>
            <span>
              Sidearm <b>{hud.weaponName || 'Ville-9'}</b>
            </span>
          </div>
        </div>
        <button className="btn primary" onClick={onStart} autoFocus>
          Deploy
        </button>
        <Controls />
        <p className="fineprint">
          Solo only for now — online co-op is {ONLINE_MULTIPLAYER_AVAILABLE ? 'available' : 'not implemented yet (Milestone 5)'}. The
          Ville hub, character select and loadouts arrive in Milestone 2. All characters use placeholder models until approved
          reference art is supplied. Placeholder audio is synthesized in the browser.
        </p>
      </div>
    </div>
  )
}

export function PauseMenu({
  settings,
  onSettings,
  onResume,
  onRestart,
  onQuit,
}: {
  settings: Settings
  onSettings: (s: Settings) => void
  onResume: () => void
  onRestart: () => void
  onQuit: () => void
}) {
  useHotkey(onResume)
  return (
    <div className="screen modal">
      <div className="panel">
        <div className="eyebrow">Paused</div>
        <div className="btn-col">
          <button className="btn primary" onClick={onResume} autoFocus>
            Resume
          </button>
          <button className="btn" onClick={onRestart}>
            Restart encounter
          </button>
          <button className="btn ghost" onClick={onQuit}>
            Quit to title
          </button>
        </div>
        <div className="settings">
          <label>
            <span>Mouse sensitivity</span>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.05}
              value={settings.sensitivity}
              onChange={(e) => onSettings({ ...settings, sensitivity: Number(e.target.value) })}
            />
            <output>{settings.sensitivity.toFixed(2)}</output>
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.invertY} onChange={(e) => onSettings({ ...settings, invertY: e.target.checked })} />
            <span>Invert vertical look</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.muted} onChange={(e) => onSettings({ ...settings, muted: e.target.checked })} />
            <span>Mute audio</span>
          </label>
        </div>
        <Controls />
      </div>
    </div>
  )
}

function Stats({ hud }: { hud: HudSnapshot }) {
  return (
    <dl className="stats-grid">
      <div>
        <dt>Wave reached</dt>
        <dd>
          {Math.min(hud.wave, hud.waveTotal)} / {hud.waveTotal}
        </dd>
      </div>
      <div>
        <dt>Kills</dt>
        <dd>{hud.kills}</dd>
      </div>
      <div>
        <dt>Accuracy</dt>
        <dd>{Math.round(hud.accuracy * 100)}%</dd>
      </div>
      <div>
        <dt>Time</dt>
        <dd>{fmtTime(hud.elapsed)}</dd>
      </div>
    </dl>
  )
}

export function DeathScreen({ hud, onRestart, onQuit }: { hud: HudSnapshot; onRestart: () => void; onQuit: () => void }) {
  useHotkey(onRestart)
  return (
    <div className="screen modal death">
      <div className="panel">
        <div className="eyebrow">Encounter failed</div>
        <h2 className="big">Silenced</h2>
        <p className="lede">
          {hud.characterName} went down in {hud.mapName}.
        </p>
        <Stats hud={hud} />
        <div className="btn-col">
          <button className="btn primary" onClick={onRestart} autoFocus>
            Restart encounter
          </button>
          <button className="btn ghost" onClick={onQuit}>
            Quit to title
          </button>
        </div>
      </div>
    </div>
  )
}

export function ClearedScreen({ hud, onRestart, onQuit }: { hud: HudSnapshot; onRestart: () => void; onQuit: () => void }) {
  useHotkey(onRestart)
  return (
    <div className="screen modal cleared">
      <div className="panel">
        <div className="eyebrow">Encounter complete</div>
        <h2 className="big">{hud.mapName} held</h2>
        <p className="lede">All {hud.waveTotal} waves cleared. Rewards and the return to The Ville arrive in Milestone 2.</p>
        <Stats hud={hud} />
        <div className="btn-col">
          <button className="btn primary" onClick={onRestart} autoFocus>
            Play again
          </button>
          <button className="btn ghost" onClick={onQuit}>
            Quit to title
          </button>
        </div>
      </div>
    </div>
  )
}

export function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="screen modal">
      <div className="panel">
        <div className="eyebrow">Can't start the game</div>
        <p className="lede">{message}</p>
      </div>
    </div>
  )
}
