#!/usr/bin/env node
/**
 * Browser smoke test: serves the production build, drives the game in real
 * Chromium (software WebGL) and checks the Milestone 1 definition of done.
 *
 *   npm run build && npm run smoke            # headless
 *   node tests/smoke.mjs --keep-server        # leave the preview server running
 *
 * Screenshots land in shots/ (git-ignored).
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shots = join(root, 'shots')
mkdirSync(shots, { recursive: true })
const PORT = 4180
const URL = `http://localhost:${PORT}/`

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('dist/ missing: run `npm run build` first')
  process.exit(2)
}

// Run Vite's own entry with node (not npx) so killing the child really stops the server.
const server = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'pipe',
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(URL)
    if (r.ok) break
  } catch {
    /* not up yet */
  }
  await sleep(250)
}

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({
  executablePath: existsSync(exe) ? exe : undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
})
// Smaller viewport: software WebGL is fill-bound, and this test checks behaviour, not looks.
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

const state = () => page.evaluate(() => window.__sfl.state())
/** Wait for N simulation ticks (60/s of game time), independent of how slow rendering is. */
const waitTicks = async (n, timeout = 30000) => {
  const start = (await state()).tick
  const t0 = Date.now()
  while ((await state()).tick < start + n) {
    if (Date.now() - t0 > timeout) return false
    await sleep(50)
  }
  return true
}
const visible = async (text, timeout = 4000) => {
  try {
    await page.locator(`text=${text}`).first().waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  }
}
const waitFor = async (pred, timeout = 120000, step = 100) => {
  const t0 = Date.now()
  for (;;) {
    const s = await state()
    if (pred(s)) return s
    if (Date.now() - t0 > timeout) return null
    await sleep(step)
  }
}

