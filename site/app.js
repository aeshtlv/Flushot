/* Flushot landing page — the only script on the page.
 *
 * Everything here is progressive: with JavaScript disabled the page still shows
 * all content, all links work, and the FAQ still opens (it is plain <details>).
 * The script only adds the theme switch, the mobile menu and the screenshot tabs.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- theme

  var root = document.documentElement;
  var themeButton = document.querySelector('[data-theme-toggle]');

  function applyTheme(theme, remember) {
    root.dataset.theme = theme;
    if (themeButton) {
      themeButton.setAttribute(
        'aria-label',
        theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'
      );
    }
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = theme === 'dark' ? '#09090b' : '#fafafa';
    if (remember) {
      try {
        localStorage.setItem('flushot-theme', theme);
      } catch (error) {
        /* private mode: the choice just will not survive a reload */
      }
    }
  }

  applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark', false);

  if (themeButton) {
    themeButton.addEventListener('click', function () {
      applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
    });
  }

  // The page is designed dark-first and stays dark whatever the system does;
  // the toggle in the header is the only way to switch, and it remembers.

  // ------------------------------------------------------------ mobile nav

  var navToggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('nav');

  function setMenu(open) {
    if (!navToggle || !nav) return;
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    nav.classList.toggle('is-open', open);
  }

  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      setMenu(navToggle.getAttribute('aria-expanded') !== 'true');
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setMenu(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setMenu(false);
    });

    document.addEventListener('click', function (event) {
      if (!event.target.closest('.header')) setMenu(false);
    });

    // A resize to desktop width must not leave the mobile panel "open".
    window.addEventListener('resize', function () {
      if (window.innerWidth > 760) setMenu(false);
    });
  }

  // --------------------------------------------------------- sticky header

  var header = document.querySelector('.header');
  if (header) {
    var updateHeader = function () {
      header.classList.toggle('is-stuck', window.scrollY > 4);
    };
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
  }

  // Motion is opt-in: everything below is skipped outright when the system asks
  // for reduced motion, because a fade or a drift is exactly what that setting
  // is about — shortening it would still be motion.
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------- hero parallax
  //
  // The grid drifts a few pixels as the hero scrolls away, slower than the text
  // in front of it. That difference is the whole depth cue: a backdrop that
  // moves in lockstep with the content reads as a flat texture pinned to it.
  var grid = document.querySelector('.hero__grid');
  if (grid && !still) {
    var hero = grid.parentElement;
    var pendingFrame = 0;
    var paint = function () {
      pendingFrame = 0;
      var travelled = Math.min(window.scrollY, 600) * 0.1;
      grid.style.setProperty('--grid-shift', travelled.toFixed(1) + 'px');
    };
    var onScroll = function () {
      if (!pendingFrame) pendingFrame = window.requestAnimationFrame(paint);
    };
    paint();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ----------------------------------------------------------- scroll reveal
  //
  // Blocks fade up as they enter the viewport. The classes are added here and
  // never written into the markup: with the script off — or if it fails to
  // load — the page is a plain document with nothing hidden and nothing to
  // animate.
  if ('IntersectionObserver' in window && !still) {
    var revealTargets = document.querySelectorAll(
      [
        '.section-head',
        '.feature',
        '.compare__card',
        '.save-grid > *',
        '.hotkeys',
        '.gallery',
        '.dl-card',
        '.limit',
        '.faq details',
        '.cta__inner'
      ].join(',')
    );

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        });
      },
      // The bottom margin keeps a block from starting its fade while it is still
      // only half over the fold, where the movement would be read as a jitter.
      { rootMargin: '0px 0px -6% 0px', threshold: 0.05 }
    );

    // Anything already on screen is shown at once. A reload halfway down the
    // page, or a jump to #download, must not animate content the reader was
    // looking at before the script ran.
    var fold = window.innerHeight;
    var perParent = new Map();

    Array.prototype.forEach.call(revealTargets, function (element) {
      if (element.getBoundingClientRect().top < fold * 0.92) return;
      var siblings = perParent.get(element.parentElement) || 0;
      perParent.set(element.parentElement, siblings + 1);
      // Stagger by position inside the group, capped: a nine-cell grid with a
      // 70 ms step would otherwise take most of a second to finish.
      element.style.setProperty('--reveal-delay', Math.min(siblings, 4) * 0.07 + 's');
      element.classList.add('reveal');
      observer.observe(element);
    });
  }

  // ------------------------------------------------------------- tabs

  var gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    var tabs = Array.prototype.slice.call(gallery.querySelectorAll('[role="tab"]'));

    var selectTab = function (index, focus) {
      tabs.forEach(function (tab, position) {
        var selected = position === index;
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.tabIndex = selected ? 0 : -1;
        var panel = document.getElementById(tab.getAttribute('aria-controls'));
        if (panel) panel.hidden = !selected;
        if (selected && focus) tab.focus();
      });
    };

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        selectTab(index, false);
      });

      tab.addEventListener('keydown', function (event) {
        var next = null;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        if (next === null) return;
        event.preventDefault();
        selectTab(next, true);
      });
    });

    selectTab(0, false);
  }
})();

