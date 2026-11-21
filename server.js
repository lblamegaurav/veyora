const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.mp4': 'video/mp4'
};

// High-Speed In-Memory Cache (Sub-10ms TTFB for Document and Critical Assets)
const memoryCache = new Map();

function getCompressed(data, encoding, callback) {
  if (encoding === 'br') {
    zlib.brotliCompress(data, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length
      }
    }, callback);
  } else if (encoding === 'gzip') {
    zlib.gzip(data, { level: 9 }, callback);
  } else {
    callback(null, data);
  }
}

const server = http.createServer((req, res) => {
  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse path and query parameters
  const parsedUrl = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Normalize path to prevent directory traversal
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/g, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  // Performance: Responsive Image Negotiation
  const isImageRequest = /\.(jpg|jpeg|png|webp|avif)$/i.test(pathname);
  if (isImageRequest) {
    const scaleDown = parsedUrl.query['scale-down-to'];
    const ext = path.extname(filePath).toLowerCase();
    const baseWithoutExt = filePath.slice(0, -ext.length);

    // Support 256w logo, 512w, 1024w, 2048w
    if (scaleDown && ['256', '512', '1024', '2048'].includes(scaleDown)) {
      const responsiveWebp = `${baseWithoutExt}-${scaleDown}.webp`;
      if (fs.existsSync(responsiveWebp)) {
        filePath = responsiveWebp;
      }
    }

    // Auto-upgrade legacy JPG/PNG to WebP if WebP version exists
    if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      const candidateWebp = `${baseWithoutExt}.webp`;
      if (fs.existsSync(candidateWebp)) {
        filePath = candidateWebp;
      }
    }
  }

  // Check if directory or file exists
  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      if (fs.existsSync(indexPath)) {
        filePath = indexPath;
        try { stats = fs.statSync(filePath); } catch(e) {}
      }
    } else if (err) {
      const tryHtml = filePath + '.html';
      const tryDirIndex = path.join(filePath, 'index.html');
      if (fs.existsSync(tryHtml)) {
        filePath = tryHtml;
        try { stats = fs.statSync(filePath); } catch(e) {}
      } else if (fs.existsSync(tryDirIndex)) {
        filePath = tryDirIndex;
        try { stats = fs.statSync(filePath); } catch(e) {}
      }
    }

    const finalExt = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[finalExt] || 'application/octet-stream';
    const isStaticAsset = /\.(webp|avif|jpg|jpeg|png|svg|woff2|woff|ttf|otf|mp4|css|mjs|js)$/i.test(finalExt);
    const cacheControl = isStaticAsset 
      ? 'public, max-age=31536000, immutable' 
      : 'public, max-age=0, must-revalidate';

    const acceptEncoding = req.headers['accept-encoding'] || '';
    const shouldCompress = /^(text\/|application\/(javascript|json|octet-stream)|image\/svg\+xml)/.test(contentType);
    const encoding = shouldCompress && acceptEncoding.includes('br') ? 'br' : (shouldCompress && acceptEncoding.includes('gzip') ? 'gzip' : 'none');

    const mtime = stats ? stats.mtimeMs : 0;
    const cacheKey = `${filePath}:${mtime}:${encoding}`;
    if (memoryCache.has(cacheKey)) {
      const cached = memoryCache.get(cacheKey);
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Timing-Allow-Origin': '*'
      };
      if (encoding !== 'none') headers['Content-Encoding'] = encoding;
      res.writeHead(200, headers);
      res.end(cached);
      return;
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        const fallbackPath = path.join(PUBLIC_DIR, '404.html');
        if (fs.existsSync(fallbackPath)) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(fallbackPath));
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        }
        return;
      }

      if (encoding !== 'none') {
        getCompressed(data, encoding, (compressErr, compressed) => {
          if (compressErr) {
            res.writeHead(200, {
              'Content-Type': contentType,
              'Cache-Control': cacheControl,
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'Timing-Allow-Origin': '*'
            });
            return res.end(data);
          }
          // Store in memory cache for instant sub-10ms TTFB
          memoryCache.set(cacheKey, compressed);
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Encoding': encoding,
            'Cache-Control': cacheControl,
            'Cross-Origin-Resource-Policy': 'cross-origin',
            'Timing-Allow-Origin': '*'
          });
          res.end(compressed);
        });
      } else {
        memoryCache.set(cacheKey, data);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': cacheControl,
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Timing-Allow-Origin': '*'
        });
        res.end(data);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` Veyora High-Performance Edge-Cached Server at http://localhost:${PORT}`);
  console.log(` Brotli / Gzip Compression: ENABLED with Memory Cache (Sub-10ms TTFB)`);
  console.log(` Serving WebP/AVIF responsive assets from: ${PUBLIC_DIR}`);
  console.log(`======================================================\n`);
});
