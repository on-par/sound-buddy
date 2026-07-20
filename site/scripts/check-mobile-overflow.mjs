// Guard against horizontal overflow on mobile (#495): reproduced at 390x844
// where document.documentElement.scrollWidth (527) exceeded clientWidth (390)
// because .footer-nav (8 links, display: flex, no flex-wrap) forced a wide
// min-content row. This is a browser-level check — static HTML greps can't
// measure layout — so it builds a minimal static server over dist/, loads
// each page under Chromium at several mobile viewports, and asserts the
// document never scrolls wider than the viewport.
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
};

const PAGES = ['/', '/browser/', '/record-your-service/'];
const VIEWPORTS = [
  { w: 320, h: 568 },
  { w: 360, h: 740 },
  { w: 390, h: 844 },
];
const EDGE_TOLERANCE_PX = 1;
const MAX_OFFENDERS_REPORTED = 3;
const MIN_VISIBLE_LINK_SIZE_PX = 1;

try {
  await access(join(distRoot, 'index.html'));
} catch {
  console.error(`✖ ${join(distRoot, 'index.html')} does not exist.`);
  console.error('  Run `npm run build` first.');
  process.exit(1);
}

function requestPathToFile(urlPath) {
  const cleanPath = urlPath.split('?')[0];
  const resolved = join(distRoot, decodeURIComponent(cleanPath));
  return resolved.endsWith('/') || extname(resolved) === '' ? join(resolved, 'index.html') : resolved;
}

const server = createServer((req, res) => {
  const filePath = requestPathToFile(req.url ?? '/');
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });
  stream.on('open', () => {
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream' });
    stream.pipe(res);
  });
});

await new Promise((resolve) => server.listen(0, resolve));
const { port } = server.address();
const baseUrl = `http://localhost:${port}`;

const problems = [];
let browser;

try {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    console.error('✖ Failed to load playwright. Run `npm install` in site/ first.');
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  try {
    browser = await chromium.launch();
  } catch (err) {
    console.error('✖ Failed to launch headless Chromium.');
    console.error('  Run `npx playwright install chromium` and try again.');
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  const page = await browser.newPage();

  for (const pagePath of PAGES) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.w, height: viewport.h });
      await page.goto(`${baseUrl}${pagePath}`, { waitUntil: 'load' });

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      if (scrollWidth > clientWidth) {
        const offenders = await page.evaluate(
          ({ clientWidth, edgeTolerance, maxOffenders }) => {
            const found = [];
            for (const el of document.querySelectorAll('*')) {
              const rect = el.getBoundingClientRect();
              if (rect.right > clientWidth + edgeTolerance || rect.left < -edgeTolerance) {
                found.push(
                  `<${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().replace(/\s+/g, '.')}` : ''}> right=${Math.round(rect.right)}px`,
                );
                if (found.length >= maxOffenders) break;
              }
            }
            return found;
          },
          { clientWidth, edgeTolerance: EDGE_TOLERANCE_PX, maxOffenders: MAX_OFFENDERS_REPORTED },
        );

        problems.push(
          `${pagePath} at ${viewport.w}x${viewport.h}: document scrollWidth ${scrollWidth} > clientWidth ${clientWidth}. ` +
            `Offenders: ${offenders.length ? offenders.join(', ') : '(none found past tolerance — check for a container overflow)'}`,
        );
      }

      const guideLinkRect = await page.evaluate(() => {
        const a = document.querySelector('footer a[href="/record-your-service"]');
        return a ? a.getBoundingClientRect().toJSON() : null;
      });
      if (!guideLinkRect || guideLinkRect.width < MIN_VISIBLE_LINK_SIZE_PX || guideLinkRect.height < MIN_VISIBLE_LINK_SIZE_PX) {
        problems.push(
          `${pagePath} at ${viewport.w}x${viewport.h}: footer recording-guide link is missing or hidden ` +
            `(rect=${guideLinkRect ? JSON.stringify(guideLinkRect) : 'null'})`,
        );
      }

      if (pagePath === '/') {
        const clipped = await page.evaluate(
          ({ edgeTolerance }) => {
            const results = [];
            const clientWidth = document.documentElement.clientWidth;
            const targets = [...document.querySelectorAll('h1'), ...document.querySelectorAll('.hero-cta .btn')];
            for (const el of targets) {
              const rect = el.getBoundingClientRect();
              const isClipped =
                rect.left < -edgeTolerance ||
                rect.right > clientWidth + edgeTolerance ||
                el.scrollWidth > el.clientWidth + edgeTolerance;
              if (isClipped) {
                results.push(
                  `<${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().replace(/\s+/g, '.')}` : ''}> ` +
                    `left=${Math.round(rect.left)} right=${Math.round(rect.right)} scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth}`,
                );
              }
            }
            return results;
          },
          { edgeTolerance: EDGE_TOLERANCE_PX },
        );

        if (clipped.length) {
          problems.push(
            `/ at ${viewport.w}x${viewport.h}: hero content clipped or overflowing: ${clipped.join(', ')}`,
          );
        }
      }
    }
  }
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (problems.length) {
  console.error(`✖ ${problems.length} mobile-overflow problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log('✓ No horizontal overflow or hero clipping at 320/360/390px on / and /browser/.');
