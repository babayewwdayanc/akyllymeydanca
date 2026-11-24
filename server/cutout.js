// Удаление фона с фото игрока для FC-карты.
// Нейросеть MODNet (портретная «матовая» маска, Apache-2.0) работает на сервере:
// телефону не нужно скачивать модель — он отправляет фото и получает PNG с прозрачным фоном.
// Быстрый вариант — onnxruntime-node (Linux, Windows, Mac M1+); запасной — onnxruntime-web (WebAssembly, работает везде).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const MODEL_PATH = path.resolve(process.env.CUTOUT_MODEL || 'models/modnet.onnx');
const REF = 512; // модель обучена на коротей стороне 512 px

let ort = null;
let sessionPromise = null;
export let cutoutBackend = null;

export const cutoutAvailable = () => fs.existsSync(MODEL_PATH);

async function loadRuntime() {
  try {
    const m = await import('onnxruntime-node');
    cutoutBackend = 'onnxruntime-node';
    return m.default ?? m;
  } catch {
    const m = await import('onnxruntime-web');
    const rt = m.default ?? m;
    rt.env.wasm.numThreads = 1;
    cutoutBackend = 'onnxruntime-web (wasm)';
    return rt;
  }
}

function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      ort = await loadRuntime();
      return ort.InferenceSession.create(new Uint8Array(fs.readFileSync(MODEL_PATH)));
    })().catch((e) => {
      sessionPromise = null;
      throw e;
    });
  }
  return sessionPromise;
}

// Обрабатываем фото по одному, чтобы не перегружать процессор.
let chain = Promise.resolve();
const enqueue = (fn) => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

const smooth = (a) => {
  // Делаем край маски чуть резче, но оставляем мягкие волосы
  const t = Math.min(1, Math.max(0, (a - 0.06) / 0.88));
  return t * t * (3 - 2 * t);
};

/**
 * Принимает фото (Buffer), возвращает PNG с прозрачным фоном, обрезанный по фигуре человека,
 * или null, если человека на фото не нашли.
 */
export function cutoutPerson(buffer) {
  return enqueue(async () => {
    const session = await getSession();
    const { data: rgb, info } = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;

    const k = REF / Math.min(W, H);
    const mw = Math.max(32, Math.round((W * k) / 32) * 32);
    const mh = Math.max(32, Math.round((H * k) / 32) * 32);
    const small = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).resize(mw, mh, { fit: 'fill' }).raw().toBuffer();
    const n = mw * mh;
    const input = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      input[i] = small[i * 3] / 127.5 - 1;
      input[n + i] = small[i * 3 + 1] / 127.5 - 1;
      input[2 * n + i] = small[i * 3 + 2] / 127.5 - 1;
    }
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, mh, mw]) });
    const matte = out[session.outputNames[0]].data;
    const m8 = Buffer.alloc(n);
    for (let i = 0; i < n; i++) m8[i] = Math.round(smooth(matte[i]) * 255);
    const alpha = await sharp(m8, { raw: { width: mw, height: mh, channels: 1 } }).resize(W, H, { fit: 'fill' }).extractChannel(0).raw().toBuffer();
    if (alpha.length !== W * H) throw new Error(`mask size ${alpha.length} != ${W * H}`);

    let minX = W;
    let minY = H;
    let maxX = -1;
    let maxY = -1;
    let cover = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (alpha[y * W + x] > 40) {
          cover++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const coverage = cover / (W * H);
    if (coverage < 0.03 || coverage > 0.97) return null;

    const rgba = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      rgba[i * 4] = rgb[i * 3];
      rgba[i * 4 + 1] = rgb[i * 3 + 1];
      rgba[i * 4 + 2] = rgb[i * 3 + 2];
      rgba[i * 4 + 3] = alpha[i];
    }
    // Обрезаем по фигуре: небольшой запас сверху и по бокам, снизу — до края фигуры
    const padX = Math.round((maxX - minX) * 0.06);
    const padTop = Math.round((maxY - minY) * 0.04);
    const left = Math.max(0, minX - padX);
    const top = Math.max(0, minY - padTop);
    const right = Math.min(W - 1, maxX + padX);
    return sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
      .extract({ left, top, width: right - left + 1, height: maxY - top + 1 })
      .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  });
}
