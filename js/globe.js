(function () {
  if (typeof window === 'undefined') return;

  const READY = (cb) =>
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', cb, { once: true })
      : cb();

  READY(init);

  function init() {
    const canvas = document.querySelector('[data-globe]');
    if (!canvas || !window.d3) return;

    const d3 = window.d3;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ROTATION_SPEED = 0.18;
    const DOT_SPACING = 22;
    const DOT_STEP = DOT_SPACING * 0.08;
    // Resume auto-rotation 1.5s after the user releases a drag. Long enough
    // that scroll-past-the-globe doesn't restart spinning underneath them.
    const AUTO_RESUME_DELAY_MS = 1500;
    // Local first, then GitHub raw — keeps the page working if the local
    // asset is somehow unavailable in production.
    const ASSET_URLS = [
      '/assets/ne_110m_land.json',
      'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/refs/heads/master/110m/physical/ne_110m_land.json',
    ];

    let cssWidth = 0;
    let cssHeight = 0;
    let radius = 0;
    let projection = null;
    let landFeatures = null;
    const dots = [];

    function size() {
      const rect = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, Math.floor(rect.width));
      cssHeight = Math.max(1, Math.floor(rect.height));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      radius = Math.min(cssWidth, cssHeight) / 2.2;
      if (projection) {
        projection.scale(radius).translate([cssWidth / 2, cssHeight / 2]);
      }
    }

    function pointInRing(px, py, ring) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      return inside;
    }

    function pointInFeature(point, feature) {
      const g = feature.geometry;
      const [x, y] = point;
      if (g.type === 'Polygon') {
        if (!pointInRing(x, y, g.coordinates[0])) return false;
        for (let i = 1; i < g.coordinates.length; i++) {
          if (pointInRing(x, y, g.coordinates[i])) return false;
        }
        return true;
      }
      if (g.type === 'MultiPolygon') {
        for (const poly of g.coordinates) {
          if (!pointInRing(x, y, poly[0])) continue;
          let inHole = false;
          for (let i = 1; i < poly.length; i++) {
            if (pointInRing(x, y, poly[i])) { inHole = true; break; }
          }
          if (!inHole) return true;
        }
      }
      return false;
    }

    function buildDots(features) {
      for (const feature of features) {
        const [[minLng, minLat], [maxLng, maxLat]] = d3.geoBounds(feature);
        for (let lng = minLng; lng <= maxLng; lng += DOT_STEP) {
          for (let lat = minLat; lat <= maxLat; lat += DOT_STEP) {
            if (pointInFeature([lng, lat], feature)) dots.push([lng, lat]);
          }
        }
      }
    }

    function render() {
      const scaleFactor = projection.scale() / radius;
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      ctx.beginPath();
      ctx.arc(cssWidth / 2, cssHeight / 2, projection.scale(), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(245, 242, 234, 0.55)';
      ctx.lineWidth = 1.2 * scaleFactor;
      ctx.stroke();

      const path = d3.geoPath().projection(projection).context(ctx);

      ctx.beginPath();
      path(d3.geoGraticule10());
      ctx.strokeStyle = 'rgba(245, 242, 234, 0.12)';
      ctx.lineWidth = 0.8 * scaleFactor;
      ctx.stroke();

      if (landFeatures) {
        ctx.beginPath();
        for (const f of landFeatures.features) path(f);
        ctx.strokeStyle = 'rgba(245, 242, 234, 0.42)';
        ctx.lineWidth = 0.8 * scaleFactor;
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(212, 175, 55, 0.85)';
      const r = 1.1 * scaleFactor;
      for (const [lng, lat] of dots) {
        const p = projection([lng, lat]);
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    let raf = 0;
    const rotation = [0, -8];
    let lastTs = 0;
    // Drag state. `dragging` is true between pointerdown and pointerup;
    // `autoRotate` flips back true once AUTO_RESUME_DELAY_MS has elapsed
    // since the last release.
    let dragging = false;
    let autoRotate = !reduceMotion;
    let resumeTimer = 0;

    function frame(ts) {
      const dt = lastTs ? ts - lastTs : 16;
      lastTs = ts;
      if (autoRotate && !dragging) {
        rotation[0] += ROTATION_SPEED * (dt / 16);
        projection.rotate(rotation);
      }
      render();
      raf = requestAnimationFrame(frame);
    }

    function start() {
      cancelAnimationFrame(raf);
      lastTs = 0;
      if (reduceMotion) {
        projection.rotate(rotation);
        render();
      } else {
        raf = requestAnimationFrame(frame);
      }
    }

    projection = d3.geoOrthographic().clipAngle(90).rotate(rotation);
    size();

    function loadFromUrls(urls) {
      const tryNext = (i) => {
        if (i >= urls.length) {
          canvas.classList.add('is-error');
          return;
        }
        fetch(urls[i], { cache: 'force-cache' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('geojson ' + r.status))))
          .then((data) => {
            landFeatures = data;
            buildDots(data.features);
            canvas.classList.add('is-ready');
            start();
          })
          .catch(() => tryNext(i + 1));
      };
      tryNext(0);
    }

    loadFromUrls(ASSET_URLS);

    // ── Drag-to-rotate (pointer events; works for mouse + pen + touch) ──
    // The hero canvas sits at z-index 0 with text overlays at z-index 1;
    // pointer-events:auto on the canvas only catches drags on empty bg areas,
    // text and buttons remain clickable because they paint on top.
    let pointerId = -1;
    let dragStart = { x: 0, y: 0, rot: [0, -8] };

    function onPointerDown(ev) {
      if (!landFeatures) return; // not loaded yet
      pointerId = ev.pointerId;
      dragging = true;
      autoRotate = false;
      clearTimeout(resumeTimer);
      dragStart.x = ev.clientX;
      dragStart.y = ev.clientY;
      dragStart.rot = [rotation[0], rotation[1]];
      canvas.classList.add('is-grabbing');
      try { canvas.setPointerCapture(ev.pointerId); } catch (_e) { /* unsupported */ }
    }
    function onPointerMove(ev) {
      if (!dragging || ev.pointerId !== pointerId) return;
      const sensitivity = 0.4;
      const dx = ev.clientX - dragStart.x;
      const dy = ev.clientY - dragStart.y;
      rotation[0] = dragStart.rot[0] + dx * sensitivity;
      rotation[1] = Math.max(-90, Math.min(90, dragStart.rot[1] - dy * sensitivity));
      projection.rotate(rotation);
      // If reduced motion is on the rAF loop is paused — render synchronously.
      if (reduceMotion) render();
    }
    function onPointerUp(ev) {
      if (ev.pointerId !== pointerId) return;
      dragging = false;
      pointerId = -1;
      canvas.classList.remove('is-grabbing');
      try { canvas.releasePointerCapture(ev.pointerId); } catch (_e) { /* unsupported */ }
      if (!reduceMotion) {
        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => { autoRotate = true; }, AUTO_RESUME_DELAY_MS);
      }
    }
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    let resizeRaf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        size();
        if (reduceMotion) render();
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else if (!reduceMotion && landFeatures) {
        start();
      }
    });
  }
})();
