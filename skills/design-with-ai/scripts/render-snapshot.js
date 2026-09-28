(function collectDesignWithAiRenderSnapshot() {
  "use strict";

  const schemaVersion = 1;
  const viewport = {
    width: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
    height: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
    devicePixelRatio: window.devicePixelRatio || 1,
  };

  const round = (value) => Math.round(Number(value) * 100) / 100;
  const rectOf = (el) => {
    const rect = el.getBoundingClientRect();
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
      right: round(rect.right),
      bottom: round(rect.bottom),
    };
  };

  const isVisible = (el) => {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2 && rect.bottom > 0 && rect.right > 0
      && rect.top < viewport.height * 3 && rect.left < viewport.width * 2;
  };

  const cleanText = (el, max = 120) => {
    const value = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return value.length > max ? value.slice(0, max - 1) + "…" : value;
  };

  const px = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const main = document.querySelector("main,[role='main']") || document.body;
  const directSurfaceChildren = Array.from(main.children).filter(isVisible);
  const sectionRoots = directSurfaceChildren.filter((el) => el.getBoundingClientRect().height >= 40);

  const sectionIndexFor = (el) => {
    for (let i = 0; i < sectionRoots.length; i += 1) {
      if (sectionRoots[i] === el || sectionRoots[i].contains(el)) return i;
    }
    return -1;
  };

  const headingEls = Array.from(document.querySelectorAll("h1,h2,h3,h4,[role='heading']")).filter(isVisible);
  const headings = headingEls.slice(0, 80).map((el) => {
    const style = getComputedStyle(el);
    const rect = rectOf(el);
    return {
      tag: el.tagName.toLowerCase(),
      text: cleanText(el, 100),
      level: Number(el.getAttribute("aria-level")) || Number(el.tagName.slice(1)) || null,
      sectionIndex: sectionIndexFor(el),
      rect,
      fontSize: round(px(style.fontSize)),
      fontWeight: style.fontWeight,
      textAlign: style.textAlign,
      textTransform: style.textTransform,
      letterSpacing: round(px(style.letterSpacing)),
      inFirstViewport: rect.y < viewport.height && rect.bottom > 0,
    };
  });

  const rgb = (value) => value.replace(/\s+/g, "").toLowerCase();

  const actionSelector = "button,a[href],[role='button'],input[type='button'],input[type='submit']";
  const actionEls = Array.from(document.querySelectorAll(actionSelector)).filter(isVisible);
  const actionIndex = new Map(actionEls.map((el, index) => [el, index]));

  const actionAppearance = (el) => {
    const style = getComputedStyle(el);
    const parentStyle = el.parentElement ? getComputedStyle(el.parentElement) : null;
    const background = rgb(style.backgroundColor);
    const parentBackground = parentStyle ? rgb(parentStyle.backgroundColor) : "";
    const hasVisibleBackground = background !== "rgba(0,0,0,0)" && background !== "transparent";
    const filled = hasVisibleBackground && background !== parentBackground;
    const border = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
      .some((value) => px(value) > 0);
    return { filled, outlined: !filled && border };
  };

  const candidateTextEls = Array.from(document.querySelectorAll("main span,main p,main div,main label,[role='main'] span,[role='main'] p,[role='main'] div,[role='main'] label"))
    .filter(isVisible)
    .slice(0, 1200);

  const kickers = [];
  for (const el of candidateTextEls) {
    if (el.children.length > 2) continue;
    const text = cleanText(el, 60);
    if (text.length < 2 || text.length > 45 || !/[A-Za-zÀ-ÿ]/.test(text)) continue;
    const style = getComputedStyle(el);
    const fontSize = px(style.fontSize);
    const letterSpacing = px(style.letterSpacing);
    const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, "");
    const uppercase = letters.length >= 2 && letters === letters.toUpperCase();
    const transformed = style.textTransform === "uppercase";
    if (fontSize > 15 || !(uppercase || transformed) || letterSpacing < 0.5) continue;
    const numbered = /^\s*0?\d{1,2}\s*(?:[·•:./-]\s*)?\S/.test(text);
    kickers.push({
      text,
      sectionIndex: sectionIndexFor(el),
      rect: rectOf(el),
      fontSize: round(fontSize),
      letterSpacing: round(letterSpacing),
      numbered,
      insideOrderedList: Boolean(el.closest("ol")),
    });
    if (kickers.length >= 80) break;
  }

  const structuralKey = (el) => {
    const children = Array.from(el.children).filter(isVisible).slice(0, 8);
    const tags = children.map((child) => child.tagName.toLowerCase()).join(",");
    const headingCount = el.querySelectorAll("h1,h2,h3,h4,[role='heading']").length;
    const actionCount = el.querySelectorAll(actionSelector).length;
    const iconCount = Array.from(el.querySelectorAll("svg")).filter(isVisible).length;
    return `${el.tagName.toLowerCase()}|${tags}|${headingCount}h|${actionCount}a|${iconCount}i`;
  };

  const groups = [];
  const groupParents = Array.from(main.querySelectorAll("section,div,ul,ol")).filter(isVisible).slice(0, 700);
  for (const parent of groupParents) {
    const children = Array.from(parent.children).filter((el) => {
      if (!isVisible(el)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 80 && rect.height >= 50;
    });
    if (children.length < 2 || children.length > 6) continue;

    const rects = children.map((el) => el.getBoundingClientRect());
    const widths = rects.map((r) => r.width).filter((v) => v > 0);
    const heights = rects.map((r) => r.height).filter((v) => v > 0);
    if (!widths.length || !heights.length) continue;
    const widthScore = Math.min(...widths) / Math.max(...widths);
    const heightScore = Math.min(...heights) / Math.max(...heights);
    const equalSizeScore = Math.min(widthScore, heightScore);
    const keys = children.map(structuralKey);
    const sameStructure = new Set(keys).size === 1;

    if (equalSizeScore < 0.72 && !sameStructure) continue;
    groups.push({
      count: children.length,
      sectionIndex: sectionIndexFor(parent),
      rect: rectOf(parent),
      equalSizeScore: round(equalSizeScore),
      sameStructure,
      childKeys: keys,
      childRects: children.map(rectOf),
    });
    if (groups.length >= 80) break;
  }

  const isCardLike = (el) => {
    if (!isVisible(el)) return false;
    const style = getComputedStyle(el);
    const radius = Math.max(
      px(style.borderTopLeftRadius),
      px(style.borderTopRightRadius),
      px(style.borderBottomLeftRadius),
      px(style.borderBottomRightRadius),
    );
    const border = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
      .some((value) => px(value) > 0);
    const shadow = style.boxShadow && style.boxShadow !== "none";
    const parent = el.parentElement;
    const differentBackground = parent
      ? rgb(style.backgroundColor) !== rgb(getComputedStyle(parent).backgroundColor)
        && rgb(style.backgroundColor) !== "rgba(0,0,0,0)"
      : false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 120 && rect.height >= 70 && radius >= 8 && (border || shadow || differentBackground);
  };

  const cardEls = Array.from(main.querySelectorAll("section,article,div,li")).filter(isCardLike).slice(0, 300);
  const hasBorder = (el) => {
    const style = getComputedStyle(el);
    return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
      .some((value) => px(value) > 0);
  };
  const hasSoftShadow = (el) => {
    const shadow = getComputedStyle(el).boxShadow;
    if (!shadow || shadow === "none") return false;
    const lengths = (shadow.match(/-?\d+(?:\.\d+)?px/g) || [])
      .map((value) => Math.abs(Number.parseFloat(value)))
      .filter(Number.isFinite);
    return lengths.some((value) => value >= 12);
  };
  const ghostCardEls = cardEls.filter((el) => hasBorder(el) && hasSoftShadow(el));

  const radiusOf = (el) => {
    const style = getComputedStyle(el);
    return Math.max(
      px(style.borderTopLeftRadius),
      px(style.borderTopRightRadius),
      px(style.borderBottomLeftRadius),
      px(style.borderBottomRightRadius),
    );
  };
  const cardRadii = cardEls.map((el) => radiusOf(el)).sort((a, b) => a - b);
  const largeRadiusCards = cardEls.filter((el) => radiusOf(el) >= 20);
  const largeRadiusSections = new Set(largeRadiusCards.map((el) => sectionIndexFor(el)).filter((index) => index >= 0));
  const medianCardRadius = cardRadii.length
    ? cardRadii[Math.floor(cardRadii.length / 2)]
    : 0;

  let maxCardDepth = 0;
  let nestedCardCount = 0;
  for (const el of cardEls) {
    let depth = 0;
    let parent = el.parentElement;
    while (parent && parent !== main && parent !== document.body) {
      if (cardEls.includes(parent)) depth += 1;
      parent = parent.parentElement;
    }
    maxCardDepth = Math.max(maxCardDepth, depth);
    if (depth >= 1) nestedCardCount += 1;
  }

  const firstBlock = sectionRoots[0] || null;
  let hero = null;
  if (firstBlock) {
    const rect = rectOf(firstBlock);
    const firstHeading = Array.from(firstBlock.querySelectorAll("h1,h2,[role='heading']")).find(isVisible) || null;
    let centeredHeading = false;
    if (firstHeading) {
      const headingRect = firstHeading.getBoundingClientRect();
      const blockRect = firstBlock.getBoundingClientRect();
      const headingCenter = headingRect.left + headingRect.width / 2;
      const blockCenter = blockRect.left + blockRect.width / 2;
      const style = getComputedStyle(firstHeading);
      centeredHeading = style.textAlign === "center"
        || Math.abs(headingCenter - blockCenter) <= Math.max(24, blockRect.width * 0.05);
    }
    hero = {
      sectionIndex: 0,
      rect,
      heightRatio: round(rect.height / Math.max(viewport.height, 1)),
      centeredHeading,
      headingText: firstHeading ? cleanText(firstHeading, 100) : null,
      actionCount: Array.from(firstBlock.querySelectorAll(actionSelector)).filter(isVisible).length,
      kickerCount: kickers.filter((item) => item.sectionIndex === 0).length,
    };
  }

  const macroZones = sectionRoots.slice(0, 24).map((zone, index) => {
    const rect = zone.getBoundingClientRect();
    const zoneGroups = groups.filter((group) => group.sectionIndex === index && group.sameStructure === true);
    const repeatedCounts = [...new Set(zoneGroups.map((group) => group.count).filter((count) => count >= 2))]
      .sort((a, b) => a - b);
    const headingCount = Array.from(zone.querySelectorAll("h1,h2,h3,h4,[role='heading']")).filter(isVisible).length;
    const actionCount = Array.from(zone.querySelectorAll(actionSelector)).filter(isVisible).length;
    const cardCount = cardEls.filter((card) => card === zone || zone.contains(card)).length;
    const widthRatio = rect.width / Math.max(viewport.width, 1);
    const heightRatio = rect.height / Math.max(viewport.height, 1);

    let archetype = "content";
    if (index === 0 && hero?.heightRatio >= 0.7 && hero.centeredHeading === true) {
      archetype = "hero-centered";
    } else if (repeatedCounts.includes(3)) {
      archetype = "repeat-3";
    } else if (repeatedCounts.some((count) => count >= 4)) {
      archetype = "repeat-many";
    } else if (cardCount >= 2) {
      archetype = "cards";
    } else if (headingCount >= 1 && actionCount >= 1) {
      archetype = "content-action";
    }

    const widthBand = widthRatio >= 0.85 ? "full" : widthRatio >= 0.6 ? "wide" : "narrow";

    return {
      index,
      archetype,
      widthBand,
      rect: rectOf(zone),
      widthRatio: round(widthRatio),
      heightRatio: round(heightRatio),
      headingCount,
      actionCount,
      repeatedCounts,
      cardCount,
    };
  });

  const macroFingerprint = macroZones
    .map((zone) => `${zone.archetype}:${zone.widthBand}:${zone.repeatedCounts.join(".") || "-"}`)
    .join(">");

  const smallSvgs = Array.from(main.querySelectorAll("svg")).filter((el) => {
    if (!isVisible(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width <= 72 && rect.height <= 72;
  });

  const iconTileParents = new Set();
  for (const svg of smallSvgs) {
    if (svg.closest("button,a[href],[role='button']")) continue;
    let node = svg.parentElement;
    for (let depth = 0; node && depth < 3; depth += 1, node = node.parentElement) {
      if (!isVisible(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20 || rect.width > 88 || rect.height > 88) continue;
      const style = getComputedStyle(node);
      const radius = radiusOf(node);
      const background = rgb(style.backgroundColor);
      const parentBackground = node.parentElement ? rgb(getComputedStyle(node.parentElement).backgroundColor) : "";
      const border = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
        .some((value) => px(value) > 0);
      const shadow = style.boxShadow && style.boxShadow !== "none";
      const hasVisibleBackground = background !== "rgba(0,0,0,0)" && background !== "transparent";
      const surfaceDiffers = hasVisibleBackground && background !== parentBackground;
      if (radius >= 8 && (surfaceDiffers || border || shadow)) {
        iconTileParents.add(node);
        break;
      }
    }
  }

  const iconTileSections = new Set(
    [...iconTileParents].map((el) => sectionIndexFor(el)).filter((index) => index >= 0),
  );
  const iconBearingCards = cardEls.filter((card) => smallSvgs.some((svg) => card.contains(svg)));

  const navCandidates = Array.from(document.querySelectorAll("header nav,header [role='navigation'],nav,[role='navigation']"))
    .filter(isVisible);
  const topNav = navCandidates.find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top <= 120 && rect.width >= viewport.width * 0.6 && rect.height <= 180;
  }) || null;

  let navMetrics = {
    present: false,
    plainActionCount: 0,
    filledActionCount: 0,
    totalActionCount: 0,
  };
  if (topNav) {
    const actions = Array.from(topNav.querySelectorAll(actionSelector)).filter(isVisible);
    const appearances = actions.map((el) => actionAppearance(el));
    navMetrics = {
      present: true,
      plainActionCount: appearances.filter((item) => !item.filled && !item.outlined).length,
      filledActionCount: appearances.filter((item) => item.filled).length,
      totalActionCount: actions.length,
    };
  }

  const footer = Array.from(document.querySelectorAll("footer,[role='contentinfo']")).find(isVisible) || null;
  let footerColumnCount = 0;
  if (footer) {
    const parents = [footer, ...Array.from(footer.querySelectorAll("div,section,nav")).filter(isVisible)].slice(0, 160);
    for (const parent of parents) {
      const children = Array.from(parent.children).filter(isVisible);
      if (children.length < 3 || children.length > 6) continue;
      const columnLike = children.filter((child) => {
        const links = Array.from(child.querySelectorAll("a[href]")).filter(isVisible);
        const heading = Array.from(child.querySelectorAll("h2,h3,h4,h5,h6,[role='heading']")).find(isVisible);
        return links.length >= 2 && Boolean(heading || cleanText(child, 80).length > 0);
      });
      if (columnLike.length === children.length) footerColumnCount = Math.max(footerColumnCount, children.length);
    }
  }

  const pairKeys = new Set();
  const pairSections = new Set();
  const pairParents = Array.from(main.querySelectorAll("section,div,nav")).filter(isVisible).slice(0, 800);
  for (const parent of pairParents) {
    const rect = parent.getBoundingClientRect();
    if (rect.height > 180) continue;
    const actions = Array.from(parent.querySelectorAll(actionSelector)).filter(isVisible);
    if (actions.length !== 2) continue;
    const indices = actions.map((el) => actionIndex.get(el)).filter((index) => Number.isInteger(index)).sort((a, b) => a - b);
    if (indices.length !== 2) continue;
    const appearances = actions.map((el) => actionAppearance(el));
    const hasFilled = appearances.some((item) => item.filled);
    const hasOutlined = appearances.some((item) => item.outlined);
    if (!hasFilled || !hasOutlined) continue;
    const key = indices.join(":");
    if (pairKeys.has(key)) continue;
    pairKeys.add(key);
    const sectionIndex = sectionIndexFor(parent);
    if (sectionIndex >= 0) pairSections.add(sectionIndex);
  }

  const shellMetrics = {
    topNav: navMetrics,
    footer: {
      present: Boolean(footer),
      columnCount: footerColumnCount,
    },
    defaultActionPairs: {
      count: pairKeys.size,
      sectionCount: pairSections.size,
    },
  };

  const headingTexts = headings.map((heading) => heading.text.toLowerCase());
  const pricingHeadingCount = headingTexts.filter((text) =>
    /\b(?:pricing|plans?|prices?|preise?|tarife?|subscriptions?|abonnements?)\b/i.test(text)
  ).length;
  const faqHeadingCount = headingTexts.filter((text) =>
    /\b(?:faq|frequently asked|questions?|fragen|häufige fragen)\b/i.test(text)
  ).length;
  const visibleDetailsCount = Array.from(main.querySelectorAll("details")).filter(isVisible).length;
  const priceLikeCount = candidateTextEls.filter((el) => {
    if (el.children.length > 2) return false;
    const text = cleanText(el, 50);
    if (!text || text.length > 50) return false;
    return /(?:[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|EUR|USD|GBP))(?:\s*\/\s*(?:mo|month|yr|year|monat|jahr))?/i.test(text);
  }).length;
  const repeatedThreeSection = groups.some((group) =>
    group.count === 3 && group.sameStructure === true && group.equalSizeScore >= 0.9
  );
  const closingZones = macroZones.slice(-2);
  const closingActionZoneCount = closingZones.filter((zone) => zone.actionCount >= 1).length;

  const marketingMetrics = {
    centeredHero: Boolean(hero && hero.heightRatio >= 0.7 && hero.centeredHeading === true),
    repeatedThreeSection,
    pricingHeadingCount,
    priceLikeCount,
    faqHeadingCount,
    visibleDetailsCount,
    closingActionZoneCount,
  };

  const sectionRects = sectionRoots.map((section) => section.getBoundingClientRect());
  const sectionGaps = [];
  for (let i = 1; i < sectionRects.length; i += 1) {
    const gap = Math.max(0, sectionRects[i].top - sectionRects[i - 1].bottom);
    sectionGaps.push(round(gap));
  }
  const gapBuckets = new Map();
  for (const gap of sectionGaps) {
    const bucket = Math.round(gap / 8) * 8;
    gapBuckets.set(bucket, (gapBuckets.get(bucket) || 0) + 1);
  }
  const dominantGap = [...gapBuckets.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] || [0, 0];
  const dividerSections = sectionRoots.filter((section) => {
    const style = getComputedStyle(section);
    return px(style.borderTopWidth) > 0 || px(style.borderBottomWidth) > 0;
  });

  const surfaceMetrics = {
    cardCount: cardEls.length,
    ghostCardCount: ghostCardEls.length,
    ghostCardRatio: cardEls.length ? round(ghostCardEls.length / cardEls.length) : 0,
  };

  const kitchenSinkCards = cardEls.map((card) => {
    const cardText = cleanText(card, 600);
    const icons = smallSvgs.filter((svg) => card.contains(svg)).length;
    const actions = Array.from(card.querySelectorAll(actionSelector)).filter(isVisible).length;
    const statuses = Array.from(card.querySelectorAll("[role='status'],[data-status],[aria-live]")).filter(isVisible).length;
    const priceLike = /(?:[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|EUR|USD|GBP))(?:\s*\/\s*(?:mo|month|yr|year|monat|jahr))?/i.test(cardText);
    const pillCandidates = Array.from(card.querySelectorAll("span,label,div")).filter((el) => {
      if (!isVisible(el) || el.closest(actionSelector)) return false;
      if (el.children.length > 1) return false;
      const text = cleanText(el, 32);
      if (!text || text.length > 24) return false;
      const rect = el.getBoundingClientRect();
      if (rect.height < 18 || rect.height > 36 || rect.width < 20 || rect.width > 180) return false;
      return radiusOf(el) >= 9;
    });

    const facets = {
      icon: icons > 0,
      pills: pillCandidates.length >= 2,
      price: priceLike,
      status: statuses > 0,
      action: actions > 0,
    };
    const facetCount = Object.values(facets).filter(Boolean).length;
    return {
      facetCount,
      facets,
      iconCount: icons,
      pillCount: pillCandidates.length,
      actionCount: actions,
      statusCount: statuses,
      priceLike,
    };
  });
  const kitchenSinkFacetCounts = kitchenSinkCards.map((card) => card.facetCount);
  const maxAdornmentKinds = kitchenSinkFacetCounts.length ? Math.max(...kitchenSinkFacetCounts) : 0;
  const denseCardCount = kitchenSinkCards.filter((card) => card.facetCount >= 4).length;
  const fullKitchenSinkCardCount = kitchenSinkCards.filter((card) => card.facetCount >= 5).length;

  const cardCompositionMetrics = {
    cardCount: cardEls.length,
    denseCardCount,
    fullKitchenSinkCardCount,
    maxAdornmentKinds,
    cards: kitchenSinkCards.slice(0, 40),
  };

  const rhythmMetrics = {
    sectionCount: sectionRoots.length,
    gapCount: sectionGaps.length,
    dominantGap: dominantGap[0],
    dominantGapCount: dominantGap[1],
    dominantGapRatio: sectionGaps.length ? round(dominantGap[1] / sectionGaps.length) : 0,
    dividerSectionCount: dividerSections.length,
    dividerSectionRatio: sectionRoots.length ? round(dividerSections.length / sectionRoots.length) : 0,
  };

  return {
    schemaVersion,
    capturedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
    viewport,
    surface: {
      rootTag: main.tagName.toLowerCase(),
      sectionCount: sectionRoots.length,
      firstBlock: hero,
    },
    headings,
    kickers,
    numberedMeta: kickers.filter((item) => item.numbered),
    siblingGroups: groups,
    macroZones,
    macroFingerprint,
    cardMetrics: {
      candidateCount: cardEls.length,
      nestedCardCount,
      maxDepth: maxCardDepth,
    },
    radiusMetrics: {
      cardCount: cardEls.length,
      largeRadiusCardCount: largeRadiusCards.length,
      largeRadiusRatio: cardEls.length ? round(largeRadiusCards.length / cardEls.length) : 0,
      medianCardRadius: round(medianCardRadius),
      sectionCount: largeRadiusSections.size,
    },
    iconMetrics: {
      smallSvgCount: smallSvgs.length,
      iconTileCount: iconTileParents.size,
      iconTileSectionCount: iconTileSections.size,
      iconBearingCardCount: iconBearingCards.length,
      iconBearingCardRatio: cardEls.length ? round(iconBearingCards.length / cardEls.length) : 0,
    },
    shellMetrics,
    marketingMetrics,
    surfaceMetrics,
    cardCompositionMetrics,
    rhythmMetrics,
  };
})()
