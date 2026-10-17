import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { DEFAULT_CHARACTER } from '../data/characters'
import { Game } from '../game/Game'
import { Hud } from './Hud'
import { ClearedScreen, DeathScreen, ErrorScreen, PauseMenu, TitleScreen } from './Screens'
import { loadSettings, saveSettings, type Settings } from './settings'

declare global {
  interface Window {
    __sfl?: ReturnType<Game['debugApi']>
  }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [game] = useState(() => new Game({ characterId: DEFAULT_CHARACTER, mapId: 'dolly-block-7', encounterId: 'dolly-test' }))
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

  return (
    <div className={`app status-${hud.status}`}>
      <canvas ref={canvasRef} className="game-canvas" />
      <div className="grain" aria-hidden />
      {(hud.status === 'playing' || hud.status === 'paused') && <Hud hud={hud} onCapture={() => game.input.requestLock()} />}
      {hud.status === 'title' && <TitleScreen hud={hud} onStart={() => game.start()} />}
      {hud.status === 'paused' && (
        <PauseMenu
          settings={settings}
          onSettings={setSettings}
          onResume={() => game.resume()}
          onRestart={() => game.restart()}
          onQuit={() => game.quitToTitle()}
        />
      )}
      {hud.status === 'dead' && <DeathScreen hud={hud} onRestart={() => game.restart()} onQuit={() => game.quitToTitle()} />}
      {hud.status === 'cleared' && <ClearedScreen hud={hud} onRestart={() => game.restart()} onQuit={() => game.quitToTitle()} />}
      {hud.status === 'error' && <ErrorScreen message={hud.error ?? 'Unknown error'} />}
    </div>
  )
}
