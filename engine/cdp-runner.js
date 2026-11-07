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

      // Execute Spatial Collector on Initial Baseline State
      const evalRes = await send('Runtime.evaluate', {
        expression: this.collectorScript,
        returnByValue: true
      });
      const initialData = evalRes.result ? evalRes.result.value : null;

      const allAnomalies = initialData ? [...initialData.anomalies] : [];
      const statesExplored = [{
        name: 'Initial Page Load',
        totalElements: initialData ? initialData.totalElements : 0,
        anomaliesCount: initialData ? initialData.anomaliesCount : 0
      }];

      // Interactive Button State Exploration (clicks buttons and checks for revealed divs & color mismatches)
      if (options.exploreStates !== false && initialData) {
        try {
          const discoverScript = `
            (() => {
              const els = Array.from(document.querySelectorAll('button:not(:disabled), [role="button"], .opt, .chip, #theme, #sol, #nq'));
              return els.slice(0, 12).map((el, idx) => {
                let sel = el.id ? ('#' + el.id) : (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).filter(c => c && !c.includes(':'))[0] : el.tagName.toLowerCase());
                return {
                  idx,
                  selector: sel,
                  id: el.id || null,
                  text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30)
                };
              });
            })()
          `;
          const discRes = await send('Runtime.evaluate', { expression: discoverScript, returnByValue: true });
          const candidates = discRes.result ? discRes.result.value : [];

          for (const cand of candidates) {
            // Fresh navigation for clean state
            await send('Page.navigate', { url: targetUrl });
            await waitForEvent('Page.loadEventFired', 3000);
            await new Promise(r => setTimeout(r, 250));

            const clickExpr = `
              (() => {
                const els = Array.from(document.querySelectorAll('button:not(:disabled), [role="button"], .opt, .chip, #theme, #sol, #nq'));
                const targetEl = els[${cand.idx}];
                if (targetEl) {
                  targetEl.click();
                  return { success: true };
                }
                return { success: false };
              })()
            `;
            await send('Runtime.evaluate', { expression: clickExpr, returnByValue: true });
            await new Promise(r => setTimeout(r, 350));

            const stateEval = await send('Runtime.evaluate', { expression: this.collectorScript, returnByValue: true });
            const stateData = stateEval.result ? stateEval.result.value : null;

            if (stateData) {
              const stateName = `Click on ${cand.selector}${cand.text ? ' ("' + cand.text + '")' : ''}`;
              statesExplored.push({
                name: stateName,
                totalElements: stateData.totalElements,
                anomaliesCount: stateData.anomaliesCount
              });

              stateData.anomalies.forEach(a => {
                const isDup = allAnomalies.some(existing =>
                  existing.type === a.type &&
                  (existing.target === a.target || (existing.elementA === a.elementA && existing.elementB === a.elementB))
                );
                if (!isDup) {
                  allAnomalies.push({
                    stateContext: stateName,
                    ...a,
                    detail: `[State: ${stateName}] ${a.detail}`
                  });
                }
              });

              // Check if any secondary modal/sheet action became enabled (e.g. #sol "Show solution")
              const secondaryExpr = `
                (() => {
                  const secondaryBtn = document.querySelector('#sol, [aria-haspopup="dialog"], .sheet-toggle');
                  if (secondaryBtn && !secondaryBtn.disabled) {
                    secondaryBtn.click();
                    return { clicked: true, text: (secondaryBtn.innerText || secondaryBtn.textContent || '').trim().slice(0, 20) };
                  }
                  return { clicked: false };
                })()
              `;
              const secRes = await send('Runtime.evaluate', { expression: secondaryExpr, returnByValue: true });
              if (secRes.result && secRes.result.value && secRes.result.value.clicked) {
                await new Promise(r => setTimeout(r, 400));
                const secEval = await send('Runtime.evaluate', { expression: this.collectorScript, returnByValue: true });
                const secData = secEval.result ? secEval.result.value : null;
                if (secData) {
                  const secStateName = `${stateName} -> Click "${secRes.result.value.text}" (Revealed Sheet/Modal)`;
                  statesExplored.push({
                    name: secStateName,
                    totalElements: secData.totalElements,
                    anomaliesCount: secData.anomaliesCount
                  });
                  secData.anomalies.forEach(a => {
                    const isDup = allAnomalies.some(existing =>
                      existing.type === a.type &&
                      (existing.target === a.target || (existing.elementA === a.elementA && existing.elementB === a.elementB))
                    );
                    if (!isDup) {
                      allAnomalies.push({
                        stateContext: secStateName,
                        ...a,
                        detail: `[State: ${secStateName}] ${a.detail}`
                      });
                    }
                  });
                }
              }
            }
          }
        } catch (e) {
          // Soft fail for state exploration
        }
      }

      if (initialData) {
        initialData.anomalies = allAnomalies;
        initialData.anomaliesCount = allAnomalies.length;
        initialData.statesExplored = statesExplored;
      }

      let screenshot = null;
      if (options.captureScreenshot) {
        const snap = await send('Page.captureScreenshot', { format: 'png' });
        screenshot = snap.data;
      }

      ws.close();
      return {
        success: true,
        url: targetUrl,
        spatialData: initialData,
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
