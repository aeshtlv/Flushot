/**
 * Russian → English for every visible string on the landing page.
 *
 * Each `from` is an exact substring of site/index.html, copied character for
 * character including its surrounding whitespace and any inline markup like
 * <kbd>Ctrl</kbd>. The build replaces longest first, so a short pair cannot
 * damage a longer one.
 */
module.exports = [
  // <head>
  ['Flushot — снимки экрана, готовые к вставке', 'Flushot — screenshots, ready to paste'],
  [
    'Flushot — бесплатная программа для снимков экрана на Windows 10 и 11. Выделили область, отпустили мышь — снимок уже в буфере обмена. Пометки, распознавание текста, работает без интернета.',
    'Flushot is a free screenshot program for Windows 10 and 11. Select a region, release the mouse — the screenshot is already in the clipboard. Annotations, text recognition, and it works without an internet connection.',
  ],
  ['Flushot — снимки экрана для Windows', 'Flushot — screenshots for Windows'],
  [
    'Отпустили кнопку мыши — готовый снимок уже в буфере обмена: рамка, тень и скруглённые углы применены. Пометки, распознавание текста, PNG без потерь. Windows 10 и 11, бесплатно.',
    'Release the mouse button — the finished screenshot is already in the clipboard: frame, shadow and rounded corners applied. Annotations, text recognition, lossless PNG. Windows 10 and 11, free.',
  ],
  [
    'Готовый снимок в буфере обмена в момент отпускания мыши. Пометки, распознавание текста, PNG без потерь. Windows 10 и 11, бесплатно.',
    'A finished screenshot in the clipboard the moment you release the mouse. Annotations, text recognition, lossless PNG. Windows 10 and 11, free.',
  ],

  // Skip link and header
  ['Перейти к содержимому', 'Skip to content'],
  ['aria-label="Flushot — на главную"', 'aria-label="Flushot — home"'],
  ['aria-label="Меню"', 'aria-label="Menu"'],
  ['aria-label="Основная навигация"', 'aria-label="Main navigation"'],
  ['>Попробовать<', '>Try it<'],
  ['>Возможности<', '>Features<'],
  ['>Как работает<', '>How it works<'],
  ['>Клавиши<', '>Hotkeys<'],
  ['>Скриншоты<', '>Screenshots<'],
  ['>Вопросы<', '>Questions<'],
  ['>Скачать<', '>Download<'],
  ['>Приватность<', '>Privacy<'],
  ['aria-label="Переключить на светлую тему"', 'aria-label="Switch to light theme"'],

  // Hero
  ['Windows 10 и 11 · версия 2.5.0 · бесплатно', 'Windows 10 and 11 · version 2.5.0 · free'],
  ['<span>Снимок экрана,</span>', '<span>A screenshot</span>'],
  ['<span>готовый к вставке</span>', '<span>ready to paste</span>'],
  [
    'Выделили область и отпустили кнопку мыши — снимок уже в буфере обмена: с рамкой, тенью\n        и скруглёнными углами. Нажимать <kbd>Ctrl</kbd>+<kbd>C</kbd> не нужно. Пометки,\n        распознавание текста и сохранение в файл — в этой же программе.',
    'Select a region and release the mouse button — the screenshot is already in the clipboard, with a frame, a shadow and rounded corners. There is no need to press <kbd>Ctrl</kbd>+<kbd>C</kbd>. Annotations, text recognition and saving to a file are in the same program.',
  ],
  ['Скачать для Windows', 'Download for Windows'],
  ['>Что внутри<', '>What’s inside<'],
  ['Без рекламы и телеметрии ·', 'No ads and no telemetry ·'],
  ['установщик обновляется сам', 'the installer updates itself'],
  [
    'Снимок окна программы, оформленный Flushot: белая рамка, скруглённые углы и мягкая тень.',
    'A screenshot of the program window styled by Flushot: white frame, rounded corners and a soft shadow.',
  ],

  // "Try it" demo
  ['>Попробуйте<', '>Try it<'],
  ['>Выделите кусок этой страницы<', '>Select a piece of this page<'],
  [
    'Проведите мышью по окну — на отпускании получится карточка в рамке, ровно так же,\n          как это делает программа. Ничего не скачивая и ничего не отправляя.',
    'Drag across the window — on release you get a card in a frame, exactly the way the program does it. Nothing to download, nothing sent anywhere.',
  ],
  ['>Отчёт за квартал<', '>Quarterly report<'],
  ['>Третий квартал<', '>Third quarter<'],
  ['>Выручка выше плана на 14 %<', '>Revenue 14 % above plan<'],
  [
    'Рост дала подписка: 2 481 новый клиент за три месяца. Средний чек вырос\n                  до 1 240 ₽, отток держится на уровне 3,1 %.',
    'Subscription drove the growth: 2,481 new customers in three months. The average order value rose to ₽1,240, and churn held at 3.1 %.',
  ],
  [
    'Цифры за сентябрь ещё уточняются: часть возвратов придёт в октябре.',
    'The September figures are still being confirmed: some refunds will land in October.',
  ],
  ['>Проведите мышью<', '>Drag across it<'],
  ['>Проведите пальцем<', '>Drag with your finger<'],
  ['>Здесь появится снимок<', '>Your screenshot appears here<'],
  [
    'С рамкой, скруглёнными углами и тенью — та же карточка, которую вы получите\n              в программе.',
    'With a frame, rounded corners and a shadow — the same card you get in the program.',
  ],
  ['>в буфере обмена<', '>in the clipboard<'],
  ['Вставить', 'Paste'],
  ['>Ещё раз<', '>Once more<'],
  ['>Я<', '>Me<'],
  ['>Вы · только что<', '>You · just now<'],
  ['>Смотрите, как выросла выручка<', '>Look how much revenue has grown<'],

  // Features
  ['>Всё, что нужно от снимка экрана<', '>Everything you need from a screenshot<'],
  [
    'Девять вещей, из-за которых Flushot ставят вместо «Ножниц» Windows.',
    'Nine things that make people install Flushot instead of the Windows Snipping Tool.',
  ],
  ['>Сразу в буфере<', '>Straight to the clipboard<'],
  [
    'Отпустили кнопку мыши — снимок готов к вставке. Ни <kbd>Ctrl</kbd>+<kbd>C</kbd>, ни лишнего окна.',
    'Release the mouse button and the screenshot is ready to paste. No <kbd>Ctrl</kbd>+<kbd>C</kbd>, no extra window.',
  ],
  ['>выделил → вставил<', '>select → paste<'],
  ['>Ровная линия<', '>Straight line<'],
  [
    'Отдельный инструмент для подчёркивания. С зажатым Shift линия прилипает к 0°, 45° или 90°.',
    'A separate tool for underlining. With Shift held, the line snaps to 0°, 45° or 90°.',
  ],
  ['>Свои горячие клавиши<', '>Your own hotkeys<'],
  [
    'Обе клавиши назначаются в настройках — любые, какие удобны. Хоть Print Screen, хоть F1.',
    'Both keys are assigned in the settings — whatever suits you. Print Screen or F1, either works.',
  ],
  ['>Print Screen · F1 · любая<', '>Print Screen · F1 · anything<'],
  ['>Рамка, тень, углы<', '>Frame, shadow, corners<'],
  [
    'Цвет фона, толщина рамки, радиус скругления и сила тени — всё настраивается.',
    'Background colour, frame thickness, corner radius and shadow strength are all adjustable.',
  ],
  ['>Пометки<', '>Annotations<'],
  [
    'Стрелка, линия, прямоугольник, карандаш, текст, нумерованные шаги и размытие.',
    'Arrow, line, rectangle, pencil, text, numbered steps and blur.',
  ],
  ['>7 инструментов<', '>7 tools<'],
  ['>Два монитора<', '>Two monitors<'],
  [
    'Выделение тянется через границу экранов. Масштаб 125 % и 150 % не ломает ни рамку, ни снимок.',
    'The selection crosses the boundary between screens. 125 % and 150 % scaling breaks neither the frame nor the screenshot.',
  ],
  ['>Живой размер<', '>Live size<'],
  [
    'Размер в пикселях обновляется, пока тянете рамку. Рамку можно двигать целиком, менять за любой край — и панель никогда не уезжает за экран.',
    'The size in pixels updates as you drag the frame. You can move the whole frame, resize it from any edge, and the panel never slides off the screen.',
  ],
  ['>Без телеметрии<', '>No telemetry<'],
  [
    'Ни аналитики, ни входа в аккаунт. Снимок уходит в сеть только по отдельной клавише «Со ссылкой» — обычные две работают локально. Раз в сутки программа спрашивает у GitHub про новую версию, это отключается переключателем.',
    'No analytics, no account. A picture only leaves the computer through a separate key, “With a link” — the other two work locally. Once a day the program asks GitHub about a new version, and one switch turns that off.',
  ],
  ['>без аналитики<', '>no analytics<'],
  ['>Текст со снимка<', '>Text from a screenshot<'],
  [
    'Обведите на снимке фрагмент — «Текст» прочитает его встроенными движками Windows: без загрузки языков, без интернета и без отправки снимка куда-либо.',
    'Outline a fragment on the screenshot and “Text” reads it with the built-in Windows engines: no language downloads, no internet, and the screenshot is not sent anywhere.',
  ],
  ['>Windows OCR · офлайн, без загрузок<', '>Windows OCR · offline, no downloads<'],

  // How it works
  [
    'Терминал: в папке Изображения\\\\Flushot лежат снимки с датой в имени файла.',
    'Terminal: the Pictures\\Flushot folder holds screenshots with the date in the file name.',
  ],
  ['>Изображения\\Flushot<', '>Pictures\\Flushot<'],
  ['>Как это работает<', '>How it works<'],
  ['>Два шага, одно вставление<', '>Two steps, one paste<'],
  [
    '<strong>Нажмите свою клавишу.</strong> По умолчанию <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, но её можно сменить на любую. Экран затемняется.</span>',
    '<strong>Press your key.</strong> By default it is <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, but you can change it to any key. The screen dims.</span>',
  ],
  [
    '<strong>Отпустите мышь.</strong> Размер показан рядом с рамкой и обновляется на ходу. В момент отпускания снимок уже в буфере обмена — остаётся нажать <kbd>Ctrl</kbd>+<kbd>V</kbd> там, куда его вставляете.</span>',
    '<strong>Release the mouse.</strong> The size is shown next to the frame and updates as you drag. By the moment you let go, the screenshot is already in the clipboard — all that is left is <kbd>Ctrl</kbd>+<kbd>V</kbd> wherever you are pasting it.</span>',
  ],
  [
    'PNG без потерь · файл в папке · пометки по <kbd>Shift</kbd>',
    'Lossless PNG · saved to a file · annotations with <kbd>Shift</kbd>',
  ],

  // Before / after
  ['>Разница<', '>The difference<'],
  ['>Одна минута в редакторе — или ни одной<', '>A minute in an editor — or none at all<'],
  [
    'Что происходит со снимком до и после Flushot.',
    'What happens to a screenshot before and after Flushot.',
  ],
  ['>Как обычно<', '>The usual way<'],
  [
    'Снимок обрезан по краю окна, снизу белая полоса',
    'The screenshot is cropped at the window edge, with a white strip along the bottom',
  ],
  [
    'Тень и углы не совпадают с макетом, приходится править руками',
    'The shadow and corners do not match the design, so you fix them by hand',
  ],
  [
    'Подчёркивание «почти горизонтальное» — и это видно',
    'The underline is “almost horizontal” — and it shows',
  ],
  [
    'Файл <code>screenshot.png</code> перезаписал предыдущий',
    'The file <code>screenshot.png</code> overwrote the previous one',
  ],
  ['>С Flushot<', '>With Flushot<'],
  [
    'Снимок сразу в рамке с тенью и скруглением',
    'The screenshot arrives already framed, with a shadow and rounded corners',
  ],
  [
    'Линия с Shift встаёт строго по 0°, 45° или 90°',
    'With Shift, the line locks to exactly 0°, 45° or 90°',
  ],
  [
    'Имя с датой: <code>screenshot_2026-10-21_10-34-11.png</code>',
    'The name carries the date: <code>screenshot_2026-10-21_10-34-11.png</code>',
  ],
  [
    'Клавиши под себя — <kbd>Print Screen</kbd>, <kbd>F1</kbd>, что удобно',
    'Hotkeys to suit you — <kbd>Print Screen</kbd>, <kbd>F1</kbd>, whatever is convenient',
  ],

  // Hotkey demo
  ['>Горячие клавиши<', '>Hotkeys<'],
  ['>Клавиши — ваши, а не наши<', '>The keys are yours, not ours<'],
  [
    'В текстах выше написаны значения по умолчанию. Это именно значения по умолчанию: обе клавиши\n          меняются в настройках на любые удобные. Ниже — рабочая демонстрация: нажмите «Изменить» и введите сочетание.',
    'The text above shows the default values. They really are defaults: both keys can be changed in the settings to whatever suits you. Below is a working demonstration: press “Change” and type a shortcut.',
  ],
  ['>Снимок области<', '>Region screenshot<'],
  ['>Выделить прямоугольник мышью<', '>Drag a rectangle with the mouse<'],
  ['aria-label="По умолчанию Ctrl Shift S"', 'aria-label="Default: Ctrl Shift S"'],
  [
    'aria-label="Изменить клавишу снимка области"',
    'aria-label="Change the region screenshot key"',
  ],
  ['>Изменить<', '>Change<'],
  ['>Снимок всего экрана<', '>Full-screen screenshot<'],
  ['>Без рамки, сразу в буфер или в файл<', '>No frame, straight to the clipboard or to a file<'],
  ['aria-label="По умолчанию Ctrl Shift 3"', 'aria-label="Default: Ctrl Shift 3"'],
  [
    'aria-label="Изменить клавишу снимка всего экрана"',
    'aria-label="Change the full-screen screenshot key"',
  ],
  ['>Как это устроено<', '>How it works<'],
  [
    'Нажмите «Изменить» и просто наберите сочетание — оно запишется само, без выпадающих списков.',
    'Press “Change” and simply type the shortcut — it records itself as you go, with no dropdown lists.',
  ],
  [
    'Если сочетание занято другой программой, Flushot так и скажет и предложит другое.',
    'If another program already owns that shortcut, Flushot says so and offers another.',
  ],
  [
    'Две одинаковые клавиши назначить нельзя: Windows отдаёт сочетание только одному действию.',
    'You cannot assign the same key twice: Windows gives a shortcut to one action only.',
  ],
  [
    'У каждой клавиши есть «Сброс» — вернуть значение по умолчанию.',
    'Each key has a “Reset” that restores the default.',
  ],
  [
    'Можно назначить и знак препинания: <kbd>Ctrl</kbd>+<kbd>=</kbd>, <kbd>Ctrl</kbd>+<kbd>-</kbd>.',
    'Punctuation marks work too: <kbd>Ctrl</kbd>+<kbd>=</kbd>, <kbd>Ctrl</kbd>+<kbd>-</kbd>.',
  ],
  [
    '<kbd>Esc</kbd> назначить нельзя — Windows не отдаёт её программам.',
    '<kbd>Esc</kbd> cannot be assigned — Windows does not give it to programs.',
  ],
  [
    '<kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> занято «Ножницами» Windows — это сочетание не может занять ни одно приложение, пока «Ножницы» установлены. Настройки так и скажут и предложат либо удалить «Ножницы», либо набрать другое сочетание.',
    '<kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> belongs to the Windows Snipping Tool — no application can take that shortcut while the Snipping Tool is installed. The settings say so and offer either to uninstall the Snipping Tool or to type another shortcut.',
  ],

  // Screenshots
  ['>Настоящие окна программы<', '>Real program windows<'],
  ['Снято на Windows при масштабе экрана 100 %.', 'Captured on Windows at 100 % display scaling.'],
  ['aria-label="Экраны программы"', 'aria-label="Program screens"'],
  ['>Выделение области<', '>Region selection<'],
  ['>Настройки<', '>Settings<'],
  [
    'Затемнённый экран с выделенной областью, подписью размера и панелью кнопок снизу.',
    'A dimmed screen with a region selected, a size label and a button panel at the bottom.',
  ],
  [
    'Затемнение, прицел и размер области. Панель с кнопками внизу — видна даже при выделении всего экрана.',
    'The dimming, the crosshair and the region size. The button panel at the bottom stays visible even when you select the whole screen.',
  ],
  [
    'Готовый снимок с панелью инструментов и нарисованной стрелкой.',
    'A finished screenshot with the tool panel and an arrow drawn on it.',
  ],
  [
    'Пометки: стрелка, линия, прямоугольник, карандаш, текст, шаги и размытие.',
    'Annotations: arrow, line, rectangle, pencil, text, numbered steps and blur.',
  ],
  [
    'Снимок с выделенным фрагментом и панелью распознанного текста.',
    'A screenshot with a fragment selected and the recognised text panel.',
  ],
  [
    'Кнопка «Текст» включает выбор фрагмента: обведите нужный кусок — рядом появится распознанный текст, его можно поправить и скопировать. Нажатие без обводки читает весь снимок.',
    'The “Text” button turns on fragment selection: outline the part you need and the recognised text appears alongside, ready to correct and copy. Pressing the button without outlining anything reads the whole screenshot.',
  ],
  [
    'Окно настроек: тема, цвет рамки, тень, папка сохранения, формат и горячие клавиши.',
    'The settings window: theme, frame colour, shadow, save folder, format and hotkeys.',
  ],
  ['>Что настраивается<', '>What you can adjust<'],
  ['>Тема: светлая или тёмная<', '>Theme: light or dark<'],
  ['>Фон рамки: белый, чёрный или свой цвет<', '>Frame background: white, black or a custom colour<'],
  ['>Толщина рамки, радиус углов, сила тени<', '>Frame thickness, corner radius, shadow strength<'],
  [
    '>Папка сохранения и режим: сразу в папку, спрашивать или только в буфер<',
    '>Save folder and mode: straight to the folder, ask, or clipboard only<',
  ],
  ['>Формат: PNG без потерь, JPEG или WebP<', '>Format: lossless PNG, JPEG or WebP<'],
  ['>Обе горячие клавиши и автозапуск<', '>Both hotkeys and autostart<'],
  ['>Язык интерфейса: русский или английский<', '>Interface language: Russian or English<'],

  // Multiple monitors
  ['>Несколько экранов<', '>Multiple screens<'],
  ['>Два монитора, один над другим<', '>Two monitors, one above the other<'],
  [
    'Выделение тянется через границу экранов, даже если они разного размера и стоят как угодно.',
    'The selection crosses the boundary between screens, even when they are different sizes and placed however you like.',
  ],
  [
    'Снимок собирается из обоих в исходном разрешении, без растягивания.',
    'The screenshot is assembled from both at their native resolution, with no stretching.',
  ],
  [
    '<strong>«Весь экран»</strong> снимает основной монитор, а не оба сразу.',
    '<strong>“Full screen”</strong> captures the primary monitor, not both at once.',
  ],
  [
    'Панель кнопок и сообщения остаются на основном мониторе, а не прыгают на соседний.',
    'The button panel and the messages stay on the primary monitor instead of jumping to the neighbouring one.',
  ],
  [
    'Разные масштабы экранов не сбивают размер: он считается по пикселям файла.',
    'Different display scalings do not throw the size off: it is counted in the pixels of the file.',
  ],
  [
    'Затемнённые два монитора, расположенные один над другим, с выделенной областью на обоих.',
    'Two dimmed monitors stacked one above the other, with a region selected across both.',
  ],

  // Download
  ['>Версия 2.5.0 для Windows<', '>Version 2.5.0 for Windows<'],
  [
    'Три варианта одной и той же сборки. Программа внутри одинаковая; отличается способ установки и то, обновляется ли она сама.',
    'Three variants of the same build. The program inside is identical; what differs is how it is installed and whether it updates itself.',
  ],
  ['>Папка с программой<', '>Folder with the program<'],
  ['>Рекомендуем<', '>Recommended<'],
  [
    'Распаковать в любую папку и запустить <code>Flushot.exe</code>. Временная папка Windows не нужна. Новую версию нужно скачивать вручную.',
    'Unpack into any folder and run <code>Flushot.exe</code>. Windows temp space is not needed. New versions have to be downloaded by hand.',
  ],
  ['<span>148 МБ</span>', '<span>148 MB</span>'],
  ['>без установки<', '>no installation<'],
  ['>Скачать ZIP<', '>Download ZIP<'],
  ['>Установщик<', '>Installer<'],
  [
    'Двойной клик, «Установить» — появятся ярлыки в меню «Пуск» и строка удаления. <strong>Обновляется сам:</strong> раз в сутки проверяет новую версию и ставит её при выходе.',
    'Double-click, “Install” — shortcuts appear in the Start menu along with an uninstall entry. <strong>Updates itself:</strong> once a day it looks for a new version and installs it on quit.',
  ],
  ['<span>94 МБ</span>', '<span>94 MB</span>'],
  [
    'Один файл без установки. При первом запуске распаковывается во временную папку, поэтому нужен рабочий <code>%TEMP%</code>. Новую версию нужно скачивать вручную.',
    'A single file with no installation. On the first launch it unpacks into the temp folder, so a working <code>%TEMP%</code> is required. New versions have to be downloaded by hand.',
  ],
  ['>один файл<', '>single file<'],
  [
    '<strong>Про синее окно Windows.</strong> При первом запуске SmartScreen покажет «Windows защитила ваш компьютер». Так бывает с любым файлом без платного сертификата разработчика. Нажмите «Подробнее» → «Выполнить всё равно».',
    '<strong>About the blue Windows window.</strong> On first launch SmartScreen shows “Windows protected your PC”. This happens with any file that has no paid developer certificate. Press “More info” → “Run anyway”.',
  ],

  // FAQ
  ['>Частые вопросы<', '>Common questions<'],
  [
    '>Снимок попал в буфер сам. Так и должно быть?<',
    '>The screenshot went to the clipboard by itself. Is that how it should be?<',
  ],
  [
    'Да, это основной режим. Отпускание кнопки мыши копирует готовую карточку в буфер обмена и закрывает оверлей, поэтому вставлять можно сразу: <kbd>Ctrl</kbd>+<kbd>V</kbd> в чате, письме или документе. Нажимать <kbd>Ctrl</kbd>+<kbd>C</kbd> не нужно.',
    'Yes, that is the main mode. Releasing the mouse button copies the finished card to the clipboard and closes the selection overlay, so you can paste right away: <kbd>Ctrl</kbd>+<kbd>V</kbd> in a chat, an email or a document. There is no need to press <kbd>Ctrl</kbd>+<kbd>C</kbd>.',
  ],
  [
    'Пометки и сохранение никуда не делись: <kbd>Shift</kbd>, удерживаемый в момент отпускания, открывает снимок в редакторе, и то же самое делает переключатель «После выделения → Открывать» в настройках. Случайное нажатие и область меньше 24 × 24 px не копируются — буфер обмена остаётся прежним.',
    'Annotations and saving are still there: holding <kbd>Shift</kbd> while you release the button opens the screenshot in the editor, and the “After selection → Open” switch in the settings does the same. An accidental click, or a region smaller than 24 × 24 px, is not copied — the clipboard stays as it was.',
  ],
  [
    '>Windows пишет, что программа небезопасна. Это опасно?<',
    '>Windows says the program is unsafe. Is that dangerous?<',
  ],
  [
    'Нет. Предупреждение появляется из-за отсутствия цифровой подписи, а не из-за содержимого. Подпись — платный сертификат, который для бесплатной программы не покупают. Нажмите «Подробнее» → «Выполнить всё равно».',
    'No. The warning appears because there is no digital signature, not because of the content. A signature is a paid certificate, and one is not bought for a free program. Press “More info” → “Run anyway”.',
  ],
  ['>Куда сохраняются снимки?<', '>Where are screenshots saved?<'],
  [
    'По умолчанию в <code>Изображения\\Flushot</code>. Папку можно сменить в настройках, там же есть кнопка, которая открывает её в проводнике. Имя файла — дата и время, поэтому ничего не перезаписывается.',
    'By default into <code>Pictures\\Flushot</code>. The folder can be changed in the settings, which also has a button that opens it in File Explorer. The file name is the date and time, so nothing is overwritten.',
  ],
  [
    'Файл пишется и тогда, когда снимок ушёл в буфер обмена: запись идёт после копирования и вставку не задерживает.',
    'The file is written even when the screenshot has gone to the clipboard: writing happens after the copy and does not hold the paste up.',
  ],
  ['>Можно ли поменять горячие клавиши?<', '>Can the hotkeys be changed?<'],
  [
    'Да, обе. Если сочетание занято другой программой, Flushot так и скажет.',
    'Yes, both. If another program already owns that shortcut, Flushot says so.',
  ],
  [
    'А вот <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> назначить не получится ни у нас, ни у кого-либо ещё: пока в Windows установлены «Ножницы», это сочетание принадлежит им. Настройки назовут хозяина и предложат два выхода: удалить «Ножницы» или набрать другое сочетание.',
    'And <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> cannot be assigned by us or by anyone else: while the Windows Snipping Tool is installed, that shortcut belongs to it. The settings name the owner and offer two ways out: uninstall the Snipping Tool, or type another shortcut.',
  ],
  [
    'Готовых кнопок с нашими вариантами в настройках нет: сочетание вы назначаете сами, записью с клавиатуры. Чужие предложения там только мешали.',
    'There are no ready-made buttons with suggested shortcuts in the settings: you assign the shortcut yourself, by typing it. Someone else’s suggestions only got in the way there.',
  ],
  ['>Как достать текст со снимка?<', '>How do I get the text out of a screenshot?<'],
  [
    'Кнопка «Текст» включает выбор фрагмента: обведите на снимке нужный кусок — рядом появится распознанный текст, его можно скопировать одной кнопкой. Нажатие без обводки читает весь снимок. Работает встроенный движок Windows, тот же, что у «Ножниц»: ничего не скачивается, интернет не нужен, снимок не покидает компьютер. Карточка 880 × 1200 с двадцатью строками читается примерно за 1,1 с после первого запуска — три чтения вместо одного стоят около 0,6 с и окупаются меньшим числом ошибок.',
    'The “Text” button turns on fragment selection: outline the part you need on the screenshot and the recognised text appears alongside, ready to copy with one button. Pressing the button without outlining anything reads the whole screenshot. This uses the built-in Windows engine, the same one as the Snipping Tool: nothing is downloaded, no internet is needed, and the screenshot never leaves the computer. A card of 880 × 1200 with twenty lines takes about 1.1 s to read after the first launch — three reads instead of one cost about 0.6 s and pay for themselves in fewer mistakes.',
  ],
  [
    'Текст в панели можно <strong>править</strong>: клик в слово, исправление, «Копировать исправленное» — в буфер уйдёт уже исправленный текст, без промежуточной вставки в блокнот. Метка «правлено» и кнопка «Вернуть» показывают, чем текст отличается от прочитанного движком.',
    'The text in the panel can be <strong>edited</strong>: click a word, correct it, “Copy corrected” — the clipboard receives the corrected text, with no round trip through Notepad. The “edited” marker and the “Revert” button show how the text differs from what the engine read.',
  ],
  [
    'Движок Windows одноязычный, поэтому читают все установленные движки сразу, а результат сводится <strong>по строкам</strong>: каждый движок прав ровно про свой алфавит, и лучшего для смешанного снимка не существует. Вдобавок каждый снимок читается <strong>трижды</strong> — в выбранном масштабе, в две трети от него и ещё раз в чёрно-белом виде, — и спорное слово решается голосованием. На наборе из 20 строк настоящего текста в четырёх размерах шрифта это дало <strong>3,22 %</strong> неверных символов против 3,50 % у одного чтения.',
    'A Windows engine handles one language only, so every installed engine reads at once and the results are merged <strong>line by line</strong>: each engine is right about exactly its own alphabet, and there is no best engine for a mixed screenshot. On top of that, each screenshot is read <strong>three times</strong> — at the chosen scaling, at two thirds of it, and once more in black and white — and a disputed word is settled by a vote. On a set of 20 lines of real text at four font sizes this gave <strong>3.22 %</strong> wrong characters against 3.50 % for a single read.',
  ],
  [
    'Это не OCR для сканов: на мелком шрифте и цветном тексте поверх картинки движок ошибается. Там, где все чтения сходятся на неверном (на 11 px «Папка» читается как «Палка» у обоих движков), свести нечего — именно для этого случая текст и правится руками.',
    'This is not OCR for scans: with small type and coloured text over a picture the engine makes mistakes. Where every read agrees on something wrong (at 11 px both engines read the same word the same wrong way), there is nothing to merge — and that is exactly the case manual editing is for.',
  ],
  ['>Работает ли с двумя мониторами?<', '>Does it work with two monitors?<'],
  [
    'Да. Выделение тянется по объединённой области всех мониторов, даже если они разного размера и стоят один над другим. Снимок собирается из обоих в исходном разрешении. Отдельная клавиша «весь экран» снимает основной монитор.',
    'Yes. The selection spans the combined area of all monitors, even when they are different sizes and stacked one above the other. The screenshot is assembled from both at their native resolution. The separate “full screen” key captures the primary monitor.',
  ],
  ['>Нужен ли интернет?<', '>Is an internet connection needed?<'],
  [
    'Для работы — нет: снимок, оформление, сохранение и распознавание текста происходят на вашем компьютере. Сам по себе снимок никуда не отправляется: две клавиши из трёх работают только локально.',
    'Not for using it: the capture, the framing, saving and text recognition all happen on your computer. The picture is not sent anywhere by itself: two of the three keys work locally only.',
  ],
  [
    'Третья клавиша — «Со ссылкой» — единственная, которая отправляет: снимок уходит на сервер, а в буфер попадает ссылка на него. Ссылка живёт час, потом снимок удаляется с сервера. Эту клавишу можно не нажимать вообще, а если она не нужна — её можно переназначить или просто не использовать.',
    'The third key, “With a link”, is the only one that sends anything: the picture goes to a server and the clipboard gets a link to it. The link works for an hour, after which the picture is deleted. You never have to press it, and it can be reassigned or ignored like anything else.',
  ],
  ['>Что с качеством картинки?<', '>What about picture quality?<'],
  [
    'Снимок делается в физических пикселях монитора, поэтому на масштабе 125 % или 150 % он не мыльный. PNG сохраняется без потерь. Если нужен файл полегче — есть JPEG с настраиваемым качеством и WebP.',
    'The screenshot is taken in the monitor’s physical pixels, so at 125 % or 150 % scaling it is not blurry. PNG is saved losslessly. If you need a lighter file, JPEG with adjustable quality and WebP are available.',
  ],
  ['>Можно ли удалить одну пометку из нескольких?<', '>Can I delete one annotation out of several?<'],
  [
    '<kbd>Ctrl</kbd>+<kbd>Z</kbd> отменяет последнее действие. Отдельный нумерованный шаг из середины убрать нельзя — нумерация пересчитывается автоматически, и выборочное удаление сломало бы её.',
    '<kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes the last action. A single numbered step cannot be removed from the middle — the numbering is recalculated automatically, and removing one selectively would break it.',
  ],
  ['>Это правда бесплатно?<', '>Is it really free?<'],
  [
    'Да. Без рекламы, без подписок, без урезанных версий и без регистрации.',
    'Yes. No ads, no subscriptions, no cut-down versions and no sign-up.',
  ],

  // Limits
  ['>Ограничения<', '>Limitations<'],
  ['>Чего пока нет<', '>What is still missing<'],
  [
    'Лучше узнать это здесь, чем после скачивания.',
    'Better to find out here than after the download.',
  ],
  [
    '<strong>Файлы не подписаны.</strong> SmartScreen предупреждает при первом запуске. Исходный код при этом открыт на <a href="https://github.com/aeshtlv/Flushot">GitHub</a> — его можно прочитать до запуска.',
    '<strong>The files are not signed.</strong> SmartScreen warns on first launch. The source code is open on <a href="https://github.com/aeshtlv/Flushot">GitHub</a>, so you can read it before running anything.',
  ],
  [
    '<strong>Пометки вшиваются при сохранении.</strong> До этого их можно двигать, после — уже нет.',
    '<strong>Annotations are baked in when you save.</strong> Before that you can move them; afterwards you cannot.',
  ],
  [
    '<strong>Отдельную пометку удалить нельзя</strong> — только последнее действие.',
    '<strong>A single annotation cannot be deleted</strong> — only the last action.',
  ],
  [
    '<strong>«Весь экран» — это основной монитор</strong>, а не все мониторы одной картинкой.',
    '<strong>“Full screen” means the primary monitor</strong>, not all monitors in one picture.',
  ],
  [
    '<strong><kbd>Esc</kbd> назначить нельзя</strong>: ею отменяется запись сочетания.',
    '<strong><kbd>Esc</kbd> cannot be assigned</strong>: it cancels the recording.',
  ],
  [
    '<strong>Только Windows 10 и 11.</strong> Версий для macOS и Linux нет.',
    '<strong>Windows 10 and 11 only.</strong> There are no macOS or Linux versions.',
  ],
  [
    '<strong>Защищённый контент выйдет чёрным.</strong> DRM-видео и часть игр в полноэкранном режиме система не отдаёт на снимок.',
    '<strong>Protected content comes out black.</strong> The system refuses to hand DRM video and some full-screen games to a capture.',
  ],
  [
    '<strong>Кадр замирает в момент нажатия клавиши.</strong> Меню, подсказка или анимация, появившиеся позже, в снимок не попадут — задержки съёмки нет.',
    '<strong>The frame freezes when you press the key.</strong> A menu, tooltip or animation that appears afterwards is not in the picture — there is no capture delay.',
  ],

  // Closing call to action
  ['>Попробуйте на одном скриншоте<', '>Try it on one screenshot<'],
  [
    'Если не понравится — удалить так же просто, как распаковать.',
    'If you do not like it, deleting it takes as little effort as unpacking did.',
  ],
  ['Скачать Flushot 2.5.0', 'Download Flushot 2.5.0'],
  ['>Сначала вопросы<', '>Questions first<'],
  ['105 МБ · без регистрации · без аналитики', '105 MB · no sign-up · no analytics'],

  // Footer
  ['>Версия 2.5.0 · © 2026 Flushot<', '>Version 2.5.0 · © 2026 Flushot<'],
  ['aria-label="Навигация в подвале"', 'aria-label="Footer navigation"'],

  // JSON-LD
  [
    'Бесплатная программа для скриншотов на Windows: выделение области, рамка с тенью, ровная линия для подчёркивания, снимок всего экрана одной клавишей.',
    'A free screenshot program for Windows: region selection, a frame with a shadow, a straight line for underlining, and a full-screen screenshot with one key.',
  ],

  // Updates and the download section as of 2.5.0
  [
    '>Скачать EXE<',
    '>Download EXE<'
  ],
  ['<span>105 МБ</span><span>EXE</span><span>автообновление</span>', '<span>105 MB</span><span>EXE</span><span>auto-updates</span>'],
  [
    ' скачиваний с GitHub · считаются скачивания, а не установки',
    ' downloads from GitHub · downloads, not installs'
  ],
  [
    '>Как приходят обновления?<',
    '>How do updates arrive?<'
  ],
  [
    'Установленная версия раз в сутки спрашивает у GitHub, не вышла ли новая, скачивает её в фоне и ставит при выходе — поэтому ничего не закрывается посреди работы. Проверить вручную можно там же, где всё остальное: настройки → «Обновления» → «Проверить сейчас».',
    'An installed copy asks GitHub once a day whether a new version exists, downloads it in the background and installs it on quit, so nothing closes in the middle of your work. To ask by hand: settings → “Updates” → “Check now”.'
  ],
  [
    'Обновляется только установщик. Portable-версия и архив для ручной распаковки заменять себя не могут: portable при каждом запуске распаковывается во временную папку, а у архива нет деинсталлятора. Им новую версию нужно скачивать с сайта.',
    'Only the installer updates itself. The portable build and the unpack-it-yourself archive cannot replace themselves: portable unpacks into the temp folder on every launch, and the archive has no uninstaller. For those, download the new version from the site.'
  ],
  [
    'Один запрос в сутки программа делает сама: спрашивает у GitHub, не вышла ли новая версия, и если вышла — скачивает её в фоне и ставит при выходе. Ничего другого она не отправляет: ни статистики, ни идентификатора, ни адресов. Проверку можно выключить в настройках, и тогда запросов не будет совсем.',
    'The program makes one request a day on its own: it asks GitHub whether a new version exists and, if one does, downloads it in the background and installs it on quit. It sends nothing else — no statistics, no identifier, no addresses. The check can be switched off in the settings, and then there are no requests at all.'
  ],
]
