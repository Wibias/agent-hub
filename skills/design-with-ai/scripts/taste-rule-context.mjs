// Bounded lexical context for contextual design signals; never replaces a language parser.
// Hard gates use original source lines so this heuristic cannot suppress a P0.
import { extname } from "node:path";
const CSS_FILES = new Set([".css", ".scss"]);
const EMBEDDED_STYLE_FILES = new Set([".html", ".htm", ".vue", ".svelte"]);
const ENTRY = /(?:^|[^a-z])(?:enter|entry|intro|appear|reveal|mount|fade[-_]?in|slide[-_]?in|animate[-_]?in)(?:[^a-z]|$)/i;

function stripComments(line, state) {
  let code = "";
  let quote = state.template ? "\x60" : null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i], next = line[i + 1];
    if (state.block) {
      if (char === "*" && next === "/") { state.block = false; i++; }
      continue;
    }
    if (state.html) {
      if (line.slice(i, i + 3) === "-->") { state.html = false; i += 2; }
      continue;
    }
    if (quote) {
      code += char;
      if (char === "\\") { if (next) code += line[++i]; }
      else if (char === quote) {
        if (quote === "\x60") state.template = false;
        quote = null;
      }
      continue;
    }
    if (line.slice(i, i + 4) === "<!--") { state.html = true; i += 3; continue; }
    if (char === "/" && next === "*") { state.block = true; i++; continue; }
    // Never treat a live JSX // text or unquoted http:// URL as a comment.
    if (char === "/" && next === "/" && !code.trim()) break;
    if (char === "'" || char === '"' || char === "\x60") {
      quote = char;
      if (char === "\x60") state.template = true;
    }
    code += char;
  }
  return code;
}

function withoutControlTags(source, state) {
  let result = "", offset = 0;
  while (offset < source.length) {
    if (state.control) {
      const end = source.indexOf(">", offset);
      if (end < 0) return result;
      state.control = false;
      offset = end + 1;
      continue;
    }
    const next = /<\s*(?:input|textarea)\b/i.exec(source.slice(offset));
    if (!next) return result + source.slice(offset);
    result += source.slice(offset, offset + next.index);
    offset += next.index;
    state.control = true;
  }
  return result;
}

function cssSegment(text, blocks) {
  const selectors = blocks.map((b) => b.selector).join(" ");
  return {
    code: text,
    hover: /:hover\b/i.test(selectors) || /:hover\b/i.test(text),
    keyframes: /@(?:-webkit-)?keyframes\b/i.test(selectors),
    entrance: ENTRY.test(selectors + " " + text),
    functionalControl: /(?:^|[\s,{])(?:input|textarea)\b/i.test(selectors),
    blockRefs: blocks.slice(),
  };
}

function cssLine(source, state) {
  const segments = [];
  let current = "", quote = state.cssQuote;
  function emit() {
    if (!current.trim()) { current = ""; return; }
    const seg = cssSegment(current, state.blocks);
    if (/\banimation(?:-iteration-count)?\s*:[^;]*\binfinite\b/i.test(current)) {
      const owner = state.blocks.at(-1);
      if (owner) owner.infinite = true;
    }
    segments.push(seg);
    current = "";
  }
  for (let i = 0; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (quote) {
      current += ch;
      if (ch === "\\") { if (next) current += source[++i]; }
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === "{") {
      const selector = (state.pending + current).trim();
      state.blocks.push({ selector, infinite: false });
      state.pending = "";
      current = "";
      continue;
    }
    if (ch === "}") {
      emit();
      state.blocks.pop();
      state.pending = "";
      continue;
    }
    if (ch === ";") {
      current += ch;
      emit();
      continue;
    }
    current += ch;
  }
  state.cssQuote = quote;
  if (current.trim()) {
    if (state.blocks.length) emit();
    else state.pending += current + " ";
  }
  return segments;
}

export function sourceRuleContexts(lines, path) {
  const extension = extname(path).toLowerCase();
  const onlyCss = CSS_FILES.has(extension);
  const mayEmbedStyle = EMBEDDED_STYLE_FILES.has(extension);
  const state = {
    block: false, html: false, template: false, control: false,
    inStyle: false, cssQuote: null, pending: "", blocks: [],
  };
  const result = [];
  for (const original of lines) {
    const code = stripComments(original, state);
    const startsStyle = mayEmbedStyle && /<style\b[^>]*>/i.test(code);
    if (startsStyle) state.inStyle = true;
    const css = onlyCss || state.inStyle;
    const cssSource = css ? code.replace(/<style\b[^>]*>/ig, "").split(/<\/style\s*>/i)[0] : "";
    const segments = css ? cssLine(cssSource, state) :
      [{ code: withoutControlTags(code, state), functionalControl: false,
         hover: false, keyframes: false, entrance: ENTRY.test(code), blockRefs: [] }];
    result.push({
      code, css, segments,
      functionalControl: segments.length && segments.every((x) => x.functionalControl) ? true : false,
      hover: segments.some((x) => x.hover),
      keyframes: segments.some((x) => x.keyframes),
      entrance: segments.some((x) => x.entrance),
    });
    if (state.inStyle && /<\/style\s*>/i.test(code)) {
      state.inStyle = false;
      state.cssQuote = null;
      state.pending = "";
      state.blocks = [];
    }
  }
  return result;
}

export function contextualRuleMatches(rule, context) {
  if (rule.hardGate === true || !["G27", "G29", "G32", "G34"].includes(rule.id)) return true;
  if (Array.isArray(context.segments)) {
    const segments = context.segments.length ? context.segments : [context];
    return segments.some((s) => contextualRuleMatches(rule, s));
  }
  const { code, functionalControl, hover, keyframes, entrance } = context;
  if (!code?.trim()) return false;
  switch (rule.id) {
    case "G27":
      return !functionalControl;
    case "G29": {
      const text = code.replace(/\d+\s*[–—]\s*\d+/g, "")
        .replace(/(["'\x60])[–—]\1/g, "");
      // A dash alone in a table cell is an empty-value placeholder.
      if (/^<\s*(?:td|th|span)[^>]*>\s*[–—]\s*<\//i.test(text)) return false;
      return /[–—]/.test(text);
    }
    case "G32":
      return /hover:scale-105/i.test(code) || (hover && /scale\s*\(\s*1\.05\s*\)/i.test(code));
    case "G34":
      return !keyframes && !/\binfinite\b/i.test(code) &&
        !(context.blockRefs ?? []).some((block) => block.infinite) && entrance;
    default:
      return true;
  }
}
