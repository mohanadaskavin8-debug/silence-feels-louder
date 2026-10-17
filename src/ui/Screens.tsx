import { useEffect } from 'react'
import type { HudSnapshot } from '../game/hud'
import { ONLINE_MULTIPLAYER_AVAILABLE } from '../net/session'
import type { Settings } from './settings'

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['E', 'Use station (The Ville)'],
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
      if (e.repeat || (e.code !== 'Enter' && e.code !== 'Space')) return
      // A focused button/checkbox handles Enter/Space itself; the hotkey is for when nothing is focused.
      const t = e.target as Element | null
      if (t && t !== document.body && t.closest('button, input, select, textarea, a, [role="option"], [role="radio"]')) return
      e.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handler])
}

export function TitleScreen({ hud, onStart }: { hud: HudSnapshot; onStart: () => void }) {
  useHotkey(onStart)
  const p = hud.profile
  const cleared = p ? Object.values(p.missions).filter((m) => m.clears > 0).length : 0
  return (
    <div className="screen title-screen">
      <div className="title-col">
        <div className="eyebrow">Milestone 2 · playable prototype</div>
        <h1 className="logo">
          KS BVNDZ
          <span>Silence Feels Louder</span>
        </h1>
        <div className="mission-card">
          <div className="eyebrow">Home · The Ville</div>
          <div className="mission-name">Back on the block</div>
          <p>Gear up at the armory, set your squad, pick a mission off the board and deploy into the infected territories.</p>
          {p && (
            <div className="mission-meta">
              <span>
                Missions cleared <b>{cleared}</b>
              </span>
              <span>
                Kills <b>{p.stats.kills}</b>
              </span>
              <span>
                Deployments <b>{p.stats.missionsPlayed}</b>
              </span>
            </div>
          )}
        </div>
        <button className="btn primary" onClick={onStart} autoFocus>
          Enter The Ville
        </button>
        <Controls />
        <p className="fineprint">
          Solo only for now — online co-op is {ONLINE_MULTIPLAYER_AVAILABLE ? 'available' : 'not implemented yet (Milestone 5)'}. All characters use
          placeholder models until approved reference art is supplied. Placeholder audio is synthesized in the browser. Progress is saved in this
          browser.
        </p>
      </div>
    </div>
  )
}

export function PauseMenu({
  scene,
  settings,
  onSettings,
  onResume,
  onRestart,
  onReturn,
  onQuit,
}: {
  scene: 'hub' | 'mission'
  settings: Settings
  onSettings: (s: Settings) => void
  onResume: () => void
  onRestart: () => void
  onReturn: () => void
  onQuit: () => void
}) {
  useHotkey(onResume)
  return (
    <div className="screen modal">
      <div className="panel">
        <div className="eyebrow">Paused{scene === 'hub' ? ' · The Ville' : ''}</div>
        <div className="btn-col">
          <button className="btn primary" onClick={onResume} autoFocus>
            Resume
          </button>
          {scene === 'mission' && (
            <>
              <button className="btn" onClick={onRestart}>
                Restart mission
              </button>
              <button className="btn" onClick={onReturn}>
                Abandon — return to The Ville
              </button>
            </>
          )}
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
  const r = hud.result
  const wave = r ? r.wave : hud.wave
  const total = r ? r.waveTotal : hud.waveTotal
  return (
    <dl className="stats-grid">
      <div>
        <dt>Wave reached</dt>
        <dd>
          {Math.min(wave, total)} / {total}
        </dd>
      </div>
      <div>
        <dt>Kills</dt>
        <dd>{r ? r.kills : hud.kills}</dd>
      </div>
      <div>
        <dt>Accuracy</dt>
        <dd>{Math.round((r ? r.accuracy : hud.accuracy) * 100)}%</dd>
      </div>
      <div>
        <dt>Time</dt>
        <dd>{fmtTime(r ? r.time : hud.elapsed)}</dd>
      </div>
    </dl>
  )
}

export function DeathScreen({ hud, onRetry, onReturn }: { hud: HudSnapshot; onRetry: () => void; onReturn: () => void }) {
  useHotkey(onRetry)
  return (
    <div className="screen modal death">
      <div className="panel">
        <div className="eyebrow">Mission failed · {hud.missionName}</div>
        <h2 className="big">Silenced</h2>
        <p className="lede">
          {hud.characterName} went down in {hud.mapName}.
        </p>
        <Stats hud={hud} />
        <div className="btn-col">
          <button className="btn primary" onClick={onRetry} autoFocus>
            Retry mission
          </button>
          <button className="btn ghost" onClick={onReturn}>
            Return to The Ville
          </button>
        </div>
      </div>
    </div>
  )
}

export function MissionCompleteScreen({ hud, onRetry, onReturn }: { hud: HudSnapshot; onRetry: () => void; onReturn: () => void }) {
  useHotkey(onReturn)
  const r = hud.result
  return (
    <div className="screen modal cleared">
      <div className="panel">
        <div className="eyebrow">Mission complete · {hud.missionName}</div>
        <h2 className="big">{hud.mapName} held</h2>
        <p className="lede">
          {r?.firstClear ? 'First clear — new missions open on the board as they come online.' : `Cleared ${r?.clears ?? 1} times.`} Rewards and
          unlocks arrive in Milestone 3.
        </p>
        <Stats hud={hud} />
        <div className="btn-col">
          <button className="btn primary" onClick={onReturn} autoFocus>
            Return to The Ville
          </button>
          <button className="btn ghost" onClick={onRetry}>
            Replay mission
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
