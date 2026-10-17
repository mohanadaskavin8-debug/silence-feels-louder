import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CHARACTERS } from '../data/characters'
import { MISSIONS, MISSION_TYPE_LABEL, TERRITORIES, isUnlocked, type MissionDef } from '../data/missions'
import { WEAPONS } from '../data/weapons'
import { isCleared, partyRoster, type FourthMember, type PartyMode, type Profile } from '../game/profile'
import { ONLINE_MULTIPLAYER_AVAILABLE } from '../net/session'
import type { CharacterDef, StationKind } from '../sim/types'

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Esc closes a panel (the canvas never sees it while a panel is open). */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyE') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

function PanelShell({ eyebrow, title, onClose, children }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose)
  return (
    <div className="screen modal hub-modal">
      <div className="panel wide" role="dialog" aria-label={title}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2 className="panel-title">{title}</h2>
          </div>
          <button className="btn ghost close" onClick={onClose} aria-label="Close">
            Close <kbd>Esc</kbd>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------- mission board

function missionState(m: MissionDef, profile: Profile): 'ready' | 'locked' | 'dev' {
  if (!m.playable) return 'dev'
  return isUnlocked(m, (id) => isCleared(profile, id)) ? 'ready' : 'locked'
}

export function MissionBoard({ profile, onDeploy, onClose }: { profile: Profile; onDeploy: (missionId: string) => void; onClose: () => void }) {
  const [selected, setSelected] = useState(() => MISSIONS.find((m) => missionState(m, profile) === 'ready')?.id ?? MISSIONS[0].id)
  const mission = MISSIONS.find((m) => m.id === selected) ?? MISSIONS[0]
  const state = missionState(mission, profile)
  const record = profile.missions[mission.id]
  const roster = partyRoster(profile.party.mode, profile.party.fourth)
  const soloOnly = profile.party.mode !== 'solo' && !ONLINE_MULTIPLAYER_AVAILABLE
  const canDeploy = state === 'ready' && !soloOnly
  return (
    <PanelShell eyebrow="The Ville · mission board" title="Choose a mission" onClose={onClose}>
      <div className="board">
        <ul className="mission-list" role="listbox" aria-label="Missions">
          {MISSIONS.map((m) => {
            const st = missionState(m, profile)
            return (
              <li key={m.id}>
                <button
                  role="option"
                  aria-selected={m.id === selected}
                  className={`mission-row ${m.id === selected ? 'sel' : ''} st-${st}`}
                  onClick={() => setSelected(m.id)}
                >
                  <span className="eyebrow">
                    {TERRITORIES[m.territory].name} · {MISSION_TYPE_LABEL[m.type]}
                  </span>
                  <span className="mission-row-name">{m.name}</span>
                  <span className="mission-row-state">
                    {st === 'ready' ? (isCleared(profile, m.id) ? 'Cleared' : 'Ready') : st === 'locked' ? 'Locked' : 'In development'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="mission-detail">
          <div className="eyebrow">
            {TERRITORIES[mission.territory].name} — {TERRITORIES[mission.territory].blurb}
          </div>
          <h3 className="mission-name">{mission.name}</h3>
          <p className="lede">{mission.briefing}</p>
          <div className="eyebrow">Objectives</div>
          <ul className="objectives">
            {mission.objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          {record && (
            <div className="record">
              <span>
                Clears <b>{record.clears}</b>
              </span>
              <span>
                Attempts <b>{record.attempts}</b>
              </span>
              {record.bestTime !== null && (
                <span>
                  Best time <b>{fmtTime(record.bestTime)}</b>
                </span>
              )}
              <span>
                Most kills <b>{record.bestKills}</b>
              </span>
            </div>
          )}
          <div className="squad-line">
            Squad: <b>{roster.map((id) => CHARACTERS[id].name).join(', ')}</b>
          </div>
          {state === 'locked' && (
            <p className="note">Clear {mission.requires.map((id) => MISSIONS.find((m) => m.id === id)?.name ?? id).join(' and ')} to unlock.</p>
          )}
          {state === 'dev' && <p className="note">This mission's map and encounter aren't built yet.</p>}
          {soloOnly && state === 'ready' && <p className="note">Squads need online co-op (Milestone 5). Switch to Solo at the squad lobby to deploy.</p>}
          <button className="btn primary deploy" disabled={!canDeploy} onClick={() => onDeploy(mission.id)}>
            Deploy
          </button>
        </div>
      </div>
    </PanelShell>
  )
}

// --------------------------------------------------------------------------- armory

type StatKey = 'damage' | 'fireRate' | 'accuracy' | 'magSize' | 'handling'

function weaponStats(id: string): Record<StatKey, number> {
  const w = WEAPONS[id]
  // Normalised 0..1 for bars. Fictional game stats only.
  return {
    damage: Math.min(1, (w.damage * w.pellets) / 120),
    fireRate: Math.min(1, w.fireRate / 14),
    accuracy: Math.max(0, 1 - w.spreadHip / 0.08),
    magSize: Math.min(1, w.magSize / 45),
    handling: Math.max(0, 1 - w.reloadTime / 3.5),
  }
}

const STAT_LABEL: Record<StatKey, string> = {
  damage: 'Damage',
  fireRate: 'Fire rate',
  accuracy: 'Accuracy',
  magSize: 'Magazine',
  handling: 'Reload speed',
}

export function Armory({ profile, onEquip, onClose }: { profile: Profile; onEquip: (weaponId: string) => void; onClose: () => void }) {
  const ids = Object.keys(WEAPONS)
  const [selected, setSelected] = useState(profile.loadout.weaponId)
  const w = WEAPONS[selected] ?? WEAPONS[ids[0]]
  const stats = useMemo(() => weaponStats(w.id), [w.id])
  const equipped = profile.loadout.weaponId === w.id
  return (
    <PanelShell eyebrow="The Ville · armory & gunsmith" title="Loadout" onClose={onClose}>
      <div className="board">
        <ul className="mission-list" role="listbox" aria-label="Weapons">
          {ids.map((id) => (
            <li key={id}>
              <button role="option" aria-selected={id === selected} className={`mission-row ${id === selected ? 'sel' : ''}`} onClick={() => setSelected(id)}>
                <span className="eyebrow">{WEAPONS[id].category}</span>
                <span className="mission-row-name">{WEAPONS[id].name}</span>
                <span className="mission-row-state">{profile.loadout.weaponId === id ? 'Equipped' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mission-detail">
          <div className="eyebrow">{w.category} · {w.automatic ? 'automatic' : 'semi-automatic'}</div>
          <h3 className="mission-name">{w.name}</h3>
          <dl className="stat-bars">
            {(Object.keys(STAT_LABEL) as StatKey[]).map((k) => (
              <div key={k}>
                <dt>{STAT_LABEL[k]}</dt>
                <dd>
                  <span style={{ transform: `scaleX(${stats[k]})` }} />
                </dd>
              </div>
            ))}
          </dl>
          <div className="record">
            <span>
              Mag <b>{w.magSize}</b>
            </span>
            <span>
              Reserve <b>{w.reserveMax}</b>
            </span>
            <span>
              Reload <b>{w.reloadTime.toFixed(2)} s</b>
            </span>
          </div>
          <p className="note">Fictional, game-balanced stats. More weapons, attachment slots and the Gunsmith workbench arrive in Milestone 3.</p>
          <button className="btn primary deploy" disabled={equipped} onClick={() => onEquip(w.id)}>
            {equipped ? 'Equipped' : 'Equip'}
          </button>
        </div>
      </div>
    </PanelShell>
  )
}

// --------------------------------------------------------------------------- squad

const MODES: { id: PartyMode; label: string; size: number }[] = [
  { id: 'solo', label: 'Solo', size: 1 },
  { id: 'duo', label: 'Duo', size: 2 },
  { id: 'trio', label: 'Trio', size: 3 },
  { id: 'squad', label: 'Squad', size: 4 },
]

function Swatches({ c }: { c: CharacterDef }) {
  const o = c.outfit
  const cols = [o.top, o.bottom, o.shoes, o.mask ?? o.skin]
  return (
    <span className="swatches" aria-hidden>
      {cols.map((v, i) => (
        <i key={i} style={{ background: `#${v.toString(16).padStart(6, '0')}` }} />
      ))}
    </span>
  )
}

export function SquadLobby({
  profile,
  onParty,
  onClose,
}: {
  profile: Profile
  onParty: (mode: PartyMode, fourth: FourthMember) => void
  onClose: () => void
}) {
  const { mode, fourth } = profile.party
  const roster = partyRoster(mode, fourth)
  return (
    <PanelShell eyebrow="The Ville · squad lobby" title="Squad" onClose={onClose}>
      <div className="modes" role="radiogroup" aria-label="Party size">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} className={`mode ${mode === m.id ? 'sel' : ''}`} onClick={() => onParty(m.id, fourth)}>
            <b>{m.label}</b>
            <span>
              {m.size} player{m.size > 1 ? 's' : ''}
            </span>
          </button>
        ))}
      </div>
      {mode === 'squad' && (
        <div className="fourth" role="radiogroup" aria-label="Fourth member">
          <span className="eyebrow">Fourth member</span>
          {(['capt50', '2tray'] as const).map((id) => (
            <button key={id} role="radio" aria-checked={fourth === id} className={`chip ${fourth === id ? 'sel' : ''}`} onClick={() => onParty(mode, id)}>
              {CHARACTERS[id].name}
            </button>
          ))}
        </div>
      )}
      <ul className="roster">
        {roster.map((id, i) => {
          const c = CHARACTERS[id]
          return (
            <li key={id} className="member">
              <span className="eyebrow">{i === 0 ? 'You' : `Slot ${i + 1}`}</span>
              <b>{c.name}</b>
              <Swatches c={c} />
              <span className="tag">{c.modelStatus === 'placeholder' ? 'placeholder model' : 'approved'}</span>
            </li>
          )
        })}
      </ul>
      <p className="note">
        {mode === 'solo'
          ? 'Solo runs as KsBvndz.'
          : ONLINE_MULTIPLAYER_AVAILABLE
            ? 'Invite players to fill the squad.'
            : 'Duo, Trio and Squad are online co-op — not implemented yet (Milestone 5). You can set your squad now; deploying needs Solo until then.'}
      </p>
    </PanelShell>
  )
}

export const STATION_PANELS: StationKind[] = ['mission-board', 'armory', 'squad']
