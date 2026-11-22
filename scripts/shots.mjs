// README media from the real demo: desktop + phone screenshots (JPEG), an 800x500 portfolio thumbnail and a GIF of
// RSVP -> live count -> QR check-in. JPEG is encoded by the browser (canvas), the GIF by gifenc. Map tiles are real OSM.
//   PW_CHANNEL=chrome node scripts/shots.mjs [outDir]       (needs playwright + gifenc)
import { mkdirSync, writeFileSync } from 'node:fs';
import gifenc from 'gifenc';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const OUT = process.argv[2] ?? 'docs/media';
const PORT = Number(process.env.SHOTS_PORT ?? 4317);
mkdirSync(OUT, { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });

async function open(width, height, path = '') {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, timezoneId: 'Asia/Tashkent' });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/${path}`);
  await page.waitForSelector('body[data-ready="1"]');
  return page;
}
const b64 = (buf) => buf.toString('base64');

/** PNG -> resized JPEG through the page's canvas. */
async function jpeg(page, png, name, w, h) {
  const out = await page.evaluate(async ([src, W, H]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, W, H);
    return cv.toDataURL('image/jpeg', 0.87).split(',')[1];
  }, [b64(png), w, h]);
  writeFileSync(`${OUT}/${name}`, Buffer.from(out, 'base64'));
  console.log('wrote', name); // eslint-disable-line no-console
}
const step = async (page, n) => {
  await page.getByTestId(`story-${n}`).click();
  await page.waitForFunction((k) => document.querySelector(`[data-testid=story-${k}]`).classList.contains('done'), n, { timeout: 60_000 });
};
const tiles = (page) => page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll('.leaflet-tile')].filter((i) => i.offsetParent);
  return imgs.length && imgs.every((i) => i.complete);
}, null, { timeout: 15_000 }).catch(() => {});
const toPhones = (page) => page.evaluate(() => {
  const top = document.querySelector('[data-testid=guest-phone]').getBoundingClientRect().top + window.scrollY;
  window.scrollTo(0, top - 50);
});
const scrollPane = (page, who, sel, gap = 40) => page.evaluate(([w, s, gp]) => {
  const pane = document.querySelector(`[data-testid=${w}-app]`);
  const el = pane.querySelector(s);
  pane.scrollTop = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - gp;
}, [who, sel, gap]);

const ONLY = new Set((process.env.ONLY ?? 'desktop,thumb,mobile,gif').split(','));

if (ONLY.has('desktop')) {
  const page = await open(1440, 900);
  for (const n of [1, 2, 3]) await step(page, n);
  await scrollPane(page, 'guest', '[data-testid=pass]', 20);
  await scrollPane(page, 'host', '[data-testid=ring]', 10);
  await page.getByTestId('door-tab-app').click();
  await toPhones(page);
  await page.waitForTimeout(2600);
  await jpeg(page, await page.screenshot(), 'demo-desktop.jpg', 1440, 900);
  await page.context().close();
}

if (ONLY.has('thumb')) {
  const page = await open(1440, 900);
  await step(page, 1);
  await scrollPane(page, 'guest', '[data-testid=names]', 150);
  await page.waitForTimeout(500);
  const left = await page.getByTestId('guest-phone').screenshot();
  for (const n of [2, 3]) await step(page, n);
  await scrollPane(page, 'host', '[data-testid=ring]', 10);
  await page.waitForTimeout(2600);
  const mid = await page.getByTestId('host-phone').screenshot();
  for (const n of [7, 8, 9]) await step(page, n);
  await scrollPane(page, 'door', '[data-testid=door-result]', 330);
  await page.waitForTimeout(600);
  const right = await page.getByTestId('door-phone').screenshot();
  const thumb = await page.evaluate(async ([a, b, c]) => {
    const load = async (s) => { const i = new Image(); i.src = `data:image/png;base64,${s}`; await i.decode(); return i; };
    const imgs = await Promise.all([a, b, c].map(load));
    const cv = document.createElement('canvas');
    cv.width = 1600;
    cv.height = 1000;
    const g = cv.getContext('2d');
    const bg = g.createRadialGradient(420, 120, 40, 700, 500, 1100);
    bg.addColorStop(0, '#1b5a73');
    bg.addColorStop(0.5, '#0f3a4d');
    bg.addColorStop(1, '#081f2a');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1600, 1000);
    // the girih lattice, drawn the same way as on the invitation
    g.strokeStyle = 'rgba(222,182,96,0.16)';
    g.lineWidth = 1.4;
    const star = (cx, cy, R) => {
      g.beginPath();
      for (let k = 0; k <= 16; k++) {
        const ang = (Math.PI / 8) * k - Math.PI / 2;
        const rr = k % 2 ? R * 0.62 : R;
        g[k ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(ang), cy + rr * Math.sin(ang));
      }
      g.stroke();
    };
    for (let y = 0; y < 1100; y += 92) for (let x = 0; x < 1700; x += 92) { star(x, y, 31); star(x + 46, y + 46, 18); }
    g.fillStyle = '#e6c47a';
    g.font = '700 22px -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText('N I K O H   T O ’ Y I', 90, 236);
    g.fillStyle = '#fbf5e6';
    g.font = 'italic 600 88px Georgia, "Times New Roman", serif';
    g.fillText('To’y', 84, 350);
    g.fillText('Taklifnoma', 84, 462);
    g.fillStyle = '#c9d6d8';
    g.font = '500 31px -apple-system, Segoe UI, Roboto, sans-serif';
    ['Chiroyli taklifnoma sahifasi', '«Kelaman» → jonli hisob', 'Imzolangan QR bilan kirish'].forEach((s, i) => {
      g.fillStyle = '#e6c47a';
      g.beginPath();
      g.arc(100, 555 + i * 56, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#d9e4e4';
      g.fillText(s, 124, 566 + i * 56);
    });
    g.fillStyle = 'rgba(230,196,122,0.9)';
    g.font = '600 25px -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText('Telegram bot + sayt · xoliddev', 90, 820);
    const H = 700;
    const draw = (img, dx, dy, rot) => {
      const w = (img.width * H) / img.height;
      g.save();
      g.translate(dx + w / 2, dy + H / 2);
      g.rotate(rot);
      g.shadowColor = 'rgba(0,0,0,0.5)';
      g.shadowBlur = 50;
      g.shadowOffsetY = 24;
      g.beginPath();
      g.roundRect(-w / 2, -H / 2, w, H, (56 * H) / img.height);
      g.fillStyle = '#000';
      g.fill();
      g.shadowColor = 'transparent';
      g.clip();
      g.drawImage(img, -w / 2, -H / 2, w, H);
      g.restore();
      return w;
    };
    draw(imgs[2], 1270, 190, 0.045);
    draw(imgs[1], 972, 150, 0.0);
    draw(imgs[0], 672, 120, -0.04);
    const out = document.createElement('canvas');
    out.width = 800;
    out.height = 500;
    const o = out.getContext('2d');
    o.imageSmoothingQuality = 'high';
    o.drawImage(cv, 0, 0, 800, 500);
    return out.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, [b64(left), b64(mid), b64(right)]);
  writeFileSync(`${OUT}/thumb.jpg`, Buffer.from(thumb, 'base64'));
  console.log('wrote thumb.jpg'); // eslint-disable-line no-console
  await page.context().close();
}

if (ONLY.has('mobile')) {
  const page = await open(390, 844, 'demo/invite.html');
  await page.getByTestId('envelope-open').click();
  await page.waitForTimeout(2300);
  await page.evaluate(() => window.scrollTo(0, 40));
  await page.waitForTimeout(400);
  await jpeg(page, await page.screenshot(), 'demo-mobile.jpg', 390, 844);
  await page.context().close();
}

if (ONLY.has('gif')) {
  const page = await open(1280, 800);
  const W = 860;
  const gif = GIFEncoder();
  await step(page, 1);
  await toPhones(page);
  await tiles(page);
  const clip = await page.evaluate(() => {
    const a = document.querySelector('[data-testid=guest-phone]').getBoundingClientRect();
    const c = document.querySelector('[data-testid=door-phone]').getBoundingClientRect();
    const x = Math.max(0, a.left - 16);
    return { x, y: Math.max(0, a.top - 8), width: c.right + 16 - x, height: Math.min(window.innerHeight - a.top, a.height + 16) };
  });
  const H = Math.round((W * clip.height) / clip.width / 2) * 2;
  async function frame(delay = 160) {
    const png = await page.screenshot({ clip });
    const rgba = await page.evaluate(async ([src, w, h]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      const bytes = g.getImageData(0, 0, w, h).data;
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }, [b64(png), W, H]);
    const data = new Uint8Array(Buffer.from(rgba, 'base64'));
    const palette = quantize(data, 128);
    gif.writeFrame(applyPalette(data, palette), W, H, { palette, delay });
  }
  await frame(1300);
  for (const n of [2, 3, 4, 7, 8, 9, 10, 11]) {
    await page.getByTestId(`story-${n}`).click();
    for (let k = 0; k < 40; k++) {
      await page.waitForTimeout(380);
      await frame(220);
      const finished = await page.evaluate((s) => document.querySelector(`[data-testid=story-${s}]`).classList.contains('done'), n);
      if (finished && k > 2) break;
    }
    await frame(1200);
  }
  await frame(2600);
  gif.finish();
  writeFileSync(`${OUT}/rsvp-live-qr.gif`, gif.bytes());
  console.log('wrote rsvp-live-qr.gif'); // eslint-disable-line no-console
  await page.context().close();
}
await browser.close();
server.close();
