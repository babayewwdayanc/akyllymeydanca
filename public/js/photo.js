// Surat taýýarlamak: telefonda kiçeltmek we serwerde fony aýyrmak.
import { ApiError } from './api.js';

function loadImg(file) {
  const url = URL.createObjectURL(file);
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res({ img: i, url });
    i.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Suraty açyp bolmady. JPG ýa-da PNG synap görüň.')); };
    i.src = url;
  });
}

const toBlob = (cv, type, q) => new Promise((r) => cv.toBlob(r, type, q));

/** Saýlanan faýldan iki surat: kiçeldilen asyl (fony aýyrmak üçin) we inedördül (fon galsa). */
export async function preparePhoto(file) {
  const { img, url } = await loadImg(file);
  try {
    const max = 1400;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k);
    cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const original = await toBlob(cv, 'image/jpeg', 0.9);

    const S = 640;
    const sq = document.createElement('canvas');
    sq.width = S;
    sq.height = S;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = Math.max(0, (img.naturalHeight - side) * 0.25); // ýüz adatça ýokarrakda
    sq.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, S, S);
    const square = await toBlob(sq, 'image/jpeg', 0.88);
    return { original, square };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Serwerde fony aýyrýar. PNG (aç-açan fon) gaýtarýar. */
export async function removeBackground(blob) {
  const fd = new FormData();
  fd.append('photo', blob, 'photo.jpg');
  let res;
  try {
    res = await fetch('/api/photo/cutout', { method: 'POST', body: fd });
  } catch {
    throw new ApiError('Serwer bilen aragatnaşyk ýok. Internedi barlaň.', 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `Ýalňyşlyk ${res.status}`, res.status);
  }
  return res.blob();
}
