/**
 * Performance statistics of the embedded RDP client (shown by the "Statystyki" button in RdpViewer).
 *
 * Measured without touching IronRDP itself:
 *  - data from the server: bytes of WebSocket messages (the RDP stream from the local proxy),
 *  - screen updates: `putImageData` calls on the `<iron-remote-desktop>` canvas (regions, pixels,
 *    drawing time); in WebKit the batching module reports its copying and presentation time,
 *  - main thread: a 10 ms timer probe – how long the thread was blocked (decoding in WebAssembly,
 *    protocol handling and drawing all run there),
 *  - large updates (≥10% of the screen, e.g. switching windows): duration from the first to the last
 *    region, data received and main-thread time in that period. Busy ≈ duration means the computer
 *    (decoding/drawing) is the limit; busy much lower than duration means the network or the server.
 */

export interface RdpBurst {
  ms: number;
  mpx: number;
  mb: number;
  busyMs: number;
  drawMs: number;
  regions: number;
}

export interface RdpStatsSnapshot {
  engine: string;
  canvas: string;
  mbps: number;
  msgs: number;
  regions: number;
  mpx: number;
  frames: number;
  drawMs: number;
  busyMs: number;
  maxBlockMs: number;
  lastBurst: RdpBurst | null;
  avgBurst: RdpBurst | null;
  bursts: number;
}

interface Counters {
  bytes: number;
  msgs: number;
  regions: number;
  px: number;
  frames: number;
  drawMs: number;
  busyMs: number;
  maxBlockMs: number;
}

const zero = (): Counters => ({ bytes: 0, msgs: 0, regions: 0, px: 0, frames: 0, drawMs: 0, busyMs: 0, maxBlockMs: 0 });

let enabled = false;
let installed = false;
let cur = zero();
let windowStart = 0;
let canvasW = 0;
let canvasH = 0;
let batched = false;

// Large-update tracking
const BURST_GAP_MS = 100;
const BURST_MIN_FRACTION = 0.1;
interface OpenBurst {
  start: number;
  last: number;
  px: number;
  bytes: number;
  busyMs: number;
  drawMs: number;
  regions: number;
}
let burst: OpenBurst | null = null;
let lastBurst: RdpBurst | null = null;
let burstSum: RdpBurst = { ms: 0, mpx: 0, mb: 0, busyMs: 0, drawMs: 0, regions: 0 };
let burstCount = 0;

let probeTimer: ReturnType<typeof setInterval> | null = null;
let probeLast = 0;
const PROBE_MS = 10;
const BLOCK_MIN_MS = 4;

const closeBurst = () => {
  if (!burst) return;
  const b = burst;
  burst = null;
  if (canvasW * canvasH === 0 || b.px < BURST_MIN_FRACTION * canvasW * canvasH) return;
  lastBurst = {
    ms: b.last - b.start,
    mpx: b.px / 1e6,
    mb: b.bytes / 1e6,
    busyMs: b.busyMs,
    drawMs: b.drawMs,
    regions: b.regions,
  };
  burstCount++;
  burstSum = {
    ms: burstSum.ms + lastBurst.ms,
    mpx: burstSum.mpx + lastBurst.mpx,
    mb: burstSum.mb + lastBurst.mb,
    busyMs: burstSum.busyMs + lastBurst.busyMs,
    drawMs: burstSum.drawMs + lastBurst.drawMs,
    regions: burstSum.regions + lastBurst.regions,
  };
};

/** A screen region drawn by IronRDP (called for every putImageData on the RDP canvas). */
export function statsRegion(px: number, width: number, height: number, ms: number): void {
  if (!enabled) return;
  const now = performance.now();
  canvasW = width;
  canvasH = height;
  cur.regions++;
  cur.px += px;
  cur.drawMs += ms;
  if (burst && now - burst.last > BURST_GAP_MS) closeBurst();
  if (!burst) burst = { start: now, last: now, px: 0, bytes: 0, busyMs: 0, drawMs: 0, regions: 0 };
  burst.last = now;
  burst.px += px;
  burst.drawMs += ms;
  burst.regions++;
}

/** One presentation of the batched frame buffer (WebKit) and its duration. */
export function statsFrame(ms: number): void {
  if (!enabled) return;
  cur.frames++;
  cur.drawMs += ms;
  if (burst && performance.now() - burst.last <= BURST_GAP_MS + 50) burst.drawMs += ms;
}

