#!/usr/bin/env node
// Service de mise a jour d'EasyCNC depuis l'interface web.
// - Sans dependance, ecoute sur 127.0.0.1 (expose par nginx sous /api/update).
// - Tourne sous l'utilisateur "easycnc" (systemd) : pas de droits root.
// - Ne fait qu'une chose : avancer sur la branche officielle (fast-forward),
//   rebuild et deployer. Aucune entree utilisateur n'est passee au shell.
import { spawn, execFile } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { readFileSync, readdirSync, readlinkSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT || 8787)
const APP_DIR = process.env.APP_DIR || '/opt/easycnc'
const BRANCH = process.env.BRANCH || 'main'
const SCRIPT = `${APP_DIR}/deploy/proxmox/update-app.sh`
const WEB_DIR = process.env.WEB_DIR || '/var/www/easycnc'
// Code d'acces optionnel (/etc/easycnc/updater.env : UPDATE_TOKEN=...).
const TOKEN = process.env.UPDATE_TOKEN || ''
const MAX_LOG = 400

// Resultat et journal de la derniere mise a jour, conserves entre redemarrages.
const STATE_FILE = process.env.STATE_FILE || `${homedir()}/last-update.json`

let running = false
let log = []
let lastResult = null // { ok, at, code }
try {
  const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  log = Array.isArray(saved.log) ? saved.log : []
  lastResult = saved.lastResult ?? null
} catch {
  /* premiere execution */
}

function saveState() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ log: log.slice(-200), lastResult }))
  } catch {
    /* disque en lecture seule : sans importance */
  }
}
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
    saveState()
    // Le service lui-meme vient peut-etre d'etre mis a jour : on quitte pour que
    // systemd le relance avec le nouveau code (code non nul : relance aussi avec
    // Restart=on-failure des anciennes installations).
    if (code === 0) setTimeout(() => process.exit(75), 3000)
  })
  child.on('error', (error) => {
    running = false
    lastResult = { ok: false, code: -1, at: new Date().toISOString() }
    push(`Impossible de lancer la mise a jour : ${error.message}`)
  })
}

/** Versions deployees (releases/<commit>-<date>), la plus recente d'abord. */
function releases() {
  let current = null
  try {
    current = readlinkSync(`${WEB_DIR}/current`).replace(/^releases\//, '')
  } catch {
    /* pas encore de lien */
  }
  let names = []
  try {
    names = readdirSync(`${WEB_DIR}/releases`)
      .filter((name) => /^[0-9a-f]{7,}-\d{14}$/.test(name))
      .sort((a, b) => statSync(`${WEB_DIR}/releases/${b}`).mtimeMs - statSync(`${WEB_DIR}/releases/${a}`).mtimeMs)
  } catch {
    /* dossier absent */
  }
  return names.map((name) => ({ name, sha: name.split('-')[0], current: name === current }))
}

/** Bascule atomique du lien current vers une version deja deployee. */
function switchTo(name) {
  const tmp = `${WEB_DIR}/current.tmp`
  try {
    unlinkSync(tmp)
  } catch {
    /* absent */
  }
  symlinkSync(`releases/${name}`, tmp)
  renameSync(tmp, `${WEB_DIR}/current`)
}

function authorized(req) {
  if (!TOKEN) return true
  const given = Buffer.from(String(req.headers['x-easycnc-token'] || ''))
  const expected = Buffer.from(TOKEN)
  return given.length === expected.length && timingSafeEqual(given, expected)
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
        tokenRequired: Boolean(TOKEN),
        releases: releases(),
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
      if (!authorized(req)) {
        send(res, 401, { error: "Code d'acces incorrect" })
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
    if (req.method === 'POST' && url.pathname === '/api/update/switch') {
      if (req.headers['x-easycnc'] !== 'update') {
        send(res, 403, { error: 'En-tete manquant' })
        return
      }
      if (!authorized(req)) {
        send(res, 401, { error: "Code d'acces incorrect" })
        return
      }
      if (running) {
        send(res, 409, { error: 'Mise a jour en cours' })
        return
      }
      // Seulement une version deja deployee (le nom vient de la liste, jamais du client tel quel).
      const target = releases().find((r) => r.name === url.searchParams.get('name'))
      if (!target) {
        send(res, 404, { error: 'Version inconnue' })
        return
      }
      switchTo(target.name)
      push(`Bascule sur la version ${target.sha} (${new Date().toISOString()})`)
      saveState()
      send(res, 200, { switchedTo: target.name })
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
