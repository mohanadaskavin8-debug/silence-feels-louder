// Music manifest. Only original/procedural placeholders ship today. Approved
// album tracks (Silence Feels Louder) go here once usage rights are confirmed:
// drop the file in public/audio/ and set `src` + `license: 'licensed'`.
// Never add scraped or unlicensed audio.

export type MusicUse = 'mission' | 'hub-radio' | 'challenge'

export interface MusicTrack {
  id: string
  title: string
  artist: string
  /** Path under public/, or null for the built-in procedural score. */
  src: string | null
  license: 'procedural-placeholder' | 'pending-approval' | 'licensed'
  uses: MusicUse[]
}

export const MUSIC: MusicTrack[] = [
  {
    id: 'block7-drone',
    title: 'Block 7 Drone (placeholder)',
    artist: 'procedural',
    src: null,
    license: 'procedural-placeholder',
    uses: ['mission'],
  },
]
