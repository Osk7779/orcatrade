#!/usr/bin/env python3
# Build a print-ready PDF of the OrcaTrade Founder Term Sheet.
#
# Output: docs/founder-term-sheet.pdf
#
# Design language:
#   - Cover page: Deep Navy (#0a1628) background, logo, brand-gold rule, title
#     stack, and confidentiality footer
#   - Body pages: Ivory (#f5efe2) background, Deep Navy headings, Brand Gold
#     accents on dividers + small-caps, monospace numbering for section refs
#   - "Solicitor note" callouts get a distinct Ivory-on-Navy block for visibility
#
# Brand colours sourced from docs/brand-kit/02-colour.md.

import base64
import os
import subprocess
import sys
import tempfile

import markdown


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "founder-term-sheet.md")
LOGO = os.path.join(ROOT, "orcatrade_logo.png")
OUT_PDF = os.path.join(ROOT, "docs", "founder-term-sheet.pdf")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def encoded_logo():
    """Base64-encode the logo so the cover renders without a file:// roundtrip."""
    with open(LOGO, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return f"data:image/png;base64,{b64}"


PRINT_CSS = """
@page {
  size: A4;
  margin: 24mm 20mm 22mm 20mm;
  @top-right {
    content: "OrcaTrade Holding Ltd · Founder Term Sheet · v1.0";
    font-family: 'Geist Mono', 'SFMono-Regular', monospace;
    font-size: 7.5pt;
    letter-spacing: 0.06em;
    color: rgba(10, 22, 40, 0.45);
  }
  @bottom-center {
    content: "Page " counter(page) " of " counter(pages);
    font-family: 'Geist Mono', 'SFMono-Regular', monospace;
    font-size: 8pt;
    letter-spacing: 0.08em;
    color: rgba(10, 22, 40, 0.45);
  }
  @bottom-right {
    content: "STRICTLY CONFIDENTIAL";
    font-family: 'Geist Mono', 'SFMono-Regular', monospace;
    font-size: 7.5pt;
    letter-spacing: 0.18em;
    color: rgba(184, 153, 104, 0.85);
  }
}
@page :first {
  margin: 0;
  @top-right { content: ""; }
  @bottom-center { content: ""; }
  @bottom-right { content: ""; }
}

:root {
  --navy: #0a1628;
  --navy-mid: #0f2540;
  --ivory: #f5efe2;
  --gold: #c8a85a;
  --gold-light: #d4b97a;
  --text: #0d1119;
  --muted: rgba(10, 22, 40, 0.62);
  --rule: rgba(10, 22, 40, 0.12);
  --rule-strong: rgba(10, 22, 40, 0.28);
}

* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: 'Cormorant Garamond', 'Cormorant Garant', Georgia, 'Times New Roman', serif;
  font-size: 10.5pt;
  line-height: 1.55;
  color: var(--text);
  background: var(--ivory);
}

/* ─── COVER ──────────────────────────────────────────────────────────── */

.cover {
  page-break-after: always;
  width: 210mm;
  height: 297mm;
  background: var(--navy);
  color: var(--ivory);
  padding: 28mm 20mm;
  display: flex;
  flex-direction: column;
  position: relative;
}
.cover::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; height: 8mm;
  background: var(--gold);
}
.cover .logo {
  width: 30mm;
  height: 30mm;
  filter: brightness(1.08);
  margin-bottom: 8mm;
}
.cover .pre-title {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 9pt;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 6mm;
}
.cover h1 {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-weight: 600;
  font-size: 38pt;
  line-height: 1.06;
  letter-spacing: -0.01em;
  color: var(--ivory);
  margin: 0 0 8mm;
  max-width: 22ch;
}
.cover .subtitle {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-style: italic;
  font-size: 14pt;
  line-height: 1.45;
  color: rgba(245, 239, 226, 0.78);
  max-width: 50ch;
  margin: 0 0 14mm;
}
.cover .gold-rule {
  width: 28mm;
  height: 1.5pt;
  background: var(--gold);
  margin: 0 0 8mm;
}
.cover .meta {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 9pt;
  letter-spacing: 0.04em;
  line-height: 1.85;
  color: rgba(245, 239, 226, 0.78);
}
.cover .meta strong {
  color: var(--gold-light);
  font-weight: 600;
  display: inline-block;
  min-width: 38mm;
}
.cover .footer {
  margin-top: auto;
  border-top: 1px solid rgba(200, 168, 90, 0.4);
  padding-top: 6mm;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.cover .footer .left {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 8pt;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--gold);
}
.cover .footer .right {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-style: italic;
  font-size: 10pt;
  color: rgba(245, 239, 226, 0.7);
}

/* ─── BODY ───────────────────────────────────────────────────────────── */

.body {
  padding: 0;
}

h1 {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 22pt;
  font-weight: 600;
  color: var(--navy);
  letter-spacing: -0.01em;
  margin: 0 0 4mm;
  padding-bottom: 4mm;
  border-bottom: 1.5pt solid var(--gold);
  page-break-after: avoid;
}
h2 {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 15pt;
  font-weight: 600;
  color: var(--navy);
  letter-spacing: -0.005em;
  margin: 8mm 0 3mm;
  padding-bottom: 1.5mm;
  border-bottom: 0.5pt solid var(--rule-strong);
  page-break-after: avoid;
}
h3 {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 12pt;
  font-weight: 600;
  color: var(--navy-mid);
  margin: 5mm 0 2mm;
  page-break-after: avoid;
}
h4 {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 8.5pt;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--gold);
  font-weight: 700;
  margin: 4mm 0 2mm;
  page-break-after: avoid;
}

p {
  margin: 0 0 3mm;
  text-align: justify;
  hyphens: auto;
  orphans: 3;
  widows: 3;
}
p, li { font-size: 10.5pt; }

a {
  color: var(--navy);
  text-decoration: none;
  border-bottom: 0.5pt solid var(--gold);
}

ul, ol {
  margin: 0 0 4mm 7mm;
  padding: 0;
}
li { margin: 1mm 0; line-height: 1.5; }
ul li::marker { color: var(--gold); }

strong { color: var(--navy); font-weight: 600; }
em { font-style: italic; color: rgba(13, 17, 25, 0.85); }

hr {
  border: none;
  border-top: 0.5pt solid var(--rule);
  margin: 6mm 0;
}

/* ─── TABLES ─────────────────────────────────────────────────────────── */

table {
  width: 100%;
  border-collapse: collapse;
  margin: 3mm 0 5mm;
  font-size: 9.5pt;
  page-break-inside: avoid;
}
th, td {
  text-align: left;
  vertical-align: top;
  padding: 2mm 2.5mm;
  border-bottom: 0.5pt solid var(--rule);
}
thead th {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 8pt;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--navy);
  font-weight: 700;
  border-bottom: 1pt solid var(--navy);
  background: rgba(10, 22, 40, 0.04);
}
tbody tr:nth-child(even) td { background: rgba(10, 22, 40, 0.025); }

/* The first table on a page (header data + signature table) gets no header
   row stripe — handled inline above. */

/* ─── BLOCKQUOTE — used for Solicitor notes ──────────────────────────── */

blockquote {
  margin: 4mm 0;
  padding: 3mm 5mm 3mm 7mm;
  background: var(--navy);
  color: var(--ivory);
  border-left: 2pt solid var(--gold);
  page-break-inside: avoid;
  font-size: 9.5pt;
  line-height: 1.5;
}
blockquote p { margin: 0 0 1.5mm; color: var(--ivory); text-align: left; }
blockquote p:last-child { margin: 0; }
blockquote strong {
  color: var(--gold-light);
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 8.5pt;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
}

/* ─── CODE ───────────────────────────────────────────────────────────── */

code {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 9.5pt;
  background: rgba(10, 22, 40, 0.06);
  padding: 0.3mm 1.2mm;
  border-radius: 1pt;
  color: var(--navy-mid);
}

/* ─── SIGNATURE BLOCKS ───────────────────────────────────────────────── */

/* The execution block uses --- separators in markdown. We'll catch the
   bold-only paragraphs (founder names) and style them. */
.body p strong:only-child {
  display: inline-block;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 13pt;
  letter-spacing: 0.06em;
  color: var(--navy);
  text-transform: uppercase;
  margin-top: 3mm;
}

/* Closing italic disclaimer */
.body > p:last-of-type em {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 8.5pt;
  letter-spacing: 0.04em;
  text-transform: none;
  font-style: normal;
  color: var(--muted);
}
"""


def cover_html(logo_data_uri):
    return f"""
<section class="cover">
  <img class="logo" src="{logo_data_uri}" alt="OrcaTrade" />
  <div class="pre-title">Founder Term Sheet</div>
  <h1>The principal terms of OrcaTrade Holding Ltd.</h1>
  <p class="subtitle">A non-binding deal summary among the founders, forming the basis of the definitive Shareholders' Agreement and Articles of Association.</p>
  <div class="gold-rule"></div>
  <div class="meta">
    <div><strong>Company</strong> OrcaTrade Holding Ltd <span style="color: rgba(245,239,226,0.5); font-size:8pt">(to be incorporated)</span></div>
    <div><strong>Jurisdiction</strong> England and Wales</div>
    <div><strong>Founders</strong> Oskar Klepuszewski · Arman Sirin · Nigel Lam</div>
    <div><strong>Document</strong> Version 1.0</div>
    <div><strong>Date</strong> 2026-05-11</div>
    <div><strong>Status</strong> Non-binding; subject to definitive documents</div>
  </div>
  <div class="footer">
    <div class="left">Strictly confidential</div>
    <div class="right">Prepared for circulation among the named Founders only</div>
  </div>
</section>
"""


def main():
    if not os.path.exists(SRC):
        sys.exit(f"missing {SRC}")
    if not os.path.exists(LOGO):
        sys.exit(f"missing logo at {LOGO}")
    if not os.path.exists(CHROME):
        sys.exit(f"Chrome not found at {CHROME}")

    md_text = open(SRC, encoding="utf-8").read()

    # Strip the leading header table — we render the same content on the cover.
    rule_idx = md_text.find("\n---\n")
    if rule_idx > 0:
        md_text = md_text[rule_idx + len("\n---\n"):]

    body_html = markdown.markdown(
        md_text,
        extensions=["tables", "fenced_code", "sane_lists", "toc", "smarty"],
    )

    logo_uri = encoded_logo()

    full_html = (
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"/>"
        "<title>OrcaTrade Holding Ltd — Founder Term Sheet</title>"
        f"<style>{PRINT_CSS}</style></head><body>"
        + cover_html(logo_uri)
        + f"<div class=\"body\">{body_html}</div>"
        + "</body></html>"
    )

    with tempfile.TemporaryDirectory() as tmp:
        html_path = os.path.join(tmp, "term-sheet.html")
        open(html_path, "w", encoding="utf-8").write(full_html)
        subprocess.run(
            [
                CHROME,
                "--headless=new",
                "--disable-gpu",
                "--no-pdf-header-footer",
                f"--print-to-pdf={OUT_PDF}",
                "file://" + html_path,
            ],
            check=True,
        )

    if not os.path.exists(OUT_PDF):
        sys.exit("Chrome did not produce a PDF")

    size_kb = os.path.getsize(OUT_PDF) // 1024
    print(f"OK — wrote {OUT_PDF} ({size_kb} KB)")


if __name__ == "__main__":
    main()
