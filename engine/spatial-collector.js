/**
 * In-browser spatial layout, collision & color contrast collector
 * With Scroll-Aware Dynamic Hit-Testing, Parent-Child SVG Normalization,
 * Fixed/Scrollable Collision Filtering, and 70%+ Color Camouflage Detection
 */
(() => {
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

  // --- Color & Contrast Utilities ---
  function parseRgba(str) {
    if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m) {
      return {
        r: parseInt(m[1], 10),
        g: parseInt(m[2], 10),
        b: parseInt(m[3], 10),
        a: m[4] !== undefined ? parseFloat(m[4]) : 1.0
      };
    }
    return null;
  }

  function alphaComposite(fg, bg) {
    if (!fg || fg.a === 0) return bg || { r: 255, g: 255, b: 255, a: 1 };
    if (!bg || bg.a === 0) return fg;
    const outA = fg.a + bg.a * (1 - fg.a);
    if (outA === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: Math.round((fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / outA),
      g: Math.round((fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / outA),
      b: Math.round((fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / outA),
      a: Math.min(1, outA)
    };
  }

  function getEffectiveBackgroundColor(el, rect) {
    const layers = [];
    let cur = el;
    while (cur && cur !== document && cur !== document.documentElement) {
      const bg = window.getComputedStyle(cur).backgroundColor;
      const parsed = parseRgba(bg);
      if (parsed && parsed.a > 0) {
        layers.push(parsed);
        if (parsed.a >= 0.99) break;
      }
      cur = cur.parentElement;
    }

    // Physical sampling if ancestors are semi-transparent
    let currentAlpha = layers.reduce((acc, l) => acc + l.a * (1 - acc), 0);
    if (currentAlpha < 0.95 && rect) {
      const cx = Math.max(0, Math.min(vw - 1, rect.left + rect.width / 2));
      const cy = Math.max(0, Math.min(vh - 1, rect.top + rect.height / 2));
      try {
        const hits = document.elementsFromPoint(cx, cy);
        let foundSelf = false;
        for (const hit of hits) {
          if (hit === el || el.contains(hit)) {
            foundSelf = true;
            continue;
          }
          if (foundSelf) {
            const bg = window.getComputedStyle(hit).backgroundColor;
            const parsed = parseRgba(bg);
            if (parsed && parsed.a > 0) {
              layers.push(parsed);
              if (parsed.a >= 0.99) break;
            }
          }
        }
      } catch (e) {}
    }

    // Fallback to body / html background, default white for light theme, dark slate for dark theme
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const parsedBody = parseRgba(bodyBg);
    const isExplicitLight = document.documentElement.dataset.theme === 'light' ||
                            document.body.classList.contains('light-contrast') ||
                            document.documentElement.classList.contains('light');
    const defaultCanvas = isExplicitLight ? { r: 255, g: 255, b: 255, a: 1 } : { r: 15, g: 17, b: 21, a: 1 };
    let finalColor = (parsedBody && parsedBody.a > 0.05) ? parsedBody : defaultCanvas;

    for (let i = layers.length - 1; i >= 0; i--) {
      finalColor = alphaComposite(layers[i], finalColor);
    }
    return finalColor;
  }

  function getColorSimilarity(c1, c2) {
    if (!c1 || !c2) return 0;
    const deltaR = c1.r - c2.r;
    const deltaG = c1.g - c2.g;
    const deltaB = c1.b - c2.b;
    // Perceptually weighted Euclidean distance (Rec. 601)
    const dist = Math.sqrt(0.299 * deltaR * deltaR + 0.587 * deltaG * deltaG + 0.114 * deltaB * deltaB);
    return Math.max(0, Math.min(100, Math.round((1 - (dist / 255)) * 100)));
  }

  function getLuminance(c) {
    const [r, g, b] = [c.r, c.g, c.b].map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function getContrastRatio(c1, c2) {
    const l1 = getLuminance(c1);
    const l2 = getLuminance(c2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
  }

  function hasDistinguishingBoundary(comp) {
    // Check border
    const bw = parseFloat(comp.borderWidth) || 0;
    if (bw >= 1 && comp.borderStyle !== 'none' && comp.borderStyle !== 'hidden') {
      const bColor = parseRgba(comp.borderColor);
      if (bColor && bColor.a > 0.2) return true;
    }
    // Check shadow
    const bs = comp.boxShadow;
    if (bs && bs !== 'none' && !bs.includes('none') && bs.length > 5) {
      return true;
    }
    // Check outline
    const ow = parseFloat(comp.outlineWidth) || 0;
    if (ow >= 1 && comp.outlineStyle !== 'none') {
      return true;
    }
    return false;
  }

  function getSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return 'unknown';
    if (el.id) return `#${el.id}`;
    let sel = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).filter(c => c && !c.includes(':')).slice(0, 2);
      if (classes.length) sel += '.' + classes.join('.');
    }
    return sel;
  }

  function getPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE && cur !== document.body && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        part += `#${cur.id}`;
        parts.unshift(part);
        break;
      }
      if (cur.className && typeof cur.className === 'string') {
        const cls = cur.className.trim().split(/\s+/).filter(Boolean)[0];
        if (cls) part += `.${cls}`;
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  function createsStackingContext(el, comp) {
    if (el === document.documentElement) return true;
    if (comp.position !== 'static' && comp.zIndex !== 'auto') return true;
    if (comp.position === 'fixed' || comp.position === 'sticky') return true;
    if (parseFloat(comp.opacity) < 1) return true;
    if (comp.transform !== 'none' || comp.perspective !== 'none') return true;
    if (comp.filter !== 'none') return true;
    if (comp.clipPath !== 'none') return true;
    if (comp.mask !== 'none' && comp.mask !== '') return true;
    if (comp.isolation === 'isolate') return true;
    if (comp.mixBlendMode !== 'normal') return true;
    if (['paint', 'layout', 'strict', 'content'].includes(comp.contain)) return true;
    return false;
  }

  function getStackingDepth(el) {
    let depth = 0;
    let cur = el.parentElement;
    while (cur && cur !== document.body) {
      const comp = window.getComputedStyle(cur);
      if (createsStackingContext(cur, comp)) {
        depth++;
      }
      cur = cur.parentElement;
    }
    return depth;
  }

  function isInteractive(el, comp) {
    const tag = el.tagName.toUpperCase();
    if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return true;
    const role = el.getAttribute('role');
    if (['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem'].includes(role)) return true;
    if (el.onclick || el.getAttribute('onclick')) return true;
    if (comp.cursor === 'pointer') return true;
    return false;
  }

  function findScrollableContainer(el) {
    let cur = el.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const comp = window.getComputedStyle(cur);
      const oy = comp.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight + 4) {
        return cur;
      }
      cur = cur.parentElement;
    }
    if (document.documentElement.scrollHeight > window.innerHeight + 4) {
      return document.documentElement;
    }
    return null;
  }

  function isFixedOrSticky(el) {
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const comp = window.getComputedStyle(cur);
      if (comp.position === 'fixed' || comp.position === 'sticky' || cur.tagName === 'NAV' || cur.classList.contains('bnav') || cur.classList.contains('top')) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function isElementActiveAndVisible(el, rect, comp) {
    if (comp.display === 'none' || comp.visibility === 'hidden' || parseFloat(comp.opacity) === 0) return false;
    if (rect.width <= 1 || rect.height <= 1) return false;

    // Skip root phone/body container clipping warnings
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const c = window.getComputedStyle(cur);
      if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false;

      // Inactive panel
      if (cur.classList.contains('panel') && !cur.classList.contains('active')) return false;

      // Closed bottom sheet/drawer
      if (cur.classList.contains('sheet') && !cur.classList.contains('open')) return false;
      if (cur.classList.contains('review') && !cur.classList.contains('open')) return false;
      if (cur.classList.contains('side') && !document.body.classList.contains('side-open') && !document.documentElement.classList.contains('side-open')) return false;

      if (cur.getAttribute('aria-hidden') === 'true') return false;

      // Ancestor overflow clipping
      if (c.overflow === 'hidden' || c.overflowX === 'hidden' || c.overflowY === 'hidden') {
        const parentRect = cur.getBoundingClientRect();
        if (rect.bottom <= parentRect.top || rect.top >= parentRect.bottom ||
            rect.right <= parentRect.left || rect.left >= parentRect.right) {
          return false;
        }
      }

      cur = cur.parentElement;
    }

    return true;
  }

  const allElements = Array.from(document.querySelectorAll('*'));
  const elementsData = [];
  const anomalies = [];
  const textElements = [];
  const containerElements = [];

  for (const el of allElements) {
    if (['SCRIPT', 'STYLE', 'META', 'HEAD', 'NOSCRIPT', 'SVG', 'PATH', 'DEFS'].includes(el.tagName)) continue;

    const comp = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!isElementActiveAndVisible(el, rect, comp)) continue;

    const stackingDepth = getStackingDepth(el);
    const parsedZ = comp.zIndex === 'auto' ? 0 : parseInt(comp.zIndex, 10) || 0;
    const calculatedZ = stackingDepth * 100 + (parsedZ > 0 ? parsedZ : 0);
    const interactive = isInteractive(el, comp);
    const scrollContainer = findScrollableContainer(el);

    const textContent = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);

    const nodeInfo = {
      id: el.id || null,
      tag: el.tagName.toLowerCase(),
      selector: getSelector(el),
      path: getPath(el),
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      },
      computed: {
        zIndex: comp.zIndex,
        position: comp.position,
        opacity: comp.opacity,
        display: comp.display,
        overflow: comp.overflow,
        pointerEvents: comp.pointerEvents
      },
      stackingDepth,
      calculatedZ,
      interactive,
      text: textContent,
      isBlocked: false,
      isScrollAccessible: false,
      blocker: null,
      colors: {
        color: comp.color,
        backgroundColor: comp.backgroundColor
      },
      issues: []
    };

    // Text Truncation Check (ignore root wrapper phone container)
    if (el.id !== 'ph' && (comp.overflow === 'hidden' || comp.overflowX === 'hidden' || comp.overflowY === 'hidden')) {
      if (el.scrollWidth > el.clientWidth + 4 || el.scrollHeight > el.clientHeight + 4) {
        nodeInfo.issues.push({
          type: 'TEXT_TRUNCATION',
          severity: 'P1',
          detail: `Content clipped: scroll ${el.scrollWidth}x${el.scrollHeight}px vs client ${el.clientWidth}x${el.clientHeight}px`
        });
        anomalies.push({
          severity: 'P1',
          type: 'TEXT_TRUNCATED',
          target: nodeInfo.selector,
          path: nodeInfo.path,
          rect: nodeInfo.rect,
          detail: `Content overflowing box and being clipped by overflow: hidden`
        });
      }
    }

    // Scroll-Aware Hit Testing for Interactive Elements
    if (interactive && comp.pointerEvents !== 'none') {
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      let initiallyBlocked = false;
      let topBlocker = null;

      if (cx >= 0 && cx <= vw && cy >= 0 && cy <= vh) {
        const hits = document.elementsFromPoint(cx, cy);
        if (hits.length > 0) {
          const topHit = hits[0];
          // Parent-child or ancestor check (handles SVG, button spans, icons)
          const isSelfOrRelative = topHit === el || el.contains(topHit) || topHit.contains(el);
          if (!isSelfOrRelative) {
            const blockerComp = window.getComputedStyle(topHit);
            if (blockerComp.pointerEvents !== 'none') {
              initiallyBlocked = true;
              topBlocker = topHit;
            }
          }
        }
      } else {
        initiallyBlocked = true;
      }

      // If initially blocked, run scroll verification
      if (initiallyBlocked) {
        if (scrollContainer) {
          const prevScrollTop = scrollContainer === document.documentElement ? window.scrollY : scrollContainer.scrollTop;
          const prevScrollLeft = scrollContainer === document.documentElement ? window.scrollX : scrollContainer.scrollLeft;

          try {
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          } catch (e) {
            el.scrollIntoView();
          }

          const scrolledRect = el.getBoundingClientRect();
          const scx = scrolledRect.left + scrolledRect.width / 2;
          const scy = scrolledRect.top + scrolledRect.height / 2;

          let clearAfterScroll = false;
          if (scx >= 0 && scx <= vw && scy >= 0 && scy <= vh) {
            const scrolledHits = document.elementsFromPoint(scx, scy);
            if (scrolledHits.length > 0) {
              const scrolledTopHit = scrolledHits[0];
              if (scrolledTopHit === el || el.contains(scrolledTopHit) || scrolledTopHit.contains(el)) {
                clearAfterScroll = true;
              }
            }
          }

          // Restore scroll position
          if (scrollContainer === document.documentElement) {
            window.scrollTo(prevScrollLeft, prevScrollTop);
          } else {
            scrollContainer.scrollTop = prevScrollTop;
            scrollContainer.scrollLeft = prevScrollLeft;
          }

          if (clearAfterScroll) {
            nodeInfo.isScrollAccessible = true;
            initiallyBlocked = false;
          }
        }

        // True permanent P0 blocker
        if (initiallyBlocked && topBlocker) {
          const blockerComp = window.getComputedStyle(topBlocker);
          const blockerInfo = {
            tag: topBlocker.tagName.toLowerCase(),
            selector: getSelector(topBlocker),
            path: getPath(topBlocker),
            zIndex: blockerComp.zIndex,
            pointerEvents: blockerComp.pointerEvents
          };
          nodeInfo.isBlocked = true;
          nodeInfo.blocker = blockerInfo;
          nodeInfo.issues.push({
            type: 'CLICK_TARGET_OCCLUDED',
            severity: 'P0',
            detail: `Target permanently obstructed by ${blockerInfo.selector} even when scrolled.`
          });
          anomalies.push({
            severity: 'P0',
            type: 'OCCLUDED_INTERACTIVE',
            target: nodeInfo.selector,
            path: nodeInfo.path,
            rect: nodeInfo.rect,
            blocker: blockerInfo,
            detail: `Interactive element cannot receive direct clicks because ${blockerInfo.selector} renders on top even when scrolled.`
          });
        }
      }
    }

    const isInViewport = (rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw);
    const isTextLeaf = isInViewport &&
                       ['H1','H2','H3','H4','H5','H6','P','SPAN','LABEL','BUTTON','A'].includes(el.tagName) &&
                       textContent.length > 2 &&
                       el.children.length <= 1;
    if (isTextLeaf) {
      const fgColor = parseRgba(comp.color) || { r: 0, g: 0, b: 0, a: 1 };
      const effectiveBg = getEffectiveBackgroundColor(el, rect);
      const colorSim = getColorSimilarity(fgColor, effectiveBg);
      const contrastRatio = getContrastRatio(fgColor, effectiveBg);

      nodeInfo.colors.foreground = `rgb(${fgColor.r}, ${fgColor.g}, ${fgColor.b})`;
      nodeInfo.colors.effectiveBackground = `rgb(${effectiveBg.r}, ${effectiveBg.g}, ${effectiveBg.b})`;
      nodeInfo.colors.similarity = colorSim;
      nodeInfo.colors.contrastRatio = contrastRatio;

      // Color camouflage / low contrast check (>= 70% color similarity or contrast < 3.0:1)
      if (colorSim >= 70 || contrastRatio < 3.0) {
        const isSevere = colorSim >= 85 || contrastRatio < 1.8;
        const severity = isSevere ? 'P0' : 'P1';
        nodeInfo.issues.push({
          type: 'UNREADABLE_TEXT_CONTRAST',
          severity: severity,
          detail: `Text has ${colorSim}% color match to background (contrast ${contrastRatio}:1). Text: "${textContent.slice(0, 30)}..."`
        });
        anomalies.push({
          severity: severity,
          type: 'UNREADABLE_TEXT_CONTRAST',
          target: nodeInfo.selector,
          path: nodeInfo.path,
          rect: nodeInfo.rect,
          similarity: colorSim,
          contrastRatio: contrastRatio,
          colors: nodeInfo.colors,
          detail: `Text "${nodeInfo.text.slice(0, 25)}..." is illegible: ${colorSim}% color match against background (${nodeInfo.colors.foreground} on ${nodeInfo.colors.effectiveBackground}, contrast ratio ${contrastRatio}:1).`
        });
      }

      textElements.push({ el, nodeInfo, rect, isFixed: isFixedOrSticky(el), hasScroll: !!scrollContainer });
    }

    const isContainer = isInViewport &&
                        ['DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'MAIN', 'NAV', 'HEADER', 'FOOTER', 'FORM', 'DIALOG', 'LI'].includes(el.tagName) &&
                        rect.width >= 30 && rect.height >= 30;
    if (isContainer) {
      const parsedBg = parseRgba(comp.backgroundColor);
      if (parsedBg && parsedBg.a >= 0.15) {
        containerElements.push({ el, nodeInfo, rect, bg: parsedBg, comp, isFixed: isFixedOrSticky(el), hasScroll: !!scrollContainer });
      }
    }

    elementsData.push(nodeInfo);
  }

  // Detect Unintended Sibling Text Collisions
  for (let i = 0; i < textElements.length; i++) {
    for (let j = i + 1; j < textElements.length; j++) {
      const a = textElements[i];
      const b = textElements[j];

      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;

      // If one is scrollable and the other is a floating/fixed nav dock, scrolling separates them!
      if ((a.hasScroll && b.isFixed) || (b.hasScroll && a.isFixed)) continue;

      const x1 = Math.max(a.rect.left, b.rect.left);
      const y1 = Math.max(a.rect.top, b.rect.top);
      const x2 = Math.min(a.rect.right, b.rect.right);
      const y2 = Math.min(a.rect.bottom, b.rect.bottom);

      if (x2 > x1 && y2 > y1) {
        const overlapWidth = x2 - x1;
        const overlapHeight = y2 - y1;
        const overlapArea = overlapWidth * overlapHeight;
        const minArea = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);

        if (overlapArea / minArea > 0.35) {
          a.nodeInfo.issues.push({
            type: 'TEXT_COLLISION',
            severity: 'P1',
            detail: `Colliding with visible text in ${b.nodeInfo.selector} (overlap: ${Math.round(overlapWidth)}x${Math.round(overlapHeight)}px)`
          });
          b.nodeInfo.issues.push({
            type: 'TEXT_COLLISION',
            severity: 'P1',
            detail: `Colliding with visible text in ${a.nodeInfo.selector}`
          });
          anomalies.push({
            severity: 'P1',
            type: 'TEXT_COLLISION',
            elementA: a.nodeInfo.selector,
            elementB: b.nodeInfo.selector,
            overlapRect: { x: Math.round(x1), y: Math.round(y1), w: Math.round(overlapWidth), h: Math.round(overlapHeight) },
            detail: `Visible text "${a.nodeInfo.text.slice(0, 20)}..." and "${b.nodeInfo.text.slice(0, 20)}..." overlap in the rendered viewport.`
          });
        }
      }
    }
  }

  // Detect Unintended Same-Color Container Overlaps (>= 70% color similarity without separating border/shadow)
  for (let i = 0; i < containerElements.length; i++) {
    for (let j = i + 1; j < containerElements.length; j++) {
      const a = containerElements[i];
      const b = containerElements[j];

      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if ((a.hasScroll && b.isFixed) || (b.hasScroll && a.isFixed)) continue;

      const x1 = Math.max(a.rect.left, b.rect.left);
      const y1 = Math.max(a.rect.top, b.rect.top);
      const x2 = Math.min(a.rect.right, b.rect.right);
      const y2 = Math.min(a.rect.bottom, b.rect.bottom);

      if (x2 > x1 && y2 > y1) {
        const overlapWidth = x2 - x1;
        const overlapHeight = y2 - y1;
        const overlapArea = overlapWidth * overlapHeight;
        const minArea = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);

        // Significant overlap (>= 25% of smaller element)
        if (overlapArea / minArea >= 0.25) {
          const bgSim = getColorSimilarity(a.bg, b.bg);
          if (bgSim >= 70) {
            const hasBoundaryA = hasDistinguishingBoundary(a.comp);
            const hasBoundaryB = hasDistinguishingBoundary(b.comp);

            if (!hasBoundaryA && !hasBoundaryB) {
              const isSevere = bgSim >= 85;
              const severity = isSevere ? 'P1' : 'P2';
              const aColorStr = `rgb(${a.bg.r}, ${a.bg.g}, ${a.bg.b})`;
              const bColorStr = `rgb(${b.bg.r}, ${b.bg.g}, ${b.bg.b})`;
              const detailStr = `Containers overlap with ${bgSim}% matching background color (${aColorStr} vs ${bColorStr}) without separating border or shadow, causing boundary loss.`;

              a.nodeInfo.issues.push({
                type: 'SAME_COLOR_CONTAINER_OVERLAP',
                severity,
                detail: `Overlaps ${b.nodeInfo.selector} with ${bgSim}% matching background color without separating border/shadow.`
              });
              b.nodeInfo.issues.push({
                type: 'SAME_COLOR_CONTAINER_OVERLAP',
                severity,
                detail: `Overlaps ${a.nodeInfo.selector} with ${bgSim}% matching background color without separating border/shadow.`
              });

              anomalies.push({
                severity,
                type: 'SAME_COLOR_CONTAINER_OVERLAP',
                elementA: a.nodeInfo.selector,
                elementB: b.nodeInfo.selector,
                overlapRect: { x: Math.round(x1), y: Math.round(y1), w: Math.round(overlapWidth), h: Math.round(overlapHeight) },
                similarity: bgSim,
                colorA: aColorStr,
                colorB: bColorStr,
                detail: detailStr
              });
            }
          }
        }
      }
    }
  }

  const severityOrder = { P0: 0, P1: 1, P2: 2 };
  anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    viewport: { width: vw, height: vh },
    timestamp: new Date().toISOString(),
    totalElements: elementsData.length,
    anomaliesCount: anomalies.length,
    anomalies,
    elements: elementsData
  };
})();
