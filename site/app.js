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
        '.try',
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

    // The terminal prints itself. Its lines are already in the markup and stay
    // readable without the script; this only makes them arrive one after
    // another, the way a command's output does, instead of all at once with the
    // block they sit in.
    var term = document.querySelector('.term__body');
    if (term && term.getBoundingClientRect().top > fold * 0.92) {
      term.classList.add('is-armed');
      var termObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.remove('is-armed');
            entry.target.classList.add('is-typed');
            termObserver.unobserve(entry.target);
          });
        },
        { threshold: 0.4 }
      );
      termObserver.observe(term);
    }
  }

  // ----------------------------------------------------------- page progress
  //
  // A hairline on the header's lower edge. On a page this long it is the only
  // cue for how much is left, and it costs one element and one number.
  var progressBar = document.querySelector('[data-progress]');
  if (progressBar) {
    var paintProgress = function () {
      var room = document.documentElement.scrollHeight - window.innerHeight;
      var ratio = room > 0 ? Math.min(1, window.scrollY / room) : 0;
      progressBar.style.setProperty('--progress', ratio.toFixed(4));
    };
    paintProgress();
    window.addEventListener('scroll', paintProgress, { passive: true });
    window.addEventListener('resize', paintProgress);
  }

  // --------------------------------------------------------------- hero tilt
  //
  // The framed screenshot leans towards the pointer and passes a light under it.
  // Only for a fine pointer: on a touch screen there is no hover, and a card
  // that tilts when tapped looks broken rather than alive.
  var preview = document.querySelector('.hero__preview');
  if (preview && !still && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var frame = preview.querySelector('.hero__frame');
    preview.addEventListener('pointermove', function (event) {
      var box = preview.getBoundingClientRect();
      if (!box.width || !box.height) return;
      var px = (event.clientX - box.left) / box.width;
      var py = (event.clientY - box.top) / box.height;
      // Half a degree of axis per 8 % of travel: the card ends up within 2° of
      // flat, which reads as depth without distorting the picture inside.
      preview.style.setProperty('--tilt-y', ((px - 0.5) * 3).toFixed(2) + 'deg');
      preview.style.setProperty('--tilt-x', ((0.5 - py) * 2).toFixed(2) + 'deg');
      if (frame) {
        frame.style.setProperty('--sheen-x', (px * 100).toFixed(1) + '%');
        frame.style.setProperty('--sheen-y', (py * 100).toFixed(1) + '%');
      }
    });
    preview.addEventListener('pointerleave', function () {
      preview.style.removeProperty('--tilt-x');
      preview.style.removeProperty('--tilt-y');
    });
  }

  // ------------------------------------------------------------- hero glow
  //
  // A light under the pointer. The mesh brightens where the cursor is and a soft
  // accent bloom sits beneath it, both inside one mask that travels with the
  // pointer. Two details make it read as a lamp rather than a sticker: the light
  // eases towards the pointer instead of snapping to it, and it fades out over
  // half a second instead of switching off.
  //
  // The easing runs only while there is something to ease — the loop stops as
  // soon as the light has caught up, so a pointer resting on the hero costs
  // nothing.
  var glow = document.querySelector('.hero__glow');
  if (glow && !still && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var glowHost = glow.parentElement;
    var glowTargetX = 0;
    var glowTargetY = 0;
    var glowX = 0;
    var glowY = 0;
    var glowFrame = 0;
    var glowPlaced = false;

    var glowPaint = function () {
      glowFrame = 0;
      glowX += (glowTargetX - glowX) * 0.16;
      glowY += (glowTargetY - glowY) * 0.16;
      glow.style.setProperty('--glow-x', glowX.toFixed(1) + 'px');
      glow.style.setProperty('--glow-y', glowY.toFixed(1) + 'px');
      if (Math.abs(glowTargetX - glowX) > 0.5 || Math.abs(glowTargetY - glowY) > 0.5) {
        glowFrame = window.requestAnimationFrame(glowPaint);
      }
    };

    glowHost.addEventListener(
      'pointermove',
      function (event) {
        var box = glow.getBoundingClientRect();
        if (!box.width || !box.height) return;
        glowTargetX = event.clientX - box.left;
        glowTargetY = event.clientY - box.top;
        if (!glowPlaced) {
          // The first move places the light where the pointer is. Easing in from
          // the layer's origin would drag a bright streak across the hero.
          glowPlaced = true;
          glowX = glowTargetX;
          glowY = glowTargetY;
          glow.style.setProperty('--glow-a', '1');
        }
        if (!glowFrame) glowFrame = window.requestAnimationFrame(glowPaint);
      },
      { passive: true }
    );

    glowHost.addEventListener('pointerleave', function () {
      glow.style.setProperty('--glow-a', '0');
      glowPlaced = false;
    });
  }

  // ------------------------------------------------------- magnetic buttons
  //
  // The primary buttons lean a few pixels towards the pointer. It is a small
  // thing and it is the one that makes a flat rectangle feel like an object with
  // weight — the cursor pulls on it and it gives slightly, then springs back.
  //
  // Twelve percent of the distance from the centre, capped at four pixels: past
  // that the label starts to look off-centre rather than the button looking
  // drawn to the pointer. The easing is the transform transition the button
  // already carries, so there is no second animation loop here.
  if (!still && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var clamp = function (value) {
      return Math.max(-4, Math.min(4, value));
    };
    Array.prototype.forEach.call(document.querySelectorAll('.btn--primary'), function (button) {
      button.addEventListener('pointermove', function (event) {
        var box = button.getBoundingClientRect();
        if (!box.width || !box.height) return;
        var dx = (event.clientX - (box.left + box.width / 2)) * 0.12;
        var dy = (event.clientY - (box.top + box.height / 2)) * 0.12;
        button.style.setProperty('--mag-x', clamp(dx).toFixed(1) + 'px');
        button.style.setProperty('--mag-y', clamp(dy).toFixed(1) + 'px');
      });
      button.addEventListener('pointerleave', function () {
        button.style.removeProperty('--mag-x');
        button.style.removeProperty('--mag-y');
      });
    });
  }

  // ------------------------------------------------------------- live demo
  //
  // The one place on the page where a visitor does the thing instead of reading
  // about it. Dragging in the scene builds a card out of a real crop of that
  // scene: the copy is offset by the drag inside an overflow:hidden box, so the
  // card shows exactly what was selected and nothing else. No image is fetched,
  // and the size printed under the card is the size of the drag, not a number
  // typed into the markup.
  var demo = document.querySelector('[data-try]');
  if (demo) {
    var scene = demo.querySelector('[data-try-scene]');
    var sheet = demo.querySelector('[data-try-doc]');
    var veil = demo.querySelector('[data-try-veil]');
    var marquee = demo.querySelector('[data-try-marquee]');
    var sizeTag = demo.querySelector('[data-try-size]');
    var slot = demo.querySelector('[data-try-slot]');
    var idle = demo.querySelector('[data-try-idle]');
    var done = demo.querySelector('[data-try-done]');
    var dimsOut = demo.querySelector('[data-try-dims]');
    var statusOut = demo.querySelector('[data-try-status]');
    var message = demo.querySelector('[data-try-msg]');
    var messageShot = demo.querySelector('[data-try-msg-shot]');
    var pasteButton = demo.querySelector('[data-try-paste]');
    var resetButton = demo.querySelector('[data-try-reset]');

    // The program refuses regions under 24 × 24 px — releasing the mouse there
    // leaves the clipboard alone. The demo repeats that rule instead of taking
    // every drag, because the rule is the whole reason the threshold exists.
    var MIN = 24;
    var drag = null;
    var lastRect = null;

    var sceneSize = function () {
      return { w: scene.clientWidth, h: scene.clientHeight };
    };

    var pointInScene = function (event) {
      var box = scene.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(scene.clientWidth, event.clientX - box.left)),
        y: Math.max(0, Math.min(scene.clientHeight, event.clientY - box.top))
      };
    };

    var rectBetween = function (a, b) {
      return {
        x: Math.round(Math.min(a.x, b.x)),
        y: Math.round(Math.min(a.y, b.y)),
        w: Math.round(Math.abs(a.x - b.x)),
        h: Math.round(Math.abs(a.y - b.y))
      };
    };

    var paintSelection = function (rect) {
      veil.hidden = false;
      veil.style.left = rect.x + 'px';
      veil.style.top = rect.y + 'px';
      veil.style.width = rect.w + 'px';
      veil.style.height = rect.h + 'px';

      marquee.hidden = false;
      sizeTag.textContent = rect.w + ' × ' + rect.h + ' px';
      // Above the rectangle when there is room, inside it when the drag has
      // reached the top edge of the window — the same rearrangement the real
      // overlay does with its size label.
      var above = rect.y > 26;
      sizeTag.style.left = Math.max(0, Math.min(rect.x, sceneSize().w - 96)) + 'px';
      sizeTag.style.top = (above ? rect.y - 24 : rect.y + 6) + 'px';
    };

    var clearSelection = function () {
      veil.hidden = true;
      marquee.hidden = true;
      demo.classList.remove('try--started');
    };

    // `scale` is used by the paste step, which shows the same card smaller, and
    // by a selection wider than the column. The crop is transformed instead of
    // rebuilt at a smaller size: a narrower box would re-wrap the text inside
    // the copy, and the result would stop being a photograph of the selection.
    var makeCard = function (rect, scale) {
      scale = scale || 1;
      var frame = document.createElement('div');
      frame.className = 'try__shot';

      var crop = document.createElement('div');
      crop.className = 'try__crop';
      crop.style.width = rect.w + 'px';
      crop.style.height = rect.h + 'px';

      var size = sceneSize();
      var copy = sheet.cloneNode(true);
      copy.removeAttribute('data-try-doc');
      copy.style.width = size.w + 'px';
      copy.style.height = size.h + 'px';
      copy.style.left = -rect.x + 'px';
      copy.style.top = -rect.y + 'px';
      crop.appendChild(copy);

      if (scale === 1) {
        frame.appendChild(crop);
        return frame;
      }

      var box = document.createElement('div');
      box.className = 'try__crop-box';
      box.style.width = Math.round(rect.w * scale) + 'px';
      box.style.height = Math.round(rect.h * scale) + 'px';
      box.style.position = 'relative';
      crop.style.position = 'absolute';
      crop.style.transform = 'scale(' + scale + ')';
      box.appendChild(crop);
      frame.appendChild(box);
      return frame;
    };

    // A selection can be as wide as the whole window, and the column it lands
    // in is fixed. Shrinking the card keeps it inside the panel instead of
    // pushing the page sideways; the size printed under it stays the size of
    // the selection, not of the card.
    var fitScale = function (rect, roomFor, roomHigh) {
      var byWidth = roomFor > 0 ? Math.min(1, roomFor / rect.w) : 1;
      var byHeight = roomHigh > 0 ? Math.min(1, roomHigh / rect.h) : 1;
      return Math.max(0.2, Math.min(byWidth, byHeight));
    };

    var showResult = function (rect) {
      lastRect = rect;
      // 24 px is the frame's own padding; 380 keeps a full-window selection from
      // stretching the column far past the scene beside it.
      var scale = fitScale(rect, slot.clientWidth - 24, 380);
      slot.replaceChildren(makeCard(rect, scale));
      idle.hidden = true;
      done.hidden = false;
      message.hidden = true;
      messageShot.replaceChildren();
      dimsOut.textContent = rect.w + ' × ' + rect.h + ' px';
      statusOut.textContent =
        'Готово: рамка, скругление и тень — те же, что ставит программа. В ней этот снимок уже лежал бы в буфере обмена.';
    };

    var resetDemo = function (note) {
      lastRect = null;
      drag = null;
      slot.replaceChildren();
      idle.hidden = false;
      done.hidden = true;
      message.hidden = true;
      messageShot.replaceChildren();
      statusOut.textContent = note || '';
      clearSelection();
    };

    scene.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      // Capture, so a drag that leaves the window still finishes here — the
      // same reason the real overlay keeps its selection while the pointer
      // crosses to another monitor.
      if (scene.setPointerCapture) scene.setPointerCapture(event.pointerId);
      drag = { from: pointInScene(event), rect: null };
      demo.classList.add('try--started');
      paintSelection(rectBetween(drag.from, drag.from));
    });

    scene.addEventListener('pointermove', function (event) {
      if (!drag) return;
      drag.rect = rectBetween(drag.from, pointInScene(event));
      paintSelection(drag.rect);
    });

    var finishDrag = function (event) {
      if (!drag) return;
      var rect = drag.rect || rectBetween(drag.from, pointInScene(event));
      drag = null;
      clearSelection();
      if (rect.w < MIN || rect.h < MIN) {
        resetDemo(
          'Область ' + rect.w + ' × ' + rect.h + ' px меньше ' + MIN + ' × ' + MIN +
            ' — программа такую не копирует, и буфер обмена остаётся прежним. Потяните шире.'
        );
        return;
      }
      showResult(rect);
    };

    scene.addEventListener('pointerup', finishDrag);
    scene.addEventListener('pointercancel', function () {
      drag = null;
      clearSelection();
    });

    if (pasteButton) {
      pasteButton.addEventListener('click', function () {
        if (!lastRect) return;
        // The copy in the message is smaller than the card above it, so the
        // conversation does not grow to the height of the whole page.
        var scale = Math.min(0.55, fitScale(lastRect, messageShot.clientWidth - 12, 200));
        messageShot.replaceChildren(makeCard(lastRect, scale));
        message.hidden = false;
        statusOut.textContent =
          'Вставили. В программе снимок лежит в буфере сразу после отпускания мыши — остаётся нажать Ctrl+V там, куда вставляете.';
      });
    }

    if (resetButton) {
      resetButton.addEventListener('click', function () {
        resetDemo('');
      });
    }
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