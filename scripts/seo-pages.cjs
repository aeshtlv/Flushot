/**
 * The content of the search-optimised pages, in both languages.
 *
 * One entry per page, and every string is a pair: the Russian text and the English text sit next
 * to each other in the same object. That is deliberate. The landing page is translated by a table
 * that matches Russian strings and replaces them, which works for one long document and would be
 * a trap here — five pages, each with its own sentences, and a table that silently stops matching
 * the moment a comma moves. Keeping both languages in one literal means a page cannot be
 * half-translated without this file showing it.
 *
 * Every claim below is one of Flushot's real features, taken from the program and the landing
 * page. Nothing here invents a capability, a review, a download count or a user number: a search
 * page that promises something the program does not do is worse than no page at all, because the
 * visitor arrives, finds it untrue, and leaves.
 */

/** A string in both languages. */
const t = (ru, en) => ({ ru, en })

/** The pages, in the order they appear in the sitemap and in the cross-links. */
const PAGES = [
  // =======================================================================================
  {
    slug: 'free-screenshot-tool',
    icon: 'cursor',
    nav: t('Бесплатный скриншот', 'Free screenshot tool'),
    alsoAbout: t('что умеет программа', 'what the program can do'),
    title: t(
      'Бесплатная программа для скриншотов на Windows — Flushot',
      'Free Screenshot Tool for Windows — Flushot'
    ),
    description: t(
      'Flushot — бесплатная программа для скриншотов на Windows 10 и 11: выделили область, отпустили мышь, снимок уже в буфере. Без рекламы и регистрации.',
      'Flushot is a free screenshot tool for Windows 10 and 11: drag a region, release the mouse, and the picture is already on the clipboard. No ads, no sign-up.'
    ),
    ogTitle: t('Бесплатная программа для скриншотов на Windows', 'Free Screenshot Tool for Windows'),
    h1: t(
      'Бесплатная программа для скриншотов на Windows',
      'Free Screenshot Tool for Windows'
    ),
    eyebrow: t(
      'Windows 10 и 11 · версия {version} · бесплатно',
      'Windows 10 and 11 · version {version} · free'
    ),
    lead: t(
      'Flushot делает снимок за одно движение: выделили область, отпустили мышь — картинка уже в буфере обмена, с рамкой и скруглёнными углами. Ни регистрации, ни рекламы, ни подписок, ни урезанной бесплатной версии.',
      'Flushot takes a screenshot in one movement: drag a region, release the mouse, and the picture is already on the clipboard — framed, with rounded corners and a soft shadow. No sign-up, no ads, no subscription, no cut-down "free tier".'
    ),
    heroImage: 'hero',
    heroAlt: t(
      'Окно программы Flushot с оформленным снимком: белая рамка, скруглённые углы и мягкая тень на сером фоне.',
      'The Flushot window with a framed screenshot: white border, rounded corners and a soft shadow on a grey background.'
    ),
    blocks: [
      {
        type: 'features',
        title: t('Что умеет программа', 'What the program does'),
        lead: t(
          'Список целиком. Платной версии нет, платить не за что и нечем: всё перечисленное есть в том файле, который вы скачали.',
          'The whole list. There is no paid version to upgrade to: everything below is in the file you downloaded.'
        ),
        items: [
          {
            icon: 'cursor',
            name: t('Снимок области', 'Region capture'),
            text: t(
              'Клавиша по умолчанию — Ctrl+Shift+S, но её можно сменить на любую, вплоть до одной клавиши без модификаторов.',
              'Ctrl+Shift+S by default, but any combination can be assigned — even a single key with no modifiers.'
            ),
            tag: t('Ctrl+Shift+S', 'Ctrl+Shift+S')
          },
          {
            icon: 'screen',
            name: t('Снимок всего экрана', 'Full-screen capture'),
            text: t(
              'Отдельная клавиша снимает основной монитор целиком — без рамки, сразу в буфер обмена или в файл.',
              'A separate shortcut captures the primary monitor whole — no frame, straight to the clipboard or a file.'
            ),
            tag: t('Ctrl+Shift+3', 'Ctrl+Shift+3')
          },
          {
            icon: 'frame',
            name: t('Рамка и скруглённые углы', 'Frame and rounded corners'),
            text: t(
              'Оформление применяется в момент снимка. В буфер попадает готовая карточка, а не голый прямоугольник с резкими углами.',
              'The styling is applied at capture time. What reaches the clipboard is a finished card, not a bare rectangle with square corners.'
            )
          },
          {
            icon: 'pen',
            name: t('Пометки', 'Annotations'),
            text: t(
              'Стрелка, линия, прямоугольник, карандаш, текст, нумерованные шаги и размытие — семь инструментов.',
              'Arrow, line, rectangle, pencil, text, numbered steps and blur — seven tools.'
            ),
            tag: t('7 инструментов', '7 tools')
          },
          {
            icon: 'text',
            name: t('Текст со снимка', 'Text from a screenshot'),
            text: t(
              'Встроенный движок Windows читает текст на снимке офлайн: без загрузки языков и без интернета.',
              'The OCR engine built into Windows reads the text offline: no language packs to download, no internet.'
            ),
            tag: t('Windows OCR', 'Windows OCR')
          },
          {
            icon: 'keys',
            name: t('Свои клавиши', 'Your own shortcuts'),
            text: t(
              'Все три клавиши переназначаются в настройках. Если сочетание занято другой программой, Flushot скажет об этом, а не сделает вид, что всё хорошо.',
              'All three shortcuts are rebindable in the settings. If a combination is already held by another program, Flushot says so instead of pretending it worked.'
            )
          }
        ]
      },
      {
        type: 'steps',
        title: t('Как сделать снимок экрана', 'How to take a screenshot'),
        lead: t(
          'Четыре шага, из которых обязательны первые три.',
          'Four steps, of which the first three are the actual screenshot.'
        ),
        items: [
          {
            name: t('Нажмите свою клавишу', 'Press your shortcut'),
            text: t(
              'По умолчанию Ctrl+Shift+S. Экран замирает в момент нажатия: меню и подсказки, появившиеся позже, в снимок не попадут — задержки съёмки нет.',
              'Ctrl+Shift+S by default. The screen freezes the instant the key goes down: menus and tooltips that appear afterwards never make it into the picture, because there is no capture delay.'
            )
          },
          {
            name: t('Выделите область', 'Drag a region'),
            text: t(
              'Размер в пикселях показан рядом с рамкой и обновляется на ходу. Рамку можно двигать целиком и тянуть за любой край.',
              'The size in pixels is shown next to the frame and updates as you drag. The frame can be moved whole and resized from any edge.'
            )
          },
          {
            name: t('Отпустите мышь', 'Release the mouse'),
            text: t(
              'Это и есть снимок: карточка уже в буфере обмена, нажимать Ctrl+C не нужно. Остаётся вставить её через Ctrl+V в чат, письмо или документ.',
              'That is the screenshot: the card is already on the clipboard, and Ctrl+C is not needed. Paste it with Ctrl+V into a chat, an email or a document.'
            )
          },
          {
            name: t('Если нужен файл — удержите Shift', 'Hold Shift if you want a file'),
            text: t(
              'Shift при отпускании оставляет окно на экране: в нём пометки, сохранение и распознавание текста. Ctrl+S записывает файл, Ctrl+C копирует.',
              'Releasing with Shift held keeps the window on screen, where the annotations, saving and text recognition live. Ctrl+S writes the file, Ctrl+C copies it.'
            )
          }
        ]
      },
      {
        type: 'figure',
        image: 'overlay',
        alt: t(
          'Оверлей выделения области: затемнение, прицел у курсора и рамка с размером в пикселях.',
          'The region-selection overlay: a dimmed screen, a crosshair at the cursor and a frame showing the size in pixels.'
        ),
        caption: t(
          'Выделение области. Панель с кнопками внизу видна даже тогда, когда выделен весь экран, — она не уезжает за край.',
          'Selecting a region. The toolbar at the bottom stays visible even when the whole screen is selected, so it never runs off the edge.'
        )
      },
      {
        type: 'prose',
        title: t('Чем это отличается от «Ножниц» и PrintScreen', 'How it differs from the Snipping Tool and PrintScreen'),
        paragraphs: [
          t(
            'В Windows уже есть снимок экрана: Win+Shift+S открывает «Ножницы». Они снимают область и кладут её в буфер — но голым прямоугольником, с резкими углами и без тени. Дальше начинается ручная работа: вставить в редактор, обрезать, скруглить, добавить рамку. Flushot делает эту часть сам и до того, как вы что-то нажмёте.',
            'Windows already has a screenshot tool: Win+Shift+S opens the Snipping Tool. It captures a region and puts it on the clipboard — as a bare rectangle with square corners and no shadow. Everything after that is manual: paste into an editor, crop, round the corners, add a border. Flushot does that part itself, before you press anything.'
          ),
          t(
            'PrintScreen на Windows 10 и 11 умеет открывать тот же «Ножницы» — это настройка системы. Flushot на эту клавишу не претендует: он занимает свою комбинацию и системную не трогает. Клавишу можно переназначить, но отобрать PrintScreen у Windows программа не может и не пытается.',
            'On Windows 10 and 11, PrintScreen can be set to open the same Snipping Tool — that is a system setting. Flushot does not claim that key: it takes its own combination and leaves the system one alone. The shortcut can be rebound, but taking PrintScreen away from Windows is not something the program can or tries to do.'
          ),
          t(
            'Чего Flushot не делает: он не фоторедактор. Пометки вшиваются в файл при сохранении, и убрать одну из них потом нельзя. Для ретуши, слоёв и работы с готовыми картинками нужен другой инструмент.',
            'What Flushot is not: a photo editor. Annotations are baked into the file when it is saved, and a single one cannot be removed afterwards. Retouching, layers and working with existing pictures need a different tool.'
          )
        ]
      },
      {
        type: 'figure',
        image: 'settings',
        alt: t(
          'Окно настроек Flushot: три горячие клавиши, формат файла и оформление рамки.',
          'The Flushot settings window: three shortcuts, file format and frame styling.'
        ),
        caption: t(
          'Настройки: три горячие клавиши, формат файла, цвет фона, толщина рамки, радиус скругления и сила тени.',
          'Settings: three shortcuts, file format, background colour, border width, corner radius and shadow strength.'
        )
      },
      {
        type: 'prose',
        title: t('Что программа отправляет в интернет', 'What the program sends to the internet'),
        paragraphs: [
          t(
            'Один запрос в сутки: установленная версия спрашивает у GitHub, не вышла ли новая, и если вышла — скачивает её в фоне. Это отключается переключателем «Обновления» в настройках, после чего сеть не используется совсем.',
            'One request a day: the installed copy asks GitHub whether a newer version exists and, if so, downloads it in the background. That can be switched off under Updates in the settings, after which the program does not use the network at all.'
          ),
          t(
            'Из трёх горячих клавиш в сеть уходит только третья — «Со ссылкой». Она отправляет снимок на сервер и кладёт в буфер ссылку на него; ссылка живёт час, потом снимок удаляется с сервера. Эту клавишу можно переназначить или не нажимать вовсе: две другие работают полностью локально.',
            'Of the three shortcuts, only the third — "with a link" — touches the network. It uploads the picture to a server and puts a link to it on the clipboard; the link lives for an hour, after which the picture is deleted. That shortcut can be rebound or simply never used: the other two work entirely on your machine.'
          )
        ]
      },
      {
        type: 'faq',
        title: t('Частые вопросы', 'Frequent questions'),
        items: [
          {
            q: t('Flushot действительно бесплатный?', 'Is Flushot really free?'),
            a: t(
              'Да. Без рекламы, без подписок, без регистрации и без урезанных версий: все возможности, перечисленные выше, есть в том файле, который вы скачали.',
              'Yes. No ads, no subscriptions, no registration and no cut-down editions: every feature listed above is in the file you downloaded.'
            )
          },
          {
            q: t('Нужен ли интернет для работы?', 'Does it need an internet connection?'),
            a: t(
              'Нет. Снимок, оформление, пометки, сохранение и распознавание текста происходят на вашем компьютере — движок распознавания встроен в Windows. Интернет нужен только для проверки обновлений и для клавиши «Со ссылкой».',
              'No. Capturing, styling, annotations, saving and text recognition all happen on your machine, using the OCR engine built into Windows. The internet is needed only for the update check and for the "with a link" shortcut.'
            )
          },
          {
            q: t('Куда сохраняется файл?', 'Where does the file go?'),
            a: t(
              'Готовые снимки складываются в папку «Изображения» с датой и временем в имени файла. Папку можно сменить в настройках. Отдельно можно удерживать Shift при отпускании мыши — тогда окно останется на экране и файл можно записать вручную, в PNG, JPEG или WebP.',
              'Screenshots go to your Pictures folder with the date and time in the file name, and that folder can be changed in the settings. Holding Shift as you release the mouse keeps the window on screen instead, where the file can be saved by hand as PNG, JPEG or WebP.'
            )
          },
          {
            q: t('Работает ли программа на Windows 7 или 8?', 'Does it run on Windows 7 or 8?'),
            a: t(
              'Нет. Flushot собран под Windows 10 и 11 и на более старых системах не запустится. Это ограничение, а не недосмотр: программа опирается на средства, которых в Windows 7 и 8 нет.',
              'No. Flushot is built for Windows 10 and 11 and will not start on older systems. That is a limitation rather than an oversight: the program relies on interfaces that Windows 7 and 8 do not have.'
            )
          },
          {
            q: t('Почему Windows предупреждает при запуске?', 'Why does Windows warn me when I run it?'),
            a: t(
              'Файлы не подписаны сертификатом разработчика: сертификат платный, и для бесплатной программы его не покупают. SmartScreen поэтому показывает предупреждение — нажмите «Подробнее» → «Выполнить всё равно». Предупреждение говорит об отсутствии подписи, а не о содержимом файла.',
              'The binaries are not code-signed: a certificate costs money and is not bought for a free program. SmartScreen therefore warns — choose More info → Run anyway. The warning is about the missing signature, not about what the file contains.'
            )
          },
          {
            q: t('Сколько места занимает и как её удалить?', 'How big is it, and how do I remove it?'),
            a: t(
              'Установщик — около 105 МБ. Удаляется обычным способом: «Параметры» → «Приложения» → Flushot → «Удалить». Portable-версия удаляется вместе со своей папкой и ничего в системе не оставляет.',
              'The installer is about 105 MB. Removal is the ordinary way: Settings → Apps → Flushot → Uninstall. The portable build goes away with its folder and leaves nothing behind in the system.'
            )
          }
        ]
      }
    ]
  },

  // =======================================================================================
  {
    slug: 'rounded-screenshot',
    icon: 'frame',
    nav: t('Скруглённые углы', 'Rounded corners'),
    alsoAbout: t('рамка, скругление и тень', 'the border, the corners and the shadow'),
    title: t(
      'Скриншот со скруглёнными углами и тенью на Windows — Flushot',
      'Rounded Corner Screenshots for Windows — Flushot'
    ),
    description: t(
      'Скруглённые углы, рамка и тень применяются в момент снимка: в буфер попадает готовая карточка. Радиус, цвет фона и тень настраиваются.',
      'Rounded corners, a border and a shadow are applied at capture time, so the clipboard gets a finished card. Radius, colour and shadow are adjustable.'
    ),
    ogTitle: t('Скриншоты со скруглёнными углами и тенью', 'Rounded Corner Screenshots'),
    h1: t(
      'Скриншоты со скруглёнными углами и тенью',
      'Create Beautiful Screenshots with Rounded Corners'
    ),
    eyebrow: t('Оформление в момент снимка · бесплатно', 'Styled at capture time · free'),
    lead: t(
      'Скруглённые углы, рамка и тень — не отдельный редактор, а часть самого снимка. Вы отпускаете мышь и получаете готовую карточку: её можно вставить в презентацию или отправить в чат, ничего не дорабатывая.',
      'Rounded corners, a border and a shadow are not a separate editor — they are part of the capture itself. You release the mouse and get a finished card that goes straight into a slide deck or a chat with no further work.'
    ),
    heroImage: 'hero',
    heroAlt: t(
      'Снимок окна со скруглёнными углами, белой рамкой и мягкой тенью.',
      'A screenshot with rounded corners, a white border and a soft shadow.'
    ),
    blocks: [
      {
        type: 'features',
        title: t('Что можно настроить', 'What you can adjust'),
        lead: t(
          'Четыре параметра, и все они видны в предпросмотре сразу — без пересъёмки и без «применить и посмотреть».',
          'Four parameters, all visible in the preview immediately — no re-capture and no "apply and hope".'
        ),
        items: [
          {
            icon: 'frame',
            name: t('Радиус скругления', 'Corner radius'),
            text: t(
              'Углы скругляются на выбранную величину. Значение применяется к снимку, а не к рамке вокруг него.',
              'Corners are rounded by the chosen amount. The value applies to the picture itself, not to a frame drawn around it.'
            )
          },
          {
            icon: 'screen',
            name: t('Цвет фона', 'Background colour'),
            text: t(
              'Фон под карточкой — свой цвет, поэтому снимок читается и на светлой, и на тёмной странице документа.',
              'The background behind the card is a colour you pick, so the picture reads well on both a light and a dark page.'
            )
          },
          {
            icon: 'pen',
            name: t('Толщина рамки', 'Border width'),
            text: t(
              'Рамка отделяет снимок от фона. Толщина настраивается, вплоть до полного отказа от неё.',
              'The border separates the picture from the background. Its width is adjustable, down to removing it altogether.'
            )
          },
          {
            icon: 'blur',
            name: t('Сила тени', 'Shadow strength'),
            text: t(
              'Тень мягкая, с настраиваемой интенсивностью — от почти незаметной до заметной.',
              'The shadow is soft, with adjustable intensity — from barely visible to clearly present.'
            )
          },
          {
            icon: 'clock',
            name: t('Без второго шага', 'No second step'),
            text: t(
              'Оформление применяется при съёмке. Открывать редактор и что-то дорисовывать не нужно — это экономит время на каждом снимке.',
              'The styling is applied during capture. There is no editor to open and nothing to draw afterwards, which saves time on every single screenshot.'
            )
          },
          {
            icon: 'text',
            name: t('И в файле, и в буфере', 'In the file and on the clipboard'),
            text: t(
              'Оформленная карточка — это и то, что попадает в буфер обмена, и то, что записывается в файл. Предпросмотр и результат совпадают по растру.',
              'The styled card is both what reaches the clipboard and what is written to the file. The preview and the result are the same raster.'
            )
          }
        ]
      },
      {
        type: 'figure',
        image: 'hero',
        alt: t(
          'Карточка со скруглёнными углами: рамка, тень и ровный фон вокруг снимка.',
          'A card with rounded corners: border, shadow and a clean background around the screenshot.'
        ),
        caption: t(
          'Рамка, скругление и тень рисуются один раз, при съёмке. Дальше карточка живёт как обычная картинка.',
          'The border, the rounding and the shadow are drawn once, at capture. After that the card is just a picture.'
        )
      },
      {
        type: 'steps',
        title: t('Как получить такой снимок', 'How to get a screenshot like this'),
        lead: t(
          'Настроить один раз, дальше — только клавиша.',
          'Set it up once; after that it is just the shortcut.'
        ),
        items: [
          {
            name: t('Откройте настройки', 'Open the settings'),
            text: t(
              'Значок в трее → «Настройки». Раздел с оформлением — там же, где формат файла и горячие клавиши.',
              'Tray icon → Settings. The styling section sits next to the file format and the shortcuts.'
            )
          },
          {
            name: t('Выставьте радиус, рамку, фон и тень', 'Set radius, border, background and shadow'),
            text: t(
              'Значения сохраняются сразу. Пересобирать программу или перезапускать её не нужно: следующий снимок уже будет с новыми настройками.',
              'Values are saved immediately. There is no rebuild and no restart: the next screenshot already uses the new settings.'
            )
          },
          {
            name: t('Снимите область', 'Capture a region'),
            text: t(
              'По умолчанию Ctrl+Shift+S. Экран замирает в момент нажатия, поэтому в снимок не попадёт ничего, что появилось позже.',
              'Ctrl+Shift+S by default. The screen freezes the moment the key goes down, so nothing that appears later gets into the picture.'
            )
          },
          {
            name: t('Вставьте через Ctrl+V', 'Paste with Ctrl+V'),
            text: t(
              'Отпустили мышь — карточка в буфере обмена. Рамка, скругление и тень уже внутри, дорисовывать нечего.',
              'Release the mouse and the card is on the clipboard — border, rounding and shadow included, with nothing left to draw.'
            )
          }
        ]
      },
      {
        type: 'prose',
        title: t('Почему это делается при съёмке, а не потом', 'Why this happens at capture, not afterwards'),
        paragraphs: [
          t(
            'Обычный путь — снять экран, открыть графический редактор, обрезать, скруглить углы, добавить рамку и тень, экспортировать. На один снимок уходит несколько минут, и на десятом повторении их становится жаль. Flushot переносит эту работу в то место, где она ничего не стоит: в момент, когда снимок и так создаётся.',
            'The usual route is: capture the screen, open a graphics editor, crop, round the corners, add a border and a shadow, export. That costs a few minutes per screenshot, and by the tenth one those minutes start to hurt. Flushot moves the work to where it costs nothing — the moment the picture is already being made.'
          ),
          t(
            'Побочная выгода — единообразие. Десять снимков для одной инструкции, сделанных одной программой с одними настройками, выглядят как серия. Сделанные вручную в разные дни — как десять разных картинок.',
            'A side benefit is consistency. Ten screenshots for one document, made by the same program with the same settings, look like a series. Made by hand on different days, they look like ten unrelated pictures.'
          )
        ]
      },
      {
        type: 'figure',
        image: 'settings',
        alt: t(
          'Раздел оформления в настройках: радиус скругления, цвет фона, толщина рамки и сила тени.',
          'The styling section in the settings: corner radius, background colour, border width and shadow strength.'
        ),
        caption: t(
          'Настройки оформления. Меняются один раз и применяются к каждому следующему снимку.',
          'The styling settings. Changed once, applied to every screenshot after that.'
        )
      },
      {
        type: 'prose',
        title: t('Чего эти настройки не умеют', 'What these settings do not do'),
        paragraphs: [
          t(
            'Оформить уже готовый скриншот программа не может: рамка, скругление и тень применяются к тому снимку, который делается сейчас. Файл, найденный на диске, через Flushot не оформить — нужен новый снимок или другой инструмент.',
            'The program cannot style a screenshot you already have: the border, rounding and shadow apply to the picture being captured right now. A file found on disk cannot be sent through Flushot — that needs a fresh capture or a different tool.'
          ),
          t(
            'Пометки — отдельная история: они вшиваются в файл при сохранении, и убрать одну из них после сохранения нельзя. Единственная отмена — до сохранения, через Ctrl+Z.',
            'Annotations are a separate matter: they are baked into the file when it is saved, and a single one cannot be removed afterwards. The only undo is before saving, with Ctrl+Z.'
          )
        ]
      },
      {
        type: 'faq',
        title: t('Частые вопросы', 'Frequent questions'),
        items: [
          {
            q: t('Углы будут прозрачными или залитыми?', 'Will the corners be transparent or filled?'),
            a: t(
              'Место, освободившееся от скруглённых углов, заполняется выбранным цветом фона — так карточка выглядит одинаково и на светлом, и на тёмном фоне документа. Цвет фона задаётся в том же разделе настроек.',
              'The space freed by the rounded corners is filled with the chosen background colour, so the card looks the same on a light or a dark page. The background colour is set in the same part of the settings.'
            )
          },
          {
            q: t('Можно ли сделать углы прямыми?', 'Can the corners stay square?'),
            a: t(
              'Да: радиус скругления настраивается, и при нулевом значении углы остаются прямыми. Рамку и тень тоже можно убрать — тогда снимок будет обычным прямоугольником.',
              'Yes: the radius is adjustable, and at zero the corners stay square. The border and the shadow can be removed too, leaving an ordinary rectangle.'
            )
          },
          {
            q: t('Настройки применяются к следующему снимку?', 'Do the settings apply to the next screenshot?'),
            a: t(
              'Да, сразу. Сохранённые значения действуют с первого же снимка после изменения — перезапускать программу не нужно.',
              'Yes, immediately. Saved values take effect from the very next capture — no restart needed.'
            )
          },
          {
            q: t('В каком формате сохраняется карточка?', 'What format is the card saved in?'),
            a: t(
              'На выбор: PNG без потерь, JPEG с настраиваемым качеством или WebP. Для вставки в документ формат не важен — в буфере обмена оказывается уже готовое изображение.',
              'Your choice: lossless PNG, JPEG with adjustable quality, or WebP. For pasting into a document the format does not matter — the clipboard already holds a finished image.'
            )
          },
          {
            q: t('Пострадает ли качество снимка?', 'Does the picture lose quality?'),
            a: t(
              'Снимок делается в физических пикселях монитора, поэтому при масштабе 125 % или 150 % он не мыльный. В PNG он сохраняется без пережатия, то есть совпадает с выбранной областью побайтово.',
              'The capture happens in the monitor\u2019s physical pixels, so at 125 % or 150 % scaling it is not blurry. In PNG it is stored without recompression, matching the selected region byte for byte.'
            )
          }
        ]
      }
    ]
  },

  // =======================================================================================
  {
    slug: 'screenshot-annotation',
    icon: 'pen',
    nav: t('Пометки на снимках', 'Annotations'),
    alsoAbout: t('стрелки, шаги и размытие', 'arrows, steps and blur'),
    title: t(
      'Пометки на скриншотах: стрелки, рамки, размытие — Flushot',
      'Screenshot Annotation Tool for Windows — Flushot'
    ),
    description: t(
      'Стрелки, рамки, карандаш, текст, шаги и размытие — семь инструментов прямо на снимке. Пометки вшиваются в файл при сохранении.',
      'Arrows, boxes, a pencil, text, numbered steps and blur — seven tools on the screenshot itself. Annotations are baked in when you save.'
    ),
    ogTitle: t('Пометки на скриншотах', 'Screenshot Annotation'),
    h1: t(
      'Пометки на скриншотах: стрелки, рамки, размытие',
      'Screenshot Annotation Tool for Windows'
    ),
    eyebrow: t('Семь инструментов · Windows 10 и 11', 'Seven tools · Windows 10 and 11'),
    lead: t(
      'Обвести место, на которое надо смотреть, поставить стрелку, спрятать персональные данные под размытием — прямо на снимке, не открывая отдельного редактора. Пометки вшиваются в картинку при сохранении.',
      'Circle the thing people should look at, add an arrow, hide personal data under a blur — on the screenshot itself, without opening a separate editor. The annotations are baked into the picture when it is saved.'
    ),
    heroImage: 'annotate',
    heroAlt: t(
      'Окно Flushot с панелью пометок и снимком, на котором нарисованы стрелка, рамка и размытие.',
      'The Flushot window with the annotation toolbar and a screenshot showing an arrow, a box and a blur.'
    ),
    blocks: [
      {
        type: 'features',
        title: t('Семь инструментов', 'Seven tools'),
        lead: t(
          'Все работают на самом снимке и остаются в нём после сохранения.',
          'All of them work on the picture itself and stay in it after saving.'
        ),
        items: [
          {
            icon: 'arrow',
            name: t('Стрелка', 'Arrow'),
            text: t(
              'Показать, куда именно смотреть. Самый быстрый способ объяснить правку на скриншоте.',
              'Point at the exact spot. The quickest way to explain a change on a screenshot.'
            )
          },
          {
            icon: 'pen',
            name: t('Линия и карандаш', 'Line and pencil'),
            text: t(
              'Ровная линия прилипает к 0°, 45° и 90° при зажатом Shift, а карандаш годится для всего остального.',
              'A straight line snaps to 0°, 45° and 90° while Shift is held, and the pencil covers everything else.'
            ),
            tag: t('Shift · 0°/45°/90°', 'Shift · 0°/45°/90°')
          },
          {
            icon: 'frame',
            name: t('Прямоугольник', 'Rectangle'),
            text: t(
              'Обвести область целиком, когда стрелки недостаточно и нужен контур.',
              'Outline a whole area when an arrow is not enough and you need the boundary.'
            )
          },
          {
            icon: 'text',
            name: t('Текст', 'Text'),
            text: t(
              'Подпись прямо на снимке. Не нужно потом сводить картинку с отдельным текстовым слоем.',
              'A caption right on the picture, with no separate text layer to combine afterwards.'
            )
          },
          {
            icon: 'clock',
            name: t('Нумерованные шаги', 'Numbered steps'),
            text: t(
              'Последовательность 1, 2, 3 — для инструкций, где важен порядок, а не отдельные места.',
              'A 1, 2, 3 sequence for instructions where the order matters more than the individual spots.'
            )
          },
          {
            icon: 'blur',
            name: t('Размытие', 'Blur'),
            text: t(
              'Спрятать почту, телефон, номер заказа или имя клиента перед тем, как отправить снимок коллеге.',
              'Hide an email address, a phone number, an order number or a customer name before sending the screenshot to a colleague.'
            )
          },
          {
            icon: 'cursor',
            name: t('Живой размер', 'Live size'),
            text: t(
              'Пока тянете рамку, рядом обновляется размер в пикселях — видно, влезет ли снимок в документ.',
              'The size in pixels updates next to the frame as you drag, so you can see whether the picture will fit the document.'
            )
          }
        ]
      },
      {
        type: 'figure',
        image: 'annotate',
        alt: t(
          'Панель пометок внизу окна: выбор инструмента и готовый снимок с пометками.',
          'The annotation toolbar at the bottom of the window, next to a screenshot with annotations applied.'
        ),
        caption: t(
          'Пометки кладутся поверх снимка в том порядке, в котором вы их ставите. Ctrl+Z убирает последнюю.',
          'Annotations are layered onto the picture in the order you add them. Ctrl+Z removes the last one.'
        )
      },
      {
        type: 'steps',
        title: t('Как поставить пометку', 'How to add an annotation'),
        lead: t(
          'Пометки живут в том же окне, где делается снимок.',
          'Annotations live in the same window as the capture.'
        ),
        items: [
          {
            name: t('Снимите область, удерживая Shift', 'Capture a region while holding Shift'),
            text: t(
              'Shift при отпускании мыши оставляет окно на экране. Без него снимок просто уходит в буфер обмена — это и есть обычный режим.',
              'Releasing with Shift held keeps the window on screen. Without it the picture just goes to the clipboard, which is the normal mode.'
            )
          },
          {
            name: t('Выберите инструмент', 'Pick a tool'),
            text: t(
              'Панель внизу окна: стрелка, линия, прямоугольник, карандаш, текст, шаги, размытие. Выбранный инструмент остаётся активным, пока вы его не смените.',
              'The toolbar at the bottom: arrow, line, rectangle, pencil, text, steps, blur. The chosen tool stays active until you change it.'
            )
          },
          {
            name: t('Нарисуйте пометку', 'Draw the annotation'),
            text: t(
              'Каждая следующая пометка ложится поверх предыдущих. Ctrl+Z убирает последнюю.',
              'Each new annotation goes on top of the previous ones. Ctrl+Z removes the last one.'
            )
          },
          {
            name: t('Сохраните или скопируйте', 'Save or copy'),
            text: t(
              'Ctrl+S записывает файл, Ctrl+C кладёт готовую карточку в буфер обмена. В обоих случаях пометки уже внутри.',
              'Ctrl+S writes the file, Ctrl+C puts the finished card on the clipboard. Either way the annotations are already in it.'
            )
          }
        ]
      },
      {
        type: 'prose',
        title: t('Пометки вшиваются в файл — что это значит', 'Annotations are baked in — what that means'),
        paragraphs: [
          t(
            'Сохранённый снимок — обычная картинка: пометки не лежат отдельным слоем, который можно включить или выключить. Это плюс, когда снимок уходит в чат или в задачу: он откроется везде, где открывается PNG. И это минус, когда пометку нужно убрать: после сохранения — только новый снимок.',
            'A saved screenshot is an ordinary picture: the annotations are not a separate layer that can be turned on or off. That is an advantage when the picture goes into a chat or an issue tracker, because it opens anywhere a PNG opens. It is a disadvantage when an annotation has to be removed, because after saving the only option is a fresh capture.'
          ),
          t(
            'Пока окно открыто, всё поправимо: Ctrl+Z убирает последнюю пометку, инструмент можно сменить и нарисовать заново. Момент, после которого изменения необратимы, — сохранение.',
            'While the window is open, everything is still fixable: Ctrl+Z removes the last annotation, and a tool can be swapped and redrawn. The point of no return is saving.'
          )
        ]
      },
      {
        type: 'prose',
        title: t('Зачем размытие, если можно обрезать', 'Why blur rather than simply cropping'),
        paragraphs: [
          t(
            'Обрезать можно только край. Пароль, адрес почты или имя клиента часто оказываются в середине снимка — между тем, что нужно показать, и тем, что тоже нужно показать. Размытие прячет ровно один участок и оставляет остальное на месте. Это единственный из инструментов, который относится не к оформлению, а к приватности.',
            'Cropping only works at the edge. A password, an email address or a customer name is often in the middle of the picture — between the part that has to be shown and the part that also has to be shown. Blur hides exactly one area and leaves the rest where it was. It is the one tool here that is about privacy rather than presentation.'
          ),
          t(
            'Размытие накладывается так же, как любая другая пометка, и так же вшивается в файл. На снимок, который уже лежит в буфере обмена, оно не влияет: буфер получает то, что вы сохранили.',
            'Blur is applied like any other annotation and is baked into the file the same way. It does not affect a picture already sitting on the clipboard: the clipboard receives what you saved.'
          )
        ]
      },
      {
        type: 'faq',
        title: t('Частые вопросы', 'Frequent questions'),
        items: [
          {
            q: t('Можно ли удалить одну пометку после сохранения?', 'Can one annotation be removed after saving?'),
            a: t(
              'Нет. После сохранения пометки — часть картинки. Убрать последнюю можно до сохранения через Ctrl+Z, а после — только сделать новый снимок.',
              'No. Once saved, the annotations are part of the picture. The last one can be removed with Ctrl+Z before saving; afterwards only a fresh capture will do.'
            )
          },
          {
            q: t('Пометки попадут в буфер обмена?', 'Do the annotations reach the clipboard?'),
            a: t(
              'Да, если нажать Ctrl+C в окне с пометками: в буфер уйдёт та же карточка, что и в файл, — с рамкой, скруглением и всеми пометками.',
              'Yes, if you press Ctrl+C in the annotation window: the clipboard gets the same card as the file, with the border, the rounding and every annotation.'
            )
          },
          {
            q: t('Сколько пометок можно поставить?', 'How many annotations can I add?'),
            a: t(
              'Столько, сколько нужно: число не ограничено, ограничено только место на экране. Каждая следующая ложится поверх предыдущих.',
              'As many as you need: there is no limit on the count, only on the screen space. Each new one goes on top of the previous ones.'
            )
          },
          {
            q: t('Можно ли дорисовать пометку на старом снимке?', 'Can I annotate a screenshot I already have?'),
            a: t(
              'Нет. Пометки живут в окне, которое открывается при съёмке. Открыть существующий файл и дорисовать в нём Flushot не умеет — для этого нужен графический редактор.',
              'No. Annotations live in the window that opens during a capture. Flushot cannot open an existing file and draw on it; that needs a graphics editor.'
            )
          },
          {
            q: t('Можно ли подписать пометку текстом?', 'Can an annotation carry text?'),
            a: t(
              'Да, инструмент «Текст» ставит подпись прямо на снимке. Для последовательностей есть нумерованные шаги 1, 2, 3 — они нумеруются сами.',
              'Yes, the Text tool puts a caption right on the picture. For sequences there are numbered steps 1, 2, 3, which number themselves.'
            )
          },
          {
            q: t('Нужен ли интернет для пометок?', 'Do annotations need the internet?'),
            a: t(
              'Нет. Всё происходит на вашем компьютере: снимок, пометки и сохранение никуда не отправляются.',
              'No. Everything happens on your machine: the capture, the annotations and the save never leave it.'
            )
          }
        ]
      }
    ]
  }
]

module.exports = { PAGES, t }
