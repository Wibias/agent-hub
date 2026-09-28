#!/usr/bin/env node
import { TAXONOMY, parseArgs } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const today = new Date().toISOString().slice(0, 10);
const surfaceFamily = args.surface || "public-home";
const primaryStratum = args.stratum || "direct-domain";
const platform = args.platform || "web-responsive";
if (!(surfaceFamily in TAXONOMY.surfaceFamilies)) {
  throw new Error("Unknown --surface: " + surfaceFamily);
}
if (!(primaryStratum in TAXONOMY.primaryStrata)) {
  throw new Error("Unknown --stratum: " + primaryStratum);
}
if (!(platform in TAXONOMY.platformTargets)) {
  throw new Error("Unknown --platform: " + platform);
}
const record = {
  id: "ref-replace-with-stable-slug",
  title: "",
  canonicalUrl: "https://example.com/",
  product: "",
  surfaceFamily,
  primaryStratum,
  platform,
  flowStates: ["initial"],
  evidenceClass: "OBSERVED",
  accessStatus: "AVAILABLE",
  accessMethod: "public-web",
  storagePolicy: "text-link-only",
  pageRole: "",
  firstScreenJob: "",
  topology: "",
  traversal: "",
  density: "medium",
  responsiveBehavior: "",
  motion: "none observed",
  visualWorld: "",
  strengths: [""],
  weaknesses: [""],
  transferableDecisions: [""],
  tags: ["replace", "these", "tags"],
  sourceFamily: "",
  sourceKind: "underlying-product",
  observedAt: today,
  lastVerifiedAt: today,
  ttlDays: 90,
  reviewStatus: "candidate",
  researchedBy: args.researcher || "replace-researcher",
  reviewedBy: null,
  reviewedAt: null,
  rightsNote: "Text and link only; no committed third-party media.",
  provenanceNote: "",
  ordinaryOrFailureProne: false,
  multiStateFlow: false,
  replacementFor: null,
};
console.log(JSON.stringify(record));
