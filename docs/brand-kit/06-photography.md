# 06 · Photography

The visual layer of OrcaTrade is dark, atmospheric, and grounded in physical infrastructure. Container terminals, factory floors, customs checkpoints, the HK office — not stock-photo headsets and handshakes.

## Direction

Three styles co-exist on the brand:

### 1. Infrastructure — wide, atmospheric, dawn/dusk

Container terminals (Rotterdam, Hamburg, Gdańsk, Małaszewicze), rail corridors at dusk, freighters in port, warehouse interiors with stacked pallets. Shot wide, deep colour grade leaning navy / steel grey. The aurora background on the live site is the digital echo of this aesthetic.

**Best for:** hero sections, blog covers, deck title slides, ad creative for "infrastructure" / "corridor" / "freight" topics.

### 2. Operations — tight, human, inside the work

The HK office in mid-shift, a forwarder operations room, a customs broker reviewing documents, a factory QC inspector with a clipboard, a warehouse loader. Shot tight (50–85mm), warm overhead light, real people not posed.

**Best for:** about pages, founder-voice content, case studies, LinkedIn carousels about "the operation behind the platform".

### 3. Product / interface

Screenshots of the agent suite, the calculator UIs, the dashboard. Cropped tight to a single feature. Dark UI on a dark page background = high coherence.

**Best for:** product launch posts, feature explainers, the documentation site.

## Approved sources

The brand kit currently has these starting assets in [`/assets/`](../../assets/):

| File | What it is | Approved use |
|------|------------|--------------|
| `assets/hero-bg.mp4` | Atmospheric hero video loop | Homepage hero only — do not reuse on other pages without re-grade |
| `assets/orcatrade-overview-2.mp4` | Trade-overview montage | Mid-page video element |
| `assets/PHOTO-2026-03-19-17-53-41.jpg` | Jay Xie portrait (CEO) | Leadership pages, "About" |
| `assets/dd0ec64c-9768-447b-89d8-8b6899e61ccd.png` | Yiu Cheung portrait | Leadership pages |
| `assets/orcatrade_logo.png` | Brand logo | All branded surfaces |

### Gaps to commission

- [ ] Container terminal at dusk — wide, navy-grade, 3000+ px wide
- [ ] HK office interior — operator at desk, monitors visible
- [ ] Factory floor — QC inspector with clipboard, anonymised
- [ ] Małaszewicze rail terminus — train + container yard
- [ ] Customs checkpoint — paperwork close-up
- [ ] EU 3PL warehouse — pallet stacks, racks, forklift in motion
- [ ] Founder portraits (Oskar, Jay, Arman, Yiu — current set is partial)

## Framing rules

- **Aspect ratios on the site:** 16:9 hero, 4:3 secondary, 1:1 portrait, 21:9 panoramic for full-bleed banners.
- **Aspect ratios on social:** 1:1 (LinkedIn / Meta feed), 4:5 (Meta / Instagram tall feed), 9:16 (Stories / Reels), 16:9 (LinkedIn article hero, Twitter / X).
- **Image weight:** under 200 KB per JPG asset. Use WebP where possible. Compress before commit.

## Treatment

- Apply a slight navy tint (10–15% opacity `#0a1628` overlay) to harmonise photography with the site palette.
- Avoid heavy filters / Instagram-style colour grading. Restraint over style.
- For product UI screenshots: use a 1px `--line` border (`rgba(255,255,255,0.09)`) and 8px outer glow `rgba(184,190,200,0.16)` (the `--glow` token) — this matches the live cards.

## Do

- Choose images with depth — leading lines (rails, docks, corridors), atmospheric weather, low-angle perspectives that make scale visible.
- Anonymise faces in factory and warehouse imagery unless the subject has signed a release.
- Caption every photograph in long-form content. The reader earns context.

## Don't

- Use generic stock photography (Shutterstock business-people, isolated isometric icons, "globe-with-dotted-connections").
- Use AI-generated photography of people. The brand is grounded in physical credibility — synthetic people break the spell.
- Crop the OrcaTrade logo into a photo — keep the logo on its own panel.
- Mix photography styles within a single piece. A blog post is either Infrastructure mood, Operations mood, or Product UI — never two on one page.

## Asset commissioning workflow

1. #6 (Brand Director) drafts a shot list.
2. Forward to HK office for on-the-ground captures (low cost, fast turnaround) where applicable.
3. For EU-side shots, use a freelance photographer from a vetted shortlist (kept in [10-assets.md](10-assets.md)).
4. Every asset goes through a colour grade and metadata pass before being added to `assets/`.
5. Asset registry entry in [10-assets.md](10-assets.md) — license, photographer, date, approved use.

---

**Section version:** 1.0 · 2026-05-08
