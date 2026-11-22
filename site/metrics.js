/**
 * Yandex.Metrika for the landing page, behind an opt-in.
 *
 * Why a separate file and not the snippet Yandex hands out: that snippet loads
 * `mc.yandex.ru/metrika/tag.js` on every visit and sets a cookie before anyone has
 * agreed to anything. This page is the advertisement for a program whose whole
 * point is not talking to the network, so the page itself must not phone home
 * until the visitor says it may.
 *
 * There are three states, and the first one is the default:
 *
 *   1. METRIKA_ID is empty — nothing happens at all. No banner, no request, no
 *      cookie, no third-party host in the network panel. The page behaves exactly
 *      as it did before this file existed, and `node scripts/verify-site.cjs`
 *      proves it by refusing any external load.
 *
 *   2. METRIKA_ID is set and the visitor has not answered yet — the banner asks
 *      once. "Принять"/"Accept" stores the answer and then loads the tag;
 *      "Отклонить"/"Decline" stores that and never asks again. Nothing is loaded
 *      before a click.
 *
 *   3. METRIKA_ID is set and the answer is stored — the tag loads on the next
 *      visit without asking.
 *
 * To turn counting on: get the counter number on metrika.yandex.ru, put it in
 * METRIKA_ID below as a number, and run `node scripts/stamp-assets.cjs`. To turn
 * it off: empty the string and run that again.
 *
 * The counter number is not a secret — it is in the page source of every site that
 * has one — so it belongs in this file rather than in a build step.
 */
(function () {
  'use strict';

  /**
   * Counter number, or '' to keep the page free of third-party requests.
   *
   * 114491353 is the counter for flushot.ink. It is not a secret: the number is in
   * the page source of every site that has one. What matters is that the tag stays
   * behind the consent gate below — a number in the file is not a visit.
   */
  var METRIKA_ID = '114491353';

  var TAG = 'https://mc.yandex.ru/metrika/tag.js';
  var CONSENT_KEY = 'flushot-analytics';
  var CONSENT_YES = 'yes';
  var CONSENT_NO = 'no';

  var LANG = document.documentElement.lang === 'en' ? 'en' : 'ru';

  // Both pages sit one level below the site root (index.html at the root, the
  // English one in en/), so the privacy page is one directory away in each case.
  var TEXT = {
    ru: {
      title: 'Считать посещения?',
      body:
        'Мы хотим знать, сколько людей заходит на сайт и откуда они приходят. Для этого — Яндекс.Метрика: она ставит cookie, видит IP и адрес страницы, с которой вы перешли. Программа Flushot при этом по-прежнему ничего о вас не отправляет — речь только про эту страницу.',
      accept: 'Принять',
      decline: 'Отклонить',
      more: 'Что именно собирается',
      privacy: 'privacy.html'
    },
    en: {
      title: 'Count visits?',
      body:
        'We would like to know how many people visit the site and where they come from. That needs Yandex.Metrika, which sets a cookie and sees your IP address and the page you arrived from. The Flushot program still sends nothing about you — this is about this page only.',
      accept: 'Accept',
      decline: 'Decline',
      more: 'What exactly is collected',
      privacy: '../privacy.html'
    }
  }[LANG];

  var text = TEXT;

  // ------------------------------------------------ storage that may not exist
  // Reading localStorage throws in some privacy modes and in a sandboxed frame,
  // and an exception here would take the rest of this file down with it.
  function readConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (error) {
      return null;
    }
  }

  function writeConsent(value) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  // ------------------------------------------------------------------ the tag
  var loaded = false;

  function loadTag() {
    if (loaded) return;
    if (!METRIKA_ID) return;
    loaded = true;

    var script = document.createElement('script');
    script.async = true;
    script.src = TAG;
    script.setAttribute('data-flushot-metrics', 'tag');
    script.addEventListener('load', function () {
      // `ym` is defined by tag.js itself. If it is missing the tag failed to
      // initialise, and calling it anyway would throw inside an event listener
      // where nothing can see the error.
      if (typeof window.ym !== 'function') return;
      window.ym(Number(METRIKA_ID), 'init', {
        // The click map and the scroll tracking are the two things worth having on
        // a one-page site: they answer "does anyone reach the download buttons".
        clickmap: true,
        trackLinks: true,
        accurateTrackBounce: true,
        webvisor: false
      });
    });
    document.head.appendChild(script);
  }

  // --------------------------------------------------------------- the banner
  function banner() {
    var box = document.createElement('div');
    box.className = 'consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', text.title);
    box.setAttribute('data-consent', 'banner');

    var heading = document.createElement('p');
    heading.className = 'consent__title';
    heading.textContent = text.title;

    var body = document.createElement('p');
    body.className = 'consent__text';
    body.textContent = text.body;

    var link = document.createElement('a');
    link.className = 'consent__link';
    link.href = text.privacy;
    link.textContent = text.more;

    var actions = document.createElement('div');
    actions.className = 'consent__actions';

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'btn btn--primary btn--sm';
    yes.textContent = text.accept;
    yes.setAttribute('data-consent-accept', '');

    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'btn btn--ghost btn--sm';
    no.textContent = text.decline;
    no.setAttribute('data-consent-decline', '');

    actions.append(yes, no);
    box.append(heading, body, link, actions);

    function close() {
      if (box.parentNode) box.parentNode.removeChild(box);
    }

    yes.addEventListener('click', function () {
      writeConsent(CONSENT_YES);
      close();
      loadTag();
    });
    no.addEventListener('click', function () {
      writeConsent(CONSENT_NO);
      close();
    });

    document.body.appendChild(box);
    // Focus goes to the refusal, not to the agreement: pressing Enter out of habit
    // should not be the same as agreeing to be tracked.
    no.focus();
  }

  // ------------------------------------------------------------------- start
  function start() {
    // No number, no banner and no request: asking permission for something the
    // page will never do would be worse than saying nothing.
    if (!METRIKA_ID) return;

    var consent = readConsent();
    if (consent === CONSENT_YES) {
      loadTag();
      return;
    }
    if (consent === CONSENT_NO) return;
    banner();
  }

  // Exposed so `scripts/test-metrics.cjs` can drive the three states without
  // guessing at internals, and so a "change my answer" link can clear it later.
  window.flushotMetrics = {
    /** The configured counter, '' when counting is off. */
    id: METRIKA_ID,
    consent: readConsent,
    grant: function () {
      writeConsent(CONSENT_YES);
      loadTag();
    },
    revoke: function () {
      writeConsent(CONSENT_NO);
    },
    forget: function () {
      try {
        localStorage.removeItem(CONSENT_KEY);
      } catch (error) {
        /* nothing to forget */
      }
    },
    load: loadTag,
    loaded: function () {
      return loaded;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