try {
  await page.goto(URL, { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__sfl, null, { timeout: 15000 })
  await sleep(1500)

  // 1. Title screen renders over a live 3D scene.
  const titleVisible = await visible('Deploy')
  check('title screen shows a Deploy button', titleVisible)
  const p0 = await page.evaluate(() => window.__sfl.probe())
  check('3D canvas renders a non-blank frame', p0.std > 6 && p0.mean > 3, `mean ${p0.mean.toFixed(1)}, std ${p0.std.toFixed(1)}, ${p0.w}x${p0.h}`)
  await page.screenshot({ path: join(shots, '01-title.png') })

  // 2. Deploy with a real click.
  await page.locator('button', { hasText: 'Deploy' }).click()
  await sleep(400)
  const lockGranted = await page.evaluate(() => document.pointerLockElement !== null)
  let s = await state()
  check('Deploy starts the encounter', s.status === 'playing', `status=${s.status}, pointer lock ${lockGranted ? 'granted' : 'not granted (headless)'}`)
  // Gate the sim open without overriding any real keys/mouse (pointer lock may be refused headless).
  await page.evaluate(() => {
    window.__sfl.setInput({})
    window.__sfl.holdWaves()
  })

  // 3. Real keyboard movement, camera-relative.
  const before = (await state()).player.pos
  await page.keyboard.down('KeyW')
  await waitTicks(72)
  await page.keyboard.up('KeyW')
  s = await state()
  const moved = Math.hypot(s.player.pos.x - before.x, s.player.pos.z - before.z)
  check('W key moves the character forward (camera-relative, -Z at yaw 0)', moved > 3 && s.player.pos.z < before.z - 3, `moved ${moved.toFixed(2)} m in ~1.2 s game time`)
  await page.keyboard.down('KeyD')
  await waitTicks(36)
  await page.keyboard.up('KeyD')
  const s2 = await state()
  check('D key strafes right (+X at yaw 0)', s2.player.pos.x > s.player.pos.x + 0.8, `dx ${(s2.player.pos.x - s.player.pos.x).toFixed(2)} m`)

  // 4. Aim and fire at a zombie until it dies.
  const zid = await page.evaluate(() => window.__sfl.spawnAhead(9))
  await page.evaluate((id) => {
    window.__sfl.setInput({ aim: true })
  }, zid)
  await sleep(350)
  let killed = false
  let firstHitHealth = null
  for (let i = 0; i < 24 && !killed; i++) {
    await page.evaluate((id) => {
      window.__sfl.aimAt(id, 'body')
      const st = window.__sfl.state()
      window.__sfl.setInput({ aim: true, yaw: st.player.yaw, pitch: st.player.pitch, fire: true })
    }, zid)
    await sleep(70)
    await page.evaluate(() => {
      const st = window.__sfl.state()
      window.__sfl.setInput({ aim: true, yaw: st.player.yaw, pitch: st.player.pitch, fire: false })
    })
    await sleep(110)
    s = await state()
    const z = s.zombies.find((zz) => zz.id === zid)
    if (z && z.health < 100 && firstHitHealth === null) {
      firstHitHealth = z.health
      await page.screenshot({ path: join(shots, '02-combat.png') })
    }
    if (!z || z.mode === 'dead') killed = true
  }
  check('aimed shots damage the zombie', firstHitHealth !== null, `health after first hit: ${firstHitHealth}`)
  check('zombie is defeated', killed, `kills=${s.player.kills}, ammo=${s.player.ammo}`)
  check('ammo is consumed', s.player.ammo < 15)
  await sleep(300)
  await page.screenshot({ path: join(shots, '03-defeated.png') })

  // 5. Reload with the real R key.
  await page.evaluate(() => window.__sfl.setInput({}))
  const ammoBefore = (await state()).player.ammo
  await page.keyboard.press('KeyR')
  await waitTicks(100)
  s = await state()
  check('R reloads the magazine', ammoBefore < 15 && s.player.ammo === 15, `${ammoBefore} -> ${s.player.ammo}, reserve ${s.player.reserve}`)

  // 6. A zombie reaches the player and hurts them; HUD health reflects it.
  await page.evaluate(() => window.__sfl.spawnAhead(2.2))
  const hurt = await waitFor((st) => st.player.health < 100, 120000)
  check('zombie attacks reduce player health', !!hurt, hurt ? `health ${hurt.player.health.toFixed(0)}` : 'no damage taken')
  await sleep(200)
  const hudHealth = await page.locator('.health-num').innerText()
  check('HUD health matches the simulation', hurt && Number(hudHealth) <= Math.ceil(hurt.player.health) + 1 && Number(hudHealth) < 100, `HUD ${hudHealth}`)
  await page.screenshot({ path: join(shots, '04-hurt.png') })

  // 7. Melee shove with the real V key staggers a zombie.
  const meleeTarget = await page.evaluate(() => {
    const st = window.__sfl.state()
    const z = st.zombies.find((zz) => zz.mode !== 'dead')
    if (z) window.__sfl.aimAt(z.id, 'body')
    return z ? z.id : null
  })
  if (meleeTarget !== null) {
    const hpBefore = (await state()).zombies.find((z) => z.id === meleeTarget)?.health ?? 0
    await page.keyboard.press('KeyV')
    await sleep(150)
    const after = (await state()).zombies.find((z) => z.id === meleeTarget)
    check('V melee damages a close zombie', after && after.health < hpBefore, `${hpBefore} -> ${after?.health}`)
  }

  // 8. Death -> death screen -> restart restores a fresh encounter.
  await page.evaluate(() => window.__sfl.killPlayer())
  // Generous wall-clock limit: software rendering here can drop to ~1 fps, and the game slows below 10 fps.
  const dead = await waitFor((st) => st.status === 'dead', 90000)
  const deathUi = await visible('Restart encounter')
  check('player death shows the death screen', !!dead && deathUi, `status ${dead ? dead.status : (await state()).status}, screen ${deathUi ? 'visible' : 'missing'}`)
  await page.screenshot({ path: join(shots, '05-dead.png') })
  await page.locator('button', { hasText: 'Restart encounter' }).click()
  await sleep(500)
  s = await state()
  check(
    'Restart encounter resets health, ammo, zombies and waves',
    s.status === 'playing' && s.player.health === 100 && s.player.ammo === 15 && s.zombies.length === 0 && s.encounter.phase === 'warmup',
    `status=${s.status} hp=${s.player.health} ammo=${s.player.ammo} zombies=${s.zombies.length} phase=${s.encounter.phase}`,
  )

  // 9. Waves actually spawn on their own after warmup (real timer restored).
  await page.evaluate(() => {
    window.__sfl.holdWaves(false)
    window.__sfl.setInput({})
  })
  const spawned = await waitFor((st) => st.encounter.phase === 'wave' && st.zombies.length > 0, 120000)
  check('wave 1 starts and zombies spawn from the alleys', !!spawned, spawned ? `${spawned.zombies.length} zombies` : '')
  await waitTicks(240)
  await page.screenshot({ path: join(shots, '06-wave.png') })

  // 10. Pause menu via Escape-equivalent and resume.
  await page.evaluate(() => window.__sfl.pause())
  await sleep(200)
  check('pause menu opens', await visible('Resume'))
  await page.screenshot({ path: join(shots, '07-paused.png') })
  const tickPaused = (await state()).tick
  await sleep(400)
  check('simulation freezes while paused', (await state()).tick === tickPaused)
  await page.locator('button', { hasText: 'Resume' }).click()
  await sleep(400)
  check('resume returns to play', (await state()).status === 'playing')

  s = await state()
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\ninfo: software-rendered fps in this container ≈ ${s.fps} real frames/s (not representative of a real GPU)`)
} catch (err) {
  check('smoke run completed without exceptions', false, String(err && err.stack ? err.stack : err))
} finally {
  await browser.close()
  if (!process.argv.includes('--keep-server')) server.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  if (serverLog.trim()) console.log('\nserver log:\n' + serverLog.slice(-2000))
  process.exit(1)
}
