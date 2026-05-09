#!/usr/bin/env python3
# Build a print-ready PDF of docs/company-overview.md.
#
# Pipeline:
#   1. Read the markdown
#   2. Convert to HTML via the `markdown` package (tables, fenced code, toc)
#   3. Wrap in a print-tuned HTML stylesheet (A4, serif body, mono accents)
#   4. Render to PDF via Google Chrome's headless mode
#
# Usage:
#   python3 scripts/build-overview-pdf.py
#
# Output:
#   docs/company-overview.pdf

import os
import shutil
import subprocess
import sys
import tempfile

import markdown


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "company-overview.md")
OUT_PDF = os.path.join(ROOT, "docs", "company-overview.pdf")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


PRINT_CSS = """
@page {
  size: A4;
  margin: 22mm 18mm 22mm 18mm;
  @bottom-center {
    content: "OrcaTrade — Company Overview · v1.0 · 2026-05-09 · Page " counter(page) " of " counter(pages);
    font-family: 'Geist Mono', 'SFMono-Regular', monospace;
    font-size: 8pt;
    color: rgba(0, 0, 0, 0.45);
  }
}
:root {
  --text: #0d0f14;
  --muted: rgba(13, 15, 20, 0.65);
  --rule: rgba(13, 15, 20, 0.12);
  --accent: #0a1628;
  --gold: #b89968;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: 'Cormorant Garamond', 'Cormorant Garant', Georgia, 'Times New Roman', serif;
  font-size: 11pt;
  line-height: 1.55;
  color: var(--text);
  background: #fff;
}
.cover {
  page-break-after: always;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  padding: 0;
}
.cover .kicker {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 9pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 1.2rem;
}
.cover h1 {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 42pt;
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin: 0 0 1rem;
  max-width: 22ch;
}
.cover .lede {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 14pt;
  line-height: 1.5;
  font-style: italic;
  color: rgba(13, 15, 20, 0.78);
  max-width: 50ch;
  margin: 0 0 2.4rem;
}
.cover .meta {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 9pt;
  letter-spacing: 0.04em;
  color: var(--muted);
  border-top: 1px solid var(--rule);
  padding-top: 1rem;
  width: 100%;
}
.cover .meta div { margin: 0.18rem 0; }
.cover .footer-line {
  margin-top: auto;
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 8.5pt;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

h1, h2, h3, h4 {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  page-break-after: avoid;
}
h1 { font-size: 22pt; line-height: 1.15; margin: 1.4rem 0 0.6rem; }
h2 { font-size: 18pt; line-height: 1.2; margin: 1.6rem 0 0.5rem; padding-bottom: 0.35rem; border-bottom: 1px solid var(--rule); }
h3 { font-size: 13pt; line-height: 1.25; margin: 1.1rem 0 0.4rem; color: var(--accent); }
h4 { font-size: 11.5pt; margin: 0.9rem 0 0.3rem; }

p { margin: 0 0 0.7rem; }
p, li { orphans: 3; widows: 3; }

a { color: var(--accent); text-decoration: none; border-bottom: 1px solid rgba(10, 22, 40, 0.18); }

ul, ol { margin: 0 0 0.9rem 1.3rem; padding: 0; }
li { margin: 0.25rem 0; }
li > strong:first-child { color: var(--accent); }

blockquote {
  margin: 0.8rem 0;
  padding: 0.6rem 1rem;
  border-left: 3px solid var(--gold);
  background: rgba(184, 153, 104, 0.05);
  font-style: italic;
  color: rgba(13, 15, 20, 0.85);
}
blockquote p { margin: 0; }

hr {
  border: none;
  border-top: 1px solid var(--rule);
  margin: 1.4rem 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.7rem 0 1rem;
  font-size: 9.8pt;
  page-break-inside: avoid;
}
th, td {
  text-align: left;
  vertical-align: top;
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--rule);
}
th {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 8pt;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 600;
  border-bottom: 1.5px solid var(--accent);
}
tbody tr:nth-child(even) { background: rgba(13, 15, 20, 0.025); }

code {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 9.5pt;
  background: rgba(13, 15, 20, 0.05);
  padding: 0.05rem 0.3rem;
  border-radius: 2px;
}
pre {
  font-family: 'Geist Mono', 'SFMono-Regular', monospace;
  font-size: 9pt;
  background: rgba(13, 15, 20, 0.04);
  padding: 0.7rem 0.9rem;
  border-left: 2px solid var(--rule);
  overflow-x: hidden;
  page-break-inside: avoid;
}

/* Section starts on a new page only after the cover. */
h2 { page-break-before: auto; }

/* The closing italic sign-off block. */
em + em, p > em:only-child { color: var(--muted); font-size: 9.5pt; }
"""


COVER_HTML = """
<section class="cover">
  <div class="kicker">OrcaTrade Holding · Company Overview</div>
  <h1>The operating system for European SMEs importing from Asia.</h1>
  <p class="lede">Find it · Verify it · Ship it · Finance it — one platform, Asia to Europe.</p>
  <div class="meta">
    <div><strong>Document version</strong> — v1.0</div>
    <div><strong>Date</strong> — 2026-05-09</div>
    <div><strong>Author</strong> — Oskar Klepuszewski, Co-Founder &amp; CFO</div>
    <div><strong>Headquarters</strong> — Warsaw, Poland</div>
    <div><strong>Operating presence</strong> — Warsaw · London · Hong Kong</div>
    <div><strong>Stage</strong> — Pre-revenue · platform feature-complete · GTM commencing 2026</div>
  </div>
  <div class="footer-line">Confidential · Prepared for partner, investor, and press circulation</div>
</section>
"""


def main():
    if not os.path.exists(SRC):
        sys.exit(f"missing {SRC}")
    if not os.path.exists(CHROME):
        sys.exit(f"Chrome not found at {CHROME}")

    md_text = open(SRC, encoding="utf-8").read()

    # Skip the first markdown table on the page — we render that on the cover.
    # Find first '---' after the opening header table and start from there.
    body_md = md_text
    rule_idx = body_md.find("\n---\n")
    if rule_idx > 0:
        # Strip the title + intro metadata table; the cover replaces it.
        body_md = body_md[rule_idx + len("\n---\n"):]

    body_html = markdown.markdown(
        body_md,
        extensions=["tables", "fenced_code", "sane_lists", "toc"],
    )

    full_html = (
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"/>"
        "<title>OrcaTrade — Company Overview</title>"
        "<style>" + PRINT_CSS + "</style></head><body>"
        + COVER_HTML
        + body_html
        + "</body></html>"
    )

    with tempfile.TemporaryDirectory() as tmp:
        html_path = os.path.join(tmp, "overview.html")
        open(html_path, "w", encoding="utf-8").write(full_html)
        # Chrome headless takes a file:// URL and writes a PDF.
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
