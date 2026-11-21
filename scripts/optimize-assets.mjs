import sharp from 'sharp';
import { optimize } from 'svgo';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DIRS_TO_PROCESS = ['images', 'assets'];
const RESPONSIVE_WIDTHS = [512, 1024, 2048];

async function optimizeImages() {
  console.log('🚀 Starting Senior Performance Engineer Asset Optimization Pipeline...\n');

  let totalOrigBytes = 0;
  let totalNewBytes = 0;
  let rasterCount = 0;
  let responsiveCount = 0;
  let svgCount = 0;
  const processedMap = new Map(); // originalName -> webpName

  for (const relDir of DIRS_TO_PROCESS) {
    const dir = path.join(ROOT_DIR, relDir);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (!fs.statSync(fullPath).isFile()) continue;

      const ext = path.extname(file).toLowerCase();
      const baseName = path.basename(file, ext);

      // Skip responsive variants
      if (baseName.endsWith('-512') || baseName.endsWith('-1024') || baseName.endsWith('-2048')) {
        continue;
      }

      // 1. Process Raster (JPG, JPEG, PNG)
      if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        const origSize = fs.statSync(fullPath).size;
        totalOrigBytes += origSize;

        const webpFilename = `${baseName}.webp`;
        const outWebp = path.join(dir, webpFilename);
        const outAvif = path.join(dir, `${baseName}.avif`);

        try {
          const image = sharp(fullPath);
          const meta = await image.metadata();

          // High-quality lossy WebP (quality 84, effort 6)
          await sharp(fullPath)
            .webp({ quality: 84, effort: 6 })
            .toFile(outWebp);

          const webpSize = fs.statSync(outWebp).size;
          totalNewBytes += webpSize;
          rasterCount++;
          processedMap.set(file, webpFilename);

          // Fast AVIF generation (quality 80, effort 3)
          await sharp(fullPath)
            .avif({ quality: 80, effort: 3 })
            .toFile(outAvif);

          // Generate responsive sizes (512, 1024, 2048)
          for (const w of RESPONSIVE_WIDTHS) {
            if (meta.width && meta.width > w) {
              const respWebp = path.join(dir, `${baseName}-${w}.webp`);
              await sharp(fullPath)
                .resize({ width: w, withoutEnlargement: true })
                .webp({ quality: 84, effort: 6 })
                .toFile(respWebp);
              responsiveCount++;
            }
          }

          const savedPct = ((1 - webpSize / origSize) * 100).toFixed(1);
          console.log(`  ✔ [WEBP & AVIF] ${file} (${(origSize / 1024).toFixed(1)} KB) ➔ ${webpFilename} (${(webpSize / 1024).toFixed(1)} KB, -${savedPct}%)`);
        } catch (err) {
          console.error(`  ✖ Failed to process ${file}:`, err.message);
        }
      }

      // 2. Re-compress oversized existing WebPs (e.g. uncompressed exports)
      else if (ext === '.webp') {
        const origSize = fs.statSync(fullPath).size;
        try {
          const meta = await sharp(fullPath).metadata();
          if (origSize > 350 * 1024) {
            const tmpOut = fullPath + '.tmp.webp';
            await sharp(fullPath)
              .webp({ quality: 84, effort: 6 })
              .toFile(tmpOut);
            const newSize = fs.statSync(tmpOut).size;
            if (newSize < origSize) {
              fs.renameSync(tmpOut, fullPath);
              console.log(`  ✔ [RE-COMPRESSED WEBP] ${file}: ${(origSize / 1024).toFixed(1)} KB ➔ ${(newSize / 1024).toFixed(1)} KB (-${((1 - newSize / origSize) * 100).toFixed(1)}%)`);
            } else {
              if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
            }
          }

          // Responsive variants for existing webps
          for (const w of RESPONSIVE_WIDTHS) {
            if (meta.width && meta.width > w) {
              const respWebp = path.join(dir, `${baseName}-${w}.webp`);
              if (!fs.existsSync(respWebp)) {
                await sharp(fullPath)
                  .resize({ width: w, withoutEnlargement: true })
                  .webp({ quality: 84, effort: 6 })
                  .toFile(respWebp);
                responsiveCount++;
              }
            }
          }
        } catch (err) {
          console.error(`  ✖ Failed to check webp ${file}:`, err.message);
        }
      }

      // 3. Optimize SVGs with SVGO (Keep SVG format intact)
      else if (ext === '.svg') {
        try {
          const origSvg = fs.readFileSync(fullPath, 'utf8');
          const result = optimize(origSvg, {
            multipass: true,
            plugins: [
              'preset-default',
              'removeDimensions',
              'cleanupIds'
            ]
          });
          fs.writeFileSync(fullPath, result.data, 'utf8');
          svgCount++;
          console.log(`  ✔ [SVGO] ${file} optimized`);
        } catch (err) {
          console.error(`  ✖ Failed to optimize SVG ${file}:`, err.message);
        }
      }
    }
  }

  console.log('\n-----------------------------------------------------------');
  console.log(`✓ Converted ${rasterCount} raster images to WebP & AVIF`);
  console.log(`✓ Generated ${responsiveCount} responsive width variants (-512, -1024, -2048)`);
  console.log(`✓ Minified ${svgCount} SVGs with SVGO`);
  console.log(`✓ Original image footprint: ${(totalOrigBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`✓ Optimized WebP footprint: ${(totalNewBytes / (1024 * 1024)).toFixed(2)} MB`);
  if (totalOrigBytes > 0) {
    console.log(`✓ Overall payload reduction: ${((1 - totalNewBytes / totalOrigBytes) * 100).toFixed(1)}%`);
  }
  console.log('-----------------------------------------------------------\n');
}

optimizeImages();
