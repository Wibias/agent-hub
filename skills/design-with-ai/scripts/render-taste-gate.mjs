#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = { snapshot: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") args.json = true;
    else if (token === "--snapshot") args.snapshot = argv[++i];
    else if (!token.startsWith("-") && !args.snapshot) args.snapshot = token;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.snapshot) throw new Error("Usage: render-taste-gate.mjs --snapshot <render-snapshot.json> [--json]");
  return args;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${path}: ${error.message}`);
  }
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1) throw new Error("Unsupported or missing render snapshot schemaVersion");
  if (!(snapshot.viewport?.width > 0) || !(snapshot.viewport?.height > 0)) throw new Error("Render snapshot viewport is missing or invalid");
  for (const key of ["headings", "kickers", "numberedMeta", "siblingGroups"]) {
    if (!Array.isArray(snapshot[key])) throw new Error(`Render snapshot missing array: ${key}`);
  }
  if (!snapshot.cardMetrics || typeof snapshot.cardMetrics !== "object") throw new Error("Render snapshot missing cardMetrics");
  if (!snapshot.radiusMetrics || typeof snapshot.radiusMetrics !== "object") throw new Error("Render snapshot missing radiusMetrics");
  if (!snapshot.iconMetrics || typeof snapshot.iconMetrics !== "object") throw new Error("Render snapshot missing iconMetrics");
  if (!snapshot.shellMetrics || typeof snapshot.shellMetrics !== "object") throw new Error("Render snapshot missing shellMetrics");
  if (!snapshot.marketingMetrics || typeof snapshot.marketingMetrics !== "object") throw new Error("Render snapshot missing marketingMetrics");
  if (!snapshot.surfaceMetrics || typeof snapshot.surfaceMetrics !== "object") throw new Error("Render snapshot missing surfaceMetrics");
  if (!snapshot.cardCompositionMetrics || typeof snapshot.cardCompositionMetrics !== "object") throw new Error("Render snapshot missing cardCompositionMetrics");
  if (!snapshot.rhythmMetrics || typeof snapshot.rhythmMetrics !== "object") throw new Error("Render snapshot missing rhythmMetrics");
}

function loadRenderRules(registry) {
  const rules = new Map();
  for (const rule of registry.renderRules ?? []) rules.set(rule.id, rule);
  return rules;
}

function evidenceHit(rules, id, evidence) {
  const rule = rules.get(id);
  if (!rule) throw new Error(`Missing render rule metadata for ${id}`);
  return {
    id,
    name: rule.name,
    family: rule.family,
    severity: rule.severity,
    weight: Number(rule.weight ?? 0),
    evidenceGrade: rule.evidence?.grade ?? "unknown",
    note: rule.note,
    evidence,
  };
}

function evaluate(snapshot, registry) {
  const rules = loadRenderRules(registry);
  const hits = [];

  const hero = snapshot.surface?.firstBlock;
  if (hero && hero.heightRatio >= 0.8 && hero.centeredHeading === true && hero.kickerCount >= 1 && hero.actionCount >= 1) {
    hits.push(evidenceHit(rules, "G03", {
      heightRatio: hero.heightRatio,
      centeredHeading: true,
      kickerCount: hero.kickerCount,
      actionCount: hero.actionCount,
      headingText: hero.headingText,
    }));
  }

  const equalThree = snapshot.siblingGroups
    .filter((group) => group.count === 3 && group.equalSizeScore >= 0.9 && group.sameStructure === true)
    .sort((a, b) => b.equalSizeScore - a.equalSizeScore)[0];
  if (equalThree) {
    hits.push(evidenceHit(rules, "G04", {
      sectionIndex: equalThree.sectionIndex,
      equalSizeScore: equalThree.equalSizeScore,
      sameStructure: true,
    }));
  }

  if (snapshot.cardMetrics.maxDepth >= 1 && snapshot.cardMetrics.nestedCardCount >= 2) {
    hits.push(evidenceHit(rules, "G05", {
      maxDepth: snapshot.cardMetrics.maxDepth,
      nestedCardCount: snapshot.cardMetrics.nestedCardCount,
      candidateCount: snapshot.cardMetrics.candidateCount,
    }));
  }

  const radius = snapshot.radiusMetrics;
  if (
    radius.cardCount >= 4
    && radius.largeRadiusCardCount >= 4
    && radius.largeRadiusRatio >= 0.65
    && radius.medianCardRadius >= 20
  ) {
    hits.push(evidenceHit(rules, "G31", {
      cardCount: radius.cardCount,
      largeRadiusCardCount: radius.largeRadiusCardCount,
      largeRadiusRatio: radius.largeRadiusRatio,
      medianCardRadius: radius.medianCardRadius,
      sectionCount: radius.sectionCount,
    }));
  }

  const icons = snapshot.iconMetrics;
  if (icons.iconTileCount >= 3) {
    hits.push(evidenceHit(rules, "G64", {
      iconTileCount: icons.iconTileCount,
      sectionCount: icons.iconTileSectionCount,
      smallSvgCount: icons.smallSvgCount,
    }));
  }

  if (
    radius.cardCount >= 5
    && icons.smallSvgCount >= 6
    && icons.iconBearingCardCount >= 4
    && icons.iconBearingCardRatio >= 0.7
  ) {
    hits.push(evidenceHit(rules, "G72", {
      smallSvgCount: icons.smallSvgCount,
      iconBearingCardCount: icons.iconBearingCardCount,
      iconBearingCardRatio: icons.iconBearingCardRatio,
      cardCount: radius.cardCount,
    }));
  }

  const shell = snapshot.shellMetrics;
  const nav = shell.topNav ?? {};
  if (
    nav.present === true
    && nav.plainActionCount >= 4
    && nav.plainActionCount <= 6
    && nav.filledActionCount === 1
    && nav.totalActionCount >= 5
    && nav.totalActionCount <= 7
  ) {
    hits.push(evidenceHit(rules, "G07", {
      plainActionCount: nav.plainActionCount,
      filledActionCount: nav.filledActionCount,
      totalActionCount: nav.totalActionCount,
    }));
  }

  const footer = shell.footer ?? {};
  if (footer.present === true && footer.columnCount >= 3 && footer.columnCount <= 5) {
    hits.push(evidenceHit(rules, "G08", {
      columnCount: footer.columnCount,
    }));
  }

  const actionPairs = shell.defaultActionPairs ?? {};
  if (actionPairs.count >= 2 && actionPairs.sectionCount >= 2) {
    hits.push(evidenceHit(rules, "G65", {
      count: actionPairs.count,
      sectionCount: actionPairs.sectionCount,
    }));
  }

  const marketing = snapshot.marketingMetrics;
  const hasPricingEvidence = marketing.pricingHeadingCount >= 1 || marketing.priceLikeCount >= 2;
  const hasFaqEvidence = marketing.faqHeadingCount >= 1 || marketing.visibleDetailsCount >= 3;
  if (
    marketing.centeredHero === true
    && marketing.repeatedThreeSection === true
    && hasPricingEvidence
    && hasFaqEvidence
    && marketing.closingActionZoneCount >= 1
  ) {
    hits.push(evidenceHit(rules, "G63", {
      centeredHero: true,
      repeatedThreeSection: true,
      pricingHeadingCount: marketing.pricingHeadingCount,
      priceLikeCount: marketing.priceLikeCount,
      faqHeadingCount: marketing.faqHeadingCount,
      visibleDetailsCount: marketing.visibleDetailsCount,
      closingActionZoneCount: marketing.closingActionZoneCount,
    }));
  }

  const surfaces = snapshot.surfaceMetrics;
  if (
    surfaces.cardCount >= 4
    && surfaces.ghostCardCount >= 3
    && surfaces.ghostCardRatio >= 0.5
  ) {
    hits.push(evidenceHit(rules, "G30", {
      cardCount: surfaces.cardCount,
      ghostCardCount: surfaces.ghostCardCount,
      ghostCardRatio: surfaces.ghostCardRatio,
    }));
  }

  const composition = snapshot.cardCompositionMetrics;
  if (
    composition.fullKitchenSinkCardCount >= 1
    || (composition.denseCardCount >= 2 && composition.maxAdornmentKinds >= 4)
  ) {
    hits.push(evidenceHit(rules, "G66", {
      cardCount: composition.cardCount,
      denseCardCount: composition.denseCardCount,
      fullKitchenSinkCardCount: composition.fullKitchenSinkCardCount,
      maxAdornmentKinds: composition.maxAdornmentKinds,
      examples: (composition.cards ?? [])
        .filter((card) => card.facetCount >= 4)
        .slice(0, 3),
    }));
  }

  const rhythm = snapshot.rhythmMetrics;
  if (
    rhythm.sectionCount >= 5
    && rhythm.gapCount >= 4
    && rhythm.dominantGap >= 24
    && rhythm.dominantGapRatio >= 0.75
  ) {
    hits.push(evidenceHit(rules, "G55", {
      sectionCount: rhythm.sectionCount,
      gapCount: rhythm.gapCount,
      dominantGap: rhythm.dominantGap,
      dominantGapCount: rhythm.dominantGapCount,
      dominantGapRatio: rhythm.dominantGapRatio,
      dividerSectionCount: rhythm.dividerSectionCount,
      dividerSectionRatio: rhythm.dividerSectionRatio,
    }));
  }

  const kickerSections = new Set(snapshot.kickers.map((item) => item.sectionIndex).filter((value) => value >= 0));
  if (snapshot.kickers.length >= 3 && kickerSections.size >= 2) {
    hits.push(evidenceHit(rules, "G27", {
      count: snapshot.kickers.length,
      sectionCount: kickerSections.size,
      examples: snapshot.kickers.slice(0, 4).map((item) => item.text),
    }));
  }

  const decorativeNumbers = snapshot.numberedMeta.filter((item) => item.insideOrderedList !== true);
  const numberedSections = new Set(decorativeNumbers.map((item) => item.sectionIndex).filter((value) => value >= 0));
  if (decorativeNumbers.length >= 2 && numberedSections.size >= 2) {
    hits.push(evidenceHit(rules, "G28", {
      count: decorativeNumbers.length,
      sectionCount: numberedSections.size,
      examples: decorativeNumbers.slice(0, 4).map((item) => item.text),
    }));
  }

  const firstViewportHeadings = snapshot.headings
    .filter((heading) => heading.inFirstViewport && heading.fontSize >= 28 && heading.text)
    .sort((a, b) => b.fontSize - a.fontSize);
  if (firstViewportHeadings.length >= 2) {
    const first = firstViewportHeadings[0];
    const second = firstViewportHeadings[1];
    const sizeRatio = second.fontSize / Math.max(first.fontSize, 1);
    if (sizeRatio >= 0.85) {
      hits.push(evidenceHit(rules, "G71", {
        sizeRatio: Math.round(sizeRatio * 100) / 100,
        headings: [first.text, second.text],
        fontSizes: [first.fontSize, second.fontSize],
      }));
    }
  }

  const families = new Map();
  for (const hit of hits) {
    const current = families.get(hit.family);
    if (!current || hit.weight > current.weight) {
      families.set(hit.family, {
        family: hit.family,
        weight: hit.weight,
        ruleIds: [hit.id],
      });
    } else if (!current.ruleIds.includes(hit.id)) {
      current.ruleIds.push(hit.id);
    }
  }
  const familyRows = [...families.values()].sort((a, b) => b.weight - a.weight || a.family.localeCompare(b.family));
  const score = familyRows.reduce((sum, row) => sum + row.weight, 0);
  const minimumIndependentFamilies = Number(registry.clusterPolicy?.minimumIndependentFamilies ?? 3);
  const minimumScore = Number(registry.clusterPolicy?.minimumScore ?? 5);
  const clusterTriggered = familyRows.length >= minimumIndependentFamilies && score >= minimumScore;

  return {
    verdict: hits.length === 0 ? "PASS_RENDER_EVIDENCE" : clusterTriggered ? "REVIEW_RENDER_CLUSTER" : "REVIEW_RENDER",
    hits,
    cluster: {
      independentFamilies: familyRows.length,
      score,
      minimumIndependentFamilies,
      minimumScore,
      families: familyRows,
    },
  };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    const snapshotPath = resolve(args.snapshot);
    if (!existsSync(snapshotPath)) throw new Error(`Snapshot path not found: ${snapshotPath}`);
    const snapshot = readJson(snapshotPath, "Render snapshot");
    validateSnapshot(snapshot);

    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const registryPath = resolve(scriptDir, "../references/slop-signals.json");
    const registry = readJson(registryPath, "Signal registry");
    const result = evaluate(snapshot, registry);

    const summary = {
      snapshot: snapshotPath,
      url: snapshot.url ?? null,
      viewport: snapshot.viewport,
      ...result,
      note: "Rendered structural leads only. Adjudicate against project intent, surface role, screenshots/live render, and anti-slop-gates.md. This tool never infers AI authorship and never emits a blocking HOLD by itself.",
    };

    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      console.log("");
      console.log("design-with-ai render-taste-gate");
      console.log(` snapshot: ${summary.snapshot}`);
      console.log(` viewport: ${summary.viewport.width}x${summary.viewport.height}`);
      console.log(` verdict: ${summary.verdict}`);
      console.log(` cluster: ${summary.cluster.independentFamilies} families / score ${summary.cluster.score}`);
      console.log(` ${summary.note}`);
      console.log("");
      if (!summary.hits.length) console.log("No rendered structural leads.");
      else for (const hit of summary.hits) console.log(`${hit.id} ${hit.name} [${hit.family}] - ${hit.note}`);
    }

    process.exitCode = 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args?.json) process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else console.error(message);
    process.exitCode = 2;
  }
}

main();
