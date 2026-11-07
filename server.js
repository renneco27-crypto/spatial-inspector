#!/usr/bin/env node
/**
 * Spatial Layout & 3D Stacking Inspector - Antigravity MCP Server
 * Standard Model Context Protocol (JSON-RPC 2.0 over stdio)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { CDPRunner } = require('./engine/cdp-runner');

const runner = new CDPRunner();
const VIEWER_TEMPLATE = fs.readFileSync(path.join(__dirname, 'viewer', 'template-3d.html'), 'utf8');

const TOOLS = [
  {
    name: 'inspect_layout_anomalies',
    description: 'Inspects a web page or local HTML file for layout & readability defects: occluded buttons/click targets, text collisions/overlaps, text clipping/truncations, z-index stacking traps, and low-contrast / color-camouflage defects (70%+ matching text-on-background or overlapping same-color divs).',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'URL (e.g. http://localhost:3000) or absolute/relative path to a local HTML file.'
        },
        generate3D: {
          type: 'boolean',
          description: 'Whether to compile an interactive Three.js 3D visualizer HTML file (default: true).'
        },
        outputDir: {
          type: 'string',
          description: 'Directory where spatial reports and 3d-inspector.html should be saved (defaults to system temporary or target directory).'
        }
      },
      required: ['target']
    }
  },
  {
    name: 'get_element_stacking_info',
    description: 'Queries exact spatial coordinates, stacking context depth, computed z-index, and hit-test occlusion for a specific CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'URL or local HTML file path.'
        },
        selector: {
          type: 'string',
          description: 'CSS selector of the element to inspect (e.g., "#checkout-btn", ".dropdown-menu").'
        }
      },
      required: ['target', 'selector']
    }
  },
  {
    name: 'export_3d_stacking_view',
    description: 'Generates a standalone, interactive 3D WebGL (Three.js) HTML explorer showing all DOM layers extruded in 3D space with collision highlights.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'URL or local HTML file path.'
        },
        destinationPath: {
          type: 'string',
          description: 'Target file path for the generated HTML visualizer (e.g., "./3d-inspector.html").'
        }
      },
      required: ['target']
    }
  }
];

async function handleToolCall(name, args) {
  if (name === 'inspect_layout_anomalies') {
    const target = args.target;
    const generate3D = args.generate3D !== false;
    const outputDir = args.outputDir || (target.startsWith('http') ? process.cwd() : path.dirname(path.resolve(target)));

    const result = await runner.runInspection(target);
    const data = result.spatialData;

    if (!data) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to inspect spatial layout: no data returned from page.` }]
      };
    }

    const reportPath = path.join(outputDir, 'spatial_anomalies.json');
    fs.writeFileSync(reportPath, JSON.stringify(data, null, 2), 'utf8');

    let viewerPath = null;
    if (generate3D) {
      viewerPath = path.join(outputDir, '3d-inspector.html');
      const populatedHtml = VIEWER_TEMPLATE.replace(
        'window.__SPATIAL_DATA__ ||',
        JSON.stringify(data) + ' ||'
      );
      fs.writeFileSync(viewerPath, populatedHtml, 'utf8');
    }

    let summaryText = `### Spatial Layout Inspection Report\n\n`;
    summaryText += `**Target:** \`${target}\`\n`;
    summaryText += `**Total Elements Scanned:** ${data.totalElements}\n`;
    summaryText += `**Anomalies Found:** ${data.anomaliesCount}\n\n`;

    if (data.anomaliesCount === 0) {
      summaryText += `✅ **Zero layout collisions or readability defects detected.** All interactive targets receive direct clicks, no text blocks overlap or camouflage into the background, containers maintain distinct boundaries, and no content is clipped.\n`;
    } else {
      summaryText += `| Severity | Type | Target / Location | Details |\n`;
      summaryText += `| :--- | :--- | :--- | :--- |\n`;
      data.anomalies.forEach(a => {
        const targetStr = a.target || `${a.elementA} ↔ ${a.elementB}`;
        summaryText += `| **${a.severity}** | \`${a.type}\` | \`${targetStr}\` | ${a.detail} |\n`;
      });
      summaryText += `\n> [!CAUTION]\n> Found **${data.anomalies.filter(a => a.severity === 'P0').length} P0 blocking issues**. Elements with higher z-index or overflowing sibling boundaries are obstructing user interactions.\n`;
    }

    if (viewerPath) {
      const viewerUrl = `file:///${viewerPath.replace(/\\/g, '/')}`;
      summaryText += `\n**Interactive 3D Visualizer Generated:**\n- Open in browser: [3D Inspector Visualizer](${viewerUrl})\n- File location: \`${viewerPath}\`\n`;
    }
    summaryText += `\n**Detailed JSON Report:** \`${reportPath}\`\n`;

    return {
      content: [{ type: 'text', text: summaryText }]
    };
  }

  if (name === 'get_element_stacking_info') {
    const { target, selector } = args;
    const result = await runner.runInspection(target);
    const data = result.spatialData;

    if (!data) {
      return { isError: true, content: [{ type: 'text', text: 'Inspection failed.' }] };
    }

    const matched = data.elements.filter(e => {
      if (selector.startsWith('#')) return e.id === selector.slice(1);
      if (selector.startsWith('.')) return e.selector.includes(selector);
      return e.tag === selector.toLowerCase() || e.selector === selector;
    });

    if (matched.length === 0) {
      return {
        content: [{ type: 'text', text: `Element matching \`${selector}\` not found in rendered DOM tree.` }]
      };
    }

    let out = `### Stacking Info for \`${selector}\` (${matched.length} match${matched.length > 1 ? 'es' : ''})\n\n`;
    matched.forEach((m, idx) => {
      out += `#### Match #${idx + 1}: \`${m.selector}\`\n`;
      out += `- **DOM Path:** \`${m.path}\`\n`;
      out += `- **Bounding Box:** x=${m.rect.x}, y=${m.rect.y}, w=${m.rect.w}, h=${m.rect.h}\n`;
      out += `- **Computed Position:** \`${m.computed.position}\`\n`;
      out += `- **Computed z-index:** \`${m.computed.zIndex}\`\n`;
      out += `- **Stacking Context Depth:** Level ${m.stackingDepth}\n`;
      out += `- **Calculated 3D Depth:** ${m.calculatedZ}\n`;
      out += `- **Interactive:** ${m.interactive ? 'Yes' : 'No'}\n`;
      out += `- **Click Blocked / Occluded:** ${m.isBlocked ? '🚨 YES' : '✅ No'}\n`;
      if (m.isBlocked && m.blocker) {
        out += `  - **Blocked By:** \`${m.blocker.selector}\` (z-index: \`${m.blocker.zIndex}\`, pointer-events: \`${m.blocker.pointerEvents}\`)\n`;
      }
      if (m.issues.length > 0) {
        out += `- **Issues:**\n`;
        m.issues.forEach(i => out += `  - [${i.severity}] ${i.type}: ${i.detail}\n`);
      }
      out += `\n`;
    });

    return { content: [{ type: 'text', text: out }] };
  }

  if (name === 'export_3d_stacking_view') {
    const { target, destinationPath } = args;
    const dest = destinationPath || path.resolve(process.cwd(), '3d-inspector.html');
    const result = await runner.runInspection(target);
    const data = result.spatialData;

    if (!data) {
      return { isError: true, content: [{ type: 'text', text: 'Failed to inspect page.' }] };
    }

    const populatedHtml = VIEWER_TEMPLATE.replace(
      'window.__SPATIAL_DATA__ ||',
      JSON.stringify(data) + ' ||'
    );
    fs.writeFileSync(dest, populatedHtml, 'utf8');

    const fileUrl = `file:///${dest.replace(/\\/g, '/')}`;
    return {
      content: [{
        type: 'text',
        text: `### 3D Stacking View Exported\n\n- File Path: \`${dest}\`\n- Clickable Link: [Open 3D Inspector](${fileUrl})\n- Total Elements Rendered: ${data.totalElements}\n- Detected Anomalies: ${data.anomaliesCount}`
      }]
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

// JSON-RPC Protocol Handler over stdio
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;

  try {
    const request = JSON.parse(line);
    const { id, method, params } = request;

    if (method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'spatial-inspector',
            version: '1.0.0'
          }
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    if (method === 'notifications/initialized') {
      // No response required for notifications
      return;
    }

    if (method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params;
      try {
        const toolResult = await handleToolCall(name, toolArgs || {});
        const response = {
          jsonrpc: '2.0',
          id,
          result: toolResult
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      } catch (err) {
        const response = {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: `Tool error: ${err.message}` }]
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
      return;
    }

    // Default response for unhandled methods
    if (id !== undefined) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      }) + '\n');
    }
  } catch (err) {
    console.error('[MCP Error]', err);
  }
});

console.error('[Spatial Inspector MCP] Server initialized on stdio.');