export function statsSetBatched(on: boolean): void {
  batched = on;
}

export function rdpStatsEnabled(): boolean {
  return enabled;
}

const isRdpCanvas = (canvas: HTMLCanvasElement | OffscreenCanvas): canvas is HTMLCanvasElement => {
  if (!(canvas instanceof HTMLCanvasElement)) return false;
  const root = canvas.getRootNode();
  return root instanceof ShadowRoot && root.host.tagName === 'IRON-REMOTE-DESKTOP';
};

/**
 * Installs the measuring hooks (WebSocket byte counter; putImageData counter when the batching
 * module is not active). Must run before IronRDP opens its WebSocket. Costs nothing while the
 * statistics are hidden (a flag check per message/region).
 */
export function installRdpStats(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const NativeWS = window.WebSocket;
  class CountingWebSocket extends NativeWS {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener('message', (ev: MessageEvent) => {
        if (!enabled) return;
        const d = ev.data;
        const n = d instanceof ArrayBuffer ? d.byteLength : d instanceof Blob ? d.size : String(d).length;
        cur.bytes += n;
        cur.msgs++;
        if (burst) burst.bytes += n;
      });
    }
  }
  window.WebSocket = CountingWebSocket as typeof WebSocket;

  if (typeof CanvasRenderingContext2D !== 'undefined') {
    const proto = CanvasRenderingContext2D.prototype;
    const inner = proto.putImageData;
    proto.putImageData = function (this: CanvasRenderingContext2D, img: ImageData, ...rest: number[]) {
      if (!enabled || batched || !isRdpCanvas(this.canvas)) {
        return (inner as any).call(this, img, ...rest);
      }
      const t0 = performance.now();
      (inner as any).call(this, img, ...rest);
      const w = rest.length >= 6 ? Math.abs(rest[4]) : img.width;
      const h = rest.length >= 6 ? Math.abs(rest[5]) : img.height;
      statsRegion(w * h, this.canvas.width, this.canvas.height, performance.now() - t0);
    } as typeof proto.putImageData;
  }
}

/** Turns the measurement on/off (the main-thread probe runs only while enabled). */
export function setRdpStatsEnabled(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  resetRdpStats();
  if (on) {
    probeLast = performance.now();
    probeTimer = setInterval(() => {
      const now = performance.now();
      const blocked = Math.max(0, now - probeLast - PROBE_MS);
      probeLast = now;
      // Timer jitter of a few ms is not a blocked thread
      if (blocked > BLOCK_MIN_MS) {
        cur.busyMs += blocked;
        cur.maxBlockMs = Math.max(cur.maxBlockMs, blocked);
        if (burst && now - blocked - burst.last <= BURST_GAP_MS) burst.busyMs += blocked;
      }
    }, PROBE_MS);
  } else if (probeTimer) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
}

export function resetRdpStats(): void {
  cur = zero();
  windowStart = performance.now();
  burst = null;
  lastBurst = null;
  burstSum = { ms: 0, mpx: 0, mb: 0, busyMs: 0, drawMs: 0, regions: 0 };
  burstCount = 0;
}

/** Values per second since the previous call (call about once a second). */
export function takeRdpStats(): RdpStatsSnapshot {
  const now = performance.now();
  const sec = Math.max(0.001, (now - windowStart) / 1000);
  const c = cur;
  cur = zero();
  windowStart = now;
  if (burst && now - burst.last > BURST_GAP_MS) closeBurst();
  const avg =
    burstCount > 0
      ? {
          ms: burstSum.ms / burstCount,
          mpx: burstSum.mpx / burstCount,
          mb: burstSum.mb / burstCount,
          busyMs: burstSum.busyMs / burstCount,
          drawMs: burstSum.drawMs / burstCount,
          regions: burstSum.regions / burstCount,
        }
      : null;
  return {
    engine: batched ? 'WebKit (batching)' : 'Chromium/WebView2',
    canvas: canvasW ? `${canvasW}×${canvasH}` : '–',
    mbps: c.bytes / 1e6 / sec,
    msgs: c.msgs / sec,
    regions: c.regions / sec,
    mpx: c.px / 1e6 / sec,
    frames: c.frames / sec,
    drawMs: c.drawMs / sec,
    busyMs: c.busyMs / sec,
    maxBlockMs: c.maxBlockMs,
    lastBurst,
    avgBurst: avg,
    bursts: burstCount,
  };
}
