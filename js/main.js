document.addEventListener('DOMContentLoaded', function () {
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
  const MOTION_ALLOWED = !REDUCED_MOTION.matches;
  const HEADER_FALLBACK = 88;
  const loadedScripts = new Map();
  const state = {
    lenis: null,
    lenisRafId: 0,
    revealObserver: null,
    staggerObserver: null,
    parallaxItems: [],
    scrollTicking: false,
  };

  const REVEAL_PRESETS = {
    section: { y: '34px', scale: '1', duration: '900ms', delay: '0ms' },
    heading: { y: '22px', scale: '1', duration: '760ms', delay: '0ms' },
    copy: { y: '18px', scale: '1', duration: '700ms', delay: '40ms' },
    card: { y: '24px', scale: '0.985', duration: '760ms', delay: '0ms' },
    stat: { y: '18px', scale: '0.97', duration: '680ms', delay: '0ms' },
    hero: { y: '26px', scale: '1', duration: '860ms', delay: '0ms' },
  };

  const STAGGER_GROUPS = [
    { container: '.group-grid', items: '.group-card', type: 'card', step: 90 },
    { container: '.rep-grid', items: '.rep-card', type: 'card', step: 90 },
    { container: '.news-grid', items: '.news-card', type: 'card', step: 70 },
    { container: '.feature-grid', items: '.feature-card', type: 'card', step: 80 },
    { container: '.hero-metrics', items: '.metric', type: 'stat', step: 65 },
    { container: '.roi-metric-grid', items: '.roi-metric', type: 'stat', step: 65 },
  ];

  document.documentElement.classList.toggle('motion-safe', MOTION_ALLOWED);
  document.documentElement.classList.toggle('motion-reduced', !MOTION_ALLOWED);

  function getHeaderOffset() {
    const header = document.querySelector('header');
    if (!header) return HEADER_FALLBACK;
    return Math.round(header.getBoundingClientRect().height + 20);
  }

  function isElementInView(element, allowance) {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.top <= viewportHeight - allowance;
  }

  function queryAllIncludingSelf(root, selector) {
    const matches = Array.from(root.querySelectorAll(selector));
    if (root !== document && root.matches && root.matches(selector)) {
      matches.unshift(root);
    }
    return matches;
  }

  function applyRevealPreset(element, type) {
    const preset = REVEAL_PRESETS[type] || REVEAL_PRESETS.copy;
    element.dataset.reveal = element.dataset.reveal || type;
    element.style.setProperty('--reveal-y', preset.y);
    element.style.setProperty('--reveal-scale', preset.scale);
    element.style.setProperty('--reveal-duration', preset.duration);
    element.style.setProperty('--reveal-delay', preset.delay);
  }

  function revealElement(element, delayMs) {
    if (!element) return;
    if (typeof delayMs === 'number') {
      element.style.setProperty('--reveal-delay', `${delayMs}ms`);
    }
    element.classList.add('is-visible');
  }

  function revealImmediateWithin(root) {
    root.querySelectorAll('[data-reveal="hero"]').forEach(function (element, index) {
      revealElement(element, index * 90);
    });
  }

  function revealAll(root) {
    root.querySelectorAll('[data-reveal], [data-stagger-item]').forEach(function (element) {
      element.classList.add('is-visible');
    });
  }

  function prepareRevealElements(root) {
    const sectionSelector = '.section:not(.section--hero):not(.section--hero-center):not(.section--story)';
    queryAllIncludingSelf(root, sectionSelector).forEach(function (section) {
      if (!section.dataset.reveal) applyRevealPreset(section, 'section');
    });

    queryAllIncludingSelf(root, '.section-kicker:not(.story-kicker), .section-title').forEach(function (element) {
      if (!element.closest('.section--story') && !element.dataset.reveal) applyRevealPreset(element, 'heading');
    });

    queryAllIncludingSelf(root, '.section-intro, .mission-block, .contact-details, #contact-form, .trade-visual').forEach(function (element) {
      if (!element.closest('.section--story') && !element.dataset.reveal) applyRevealPreset(element, 'copy');
    });

    queryAllIncludingSelf(root, '.hero-kicker, .hero-title, .hero-title-center, .hero-body, .hero-body-center, .hero-meta, .hero-actions, .unit-hero .status-badge, .unit-hero-title, .unit-hero-body').forEach(function (element) {
      if (!element.dataset.reveal) applyRevealPreset(element, 'hero');
    });

    queryAllIncludingSelf(root, '.card, .process-card, .cta-box').forEach(function (element) {
      if (!element.dataset.reveal) applyRevealPreset(element, 'card');
    });

    queryAllIncludingSelf(root, '[data-reveal="heading"], [data-reveal="copy"], [data-reveal="card"], [data-reveal="stat"], [data-reveal="hero"], [data-reveal="section"]').forEach(function (element) {
      if (!element.dataset.revealPrepared) {
        const type = element.dataset.reveal;
        applyRevealPreset(element, type);
        element.dataset.revealPrepared = 'true';
      }
    });
  }

  function prepareStaggerGroups(root) {
    STAGGER_GROUPS.forEach(function (group) {
      queryAllIncludingSelf(root, group.container).forEach(function (container) {
        if (!container.dataset.staggerGroup) {
          container.dataset.staggerGroup = group.type;
        }
        container.dataset.staggerStep = container.dataset.staggerStep || String(group.step);

        container.querySelectorAll(group.items).forEach(function (item) {
          if (!item.dataset.staggerItem) item.dataset.staggerItem = group.type;
          if (!item.dataset.revealPrepared) {
            applyRevealPreset(item, group.type);
            item.dataset.revealPrepared = 'true';
          }
        });
      });
    });

    queryAllIncludingSelf(root, '[data-stagger-group]').forEach(function (container) {
      const type = container.dataset.staggerGroup || 'card';
      const step = Number(container.dataset.staggerStep || 80);

      container.querySelectorAll('[data-stagger-item]').forEach(function (item) {
        if (!item.dataset.revealPrepared) {
          applyRevealPreset(item, item.dataset.staggerItem || type);
          item.dataset.revealPrepared = 'true';
        }
      });

      if (!container.dataset.staggerStep) {
        container.dataset.staggerStep = String(step);
      }
    });
  }

  function updateParallax() {
    if (!MOTION_ALLOWED || window.innerWidth < 900) {
      state.parallaxItems.forEach(function (element) {
        element.style.setProperty('--parallax-offset', '0px');
      });
      return;
    }

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    state.parallaxItems.forEach(function (element) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > viewportHeight) return;

      const strength = Number(element.dataset.parallaxStrength || 16);
      const midpoint = rect.top + (rect.height / 2);
      const distanceFromCenter = midpoint - (viewportHeight / 2);
      const offset = Math.max(-strength, Math.min(strength, distanceFromCenter * -0.045));
      element.style.setProperty('--parallax-offset', `${offset.toFixed(2)}px`);
    });
  }

  function collectParallaxItems() {
    state.parallaxItems = Array.from(document.querySelectorAll('[data-parallax]'));
    updateParallax();
  }

  function createRevealObserver() {
    if (state.revealObserver) state.revealObserver.disconnect();
    state.revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        revealElement(entry.target);
        state.revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -10% 0px' });
  }

  function createStaggerObserver() {
    if (state.staggerObserver) state.staggerObserver.disconnect();
    state.staggerObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;

        const group = entry.target;
        const step = Number(group.dataset.staggerStep || 80);
        group.dataset.staggerState = 'revealed';
        revealElement(group);

        group.querySelectorAll('[data-stagger-item]').forEach(function (item, index) {
          revealElement(item, index * step);
        });

        state.staggerObserver.unobserve(group);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  }

  function observeMotion(root) {
    if (!MOTION_ALLOWED) {
      revealAll(root);
      return;
    }

    if (!state.revealObserver) createRevealObserver();
    if (!state.staggerObserver) createStaggerObserver();

    queryAllIncludingSelf(root, '[data-reveal]').forEach(function (element) {
      if (element.dataset.reveal === 'hero') return;
      if (element.hasAttribute('data-stagger-item')) return;

      if (isElementInView(element, 80)) {
        revealElement(element);
      } else {
        state.revealObserver.observe(element);
      }
    });

    queryAllIncludingSelf(root, '[data-stagger-group]').forEach(function (group) {
      if (group.dataset.staggerState === 'revealed' || isElementInView(group, 110)) {
        const step = Number(group.dataset.staggerStep || 80);
        group.dataset.staggerState = 'revealed';
        revealElement(group);
        group.querySelectorAll('[data-stagger-item]').forEach(function (item, index) {
          revealElement(item, index * step);
        });
      } else {
        state.staggerObserver.observe(group);
      }
    });

    revealImmediateWithin(document);
  }

  function refreshMotion(root) {
    const scope = root || document;
    prepareRevealElements(scope);
    prepareStaggerGroups(scope);
    collectParallaxItems();
    observeMotion(scope);
  }

  window.OrcaMotion = {
    refresh: refreshMotion,
  };

  function scheduleScrollWork() {
    if (state.scrollTicking) return;
    state.scrollTicking = true;

    requestAnimationFrame(function () {
      highlightActive();
      updateParallax();
      state.scrollTicking = false;
    });
  }

  function loadScript(src) {
    if (loadedScripts.has(src)) return loadedScripts.get(src);

    const promise = new Promise(function (resolve, reject) {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error(`Failed to load ${src}`));
      };
      document.head.appendChild(script);
    });

    loadedScripts.set(src, promise);
    return promise;
  }

  async function initLenis() {
    if (!MOTION_ALLOWED) return;

    try {
      if (!window.Lenis) {
        await loadScript('https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.min.js');
      }

      if (!window.Lenis) return;

      const lenis = new window.Lenis({
        duration: 1.05,
        smoothWheel: true,
        smoothTouch: false,
        wheelMultiplier: 0.9,
        touchMultiplier: 1,
        lerp: 0.085,
      });

      state.lenis = lenis;
      document.documentElement.classList.add('lenis-enabled');

      function raf(time) {
        lenis.raf(time);
        state.lenisRafId = requestAnimationFrame(raf);
      }

      state.lenisRafId = requestAnimationFrame(raf);
      lenis.on('scroll', scheduleScrollWork);
    } catch (error) {
      console.warn('Lenis failed to initialize:', error);
    }
  }

  function scrollToTarget(target) {
    const offset = getHeaderOffset() * -1;
    if (state.lenis && target) {
      state.lenis.scrollTo(target, {
        offset: target.id === 'top' ? 0 : offset,
        duration: 1.15,
      });
      return;
    }

    const rect = target.getBoundingClientRect();
    const top = rect.top + window.scrollY - (target.id === 'top' ? 0 : getHeaderOffset());
    window.scrollTo({
      top: Math.max(0, top),
      behavior: MOTION_ALLOWED ? 'smooth' : 'auto',
    });
  }

  function initAnchorLinks() {
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (event) {
        const href = anchor.getAttribute('href');
        if (!href || href === '#') return;

        const target = document.querySelector(href);
        if (!target) return;

        event.preventDefault();
        scrollToTarget(target);
      });
    });
  }

  function initReadMoreToggle(toggleId, contentId) {
    const toggle = document.getElementById(toggleId);
    const content = document.getElementById(contentId);
    if (!toggle || !content) return;

    toggle.addEventListener('click', function () {
      const open = content.style.display !== 'none';
      content.style.display = open ? 'none' : 'block';
      toggle.textContent = open ? 'Read more ↓' : 'Read less ↑';
      toggle.setAttribute('aria-expanded', String(!open));

      if (!open && window.OrcaMotion) {
        window.OrcaMotion.refresh(content);
      }
    });
  }

  const sections = Array.from(document.querySelectorAll('.section[id]'));
  const navLinks = Array.from(document.querySelectorAll('.nav-links a[href^="#"]'));

  function highlightActive() {
    if (!sections.length || !navLinks.length) return;

    const marker = getHeaderOffset() + 90;
    let current = sections[0].id;

    sections.forEach(function (section) {
      const rect = section.getBoundingClientRect();
      if (rect.top <= marker && rect.bottom >= marker) current = section.id;
    });

    navLinks.forEach(function (link) {
      const href = link.getAttribute('href');
      const active = href === `#${current}` || (current === 'top' && href === '#top');
      link.style.opacity = active ? '1' : '0.72';
      link.style.fontWeight = active ? '500' : 'normal';
    });
  }

  async function initPinnedStory() {
    const storySection = document.querySelector('[data-story-section]');
    const storyPanel = storySection && storySection.querySelector('[data-story-panel]');
    const copies = storySection ? Array.from(storySection.querySelectorAll('[data-story-copy]')) : [];
    const signals = storySection ? Array.from(storySection.querySelectorAll('.story-signal')) : [];

    if (!storySection || !storyPanel || !copies.length) return;

    function setActiveStoryStep(index) {
      const step = Math.max(0, Math.min(copies.length - 1, index));
      storySection.dataset.storyStep = String(step + 1);

      copies.forEach(function (copy, copyIndex) {
        copy.classList.toggle('is-active', copyIndex === step);
      });

      signals.forEach(function (signal, signalIndex) {
        signal.classList.toggle('is-active', signalIndex === step);
      });
    }

    setActiveStoryStep(0);

    if (!MOTION_ALLOWED) return;

    try {
      if (!window.gsap) {
        await loadScript('https://cdn.jsdelivr.net/npm/gsap@3.12.7/dist/gsap.min.js');
      }
      if (!window.ScrollTrigger) {
        await loadScript('https://cdn.jsdelivr.net/npm/gsap@3.12.7/dist/ScrollTrigger.min.js');
      }

      if (!window.gsap || !window.ScrollTrigger) return;

      window.gsap.registerPlugin(window.ScrollTrigger);

      if (state.lenis) {
        state.lenis.on('scroll', window.ScrollTrigger.update);
      }

      const mm = window.gsap.matchMedia();

      mm.add('(min-width: 961px)', function () {
        const trigger = window.ScrollTrigger.create({
          trigger: storySection,
          start: 'top top',
          end: '+=230%',
          pin: storyPanel,
          scrub: 0.55,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: function (self) {
            const index = Math.min(copies.length - 1, Math.floor(self.progress * copies.length));
            setActiveStoryStep(index);
            storySection.style.setProperty('--story-progress', self.progress.toFixed(3));
          },
        });

        return function () {
          trigger.kill();
          storySection.style.setProperty('--story-progress', '0');
          setActiveStoryStep(0);
        };
      });
    } catch (error) {
      console.warn('GSAP storytelling section failed to initialize:', error);
    }
  }

  // Mobile nav is owned by js/site-nav.js — it renders + binds the
  // hamburger as part of its locale-aware header. main.js used to ship
  // its own initMobileNav() too, which attached a SECOND click listener
  // to the same button; the two handlers cancelled each other (open
  // then immediately close), so the menu never visibly expanded on
  // mobile. Removed in the BG-5.6 follow-up fix.

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  refreshMotion(document);
  initAnchorLinks();
  initReadMoreToggle('missionToggle', 'missionMore');
  initReadMoreToggle('leaderToggle', 'leaderMore');
  highlightActive();
  scheduleScrollWork();

  window.addEventListener('scroll', scheduleScrollWork, { passive: true });
  window.addEventListener('resize', scheduleScrollWork, { passive: true });

  const lenisReady = initLenis().then(function () {
    scheduleScrollWork();
    return state.lenis;
  });

  lenisReady.finally(function () {
    initPinnedStory();
  });
});
