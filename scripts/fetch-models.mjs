// Скачивает нейросеть для удаления фона с фото (MODNet, лицензия Apache-2.0, ~26 МБ).
// Запуск: npm run models. Если сервер без доступа к Hugging Face — скопируйте файл вручную в models/modnet.onnx.
import fs from 'node:fs';
import path from 'node:path';

const MODELS = [
  {
    file: 'models/modnet.onnx',
    url: 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx',
    size: 25888640,
  },
];

for (const m of MODELS) {
  const dest = path.resolve(m.file);
  if (fs.existsSync(dest) && fs.statSync(dest).size === m.size) {
    console.log(`✓ ${m.file} уже есть`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log(`↓ ${m.file} (${(m.size / 1e6).toFixed(1)} МБ)…`);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`Не удалось скачать ${m.url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== m.size) throw new Error(`Размер не совпал: ${buf.length} вместо ${m.size}`);
  fs.writeFileSync(dest, buf);
  console.log(`✓ ${m.file} сохранён`);
}
