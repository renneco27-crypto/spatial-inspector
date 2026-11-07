const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

class CDPRunner {
  constructor(options = {}) {
    this.port = options.port || (9340 + Math.floor(Math.random() * 50));
    this.collectorScript = fs.readFileSync(
      path.join(__dirname, 'spatial-collector.js'),
      'utf8'
    );
  }

  async runInspection(targetUrlOrPath, options = {}) {
    let targetUrl = targetUrlOrPath;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('file:///')) {
      const absPath = path.resolve(targetUrlOrPath).replace(/\\/g, '/');
      targetUrl = `file:///${absPath}`;
    }

    const edge = spawn(EDGE_PATH, [
      '--headless=new',
      `--remote-debugging-port=${this.port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      'about:blank'
    ]);

    let wsUrl = null;
    try {
      // Wait for Edge CDP port to be open
      for (let i = 0; i < 35; i++) {
        await new Promise(r => setTimeout(r, 150));
        try {
          const res = await fetch(`http://127.0.0.1:${this.port}/json`);
          const pages = await res.json();
          const page = pages.find(p => p.type === 'page');
          if (page && page.webSocketDebuggerUrl) {
            wsUrl = page.webSocketDebuggerUrl;
            break;
          }
        } catch (e) {}
      }

      if (!wsUrl) {
        throw new Error(`Failed to connect to Chromium CDP on port ${this.port}`);
      }

      const ws = new WebSocket(wsUrl);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });

      let msgId = 1;
      const send = (method, params = {}) => {
        return new Promise((resolve, reject) => {
          const id = msgId++;
          const handler = (evt) => {
            const msg = JSON.parse(evt.data);
            if (msg.id === id) {
              ws.removeEventListener('message', handler);
              if (msg.error) reject(new Error(msg.error.message));
              else resolve(msg.result);
            }
          };
          ws.addEventListener('message', handler);
          ws.send(JSON.stringify({ id, method, params }));
        });
      };

      const waitForEvent = (eventName, timeoutMs = 8000) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            ws.removeEventListener('message', handler);
            resolve(null); // Resolve softly on timeout
          }, timeoutMs);

          const handler = (evt) => {
            const msg = JSON.parse(evt.data);
            if (msg.method === eventName) {
              clearTimeout(timer);
              ws.removeEventListener('message', handler);
              resolve(msg.params);
            }
          };
          ws.addEventListener('message', handler);
        });
      };

      await send('Page.enable');
      await send('DOM.enable');

      // Navigate to target URL
      const loadPromise = waitForEvent('Page.loadEventFired');
      await send('Page.navigate', { url: targetUrl });
      await loadPromise;

      // Allow micro-animations and layouts to settle
      await new Promise(r => setTimeout(r, 400));

      // Execute Spatial Collector
      const evalRes = await send('Runtime.evaluate', {
        expression: this.collectorScript,
        returnByValue: true
      });

      let screenshot = null;
      if (options.captureScreenshot) {
        const snap = await send('Page.captureScreenshot', { format: 'png' });
        screenshot = snap.data;
      }

      ws.close();
      return {
        success: true,
        url: targetUrl,
        spatialData: evalRes.result ? evalRes.result.value : null,
        screenshot
      };
    } finally {
      try {
        edge.kill();
      } catch (e) {}
    }
  }
}

module.exports = { CDPRunner };
