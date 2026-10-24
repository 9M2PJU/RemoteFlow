/**
 * Batched drawing for the embedded RDP client (IronRDP WebAssembly).
 *
 * IronRDP draws every updated screen region with its own `putImageData` call – e.g. a full-screen
 * picture arrives as ~180 strips of 1600×5 px. In Chromium (WebView2, Windows) that costs ~2 ms
 * per frame in total, but in WebKitGTK (Linux) every `putImageData` call has a fixed cost of
 * ~1.5–2 ms (measured: 340–480 ms per full-screen update), so the picture visibly builds up in
 * stripes.
 *
 * Here the regions are only copied into a JS-side frame buffer (cheap) and the dirty area is
 * drawn with ONE `putImageData` per animation frame – measured in WebKitGTK 2.52 against xrdp
 * (1600×900 picture): 11–23 ms of drawing instead of 340–480 ms. Only canvases inside the
 * `<iron-remote-desktop>` element are affected; enabled for WebKit engines (RdpViewer).
 */

interface CanvasBatch {
  width: number;
  height: number;
  frame: Uint8ClampedArray<ArrayBuffer>;
  // dirty rectangle (exclusive max)
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  scheduled: boolean;
}

const batches = new WeakMap<HTMLCanvasElement, CanvasBatch>();
let installed = false;

const isRdpCanvas = (canvas: HTMLCanvasElement | OffscreenCanvas): canvas is HTMLCanvasElement => {
  if (!(canvas instanceof HTMLCanvasElement)) return false;
  const root = canvas.getRootNode();
  return root instanceof ShadowRoot && root.host.tagName === 'IRON-REMOTE-DESKTOP';
};

export function installRdpCanvasBatching(): void {
  if (installed || typeof CanvasRenderingContext2D === 'undefined') return;
  installed = true;

  const proto = CanvasRenderingContext2D.prototype;
  const native = proto.putImageData;

  const flush = (ctx: CanvasRenderingContext2D, b: CanvasBatch) => {
    b.scheduled = false;
    if (b.x1 <= b.x0 || b.y1 <= b.y0) return;
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    // Copy the dirty rows into a compact buffer (full-width rows are a zero-copy view)
    let part: ImageData;
    if (b.x0 === 0 && w === b.width) {
      part = new ImageData(b.frame.subarray(b.y0 * b.width * 4, b.y1 * b.width * 4), w, h);
    } else {
      const buf = new Uint8ClampedArray(w * h * 4);
      for (let r = 0; r < h; r++) {
        const start = ((b.y0 + r) * b.width + b.x0) * 4;
        buf.set(b.frame.subarray(start, start + w * 4), r * w * 4);
      }
      part = new ImageData(buf, w, h);
    }
    (native as any).call(ctx, part, b.x0, b.y0);
    b.x0 = b.y0 = Number.MAX_SAFE_INTEGER;
    b.x1 = b.y1 = 0;
  };

  proto.putImageData = function (
    this: CanvasRenderingContext2D,
    img: ImageData,
    dx: number,
    dy: number,
    sx?: number,
    sy?: number,
    sw?: number,
    sh?: number
  ) {
    const canvas = this.canvas;
    if (!isRdpCanvas(canvas)) {
      // eslint-disable-next-line prefer-rest-params
      return (native as any).apply(this, arguments);
    }

    let b = batches.get(canvas);
    if (!b || b.width !== canvas.width || b.height !== canvas.height) {
      if (b?.scheduled) flush(this, b);
      b = {
        width: canvas.width,
        height: canvas.height,
        frame: new Uint8ClampedArray(canvas.width * canvas.height * 4),
        x0: Number.MAX_SAFE_INTEGER,
        y0: Number.MAX_SAFE_INTEGER,
        x1: 0,
        y1: 0,
        scheduled: false,
      };
      // The canvas already shows the current picture – keep it in the frame buffer
      if (canvas.width > 0 && canvas.height > 0) {
        try {
          b.frame.set(this.getImageData(0, 0, canvas.width, canvas.height).data);
        } catch {
          /* ignore */
        }
      }
      batches.set(canvas, b);
    }

    // Source rectangle inside `img` (the 7-argument form is what IronRDP uses), clipped to the
    // image and, at its destination (dx + sx, dy + sy), to the canvas.
    let rx = Math.floor(sx ?? 0);
    let ry = Math.floor(sy ?? 0);
    let rw = Math.floor(sw ?? img.width);
    let rh = Math.floor(sh ?? img.height);
    if (rw < 0) {
      rx += rw;
      rw = -rw;
    }
    if (rh < 0) {
      ry += rh;
      rh = -rh;
    }
    if (rx < 0) {
      rw += rx;
      rx = 0;
    }
    if (ry < 0) {
      rh += ry;
      ry = 0;
    }
    rw = Math.min(rw, img.width - rx);
    rh = Math.min(rh, img.height - ry);
    let tx = Math.floor(dx) + rx;
    let ty = Math.floor(dy) + ry;
    if (tx < 0) {
      rx -= tx;
      rw += tx;
      tx = 0;
    }
    if (ty < 0) {
      ry -= ty;
      rh += ty;
      ty = 0;
    }
    const w = Math.min(rw, b.width - tx);
    const h = Math.min(rh, b.height - ty);
    if (w <= 0 || h <= 0) return;
    const x = tx;
    const y = ty;
    const offX = rx;
    const offY = ry;

    // Copy the region into the frame buffer (row by row; one block when full rows match)
    const src = img.data;
    if (offX === 0 && w === img.width && w === b.width) {
      b.frame.set(src.subarray(offY * img.width * 4, (offY + h) * img.width * 4), y * b.width * 4);
    } else {
      for (let r = 0; r < h; r++) {
        const s = ((offY + r) * img.width + offX) * 4;
        b.frame.set(src.subarray(s, s + w * 4), ((y + r) * b.width + x) * 4);
      }
    }

    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x + w);
    b.y1 = Math.max(b.y1, y + h);

    if (!b.scheduled) {
      b.scheduled = true;
      const ctx = this;
      const batch = b;
      requestAnimationFrame(() => flush(ctx, batch));
    }
  } as typeof proto.putImageData;
}
