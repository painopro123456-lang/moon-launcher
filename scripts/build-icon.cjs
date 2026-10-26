const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const toIco = typeof pngToIcoModule === 'function' ? pngToIcoModule : pngToIcoModule.default;

async function main() {
  if (typeof toIco !== 'function') {
    throw new TypeError('png-to-ico did not expose an ICO conversion function.');
  }
  const root = path.resolve(__dirname, '..');
  const svg = path.join(root, 'assets', 'moon-icon.svg');
  const png = path.join(root, 'assets', 'moon-icon.png');
  const ico = path.join(root, 'native', 'moon-icon.ico');
  await sharp(svg).resize(256, 256).png().toFile(png);
  const icoBuffer = await toIco(png);
  await fs.writeFile(ico, icoBuffer);
  await fs.unlink(png);
  console.log('Generated Windows app icon:', ico);
}
main().catch(error => { console.error(error); process.exitCode = 1; });