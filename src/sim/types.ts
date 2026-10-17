import type { Rng, Vec3 } from './math'

// ---------------------------------------------------------------------------
// Static data shapes (authored in src/data, read by sim + renderer)
// ---------------------------------------------------------------------------

export type ObstacleKind =
  | 'building'
  | 'shop'
  | 'wall'
  | 'car'
  | 'dumpster'
  | 'crate'
  | 'barrier'
  | 'fence'
  | 'garage'
  | 'board'
  | 'bench'

/** Axis-aligned box on the ground. Everything solid in a map is one of these. */
export interface Obstacle {
  kind: ObstacleKind
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  height: number
  /** Fences stop movement but not bullets. Defaults to true. */
  blocksShots?: boolean
  /** Visual variation index; ignored by the simulation. */
  variant?: number
  /** Signage text (shops, boards); ignored by the simulation. */
  label?: string
}

export type StationKind = 'mission-board' | 'armory' | 'squad'

/** An interaction point in a safe hub: walk up to it and press E. */
export interface Station {
  id: string
  kind: StationKind
  label: string
  x: number
  z: number
  radius: number
}

export interface MapLight {
  x: number
  z: number
  height: number
  color: number
  intensity: number
  /** false = glowing fixture and light pool only, no real light (cheaper). Defaults to true. */
  dynamic?: boolean
  /** false = wall-mounted fixture, no lamp post. Defaults to true. */
  pole?: boolean
}

export interface MapTheme {
  fog: number
  fogDensity: number
  sky: number
  ground: number
  moon: number
  moonIntensity: number
  ambient: number
  ambientIntensity: number
}

export interface MapDef {
  id: string
  name: string
  district: string
  halfX: number
  halfZ: number
  playerSpawns: { x: number; z: number; yaw: number }[]
  zombieSpawns: { x: number; z: number }[]
  obstacles: Obstacle[]
  lights: MapLight[]
  theme: MapTheme
  /** Safe hubs have no combat: weapons stay holstered. */
  safe?: boolean
  /** Painted ground markings (parking bays, lane dashes): centre x/z, size w/d. Visual only. */
  markings?: { x: number; z: number; w: number; d: number }[]
  stations?: Station[]
}

export interface WeaponDef {
  id: string
  name: string
  category: 'pistol' | 'smg' | 'rifle' | 'shotgun'
  /** Damage per pellet/bullet before multipliers. Fictional game balance, not real-world data. */
  damage: number
  headshotMultiplier: number
  /** Rounds per second. */
  fireRate: number
  automatic: boolean
  pellets: number
  magSize: number
  reserveMax: number
  reloadTime: number
  range: number
  /** Cone half-angles in radians. */
  spreadHip: number
  spreadAim: number
  spreadMoving: number
  spreadPerShot: number
  spreadMax: number
  spreadRecovery: number
  /** Camera kick per shot in radians (applied client-side to the view). */
  recoilPitch: number
  recoilYaw: number
  /** Knockback impulse on hit (m/s). */
  knockback: number
  /** Chance (0..1) a body hit staggers a regular enemy. */
  staggerChance: number
  /** Armory price in cash (0 = starter). Economy data, ignored by the simulation. */
  price?: number
  /** Mission that must be cleared before it can be bought. */
  requires?: string
  desc?: string
}

/** A weapon with its attachments folded in (see data/attachments.ts resolveWeapon). */
export interface ResolvedWeapon extends WeaponDef {
  /** Aim FOV multiplier from optics. */
  aimZoom: number
  /** Movement speed multiplier while this weapon is out. */
  moveSpeed: number
  attachments: Partial<Record<string, string>>
}

export type ZombieArchetypeId = 'regular' | 'runner' | 'brute'

export interface ZombieArchetype {
  id: ZombieArchetypeId
  name: string
  health: number
  speed: number
  speedVariance: number
  turnRate: number
  radius: number
  height: number
  attackRange: number
  attackDamage: number
  attackWindup: number
  attackRecovery: number
  attackCooldown: number
  staggerTime: number
  /** Multiplier on incoming knockback. */
  knockbackScale: number
  score: number
  /** Body scale range (hit volumes and model). */
  scaleMin: number
  scaleMax: number
  /** 0..1: how much this body shrugs off staggers (brutes barely flinch). */
  staggerResist: number
  /** Chance the side bag drops loot on death. */
  lootChance: number
  /** Cash bounty credited to the killer. */
  bounty: number
}

export interface CharacterOutfit {
  skin: number
  top: number
  topAccent: number
  bottom: number
  shoes: number
  hood: boolean
  mask: number | null
  glasses: boolean
  bag: number | null
}

export interface CharacterDef {
  id: string
  name: string
  /** Shown on character cards; "PLACEHOLDER" until approved reference art arrives. */
  modelStatus: 'placeholder' | 'approved'
  maxHealth: number
  speedWalk: number
  speedSprint: number
  speedAim: number
  outfit: CharacterOutfit
}

export interface WaveDef {
  count: number
  maxAlive: number
  spawnInterval: number
  speedScale: number
  /** Relative spawn weights per archetype (defaults to all regular). */
  mix?: Partial<Record<ZombieArchetypeId, number>>
  /** Spawned first, before the weighted mix (e.g. a brute to open the final wave). */
  lead?: ZombieArchetypeId[]
}

export type PickupKind = 'ammo' | 'cash' | 'medkit'

export interface PickupState {
  id: number
  kind: PickupKind
  amount: number
  pos: Vec3
  /** Seconds before it disappears. */
  ttl: number
}

export interface EncounterDef {
  id: string
  name: string
  waves: WaveDef[]
  intermission: number
  /** Delay before wave 1 so the player can get their bearings. */
  warmup: number
}

