#!/usr/bin/env node
// Service de mise a jour d'EasyCNC depuis l'interface web.
// - Sans dependance, ecoute sur 127.0.0.1 (expose par nginx sous /api/update).
// - Tourne sous l'utilisateur "easycnc" (systemd) : pas de droits root.
// - Ne fait qu'une chose : avancer sur la branche officielle (fast-forward),
//   rebuild et deployer. Aucune entree utilisateur n'est passee au shell.
import { spawn, execFile } from 'node:child_process'
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT || 8787)
const APP_DIR = process.env.APP_DIR || '/opt/easycnc'
const BRANCH = process.env.BRANCH || 'main'
const SCRIPT = `${APP_DIR}/deploy/proxmox/update-app.sh`
const MAX_LOG = 400

let running = false
let log = []
let lastResult = null // { ok, at, code }
let remote = { sha: null, checkedAt: 0, error: null }

function git(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', APP_DIR, ...args], { timeout }, (error, stdout) => (error ? reject(error) : resolve(stdout.trim())))
  })
}

async function localVersion() {
  const [sha, date, subject] = (await git(['log', '-1', '--format=%H%n%cI%n%s'])).split('\n')
  return { sha, date, subject }
}

async function remoteSha(force) {
  if (!force && Date.now() - remote.checkedAt < 5 * 60 * 1000) return remote
  try {
    const out = await git(['ls-remote', 'origin', `refs/heads/${BRANCH}`])
    remote = { sha: out.split(/\s+/)[0] || null, checkedAt: Date.now(), error: null }
  } catch (error) {
    remote = { sha: null, checkedAt: Date.now(), error: 'Depot distant injoignable' }
  }
  return remote
}

function push(line) {
  for (const part of String(line).split(/\r?\n/)) {
    if (part.trim()) log.push(part)
  }
  if (log.length > MAX_LOG) log = log.slice(-MAX_LOG)
}

function startUpdate() {
  running = true
  log = []
  push(`Mise a jour demandee ${new Date().toISOString()}`)
  const child = spawn('bash', [SCRIPT], { cwd: APP_DIR, env: { ...process.env, BRANCH } })
  child.stdout.on('data', push)
  child.stderr.on('data', push)
  child.on('close', (code) => {
    running = false
    lastResult = { ok: code === 0, code, at: new Date().toISOString() }
    push(code === 0 ? 'Mise a jour terminee.' : `Echec (code ${code}).`)
    remote.checkedAt = 0
  })
  child.on('error', (error) => {
    running = false
    lastResult = { ok: false, code: -1, at: new Date().toISOString() }
    push(`Impossible de lancer la mise a jour : ${error.message}`)
  })
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  try {
    if (req.method === 'GET' && url.pathname === '/api/update/status') {
      const [current, latest] = await Promise.all([localVersion(), remoteSha(url.searchParams.has('refresh'))])
      send(res, 200, {
        branch: BRANCH,
        current,
        latest: latest.sha,
        remoteError: latest.error,
        available: Boolean(latest.sha && latest.sha !== current.sha),
        running,
        lastResult,
        log: log.slice(-200),
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/update') {
      // En-tete personnalise : un formulaire d'un autre site ne peut pas l'envoyer (CSRF).
      if (req.headers['x-easycnc'] !== 'update') {
        send(res, 403, { error: 'En-tete manquant' })
        return
      }
      if (running) {
        send(res, 409, { error: 'Mise a jour deja en cours' })
        return
      }
      startUpdate()
      send(res, 202, { started: true })
      return
    }
    send(res, 404, { error: 'Introuvable' })
  } catch (error) {
    send(res, 500, { error: String(error?.message || error) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`easycnc-updater sur 127.0.0.1:${PORT} (${APP_DIR}, branche ${BRANCH})`)
})
