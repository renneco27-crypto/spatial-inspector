---
name: spatial-layout-inspector
description: >-
  Inspect rendered web UI for spatial defects: occluded or non-clickable buttons,
  text collisions/overlaps, text clipping/truncations, z-index traps, and generate
  interactive 3D WebGL stacking context views and collision heatmaps. Use whenever
  a user or UI audit mentions overlapping elements, unclickable buttons, layering bugs,
  or asks for 3D element maps / visual debugging.
---

# Spatial Layout & 3D Stacking Inspector

The **Spatial Layout Inspector** is an automated geometry and stacking-context audit engine for Google Antigravity. It uses headless Chromium (via Microsoft Edge CDP) to inspect the *actually rendered* viewport, discovering defects that pure static code analysis cannot detect.

---

## Capabilities & Detection Types

1. **Click Target Occlusion (P0 - Blocker)**:
   - Detects interactive elements (`button`, `a`, `input`, `select`, `[role=button]`) whose center coordinate is intercepted by another DOM element (`document.elementsFromPoint`).
   - Identifies the exact blocking element, its selector, and its computed `z-index` / `pointer-events`.

2. **Unreadable / Camouflaged Text (P0 / P1)**:
   - Measures perceptual color similarity between text foreground and its effective rendered background.
   - Flags text with $\ge 70\%$ color match or WCAG contrast ratio $< 3.0:1$ (upgraded to P0 blocker if $\ge 85\%$ match or contrast $< 1.8:1$).

3. **Same-Color Container Overlap (P1 - High)**:
   - Evaluates overlapping non-ancestor containers (`div`, `section`, `article`, `card`, etc.).
   - Detects when two containers overlap by $\ge 25\%$ area, share $\ge 70\%$ identical background colors, and lack a distinguishing border or drop-shadow, resulting in visual boundary collapse.

4. **Unintended Text Collisions (P1 - High)**:
   - Evaluates axis-aligned bounding box (AABB) intersections between independent text nodes.
   - Flags text overlapping other text by more than 25% of its bounding area.

5. **Text Truncation & Clipping (P1 - High)**:
   - Detects elements where `scrollWidth > clientWidth + 2` or `scrollHeight > clientHeight + 2` with `overflow: hidden` or `clip`.

6. **3D Stacking Context Isolation**:
   - Traces the true nesting hierarchy of stacking contexts created by `opacity < 1`, `transform`, `filter`, `isolation: isolate`, `fixed`/`sticky` positioning, and `clip-path`.
   - Explains why an element with `z-index: 9999` is still trapped underneath an unrelated sibling.

7. **Interactive 3D WebGL Explorer**:
   - Generates a standalone Three.js HTML explorer (`3d-inspector.html`) that allows users and agents to rotate the UI in 3D, pull layers apart along the Z-axis with an extrusion slider, filter by color camouflage, and inspect layer metadata and color swatches on hover.

---

## How to Call the Tools

The inspector is registered as the **`spatial-inspector`** MCP server.

### 1. Run Complete Anomaly Audit & Generate 3D Explorer
```json
{
  "ServerName": "spatial-inspector",
  "ToolName": "inspect_layout_anomalies",
  "Arguments": {
    "target": "c:/path/to/index.html",
    "generate3D": true
  }
}
```
*For a local development server, pass the URL:*
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

### 2. Inspect a Specific Stacking Context or Selector
```json
{
  "ServerName": "spatial-inspector",
  "ToolName": "get_element_stacking_info",
  "Arguments": {
    "target": "c:/path/to/index.html",
    "selector": "#submit-order"
  }
}
```

### 3. Export Standalone 3D Viewer HTML
```json
{
  "ServerName": "spatial-inspector",
  "ToolName": "export_3d_stacking_view",
  "Arguments": {
    "target": "c:/path/to/index.html",
    "destinationPath": "c:/path/to/output_3d.html"
  }
}
```

---

## Fixing Common Spatial Defects

### Defect 1: Transparent Backdrop / Overlay Intercepting Clicks
- **Symptom**: P0 `OCCLUDED_INTERACTIVE` - `Button #btn intercepted by .hero-backdrop`.
- **Solution**:
  If the backdrop is decorative:
  ```css
  .hero-backdrop {
    pointer-events: none;
  }
  ```

### Defect 2: Z-Index Trap in Parent Stacking Context
- **Symptom**: `#modal` has `z-index: 9999`, but is rendered underneath `.header` (`z-index: 10`).
- **Cause**: `#modal`'s parent has `transform`, `opacity: 0.99`, or a local `z-index: 1`, creating a localized stacking context.
- **Solution**:
  - Lift the modal container to `body` or a top-level React Portal.
  - Or add `isolation: isolate` to the common layout container and assign z-index tokens at the top stacking level.

### Defect 3: Text Collision in Responsive Layout
- **Symptom**: P1 `TEXT_COLLISION` between `.title` and `.subtitle`.
- **Cause**: Negative margin, `position: absolute`, or fixed heights with `overflow: visible`.
- **Solution**:
  Replace absolute positioning with standard Flexbox/Grid flow with explicit `gap`:
  ```css
  .header-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  ```
