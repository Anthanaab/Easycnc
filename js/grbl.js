// Liaison série GRBL (Web Serial) avec streaming à comptage de caractères.
(function () {
  const CNC = window.CNC;
  const RX_BUFFER = 120; // GRBL : 128 octets, marge de sécurité

  class Grbl {
    constructor() {
      this.port = null; this.writer = null; this.reader = null;
      this.connected = false; this.homed = false; this.homing = false;
      this.inflight = []; this.manual = []; this.job = null;
      this.rx = '';
      this.status = { pins: '', state: 'Déconnecté', mpos: [0, 0, 0], wpos: [0, 0, 0], wco: [0, 0, 0], feed: 0, spindle: 0 };
      this.settings = {};
      this.on = { log() {}, status() {}, job() {}, settings() {}, close() {} };
      this.timer = null;
    }

    static supported() { return 'serial' in navigator; }

    async connect(baud) {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: baud || 115200 });
      this.connected = true;
      this.writer = this.port.writable.getWriter();
      this.status.state = 'Connexion…';
      this.on.status(this.status);
      this._readLoop();
      this.timer = setInterval(() => this.rt(0x3f), 250); // '?'
      setTimeout(() => this.send('$$').catch(() => {}), 2000); // laisse GRBL démarrer après le reset DTR
    }

    async disconnect() {
      this.connected = false; this.homed = false; this.homing = false;
      clearInterval(this.timer);
      this.job = null; this.inflight = []; this.manual = [];
      try { this.reader && (await this.reader.cancel()); } catch (e) { /* ignoré */ }
      try { this.writer && this.writer.releaseLock(); } catch (e) { /* ignoré */ }
      try { this.port && (await this.port.close()); } catch (e) { /* ignoré */ }
      this.port = this.writer = this.reader = null;
      this.status.state = 'Déconnecté';
      this.on.status(this.status);
      this.on.close();
    }

    async _readLoop() {
      const dec = new TextDecoder();
      try {
        this.reader = this.port.readable.getReader();
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          this._onData(dec.decode(value, { stream: true }));
        }
      } catch (e) {
        this.on.log('err', 'Liaison série interrompue : ' + e.message);
      } finally {
        try { this.reader.releaseLock(); } catch (e) { /* ignoré */ }
      }
      if (this.connected) this.disconnect();
    }

    _onData(chunk) {
      this.rx += chunk;
      let i;
      while ((i = this.rx.indexOf('\n')) >= 0) {
        const line = this.rx.slice(0, i).trim();
        this.rx = this.rx.slice(i + 1);
        if (line) this._onLine(line);
      }
    }

    _onLine(line) {
      if (line[0] === '<') return this._onStatus(line);
      if (line === 'ok') return this._ack(null);
      if (line.startsWith('error')) { this.on.log('err', line); return this._ack(line); }
      if (line.startsWith('ALARM')) { this.on.log('err', line); return; }
      if (/^\$\d+=/.test(line)) {
        const [k, v] = line.split('=');
        this.settings[k] = parseFloat(v);
        this.on.settings(this.settings);
        return;
      }
      if (line.startsWith('[PRB:')) { // résultat d'un palpage : [PRB:x,y,z:1] (1 = contact)
        const m = line.match(/^\[PRB:([-\d.,]+):(\d)\]/);
        if (m) this.lastPrb = { pos: m[1].split(',').map(parseFloat), ok: m[2] === '1' };
        this.on.log('info', line);
        return;
      }
      if (line.startsWith('Grbl')) { this.inflight = []; this.on.log('info', line); return; }
      this.on.log('info', line);
    }

    _onStatus(line) {
      const parts = line.replace(/[<>]/g, '').split('|');
      this.status.pins = '';
      const s = this.status;
      s.state = parts[0].split(':')[0];
      // suivi du homing : « Home » pendant la recherche des contacts, puis « Idle » = position machine valide
      if (s.state === 'Home') this.homing = true;
      else if (this.homing && s.state === 'Idle') { this.homed = true; this.homing = false; }
      else if (s.state === 'Alarm') { this.homed = false; this.homing = false; }
      let gotM = false, gotW = false;
      for (const p of parts.slice(1)) {
        const [k, v] = p.split(':');
        const nums = (v || '').split(',').map(parseFloat);
        if (k === 'MPos') { s.mpos = nums; gotM = true; }
        else if (k === 'WPos') { s.wpos = nums; gotW = true; }
        else if (k === 'WCO') s.wco = nums;
        else if (k === 'FS') { s.feed = nums[0]; s.spindle = nums[1]; }
        else if (k === 'F') s.feed = nums[0];
        else if (k === 'Pn') s.pins = v || '';
      }
      // le décalage WCO peut arriver après la position dans le même rapport : on calcule une fois tout lu
      if (gotM) s.wpos = s.mpos.map((n, i) => n - s.wco[i]);
      else if (gotW) s.mpos = s.wpos.map((n, i) => n + s.wco[i]);
      this.on.status(s);
      const j = this.job;
      if (j && j.acked >= j.total && s.state === 'Idle') {
        this.job = null;
        this.on.job({ done: true, total: j.total, acked: j.total });
      }
    }

    _ack(err) {
      const item = this.inflight.shift();
      if (!item) return;
      if (item.job && this.job) {
        this.job.acked++;
        if (err) { this.job.error = err; }
        this.on.job({ done: false, total: this.job.total, acked: this.job.acked, error: this.job.error });
      }
      if (item.res) (err ? item.rej(new Error(err)) : item.res());
      if (err && item.job) this.stop();
      this._pump();
    }

    _write(str) {
      if (!this.writer) return;
      this.writer.write(new TextEncoder().encode(str)).catch((e) => this.on.log('err', e.message));
    }

    rt(byte) {
      if (!this.writer) return;
      this.writer.write(new Uint8Array([byte])).catch(() => {});
    }

    // Commande unique ; la promesse se résout sur « ok »
    send(line) {
      return new Promise((res, rej) => {
        this.manual.push({ line, res, rej });
        this._pump();
      });
    }

    _pump() {
      for (;;) {
        let item, fromJob = false;
        if (this.manual.length) item = this.manual[0];
        else if (this.job && !this.job.paused && this.job.next < this.job.lines.length) {
          item = { line: this.job.lines[this.job.next] };
          fromJob = true;
        } else break;
        const len = item.line.length + 1;
        const used = this.inflight.reduce((a, b) => a + b.len, 0);
        if (used + len > RX_BUFFER) break;
        if (fromJob) this.job.next++; else this.manual.shift();
        this.inflight.push({ len, job: fromJob, res: item.res, rej: item.rej });
        this._write(item.line + '\n');
      }
    }

    startJob(lines) {
      this.job = { lines, next: 0, acked: 0, total: lines.length, paused: false };
      this.on.job({ done: false, total: lines.length, acked: 0 });
      this._pump();
    }
    pause() { this.rt(0x21); if (this.job) this.job.paused = true; }
    resume() { this.rt(0x7e); if (this.job) { this.job.paused = false; this._pump(); } }
    async stop() {
      this.rt(0x21);
      await new Promise((r) => setTimeout(r, 150));
      this.rt(0x18); // reset logiciel : arrête aussi la broche
      this.homed = false; // la position machine n'est plus garantie après un reset
      const had = this.job;
      this.job = null; this.inflight = []; this.manual = [];
      if (had) this.on.job({ done: true, aborted: true, total: had.total, acked: had.acked });
    }

    jog(dx, dy, dz, feed) {
      const ax = [['X', dx], ['Y', dy], ['Z', dz]].filter((a) => a[1]).map(([k, v]) => k + CNC.num(v)).join('');
      if (!ax) return Promise.resolve();
      return this.send(`$J=G21G91${ax}F${feed}`);
    }
  }

  CNC.Grbl = Grbl;
})();
