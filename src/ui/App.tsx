import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Game } from '../game/Game'
import { Hud } from './Hud'
import { Armory, MissionBoard, SquadLobby } from './HubPanels'
import { DeathScreen, ErrorScreen, MissionCompleteScreen, PauseMenu, TitleScreen } from './Screens'
import { loadSettings, saveSettings, type Settings } from './settings'

declare global {
  interface Window {
    __sfl?: ReturnType<Game['debugApi']>
  }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [game] = useState(() => new Game())
  const hud = useSyncExternalStore(game.hud.subscribe, game.hud.get)
  const [settings, setSettings] = useState<Settings>(loadSettings)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    game.mount(canvas)
    window.__sfl = game.debugApi()
    return () => {
      game.dispose()
      delete window.__sfl
    }
  }, [game])

  useEffect(() => {
    game.input.settings = { sensitivity: settings.sensitivity, invertY: settings.invertY }
    if (game.audio.muted !== settings.muted) game.audio.setMuted(settings.muted)
    saveSettings(settings)
  }, [game, settings])

  // Persist mute toggles made in-game (M key): react only to changes, never the initial value.
  const prevMuted = useRef(hud.muted)
  useEffect(() => {
    if (prevMuted.current === hud.muted) return
    prevMuted.current = hud.muted
    setSettings((s) => (s.muted === hud.muted ? s : { ...s, muted: hud.muted }))
  }, [hud.muted])

  const profile = hud.profile
  return (
    <div className={`app status-${hud.status} scene-${hud.scene}`}>
      <canvas ref={canvasRef} className="game-canvas" />
      <div className="grain" aria-hidden />
      {(hud.status === 'playing' || hud.status === 'paused' || hud.status === 'hub') && <Hud hud={hud} onCapture={() => game.input.requestLock()} />}
      {hud.status === 'title' && <TitleScreen hud={hud} onStart={() => game.start()} />}
      {hud.status === 'panel' && profile && hud.panel === 'mission-board' && (
        <MissionBoard profile={profile} onDeploy={(id) => game.deploy(id)} onClose={() => game.closePanel()} />
      )}
      {hud.status === 'panel' && profile && hud.panel === 'armory' && (
        <Armory profile={profile} onEquip={(id) => game.equip(id)} onClose={() => game.closePanel()} />
      )}
      {hud.status === 'panel' && profile && hud.panel === 'squad' && (
        <SquadLobby profile={profile} onParty={(m, f) => game.setParty(m, f)} onClose={() => game.closePanel()} />
      )}
      {hud.status === 'paused' && (
        <PauseMenu
          scene={hud.scene}
          settings={settings}
          onSettings={setSettings}
          onResume={() => game.resume()}
          onRestart={() => game.restart()}
          onReturn={() => game.returnToHub()}
          onQuit={() => game.quitToTitle()}
        />
      )}
      {hud.status === 'dead' && <DeathScreen hud={hud} onRetry={() => game.restart()} onReturn={() => game.returnToHub()} />}
      {hud.status === 'cleared' && <MissionCompleteScreen hud={hud} onRetry={() => game.restart()} onReturn={() => game.returnToHub()} />}
      {hud.status === 'error' && <ErrorScreen message={hud.error ?? 'Unknown error'} />}
    </div>
  )
}
