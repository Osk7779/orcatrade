# 10 · Asset registry

Every approved photo, video, illustration, and logo file the brand uses. The Brand & Creative Director (#6) maintains this; everyone else reads.

If an asset isn't in this registry, **don't use it on a public-facing surface**. Either commission it through the workflow in [06-photography.md](06-photography.md), or use a near-match that's already approved.

## Logo files

| File | Format | Approved use | Notes |
|------|--------|--------------|-------|
| `/orcatrade_logo.png` | PNG, 1080×1080 (raster) | All branded surfaces | Single available variant; SVG + mono variants are gaps to commission |

## Video

| File | Format | Length | Approved use |
|------|--------|--------|--------------|
| `assets/hero-bg.mp4` | MP4, 1920×1080, looping | ~12s | Homepage hero only |
| `assets/orcatrade-overview-2.mp4` | MP4, 1080×1080 | ~8s | Mid-page video block on home + intro pages |

## Photography (people)

| File | Subject | License | Approved use |
|------|---------|---------|--------------|
| `assets/PHOTO-2026-03-19-17-53-41.jpg` | Jay Xie (CEO) portrait | Subject release on file | Leadership pages, About, decks |
| `assets/dd0ec64c-9768-447b-89d8-8b6899e61ccd.png` | Yiu Cheung (HK Director) portrait | Subject release on file | Leadership pages, HK office content |

## Photography (place / infrastructure)

*None currently in repo.* Open commission queue:

- [ ] Container terminal at dusk (Rotterdam / Hamburg / Gdańsk) — 3000+ px
- [ ] HK office interior — operator at desk
- [ ] Factory floor — QC inspector with clipboard
- [ ] Małaszewicze rail terminus
- [ ] Customs checkpoint — paperwork close-up
- [ ] EU 3PL warehouse — pallet stacks, racks, forklift in motion

## Illustrations / icons

The platform doesn't use decorative illustrations. The visual system relies on photography + typography + colour + the aurora/spotlight effects. Don't add stock illustration kits.

The exception: **the OrcaTrade logo glyph** (the orca silhouette) can be used as a small accent inside cards, decks, and social templates. It must always be paired with the wordmark or used at a size where it's clearly a logo, not decoration.

## Document templates

| File | Purpose | Status |
|------|---------|--------|
| `docs/raport-orcatrade.html` | Polish-language platform progress report (PDF source) | Live · used for board comms |
| `docs/orcatrade-progress-report.html` | English-language platform progress report (PDF source) | Live · same |

These two HTML files are the canonical print template. Reuse the styling for new long-form documents.

## Approved external sources

When commissioning new photography or illustration, use only these vetted contractors:

| Type | Source | Contact | Last engaged |
|------|--------|---------|-------------|
| (To be populated) | | | |

The shortlist is currently empty. The first task for #6 in the next quarter is to vet 2–3 trusted contractors for each of: EU-side photography, HK-side photography, brand illustration.

## Stock photography

**Default policy: don't use stock photography.** Generic stock images break the operator-grounded visual system.

If a piece urgently needs a placeholder, use:

1. Unsplash (CC0) — only for pure infrastructure (ports, containers, warehouses). Never for people.
2. Avoid Shutterstock / Getty for marketing surfaces.

Every stock placeholder must be replaced with a commissioned asset within 30 days, tracked here.

## License conventions

For every commissioned asset, capture in the registry:

```
File: assets/path/to/file.jpg
Subject: Brief description
Photographer/Designer: Name
Date: YYYY-MM-DD
License type: Buyout / Limited use / CC-BY / Subject release on file
Approved use: All / Web only / Print only / Internal only
Expires: YYYY-MM-DD (if limited)
```

This protects the brand from a deletion order years later when a contractor's terms change.

## Cleanup history

| Date | Removed | Reason |
|------|---------|--------|
| 2026-05-07 | `assets/My Movie 2.mp4`, `_users_*.MP4` (×2), `orcatrade-overview.mp4`, `PHOTO-2026-03-19-17-57-48.jpg`, `PHOTO-2026-03-20-00-27-11.jpg` | Pre-deploy cleanup. Orphaned drafts, unreferenced. ~27 MB recovered. |

---

**Section version:** 1.0 · 2026-05-08 · Maintained by Brand & Creative Director.
