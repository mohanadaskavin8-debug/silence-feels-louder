import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CHARACTERS } from '../data/characters'
import { MISSIONS, MISSION_TYPE_LABEL, TERRITORIES, isUnlocked, type MissionDef } from '../data/missions'
import { WEAPONS, isSidearm } from '../data/weapons'
import { ATTACHMENTS, SLOTS, fitsWeapon, resolveWeapon, type AttachmentChoice, type AttachmentSlot } from '../data/attachments'
import { WEAPON_LEVELS, attachmentUnlocked, isCleared, partyRoster, weaponLevel, type FourthMember, type PartyMode, type Profile } from '../game/profile'
import { WeaponPreview } from './WeaponPreview'
import { ONLINE_MULTIPLAYER_AVAILABLE } from '../net/session'
import type { CharacterDef, StationKind, WeaponDef } from '../sim/types'

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Esc closes a panel (the canvas never sees it while a panel is open). */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      // Typing in a field (loadout name) must not close the panel.
      const t = e.target as Element | null
      if (e.code === 'KeyE' && t?.closest('input, textarea, select')) return
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

// --------------------------------------------------------------------------- armory / gunsmith

type StatKey = 'damage' | 'fireRate' | 'accuracy' | 'control' | 'magSize' | 'handling'

function weaponStats(w: WeaponDef): Record<StatKey, number> {
  // Normalised 0..1 for bars. Fictional game stats only.
  return {
    damage: Math.min(1, (w.damage * w.pellets) / 120),
    fireRate: Math.min(1, w.fireRate / 14),
    accuracy: Math.max(0, 1 - w.spreadAim / 0.06),
    control: Math.max(0, 1 - w.recoilPitch / 0.07),
    magSize: Math.min(1, w.magSize / 60),
    handling: Math.max(0, 1 - w.reloadTime / 3.6),
  }
}

const STAT_LABEL: Record<StatKey, string> = {
  damage: 'Damage',
  fireRate: 'Fire rate',
  accuracy: 'Accuracy',
  control: 'Recoil control',
  magSize: 'Magazine',
  handling: 'Reload speed',
}

export interface ArmoryActions {
  selectLoadout: (i: number) => void
  renameLoadout: (i: number, name: string) => void
  equip: (weaponId: string) => void
  clearPrimary: () => void
  setAttachment: (weaponId: string, slot: AttachmentSlot, id: string | null) => void
  buyWeapon: (weaponId: string) => boolean
}

