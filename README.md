# Spatial Layout & 3D Stacking Inspector

> **Automated geometry, z-index stacking context, and 70%+ color camouflage audit engine for web applications.**  
> Built for Google Antigravity, Playwright/Chromium CDP workflows, and frontend developers.

---

## Overview

Static linters and DOM inspectors only verify that elements exist in HTML/CSS. They cannot tell if:
- A button is **physically blocked** from clicks by an invisible backdrop or higher z-index overlay.
- Text has become **completely unreadable** because its color matches or is near-identical ($\ge 70\%$ match) to its background.
- Two distinct cards or dialog divs **overlap with identical background colors**, causing visual fusion and lost UI hierarchy.
- Text strings **physically collide** and overlap in the rendered viewport.
- An element with `z-index: 9999` is trapped underneath a sibling due to parent stacking context isolation (`opacity < 1`, `transform`, `filter`).

**Spatial Inspector** launches headless Chromium (Microsoft Edge CDP), measures the live rendered viewport geometry, executes dynamic scroll-aware hit-testing, runs perceptual color similarity & WCAG contrast math, and generates a standalone interactive **3D Three.js WebGL visualizer** (`3d-inspector.html`).

---

## Key Features

### 1. Color Camouflage & Contrast Detection (`>= 70%` Match)
- **Text-on-Background Readability Check**:
  Calculates true effective background color by compositing alpha channels across parent hierarchies and physical layers beneath the text (`elementsFromPoint`).
  Flags text with $\ge 70\%$ perceptual similarity or WCAG contrast $< 3.0:1$ (upgrades to **P0 Blocker** if $\ge 85\%$ match or contrast $< 1.8:1$).
- **Same-Color Container Overlaps**:
  Detects when two distinct containers (`div`, `section`, `article`, etc.) overlap by $\ge 25\%$ viewport area and share $\ge 70\%$ identical background colors without distinguishing borders or drop-shadows.

### 2. Physical Hit-Testing Occlusion (P0 Blocker)
- Computes center coordinates of interactive elements (`button`, `a`, `input`, `select`, `[role=button]`).
- Performs dynamic scroll-aware hit-testing to verify whether scrolling exposes the element or if it is permanently obstructed.

### 3. AABB Sibling Text Collisions (P1 Defect)
- Calculates Axis-Aligned Bounding Box (AABB) intersection between visible leaf text nodes.
- Flags text colliding by more than 35% bounding area.

### 4. Interactive 3D WebGL Stacking Visualizer
- Generates `3d-inspector.html` using Three.js and OrbitControls.
- Features:
  - **Z-Extrusion Slider**: Explode DOM layers along the Z-axis to inspect nested stacking contexts in 3D.
  - **Color / Contrast Filter**: Instantly isolate camouflaged text and same-color overlapping divs.
  - **Interactive HUD**: Hover any 3D layer to inspect selector, computed z-index, dimensions, text, foreground/background color swatches, similarity %, and WCAG contrast.

---

## Installation & Setup

### Antigravity Plugin Configuration
In your Antigravity plugin or MCP config (`mcp_config.json`):
```json
{
  "mcpServers": {
    "spatial-inspector": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}
```

### Direct CLI Usage
Run directly from terminal or PowerShell against any URL or local HTML file:
```powershell
node bin/inspect.js "path/to/index.html"
# Or against a running dev server:
node bin/inspect.js "http://localhost:3000"
```

---

## MCP Tools Reference

### `inspect_layout_anomalies`
Runs complete geometry, occlusion, text collision, and color contrast audit on target URL or file.
```json
{
  "ServerName": "spatial-inspector",
  "ToolName": "inspect_layout_anomalies",
  "Arguments": {
    "target": "http://localhost:3000",
    "generate3D": true
  }
}
```

### `get_element_stacking_info`
Queries exact spatial coordinates, stacking context depth, and computed z-index for a specific selector.

### `export_3d_stacking_view`
Generates standalone interactive `3d-inspector.html` Three.js viewer.

---

## Anomaly Severity Classification

| Severity | Type | Description | Remediation |
| :--- | :--- | :--- | :--- |
| **P0** | `OCCLUDED_INTERACTIVE` | Click target permanently blocked by overlay | Set `pointer-events: none` on decorative overlay or adjust z-index |
| **P0** | `UNREADABLE_TEXT_CONTRAST` | Text color $\ge 85\%$ match or contrast $< 1.8:1$ | Increase text/background color contrast to meet WCAG AA standards |
| **P1** | `UNREADABLE_TEXT_CONTRAST` | Text color $\ge 70\%$ match or contrast $< 3.0:1$ | Adjust text color or container background |
| **P1** | `SAME_COLOR_CONTAINER_OVERLAP`| Overlapping divs share $\ge 70\%$ color without border/shadow | Add contrasting 1px border or subtle `box-shadow` to separate boundaries |
| **P1** | `TEXT_COLLISION` | Text bounding boxes colliding in viewport | Fix negative margins or switch to Flexbox/Grid flow with `gap` |
| **P1** | `TEXT_TRUNCATED` | Text clipped by `overflow: hidden` | Adjust container client constraints |

---

## License

MIT © [renneco27-crypto](https://github.com/renneco27-crypto)
