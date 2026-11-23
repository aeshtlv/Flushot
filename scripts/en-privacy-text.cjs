/**
 * English text for site/privacy.html.
 *
 * Same contract as `en-page-text.cjs`: each entry is an exact substring of the
 * Russian page and its English replacement. The build fails when an entry matches
 * nothing, so a reworded Russian paragraph cannot silently keep an old English one.
 */

module.exports = [
  ['<title>Приватность — Flushot</title>', '<title>Privacy — Flushot</title>'],
  [
    '<meta name="description" content="Что Flushot отправляет в сеть, что собирает этот сайт и как отказаться от статистики.">',
    '<meta name="description" content="What Flushot sends over the network, what this site collects, and how to opt out of the statistics.">'
  ],

  // Chrome
  ['>Перейти к содержимому<', '>Skip to content<'],
  ['aria-label="Flushot — на главную"', 'aria-label="Flushot — home"'],

  // The document itself
  ['>Документ<', '>Document<'],
  ['<h1 class="legal__title">Приватность</h1>', '<h1 class="legal__title">Privacy</h1>'],
  [
    'Коротко: программа ничего о вас не отправляет, а сайт считает посещения только\n    с вашего согласия. Ниже — подробно, без формулировок «мы можем передавать данные партнёрам».',
    'In short: the program sends nothing about you, and this site counts visits only\n    with your consent. The details follow, without “we may share data with partners” wording.'
  ],
  ['Обновлено 22 ноября 2026 года.', 'Last updated 22 November 2026.'],

  // The program
  ['Программа Flushot', 'The Flushot program'],
  [
    'Снимки, оформление рамки, пометки и распознавание текста происходят на вашем компьютере. Ни\n    снимок, ни его содержимое, ни имена файлов никуда не отправляются — в программе нет ни аккаунта,\n    ни аналитики, ни идентификатора установки.',
    'Screenshots, the frame around them, annotations and text recognition all happen on your computer.\n    Neither the picture, nor its contents, nor file names are sent anywhere — the program has no\n    account, no analytics and no install identifier.'
  ],
  [
    'Один запрос в сутки программа делает сама: спрашивает у GitHub, не вышла ли новая версия, и если\n    вышла — скачивает её в фоне. Других обращений нет, и этот запрос выключается переключателем\n    «Обновления» в настройках, после чего сеть не используется совсем. Владелец адреса\n    <code>api.github.com</code> видит IP-адрес вашего компьютера и версию программы — как при любом\n    обращении к любому сайту.',
    'Once a day the program asks GitHub whether a new version exists and, if it does, downloads it in\n    the background. There are no other requests, and this one can be switched off in settings under\n    “Updates”, after which the program does not use the network at all. The owner of\n    <code>api.github.com</code> sees your computer’s IP address and the program version — as with any\n    request to any site.'
  ],
  [
    'Скачивание файла с GitHub идёт через <code>github.com</code> и учитывается в счётчике скачиваний\n    на странице релиза. Это счётчик скачиваний, а не установок, и он не связан с конкретным\n    человеком.',
    'Downloading a file from GitHub goes through <code>github.com</code> and is counted on the release\n    page. That counter measures downloads, not installations, and it is not tied to any particular\n    person.'
  ],

  // Uploaded pictures
  ["Снимки, загруженные по ссылке", "Pictures uploaded as a link"],
  ["Одна из трёх горячих клавиш — «Со ссылкой» — отправляет снимок на сервер и кладёт в буфер\n    обмена ссылку на него. Это единственный случай, когда снимок покидает ваш компьютер. Две другие\n    клавиши работают только локально, и нажимать эту никто не обязан.", "One of the three shortcuts, “With a link”, sends the picture to a server and puts a link to it on the clipboard. That is the only case in which a picture leaves your computer. The other two keys work locally only, and nobody has to press this one."],
  ["<strong>Что хранится.</strong> Готовый снимок целиком — тот же файл, который вы увидели бы при\n    сохранении: рамка, тень и пометки уже впечатаны. Больше ничего: ни имени файла, ни вашего\n    имени, ни аккаунта. Имя файла на сервере — шестнадцать случайных символов, поэтому содержимое\n    ссылки не связано ни с вами, ни с другими снимками.", "<strong>What is stored.</strong> The finished picture as a whole — the same file you would get by saving it, with the frame, the shadow and the annotations already baked in. Nothing else: no file name, no name of yours, no account. The name on the server is sixteen random characters, so the link is tied neither to you nor to any other picture."],
  ["<strong>Сколько хранится.</strong> Ровно один час с момента загрузки. Затем снимок удаляется с\n    сервера автоматически — не «может быть удалён», а удаляется: этим занимается отдельная задача,\n    которая запускается каждую минуту. После этого по ссылке открывается страница «Ссылка истекла».\n    Тот, у кого ссылка уже открыта в браузере, увидит снимок до конца часа; заранее сохранённую\n    копию, разумеется, отозвать нельзя.", "<strong>How long it is kept.</strong> Exactly one hour from the upload. After that the picture is deleted from the server automatically — not “may be deleted”, but deleted: a separate task runs every minute and does it. The link then shows a “Link expired” page. Someone who already has the picture open in a browser will see it until the hour is up; a copy saved beforehand cannot, of course, be recalled."],
  ["<strong>Кто может увидеть.</strong> Любой, у кого есть ссылка: пароля на ней нет. Ссылка\n    трудноподбираемая, но публичная — не отправляйте её туда, где её увидят не те, кому вы её дали.\n    Поисковые системы ссылку не индексируют, и сервер прямо запрещает индексацию ответом\n    <code>X-Robots-Tag</code>.", "<strong>Who can see it.</strong> Anyone holding the link: there is no password on it. The link is hard to guess but public — do not post it anywhere the wrong people will see it. Search engines do not index it, and the server forbids indexing outright with an <code>X-Robots-Tag</code> header."],
  ["<strong>Журналы.</strong> Сервер записывает факт загрузки: время, размер и IP-адрес, как и любой\n    веб-сервер. Журналы хранятся десять дней. Содержимое снимка в журналы не попадает.", "<strong>Logs.</strong> The server records the upload itself: time, size and IP address, as every web server does. The logs are kept for ten days. The contents of the picture never reach them."],
  ["<strong>Если снимок загрузили без вашего согласия.</strong> Ссылку можно погасить раньше срока:\n    <code>DELETE https://flushot.ink/api/shot/&lt;часть ссылки без расширения&gt;</code> удаляет файл\n    немедленно. По этому же адресу можно написать, если что-то пошло не так.", "<strong>If a picture was uploaded without your consent.</strong> The link can be cancelled early: <code>DELETE https://flushot.ink/api/shot/&lt;the link without its extension&gt;</code> deletes the file immediately. The same address is where to write if something went wrong."],

  // The site
  ['Этот сайт', 'This site'],
  [
    'Сайт — статическая страница. Форм, регистрации и комментариев на нём нет, поэтому нет и данных,\n    которые можно было бы сохранить о вас как о пользователе.',
    'The site is a static page. It has no forms, no sign-up and no comments, so there is no user data\n    that could be stored about you.'
  ],
  [
    '<strong>Статистика посещений.</strong> Чтобы знать, сколько людей заходит на сайт и откуда они\n    приходят, используется Яндекс.Метрика. Она включается только после нажатия «Принять» в\n    уведомлении о cookie. Если вы нажали «Отклонить», скрипт Метрики не загружается вообще: ни\n    cookie, ни запроса на серверы Яндекса.',
    '<strong>Visit statistics.</strong> To know how many people visit the site and where they come\n    from, Yandex.Metrika is used. It starts only after “Accept” is pressed in the cookie notice. If you\n    press “Decline”, the Metrika script is not loaded at all: no cookie and no request to Yandex\n    servers.'
  ],
  [
    'Когда статистика включена, Яндекс получает: адрес страницы, IP-адрес и регион, определённый по\n    нему, тип браузера и операционной системы, размер окна, адрес страницы, с которой вы перешли,\n    и сведения о прокрутке и кликах по этой странице (карта кликов). Cookie Метрики хранятся до\n    одного года. Мы видим только сведённые отчёты: сколько было визитов, из каких поисковых систем,\n    какие кнопки нажимали. Мы не сопоставляем эти данные с вами и не передаём их никому, кроме\n    Яндекса, который эти данные и собирает.',
    'With statistics enabled, Yandex receives: the page address, your IP address and the region\n    derived from it, browser and operating system, window size, the address of the page you arrived\n    from, and information about scrolling and clicks on this page (the click map). Metrika cookies are\n    kept for up to one year. We see aggregated reports only: how many visits there were, which search\n    engines sent them, which buttons were pressed. We do not link this data to you and pass it to\n    nobody except Yandex, which collects it in the first place.'
  ],
  [
    'Обработка данных в Метрике описана в документах Яндекса: <a href="https://yandex.ru/legal/metrica_termsofuse/">условия\n    использования сервиса</a> и <a href="https://yandex.ru/legal/confidential/">политика\n    конфиденциальности</a>.',
    'How Metrika handles data is described in Yandex’s own documents: the <a href="https://yandex.ru/legal/metrica_termsofuse/">terms\n    of service</a> and the <a href="https://yandex.ru/legal/confidential/">privacy policy</a>.'
  ],

  // Server logs
  ['Журналы сервера', 'Server logs'],
  [
    'Сервер, на котором стоит страница, записывает обращения обычным журналом nginx: IP-адрес, дату,\n    адрес страницы и имя браузера. Это нужно, чтобы находить ошибки и отсекать мусорный трафик.\n    Журналы хранятся десять дней и затем удаляются автоматически.',
    'The server that hosts the page records requests in a plain nginx log: IP address, date, page\n    address and browser name. This is what makes it possible to find faults and keep junk traffic out.\n    The logs are kept for ten days and then deleted automatically.'
  ],

  // Opting out
  ['Как отказаться', 'How to opt out'],
  [
    'Кнопка ниже стирает сохранённый ответ, так что при следующем заходе уведомление спросит снова —\n    и можно ответить «Отклонить». Если статистика уже была включена, отказ отключает загрузку скрипта\n    на будущее; ранее поставленные cookie Метрики удаляются средствами браузера.',
    'The button below erases the stored answer, so the notice will ask again on your next visit — and\n    you can answer “Decline”. If statistics were already enabled, declining stops the script from\n    loading in future; cookies Metrika already set are removed with your browser’s own tools.'
  ],
  ['>Сбросить согласие на статистику<', '>Reset statistics consent<'],

  // History
  ['Что менялось', 'What changed'],
  [
    'Эта страница появилась 22 ноября 2026 года вместе со счётчиком посещений. До неё сайт не ставил\n    cookie и не подключал сторонних скриптов — и до появления счётчика это было видно по исходному\n    коду страницы.',
    'This page appeared on 22 November 2026, together with the visit counter. Before it, the site set\n    no cookies and loaded no third-party scripts — and before the counter existed, that was visible in\n    the page source.'
  ],

  // Footer and the way back
  ['>← Вернуться на сайт<', '>← Back to the site<'],
  ['aria-label="Навигация в подвале"', 'aria-label="Footer navigation"'],
  ['>Главная<', '>Home<'],
  ['>Скачать<', '>Download<'],
  ['>Вопросы<', '>Questions<'],
  ['<span>Версия 2.5.3 · © 2026 Flushot</span>', '<span>Version 2.5.3 · © 2026 Flushot</span>'],

  // Strings the reset button writes at runtime
  [
    '? \'Готово. Ответ стёрт — при следующем заходе уведомление спросит снова.\'',
    '? \'Done. The answer is erased — the notice will ask again on your next visit.\''
  ],
  [
    ': \'Браузер не даёт сохранять настройки сайта, поэтому ответ и не был записан.\'',
    ': \'The browser does not allow storing site settings, so no answer was ever saved.\''
  ]
]
