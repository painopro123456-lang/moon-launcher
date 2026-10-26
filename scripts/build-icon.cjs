const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const toIco = require('png-to-ico');

async function main() {
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
