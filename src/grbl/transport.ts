export type LineHandler = (line: string) => void

/**
 * Fine couche au-dessus de l'API Web Serial.
 * Elle ouvre le port, lit en continu et decoupe le flux en lignes.
 */
export class SerialTransport {
  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()
  private buffer = ''
  private closing = false

  onLine?: LineHandler
  onClose?: () => void
  onError?: (error: unknown) => void

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator
  }

  get isOpen(): boolean {
    return this.port !== null && this.writer !== null && !this.closing
  }

  /** Ouvre le selecteur de port du navigateur puis ouvre le port choisi. */
  async requestAndOpen(baudRate: number): Promise<void> {
    if (!SerialTransport.isSupported()) {
      throw new Error('Web Serial non supporte par ce navigateur (utilisez Chrome/Edge).')
    }
    const port = await navigator.serial.requestPort()
    await this.open(port, baudRate)
  }

  async open(port: SerialPort, baudRate: number): Promise<void> {
    this.closing = false
    this.buffer = ''
    this.port = port
    await port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
      bufferSize: 4096,
    })
    this.writer = port.writable!.getWriter()
    void this.readLoop()
  }

  private async readLoop(): Promise<void> {
    const port = this.port
    if (!port) return
    while (!this.closing && port.readable) {
      this.reader = port.readable.getReader()
      try {
        for (;;) {
          const { value, done } = await this.reader.read()
          if (done) break
          if (value && value.length) {
            this.buffer += this.decoder.decode(value, { stream: true })
            this.drain()
          }
        }
      } catch (error) {
        if (!this.closing) this.onError?.(error)
      } finally {
        try {
          this.reader?.releaseLock()
        } catch {
          /* ignore */
        }
        this.reader = null
      }
      if (this.closing) break
    }
    this.onClose?.()
  }

  private drain(): void {
    let index: number
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const raw = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      const line = raw.replace(/\r/g, '').trim()
      if (line.length) this.onLine?.(line)
    }
  }

  async write(data: string | Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('Port serie non ouvert')
    const bytes = typeof data === 'string' ? this.encoder.encode(data) : data
    await this.writer.write(bytes)
  }

  async close(): Promise<void> {
    this.closing = true
    try {
      await this.reader?.cancel()
    } catch {
      /* ignore */
    }
    try {
      this.writer?.releaseLock()
    } catch {
      /* ignore */
    }
    this.writer = null
    const port = this.port
    this.port = null
    try {
      await port?.close()
    } catch {
      /* ignore */
    }
  }
}
