// Conservative source context for high-noise contextual design rules.
// These filters must never change mechanically decisive P0/hard gates.
import { extname } from "node:path";

function stripComments(line, state) {
  let code = "";
  let quote = null;
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
      else if (char === quote) quote = null;
      continue;
    }
    if (line.slice(i, i + 4) === "<!--") { state.html = true; i += 3; continue; }
    if (char === "/" && next === "*") { state.block = true; i++; continue; }
    if (char === "/" && next === "/") break;
    if (char === "'" || char === '"' || char === "\x60") quote = char;
    code += char;
  }
  return code;
}

const ENTRY = /(?:^|[^a-z])(?:enter|entry|intro|appear|reveal|mount|fade[-_]?in|slide[-_]?in|animate[-_]?in)(?:[^a-z]|$)/i;

export function sourceRuleContexts(lines, path) {
  const css = [".css", ".scss"].includes(extname(path).toLowerCase());
  const comments = { block: false, html: false };
  const blocks = [];
  let functionalTag = false;
  const result = [];
  for (const original of lines) {
    const code = stripComments(original, comments);
    if (!css && /<\s*(?:input|textarea)\b/i.test(code)) functionalTag = true;
    const current = blocks.join(" ");
    const opened = [];
    let piece = "";
    if (css) {
      for (const char of code) {
        if (char === "{") {
          const selector = piece.trim();
          blocks.push(selector);
          opened.push(selector);
          piece = "";
        } else if (char === "}") {
          blocks.pop();
          piece = "";
        } else {
          piece += char;
        }
      }
    }
    const selectorContext = [current, ...opened].join(" ");
    result.push({
      code,
      css,
      functionalControl: functionalTag,
      hover: /:hover\b/i.test(selectorContext) || /:hover\b/i.test(code),
      keyframes: /@(?:-webkit-)?keyframes\b/i.test(selectorContext),
      entrance: ENTRY.test(selectorContext + " " + code),
    });
    if (!css && functionalTag && code.includes(">")) functionalTag = false;
  }
  return result;
}

export function contextualRuleMatches(rule, context) {
  if (rule.hardGate === true || !["G27", "G29", "G32", "G34"].includes(rule.id)) return true;
  const { code, css, functionalControl, hover, keyframes, entrance } = context;
  if (!code.trim()) return false;
  switch (rule.id) {
    case "G27":
      return !functionalControl && !(css && /(?:^|[\s,{])(?:input|textarea)\b/i.test(code));
    case "G29": {
      // Numeric ranges and isolated missing-value placeholders are not UI prose.
      const meaningful = code.replace(/\d+\s*[–—]\s*\d+/g, "")
        .replace(/(["'\x60])[–—]\1/g, "");
      return /[–—]/.test(meaningful);
    }
    case "G32":
      return /hover:scale-105/i.test(code) || (hover && /scale\s*\(\s*1\.05\s*\)/i.test(code));
    case "G34":
      // Only recognizable entrances qualify; infinite ambient and toy motion do not.
      return !keyframes && !/\binfinite\b/i.test(code) && entrance;
    default:
      return true;
  }
}