/* ---------------------------------------------------------------- hotkeys
 *
 * The section shows the default shortcuts and claims they can be changed. The
 * claim is only worth making if it can be checked, so the buttons run the same
 * rules the application does: a combination is recorded from real key presses,
 * the two fields cannot collide, Escape is refused because Windows reserves it.
 *
 * Everything stays on the page — nothing is sent anywhere.
 */
(function () {
  const panel = document.querySelector('.hotkeys')
  if (!panel) return

  const status = document.querySelector('.hotkeys__status')
  const fields = {
    area: {
      keys: panel.querySelector('.hotkey-keys[data-field="area"]'),
      button: panel.querySelector('.hotkey-change[data-field="area"]'),
      value: ['Ctrl', 'Shift', 'S']
    },
    full: {
      keys: panel.querySelector('.hotkey-keys[data-field="full"]'),
      button: panel.querySelector('.hotkey-change[data-field="full"]'),
      value: ['Ctrl', 'Shift', '3']
    }
  }

  const DEFAULTS = {
    area: ['Ctrl', 'Shift', 'S'],
    full: ['Ctrl', 'Shift', '3']
  }

  let listening = null

  function say(message, tone) {
    if (!status) return
    status.textContent = message
    status.dataset.tone = tone || ''
  }

  function paint(field) {
    const { keys, value } = fields[field]
    if (!keys) return
    keys.textContent = ''
    value.forEach((part, index) => {
      if (index > 0) {
        const plus = document.createElement('span')
        plus.className = 'hotkeys__plus'
        plus.textContent = '+'
        keys.append(plus)
      }
      const key = document.createElement('kbd')
      key.textContent = part
      keys.append(key)
    })
    keys.setAttribute('aria-label', value.join(' + '))
  }

  function reset(field) {
    fields[field].value = DEFAULTS[field].slice()
    paint(field)
    stopListening()
    say('Вернули значение по умолчанию.', 'ok')
  }

  function stopListening() {
    if (listening) {
      listening.button.textContent = 'Изменить'
      listening.button.removeAttribute('data-active')
      listening = null
    }
    document.removeEventListener('keydown', onKey, true)
  }

  function startListening(field) {
    stopListening()
    listening = { field, button: fields[field].button }
    listening.button.textContent = 'Нажмите…'
    listening.button.setAttribute('data-active', '')
    say('Нажмите сочетание. Esc — отмена, Backspace — сброс.')
    document.addEventListener('keydown', onKey, true)
  }

  /** Turn a KeyboardEvent into the parts a shortcut is made of. */
  function partsOf(event) {
    const modifiers = []
    if (event.ctrlKey) modifiers.push('Ctrl')
    if (event.altKey) modifiers.push('Alt')
    if (event.shiftKey) modifiers.push('Shift')
    if (event.metaKey) modifiers.push('Win')

    const named = {
      Escape: 'Esc',
      PrintScreen: 'Print Screen',
      ' ': 'Space',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      Home: 'Home',
      End: 'End',
      Insert: 'Insert',
      Delete: 'Delete',
      Enter: 'Enter',
      Tab: 'Tab',
      Backspace: 'Backspace',
      CapsLock: 'Capslock'
    }

    let key = null
    if (named[event.key]) {
      key = named[event.key]
    } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) {
      key = event.key
    } else if (event.key.length === 1) {
      key = event.key.toUpperCase()
    }

    return { modifiers, key }
  }

  function onKey(event) {
    if (!listening) return
    const field = listening.field

    // Escape and Backspace are controls of this widget, not combinations.
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      // With a modifier it is a real attempt at a combination, and Windows
      // refuses to hand Escape to any application, so explain that instead of
      // silently treating it as a cancel.
      if (event.ctrlKey || event.altKey || event.metaKey) {
        say('Escape назначить нельзя: Windows не отдаёт её программам.', 'warn')
        return
      }
      stopListening()
      paint(field)
      say('Отменили — осталось прежнее сочетание.')
      return
    }
    if (event.key === 'Backspace' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault()
      event.stopPropagation()
      reset(field)
      return
    }
    // A bare modifier is not a combination yet.
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return

    event.preventDefault()
    event.stopPropagation()

    const { modifiers, key } = partsOf(event)
    if (!key) return

    if (key === 'Esc') {
      say('Escape назначить нельзя: Windows не отдаёт её программам.', 'warn')
      return
    }

    const parts = modifiers.concat(key)
    const other = field === 'area' ? 'full' : 'area'
    if (parts.join('+') === fields[other].value.join('+')) {
      const name = field === 'area' ? 'снимком всего экрана' : 'снимком области'
      say('Это сочетание уже занято ' + name + '. Выберите другое.', 'warn')
      return
    }

    fields[field].value = parts
    paint(field)
    stopListening()
    say('Готово. В приложении это же сочетание записывается так же.', 'ok')
  }

  Object.keys(fields).forEach((field) => {
    const { button } = fields[field]
    if (button) {
      button.addEventListener('click', () => {
        if (listening && listening.field === field) {
          stopListening()
          paint(field)
          say('Отменили.')
          return
        }
        startListening(field)
      })
    }
  })
})()