export function Armory({ profile, actions, onClose }: { profile: Profile; actions: ArmoryActions; onClose: () => void }) {
  const loadout = profile.loadouts[profile.activeLoadout]
  const ids = Object.keys(WEAPONS)
  const sidearms = ids.filter((id) => isSidearm(WEAPONS[id]))
  const primaries = ids.filter((id) => !isSidearm(WEAPONS[id]))
  const [selected, setSelected] = useState(loadout.primary?.id ?? loadout.sidearm.id)
  const base = WEAPONS[selected] ?? WEAPONS[ids[0]]
  const owned = profile.owned.includes(base.id)
  const inLoadout = loadout.primary?.id === base.id ? loadout.primary : loadout.sidearm.id === base.id ? loadout.sidearm : null
  const choice: AttachmentChoice = inLoadout?.attachments ?? {}
  const resolved = useMemo(() => resolveWeapon(base, choice), [base, choice])
  const before = weaponStats(base)
  const after = weaponStats(resolved)
  const xp = profile.weaponXp[base.id] ?? 0
  const level = weaponLevel(xp)
  const nextAt = WEAPON_LEVELS[level] ?? null
  const prevAt = WEAPON_LEVELS[level - 1] ?? 0
  const locked = base.requires && !isCleared(profile, base.requires)
  const price = base.price ?? 0
  const [name, setName] = useState(loadout.name)
  useEffect(() => setName(loadout.name), [loadout.name, profile.activeLoadout])

  const status = (id: string) => {
    const w = WEAPONS[id]
    if (loadout.primary?.id === id) return 'Primary'
    if (loadout.sidearm.id === id) return 'Sidearm'
    if (profile.owned.includes(id)) return 'Owned'
    if (w.requires && !isCleared(profile, w.requires)) return 'Locked'
    return `$${(w.price ?? 0).toLocaleString()}`
  }

  const row = (id: string) => (
    <li key={id}>
      <button role="option" aria-selected={id === selected} className={`mission-row ${id === selected ? 'sel' : ''}`} onClick={() => setSelected(id)}>
        <span className="eyebrow">{WEAPONS[id].category}</span>
        <span className="mission-row-name">{WEAPONS[id].name}</span>
        <span className="mission-row-state">{status(id)}</span>
      </button>
    </li>
  )

  return (
    <PanelShell eyebrow="The Ville · armory & gunsmith" title="Gunsmith" onClose={onClose}>
      <div className="loadout-bar">
        <div className="loadout-tabs" role="tablist" aria-label="Loadouts">
          {profile.loadouts.map((l, i) => (
            <button key={i} role="tab" aria-selected={i === profile.activeLoadout} className={`chip ${i === profile.activeLoadout ? 'sel' : ''}`} onClick={() => actions.selectLoadout(i)}>
              {l.name}
            </button>
          ))}
        </div>
        <label className="loadout-name">
          <span className="eyebrow">Name</span>
          <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onBlur={() => actions.renameLoadout(profile.activeLoadout, name)} />
        </label>
        <div className="cash">
          <span className="eyebrow">Cash</span>
          <b>${profile.cash.toLocaleString()}</b>
        </div>
      </div>
      <div className="board gunsmith">
        <div>
          <div className="eyebrow list-head">Primary</div>
          <ul className="mission-list" role="listbox" aria-label="Primary weapons">
            {primaries.map(row)}
          </ul>
          <div className="eyebrow list-head">Sidearm</div>
          <ul className="mission-list" role="listbox" aria-label="Sidearms">
            {sidearms.map(row)}
          </ul>
        </div>
        <div className="mission-detail">
          <div className="gs-top">
            <WeaponPreview def={base} attachments={choice} />
            <div className="gs-head">
              <div className="eyebrow">
                {base.category} · {resolved.automatic ? 'automatic' : 'semi-automatic'}
                {base.pellets > 1 ? ` · ${base.pellets} pellets` : ''}
              </div>
              <h3 className="mission-name">{base.name}</h3>
              <p className="note">{base.desc}</p>
              <div className="wlevel">
                <span>
                  Weapon level <b>{level}</b>
                </span>
                <span className="xpbar">
                  <i style={{ transform: `scaleX(${nextAt ? (xp - prevAt) / (nextAt - prevAt) : 1})` }} />
                </span>
                <span className="dim">{nextAt ? `${xp} / ${nextAt} XP` : 'max'}</span>
              </div>
            </div>
          </div>
          <dl className="stat-bars">
            {(Object.keys(STAT_LABEL) as StatKey[]).map((k) => (
              <div key={k}>
                <dt>{STAT_LABEL[k]}</dt>
                <dd>
                  <span style={{ transform: `scaleX(${Math.min(before[k], after[k])})` }} />
                  {after[k] > before[k] && <span className="up" style={{ left: `${before[k] * 100}%`, width: `${(after[k] - before[k]) * 100}%` }} />}
                  {after[k] < before[k] && <span className="down" style={{ left: `${after[k] * 100}%`, width: `${(before[k] - after[k]) * 100}%` }} />}
                </dd>
              </div>
            ))}
          </dl>
          {inLoadout ? (
            <div className="slots">
              {SLOTS.map((slot) => {
                const options = Object.values(ATTACHMENTS).filter((a) => a.slot === slot && fitsWeapon(a, base))
                if (!options.length) return null
                return (
                  <div key={slot} className="slot">
                    <span className="eyebrow">{slot}</span>
                    <div className="slot-opts">
                      <button className={`chip ${!choice[slot] ? 'sel' : ''}`} onClick={() => actions.setAttachment(base.id, slot, null)}>
                        None
                      </button>
                      {options.map((a) => {
                        const open = attachmentUnlocked(profile, base.id, a.id)
                        return (
                          <button
                            key={a.id}
                            className={`chip ${choice[slot] === a.id ? 'sel' : ''}`}
                            disabled={!open}
                            title={open ? a.desc : `Unlocks at weapon level ${a.level}`}
                            onClick={() => actions.setAttachment(base.id, slot, a.id)}
                          >
                            {a.name}
                            {!open && <em> · Lv {a.level}</em>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="note">{owned ? 'Equip this weapon to fit attachments.' : 'Buy this weapon to equip and customise it.'}</p>
          )}
          <div className="gs-actions">
            {!owned && locked && <p className="note">Clear {MISSIONS.find((m) => m.id === base.requires)?.name ?? base.requires} to unlock.</p>}
            {!owned && !locked && (
              <button className="btn primary" disabled={profile.cash < price} onClick={() => actions.buyWeapon(base.id)}>
                Buy · ${price.toLocaleString()}
              </button>
            )}
            {owned && !inLoadout && (
              <button className="btn primary" onClick={() => actions.equip(base.id)}>
                Equip as {isSidearm(base) ? 'sidearm' : 'primary'}
              </button>
            )}
            {inLoadout && loadout.primary?.id === base.id && (
              <button className="btn ghost" onClick={() => actions.clearPrimary()}>
                Unequip primary
              </button>
            )}
          </div>
          <p className="note">Fictional, game-balanced stats. Weapon XP comes from kills; levels unlock attachments.</p>
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