// ---------------------------------------------------------------------------
// Runtime state (owned by the simulation; on a server this is what replicates)
// ---------------------------------------------------------------------------

/** One tick of player intent. Movement is in the camera's frame; the sim rotates it by yaw. */
export interface PlayerInput {
  /** -1..1, +1 = strafe right. */
  moveX: number
  /** -1..1, +1 = forward (away from camera). */
  moveZ: number
  yaw: number
  pitch: number
  sprint: boolean
  aim: boolean
  fire: boolean
  reload: boolean
  melee: boolean
  /** -1 = keep, 0..n-1 = switch to that slot, -2 = next slot. */
  switchTo: number
}

export const emptyInput = (): PlayerInput => ({
  moveX: 0,
  moveZ: 0,
  yaw: 0,
  pitch: 0,
  sprint: false,
  aim: false,
  fire: false,
  reload: false,
  melee: false,
  switchTo: -1,
})

export interface WeaponState {
  /** Resolved stats (base weapon + attachments). Plain data, so it replicates with the state. */
  def: ResolvedWeapon
  ammo: number
  reserve: number
  /** Seconds until the next shot is allowed. */
  cooldown: number
  /** Seconds left in the current reload, 0 when not reloading. */
  reloadLeft: number
  /** Current bloom (radians), decays toward the base spread. */
  bloom: number
  /** Fire input on the previous tick (edge detection for semi-auto). */
  triggerHeld: boolean
  /** Seconds a semi-auto trigger press stays queued while the gun is cycling or finishing a reload. */
  buffer: number
}

export interface PlayerState {
  id: string
  characterId: string
  pos: Vec3
  vel: Vec3
  /** Body facing (radians). */
  facing: number
  /** Last applied view orientation (from input). */
  yaw: number
  pitch: number
  /** 0 = hip, 1 = fully aimed; eased so the camera and spread blend. */
  aimBlend: number
  sprinting: boolean
  health: number
  maxHealth: number
  alive: boolean
  /** Loadout slots (primary, sidearm). */
  weapons: WeaponState[]
  active: number
  /** Seconds left drawing the weapon just switched to (can't fire meanwhile). */
  switchLeft: number
  meleeCooldown: number
  /** Seconds since last damage, drives regen and the HUD vignette. */
  sinceDamage: number
  /** Seconds since the last shot, keeps the body facing the aim for a moment. */
  sinceShot: number
  kills: number
  headshotKills: number
  shotsFired: number
  shotsHit: number
  /** Cash earned this mission (bounties + pickups). */
  cash: number
  /** Weapon XP earned this mission, by weapon id. */
  weaponXp: Record<string, number>
}

export type ZombieMode = 'rising' | 'chase' | 'attack' | 'stagger' | 'dead'

export interface ZombieState {
  id: number
  archetype: ZombieArchetypeId
  pos: Vec3
  vel: Vec3
  facing: number
  health: number
  maxHealth: number
  speed: number
  mode: ZombieMode
  /** Seconds spent in the current mode. */
  modeTime: number
  attackCooldown: number
  /** Whether the current attack swing already resolved its hit. */
  attackResolved: boolean
  targetId: string | null
  /** Seed for outfit wear, gait and resting lean (shared by sim pose and renderer). */
  seed: number
  /** Body scale; hit volumes and the model both use it. */
  scale: number
  /** Seconds before this zombie can be staggered again (prevents stunlock). */
  staggerImmune: number
  /** World-space direction of the killing blow, for the death fall. */
  deathDir: Vec3
}

export type EncounterPhase = 'warmup' | 'wave' | 'intermission' | 'cleared' | 'failed'

export interface EncounterState {
  defId: string
  phase: EncounterPhase
  /** 0-based index of the current (or next) wave. */
  wave: number
  phaseTime: number
  spawnedThisWave: number
  killedThisWave: number
  spawnTimer: number
  totalKills: number
  elapsed: number
}

export interface WorldState {
  tick: number
  time: number
  rng: Rng
  mapId: string
  players: PlayerState[]
  zombies: ZombieState[]
  nextZombieId: number
  pickups: PickupState[]
  nextPickupId: number
  encounter: EncounterState
}

// ---------------------------------------------------------------------------
// Events: one-shot things that happened during a tick (sounds, effects, HUD)
// ---------------------------------------------------------------------------

export type SimEvent =
  | {
      type: 'shot'
      playerId: string
      weaponId: string
      muzzle: Vec3
      end: Vec3
      hit: 'zombie' | 'world' | 'none'
      normal: Vec3 | null
      recoilPitch: number
      recoilYaw: number
    }
  | { type: 'dryFire'; playerId: string }
  | { type: 'weaponSwitch'; playerId: string; slot: number; weaponId: string }
  | { type: 'reloadStart'; playerId: string; duration: number }
  | { type: 'reloadDone'; playerId: string }
  | { type: 'zombieHit'; zombieId: number; playerId: string; pos: Vec3; damage: number; headshot: boolean; killed: boolean; melee: boolean }
  | { type: 'zombieAttack'; zombieId: number; pos: Vec3 }
  | { type: 'zombieSpawn'; zombieId: number; pos: Vec3 }
  | { type: 'playerHit'; playerId: string; damage: number; from: Vec3 }
  | { type: 'playerDied'; playerId: string }
  | { type: 'melee'; playerId: string; hits: number }
  | { type: 'pickupSpawn'; pickupId: number; kind: PickupKind; pos: Vec3 }
  | { type: 'pickup'; playerId: string; kind: PickupKind; amount: number; pos: Vec3 }
  | { type: 'waveStart'; wave: number; total: number }
  | { type: 'waveCleared'; wave: number }
  | { type: 'encounterCleared' }
  | { type: 'encounterFailed' }
