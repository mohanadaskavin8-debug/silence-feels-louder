export interface Settings {
  sensitivity: number
  invertY: boolean
  muted: boolean
}

const KEY = 'sfl:settings:v1'
const DEFAULTS: Settings = { sensitivity: 1, invertY: false, muted: false }

// Storage can be unavailable (private mode, blocked site data); settings then just don't persist.
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const v = JSON.parse(raw) as Partial<Settings>
    return {
      sensitivity: typeof v.sensitivity === 'number' && v.sensitivity >= 0.2 && v.sensitivity <= 3 ? v.sensitivity : DEFAULTS.sensitivity,
      invertY: !!v.invertY,
      muted: !!v.muted,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* not persisted */
  }
}
