# Prompt Injection Detection Reference

> Source: mukul975/Anthropic-Cybersecurity-Skills (https://github.com/mukul975/Anthropic-Cybersecurity-Skills), Apache-2.0 License. Adapted 2026-07-10.

> **AUTHORIZED USE ONLY.** Run scanning only on data you are authorized to process. Treat extracted payloads as live untrusted input.

Drawn from: detecting-indirect-prompt-injection, securing-agentic-ai-tool-invocation

## Threat: Indirect Prompt Injection (AML.T0051.001, OWASP LLM01)

An agent ingests external content (web page, PDF, email, image, tool result) containing hidden instructions. The model treats all tokens in its context window as equally authoritative, so the attacker's instructions execute.

Hiding surfaces:
- Web pages: HTML comments, `display:none`, alt-text
- PDFs: white/tiny font, off-page text
- Images: rendered pixels (OCR-readable), EXIF, alt-text
- Any text: zero-width / Unicode-tag characters, Base64, ROT13

## Prerequisites

```bash
python -m venv .venv && source .venv/bin/activate

pip install llm-guard transformers torch
pip install beautifulsoup4 pypdf pillow pytesseract
# Tesseract: apt-get install -y tesseract-ocr  OR  brew install tesseract  OR  choco install tesseract
```

Access (gated): `meta-llama/Llama-Prompt-Guard-2-86M`, or use open `protectai/deberta-v3-base-prompt-injection-v2`.

## Step 1: Extract Hidden Text

```python
# extract_html.py
from bs4 import BeautifulSoup, Comment

def extract_hidden(html: str):
    soup = BeautifulSoup(html, "html.parser")
    hidden = []
    for c in soup.find_all(string=lambda t: isinstance(t, Comment)):
        hidden.append(("comment", c.strip()))
    for el in soup.select('[style*="display:none"],[style*="visibility:hidden"],[hidden]'):
        hidden.append(("css-hidden", el.get_text(strip=True)))
    for img in soup.find_all("img"):
        if img.get("alt"):
            hidden.append(("alt-text", img["alt"]))
    return [h for h in hidden if h[1]]
```

## Step 2: Normalize and De-Obfuscate

```python
# normalize.py
import base64, codecs, re, unicodedata

ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff"), None)
TAG_RANGE = range(0xE0000, 0xE0080)

def normalize(text: str) -> str:
    text = text.translate(ZERO_WIDTH)
    text = "".join(ch for ch in text if ord(ch) not in TAG_RANGE)
    text = unicodedata.normalize("NFKC", text)
    for token in re.findall(r"[A-Za-z0-9+/=]{20,}", text):
        try:
            decoded = base64.b64decode(token).decode("utf-8", "ignore")
            if decoded.isprintable():
                text += f"\n[decoded-b64] {decoded}"
        except Exception:
            pass
    text += "\n[decoded-rot13] " + codecs.decode(text, "rot_13")
    return text
```

## Step 3: Scan with LLM Guard

```python
from llm_guard.input_scanners import PromptInjection
from llm_guard.input_scanners.prompt_injection import MatchType

scanner = PromptInjection(threshold=0.5, match_type=MatchType.FULL)

def scan(text: str):
    sanitized, is_valid, risk = scanner.scan(text)
    return {"is_valid": is_valid, "risk": risk}  # is_valid=False => injection detected
```

## Step 4: Add a Dedicated Detector Model

```python
from transformers import pipeline

# Open classifier (no gating)
clf = pipeline("text-classification",
               model="protectai/deberta-v3-base-prompt-injection-v2")

def is_injection(text: str, threshold: float = 0.5) -> bool:
    out = clf(text[:512])[0]
    return out["label"].upper() == "INJECTION" and out["score"] >= threshold
```

## Step 5: OCR Images

```python
from PIL import Image
import pytesseract

def ocr(path: str) -> str:
    return pytesseract.image_to_string(Image.open(path))
# Feed ocr(path) through normalize() -> scan() -> is_injection()
```

## Step 6: Enforce Decision and Emit Telemetry

```python
import json, hashlib
from datetime import datetime, timezone

def decide(source, raw, normalized, llmguard_invalid, model_flag):
    flagged = llmguard_invalid or model_flag
    event = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "sha256": hashlib.sha256(raw.encode("utf-8", "ignore")).hexdigest(),
        "atlas": "AML.T0051.001",
        "llmguard_injection": llmguard_invalid,
        "model_injection": model_flag,
        "decision": "block" if flagged else "allow",
    }
    print(json.dumps(event))
    return event["decision"]
```

## Validation Criteria

- [ ] Hidden-text extraction implemented for HTML, PDF, and images
- [ ] Normalization strips zero-width/Unicode-tag chars and decodes Base64/ROT13
- [ ] LLM Guard PromptInjection scanner integrated
- [ ] Dedicated detector model (Prompt Guard 2 or deberta) integrated as a second signal
- [ ] OCR path scans text rendered inside images
- [ ] Block/sanitize/allow decision enforced before model ingestion
- [ ] Structured detection telemetry emitted for SIEM with ATLAS mapping
- [ ] Pipeline validated on a labeled corpus with precision/recall measured
