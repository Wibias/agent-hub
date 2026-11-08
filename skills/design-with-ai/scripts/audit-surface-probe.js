(function collectDwaAuditSurfaceProbe() {
  "use strict";

  const schemaVersion = 1;
  const round = (value) => Math.round(Number(value) * 100) / 100;
  const clamp = (value) => Math.max(0, Math.min(255, value));
  const viewport = {
    width: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
    height: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
    devicePixelRatio: window.devicePixelRatio || 1,
  };

  const parseColor = (value) => {
    if (typeof value !== "string") return null;
    const text = value.trim().toLowerCase();
    if (!text || text === "transparent" || text === "none") return { r: 0, g: 0, b: 0, a: 0 };
    const match = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
    if (match) {
      return {
        r: clamp(Number(match[1])),
        g: clamp(Number(match[2])),
        b: clamp(Number(match[3])),
        a: match[4] === undefined ? 1 : clamp(Number(match[4])),
      };
    }
    const hex = text.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      const raw = hex[1];
      const expand = raw.length <= 4
        ? raw.split("").map((ch) => ch + ch).join("")
        : raw;
      return {
        r: parseInt(expand.slice(0, 2), 16),
        g: parseInt(expand.slice(2, 4), 16),
        b: parseInt(expand.slice(4, 6), 16),
        a: expand.length >= 8 ? parseInt(expand.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  };

  const composite = (foreground, background) => {
    const alpha = foreground.a + background.a * (1 - foreground.a);
    if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 1 };
    return {
      r: clamp((foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha),
      g: clamp((foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha),
      b: clamp((foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha),
      a: 1,
    };
  };

  const cssColor = (color) => color && color.a >= 0.995
    ? `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
    : color ? `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${round(color.a)})` : null;

  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2 && rect.bottom > 0 && rect.right > 0
      && rect.top < viewport.height * 3 && rect.left < viewport.width * 2;
  };

  const rectOf = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
  };

  const MAX_VISIBLE_TEXT = 2000;
  const redactText = (value) => {
    let redactions = 0;
    let text = String(value ?? "").replace(/\s+/g, " ").trim();
    const redact = (pattern) => {
      text = text.replace(pattern, () => { redactions += 1; return "[REDACTED]"; });
    };
    redact(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi);
    redact(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi);
    redact(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g);
    redact(/\b(?:token|secret|password|passwd|api[_-]?key|auth|code)=[^&\s]+/gi);
    redact(/\b[A-Za-z0-9_-]{32,}\b/g);
    return { text, redactions };
  };
  const safeText = (value, max = 160) => {
    const redacted = redactText(value);
    return {
      text: redacted.text.length > max ? redacted.text.slice(0, max - 1) + "…" : redacted.text,
      redactions: redacted.redactions,
      truncated: redacted.text.length > max,
    };
  };

  const accessibleName = (element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/)
        .map((id) => safeText(document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "", 120).text)
        .filter(Boolean).join(" ").trim();
      if (text) return text;
    }
    const aria = element.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const id = element.getAttribute("id");
    if (id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label) return safeText(label.innerText || label.textContent || "", 160).text;
      } catch { /* ignore malformed ids */ }
    }
    const wrapping = element.closest("label");
    if (wrapping) return safeText(wrapping.innerText || wrapping.textContent || "", 160).text;
    return safeText(element.innerText || element.textContent || "", 120).text;
  };

  const backgroundStack = (element) => {
    const stack = [];
    let current = element;
    while (current && current instanceof Element) {
      const style = getComputedStyle(current);
      const parsed = parseColor(style.backgroundColor);
      if (parsed && parsed.a > 0) {
        stack.push({
          tag: current.tagName.toLowerCase(),
          value: style.backgroundColor,
          image: style.backgroundImage && style.backgroundImage !== "none",
        });
      }
      current = current.parentElement;
    }
    return stack.reverse();
  };

  const effectiveBackground = (element) => {
    let result = { r: 255, g: 255, b: 255, a: 1 };
    let reliable = true;
    for (const layer of backgroundStack(element)) {
      if (layer.image) reliable = false;
      const parsed = parseColor(layer.value);
      if (parsed) result = composite(parsed, result);
    }
    return { value: cssColor(result), color: result, reliable };
  };

  const styleOf = (element) => {
    const style = getComputedStyle(element);
    return {
      appearance: style.appearance,
      color: style.color,
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage === "none" ? null : style.backgroundImage,
      borderTopWidth: style.borderTopWidth,
      borderRightWidth: style.borderRightWidth,
      borderBottomWidth: style.borderBottomWidth,
      borderLeftWidth: style.borderLeftWidth,
      borderTopColor: style.borderTopColor,
      borderRightColor: style.borderRightColor,
      borderBottomColor: style.borderBottomColor,
      borderLeftColor: style.borderLeftColor,
      borderTopStyle: style.borderTopStyle,
      borderRadius: style.borderTopLeftRadius,
      opacity: style.opacity,
      boxShadow: style.boxShadow === "none" ? null : style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      display: style.display,
      flexDirection: style.flexDirection,
      cursor: style.cursor,
    };
  };

  const resolveVars = (element, value) => String(value ?? "").replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g,
    (_, name, fallback) => {
      const computed = getComputedStyle(element).getPropertyValue(name).trim();
      if (computed) return computed;
      return fallback ? fallback.trim() : "";
    },
  );

  const stateForSelector = (selector) => {
    const interaction = [];
    if (/:hover\b/.test(selector)) interaction.push("hover");
    if (/:focus-visible\b|:focus-within\b|:focus\b/.test(selector)) interaction.push("focus");
    if (/:active\b/.test(selector)) interaction.push("pressed");
    if (/:checked\b/.test(selector)) interaction.push("checked");
    // A selector such as `.tab.is-active:hover` describes the hover variant,
    // not the selected default. Keeping it as selected would hide the very
    // state-precedence loss this probe is meant to expose.
    if (interaction.length) return interaction;
    const states = [];
    if (/\[aria-selected\s*=\s*["']?true|\[aria-checked\s*=\s*["']?true|\[aria-current\s*=\s*["']?page|\[data-state\s*=\s*["']?active|\.(?:is-)?(?:active|selected|current)\b/.test(selector)) {
      states.push("selected");
    }
    return states.length ? states : ["base"];
  };

  const matchesWithoutState = (element, selector) => {
    let stripped = selector
      .replace(/::?(?:hover|focus-visible|focus-within|focus|active|checked|disabled|visited|link|target|enabled)\b/g, "")
      .replace(/\[aria-(?:selected|checked|expanded|current|pressed)(?:\s*=\s*["']?[^\]]*["']?)?\]/g, "")
      .replace(/\[data-state(?:\s*=\s*["']?[^\]]*["']?)?\]/g, "")
      .replace(/\.(?:is-)?(?:active|selected|current|checked)\b/g, "")
      .replace(/:(?:first|last|only|nth)-(?:child|of-type)\([^)]*\)/g, "")
      .replace(/:(?:first|last|only)-(?:child|of-type)\b/g, "")
      .trim();
    if (!stripped) stripped = "*";
    try { return element.matches(stripped); } catch { return false; }
  };

  const ruleDeclarations = (element, rule) => {
    const declarations = {};
    for (const property of [
      "background-color", "background", "color", "border-color", "border-width",
      "border-top-color", "border-top-width", "opacity", "box-shadow",
      "outline-color", "outline-width", "text-decoration-line",
    ]) {
      let value = rule.style.getPropertyValue(property);
      if (!value && property === "background-color") value = rule.style.getPropertyValue("background");
      if (!value) continue;
      declarations[property] = resolveVars(element, value);
    }
    return declarations;
  };

  const collectRules = (element) => {
    const result = { base: [], hover: [], focus: [], pressed: [], checked: [], selected: [] };
    const visit = (rules) => {
      // CSSRuleList is array-like and not consistently iterable across engines.
      for (const rule of Array.from(rules)) {
        if (rule.media && typeof rule.conditionText === "string") {
          try { if (!window.matchMedia(rule.conditionText).matches) continue; } catch { continue; }
        }
        // A CSSStyleRule can also expose nested cssRules in engines with CSS
        // nesting. Process its declarations first, then recurse into children.
        if (rule.selectorText && rule.style) {
          const parts = rule.selectorText.split(",").map((part) => part.trim()).filter(Boolean);
          if (parts.some((part) => matchesWithoutState(element, part))) {
            const declarations = ruleDeclarations(element, rule);
            if (Object.keys(declarations).length) {
              for (const state of stateForSelector(rule.selectorText)) {
                result[state].push({ selector: rule.selectorText.trim().slice(0, 300), declarations });
              }
            }
          }
        }
        if (rule.cssRules && rule.cssRules.length) visit(rule.cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try { visit(sheet.cssRules); } catch { /* cross-origin or inaccessible sheet */ }
    }
    return result;
  };

  const describe = (element, kind, extra = {}) => {
    const style = styleOf(element);
    return {
      kind,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      type: element.getAttribute("type"),
      name: accessibleName(element),
      text: safeText(element.innerText || element.textContent || "", 120).text,
      rect: rectOf(element),
      visible: isVisible(element),
      disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
      checked: element.matches("input[type=checkbox],input[type=radio]") ? Boolean(element.checked) : null,
      selected: element.getAttribute("aria-selected") === "true"
        || element.getAttribute("aria-checked") === "true"
        || element.getAttribute("aria-current") === "page"
        || element.classList.contains("is-active")
        || element.classList.contains("is-selected"),
      tabIndex: element.tabIndex,
      id: element.id || null,
      controls: element.getAttribute("aria-controls"),
      ...extra,
      style,
      ownBackground: (() => { const parsed = parseColor(style.backgroundColor); return parsed ? { value: cssColor(parsed), color: parsed } : null; })(),
      adjacentBackground: effectiveBackground(element.parentElement),
      rules: collectRules(element),
    };
  };

  const elements = [];
  const seen = new Set();
  const add = (element, kind, extra) => {
    if (!element || seen.has(element) || elements.length >= 300 || !isVisible(element)) return;
    seen.add(element);
    elements.push(describe(element, kind, extra));
  };

  for (const element of document.querySelectorAll("input[type=checkbox],input[type=radio]")) add(element, "checkbox");
  for (const element of document.querySelectorAll("select")) add(element, "select");
  for (const element of document.querySelectorAll("textarea,input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=reset]):not([type=file])")) add(element, "text");
  for (const element of document.querySelectorAll("[role=tab]")) add(element, "tab");
  for (const element of document.querySelectorAll("[aria-expanded]")) add(element, "disclosure");
  for (const element of document.querySelectorAll("[role=combobox]")) add(element, "combobox");

  const tablists = Array.from(document.querySelectorAll("[role=tablist]"))
    .filter(isVisible)
    .map((list, index) => {
      const tabs = Array.from(list.querySelectorAll("[role=tab]")).filter(isVisible);
      const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
      const controls = tabs.map((tab) => tab.getAttribute("aria-controls"));
      const style = getComputedStyle(list);
      const rect = list.getBoundingClientRect();
      return {
        index,
        name: accessibleName(list),
        orientation: list.getAttribute("aria-orientation"),
        display: style.display,
        flexDirection: style.flexDirection,
        rect: rectOf(list),
        layout: rect.height > rect.width * 1.5 ? "vertical" : "horizontal",
        tabCount: tabs.length,
        tabbableCount: tabs.filter((tab) => tab.tabIndex === 0).length,
        selectedCount: selected.length,
        selectedTab: selected.length ? safeText(selected[0].innerText || selected[0].textContent || "", 80).text : null,
        controls,
        uniqueControls: new Set(controls.filter(Boolean)).size,
        controlsTargetsExist: controls.map((id) => Boolean(id && document.getElementById(id))),
        tabStops: tabs.map((tab) => ({
          id: tab.id || null,
          name: accessibleName(tab),
          tabIndex: tab.tabIndex,
          selected: tab.getAttribute("aria-selected") === "true",
          controls: tab.getAttribute("aria-controls"),
        })),
      };
    });

  const panels = Array.from(document.querySelectorAll("[role=tabpanel]"))
    .filter(isVisible)
    .map((panel) => ({
      id: panel.id || null,
      labelledby: panel.getAttribute("aria-labelledby"),
      hidden: panel.hasAttribute("hidden"),
      name: accessibleName(panel),
    }));

  const inventory = {};
  for (const element of elements) inventory[element.kind] = (inventory[element.kind] || 0) + 1;

  const bodyText = redactText(document.body?.innerText || "");
  const visibleText = bodyText.text.slice(0, MAX_VISIBLE_TEXT);
  return {
    schemaVersion,
    kind: "dwa/audit-surface-probe",
    capturedAt: new Date().toISOString(),
    route: location.pathname,
    title: safeText(document.title, 120).text,
    viewport,
    inventory,
    elements,
    tablists,
    panels,
    visibleText,
    visibleTextMeta: {
      length: bodyText.text.length,
      redactions: bodyText.redactions,
      truncated: bodyText.text.length > MAX_VISIBLE_TEXT,
      max: MAX_VISIBLE_TEXT,
    },
    privacy: {
      url: "pathname-only",
      visibleText: "redacted-truncated",
      note: "Do not upload raw probe JSON; keep it private-local unless the project sanitizes it further.",
    },
    limitations: [
      "Computed styles do not simulate a real hover, focus or keyboard sequence.",
      "Cross-origin stylesheets and canvas-painted controls may be unobservable.",
      "Gradients, images and backdrop filters can make the adjacent background estimate approximate.",
      "This probe measures presentation and attribute wiring, not screen-reader announcements or task success.",
      "URL and visible text are minimized; the text sample is redacted and truncated, not a full transcript.",
    ],
  };
})()
