#!/usr/bin/env python3
"""API de stockage d'EasyCNC (bibliothèque standard uniquement).

Écoute en local (127.0.0.1) : Caddy lui transmet les requêtes /api/*.

  GET    /api/ping                  état du service
  GET    /api/store                 tous les réglages { clé: texte }
  PUT    /api/store/<clé>           enregistre un réglage (corps = texte JSON)
  DELETE /api/store/<clé>
  GET    /api/projects              liste des projets (métadonnées)
  GET    /api/projects/<id>         un projet
  PUT    /api/projects/<id>         enregistre un projet (corps = JSON)
  DELETE /api/projects/<id>

Données : $EASYCNC_DATA (par défaut /var/lib/easycnc) : store/, projects/, backups/ (une sauvegarde par jour, 14 conservées).
Aucune authentification : à réserver au réseau local.
"""
import io
import json
import os
import re
import sys
import tarfile
import time
from datetime import date, datetime, timezone

DATA = os.environ.get('EASYCNC_DATA', '/var/lib/easycnc')
PORT = int(os.environ.get('EASYCNC_PORT', '8787'))
MAX_BODY = 12 * 1024 * 1024
KEEP_BACKUPS = 14
KEY_RE = re.compile(r'^easycnc\.[A-Za-z0-9._-]{1,120}$')
ID_RE = re.compile(r'^[a-z0-9]{6,32}$')


def _dir(sub):
    p = os.path.join(DATA, sub)
    os.makedirs(p, exist_ok=True)
    return p


def _write_atomic(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _read(path):
    with open(path, 'rb') as f:
        return f.read()


def backup_if_needed():
    """Une archive datée par jour (créée à la première écriture du jour), 14 conservées."""
    bdir = _dir('backups')
    name = 'easycnc-%s.tar.gz' % date.today().isoformat()
    target = os.path.join(bdir, name)
    if not os.path.exists(target):
        tmp = target + '.tmp'
        with tarfile.open(tmp, 'w:gz') as tar:
            for sub in ('store', 'projects'):
                p = os.path.join(DATA, sub)
                if os.path.isdir(p):
                    tar.add(p, arcname=sub)
        os.replace(tmp, target)
    olds = sorted(f for f in os.listdir(bdir) if f.startswith('easycnc-') and f.endswith('.tar.gz'))
    for f in olds[:-KEEP_BACKUPS]:
        try:
            os.remove(os.path.join(bdir, f))
        except OSError:
            pass


def _json(code, obj):
    return code, 'application/json; charset=utf-8', json.dumps(obj, ensure_ascii=False).encode('utf-8')


def _err(code, msg):
    return _json(code, {'error': msg})


def _meta(pid, raw, mtime):
    """Métadonnées d'un projet pour la liste."""
    try:
        p = json.loads(raw.decode('utf-8'))
    except Exception:
        p = {}
    stock = p.get('stock') or {}
    return {
        'id': pid,
        'name': p.get('name') or 'Sans titre',
        'updated': datetime.fromtimestamp(mtime, timezone.utc).isoformat(),
        'w': stock.get('w'), 'h': stock.get('h'), 't': stock.get('t'),
        'shapes': len(p.get('shapes') or []),
        'mode': p.get('mode') or 'mill',
    }


def handle(method, path, body=b''):
    """Traitement d'une requête -> (code HTTP, type MIME, octets). Ne touche pas au réseau : testable seul."""
    path = path.split('?', 1)[0].rstrip('/') or '/'
    parts = [p for p in path.split('/') if p]
    if len(parts) < 2 or parts[0] != 'api':
        return _err(404, 'introuvable')
    area = parts[1]
    ident = parts[2] if len(parts) > 2 else None
    if len(parts) > 3:
        return _err(404, 'introuvable')

    if area == 'ping' and method == 'GET':
        return _json(200, {'ok': True, 'service': 'easycnc', 'time': int(time.time())})

    if area == 'store':
        d = _dir('store')
        if ident is None:
            if method != 'GET':
                return _err(405, 'méthode non autorisée')
            out = {}
            for f in os.listdir(d):
                if f.endswith('.json'):
                    key = f[:-5]
                    if KEY_RE.match(key):
                        out[key] = _read(os.path.join(d, f)).decode('utf-8')
            return _json(200, out)
        if not KEY_RE.match(ident):
            return _err(400, 'clé invalide')
        fpath = os.path.join(d, ident + '.json')
        if method == 'PUT':
            if len(body) > MAX_BODY:
                return _err(413, 'trop volumineux')
            try:
                body.decode('utf-8')
            except UnicodeDecodeError:
                return _err(400, 'texte UTF-8 attendu')
            backup_if_needed()
            _write_atomic(fpath, body)
            return _json(200, {'ok': True})
        if method == 'DELETE':
            if os.path.exists(fpath):
                backup_if_needed()
                os.remove(fpath)
            return _json(200, {'ok': True})
        return _err(405, 'méthode non autorisée')

    if area == 'projects':
        d = _dir('projects')
        if ident is None:
            if method != 'GET':
                return _err(405, 'méthode non autorisée')
            items = []
            for f in os.listdir(d):
                if f.endswith('.json') and ID_RE.match(f[:-5]):
                    fp = os.path.join(d, f)
                    items.append(_meta(f[:-5], _read(fp), os.path.getmtime(fp)))
            items.sort(key=lambda m: m['updated'], reverse=True)
            return _json(200, items)
        if not ID_RE.match(ident):
            return _err(400, 'identifiant invalide')
        fpath = os.path.join(d, ident + '.json')
        if method == 'GET':
            if not os.path.exists(fpath):
                return _err(404, 'projet introuvable')
            return 200, 'application/json; charset=utf-8', _read(fpath)
        if method == 'PUT':
            if len(body) > MAX_BODY:
                return _err(413, 'trop volumineux')
            try:
                obj = json.loads(body.decode('utf-8'))
            except Exception:
                return _err(400, 'JSON invalide')
            if not isinstance(obj, dict) or not isinstance(obj.get('shapes', []), list):
                return _err(400, 'projet invalide')
            backup_if_needed()
            _write_atomic(fpath, json.dumps(obj, ensure_ascii=False).encode('utf-8'))
            return _json(200, {'ok': True, 'id': ident})
        if method == 'DELETE':
            if os.path.exists(fpath):
                backup_if_needed()
                os.remove(fpath)
            return _json(200, {'ok': True})
        return _err(405, 'méthode non autorisée')

    return _err(404, 'introuvable')


def serve():
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def _run(self):
            try:
                length = int(self.headers.get('Content-Length') or 0)
            except ValueError:
                length = 0
            if length > MAX_BODY:
                code, ctype, data = _err(413, 'trop volumineux')
            else:
                body = self.rfile.read(length) if length else b''
                try:
                    code, ctype, data = handle(self.command, self.path, body)
                except Exception as e:  # ne jamais faire tomber le service
                    sys.stderr.write('erreur: %r\n' % (e,))
                    code, ctype, data = _err(500, 'erreur interne')
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_PUT = do_DELETE = do_POST = _run

        def log_message(self, fmt, *args):
            pass

    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    sys.stderr.write('EasyCNC API sur 127.0.0.1:%d, données dans %s\n' % (PORT, DATA))
    srv.serve_forever()


if __name__ == '__main__':
    serve()
