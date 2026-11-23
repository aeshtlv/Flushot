/**
 * Every word the program shows, in one place, in two languages.
 *
 * The Russian text is the source of truth — it is what the product was written
 * in — and English is a translation of it, keyed by the same identifiers. Nothing
 * is generated from the other side, so a missing English line is a compile error
 * rather than a Russian sentence appearing in an English window: `EN` is typed as
 * `Record<MessageKey, string>`, and `MessageKey` is `keyof typeof RU`.
 *
 * Choosing the language is deliberately boring. The preference is `auto`, `ru` or
 * `en`; `auto` asks the operating system. Both sides compute the answer from the
 * same two inputs (`resolveLanguage`), so the main process and a renderer cannot
 * disagree: the renderer passes `navigator.language`, the main process passes
 * `app.getLocale()`, and a saved preference overrides both.
 *
 * Anything that needs a number inside a sentence uses `{name}` placeholders and
 * `t(language, key, { name: value })`. Counted nouns go through `pluralForm`,
 * because Russian has three forms and English has two, and a table of suffixes
 * would be wrong in one of them.
 */

export type Language = 'ru' | 'en'

/** What the user picked. `auto` follows Windows. */
export type LanguagePreference = Language | 'auto'

export const LANGUAGES: readonly Language[] = ['ru', 'en']

/**
 * Names of the languages, each written in itself — the convention every settings
 * window follows, and the only form that is readable to someone who cannot read
 * the interface yet.
 */
export const LANGUAGE_NAMES: Record<Language, string> = {
  ru: 'Русский',
  en: 'English'
}

const RU = {
  // ---------------------------------------------------------------- main process
  'app.notifyTitle': 'Flushot — ошибка',
  'app.startFailed': 'Не удалось запустить Flushot',
  'app.startFailedDetail': 'Не удалось запустить приложение.\n\n{detail}',
  'app.notificationFailed': 'Не удалось показать уведомление',
  'app.hotkeysFailed': 'Не удалось назначить горячие клавиши',
  'app.hotkeysNotAssigned': 'Горячие клавиши не назначены — задайте их в настройках.',
  'app.autostartRejected': 'Не удалось включить автозапуск: Windows отклонила изменение.',
  'app.unhandledError': 'Необработанная ошибка',
  'app.unexpectedError': 'Непредвиденная ошибка: {message}',
  'app.unhandledRejection': 'Необработанный отказ промиса',
  'app.comboRejected': 'Сочетание {combo} не принимается системой',
  'app.hotkeysReleaseFailed': 'Не удалось освободить прежние сочетания',
  'app.hotkeyUnavailable': 'Не удалось назначить {combo} — выберите другое сочетание в настройках.',
  'app.hotkeyTaken': '{combo} занята другой программой. Flushot использует {active}.',
  'app.fullscreenHotkeyUnavailable':
    'Не удалось назначить {combo} для снимка всего экрана — выберите другое сочетание в настройках.',
  'app.fullscreenHotkeyTaken':
    '{combo} занята другой программой. Снимок всего экрана — {active}.',
  'app.uploadHotkeyUnavailable':
    'Не удалось назначить {combo} для снимка со ссылкой — выберите другое сочетание в настройках.',
  'app.uploadHotkeyTaken':
    '{combo} занята другой программой. Снимок со ссылкой — {active}.',
  'app.captureFailed': 'Не удалось начать захват',
  'app.tempUnavailable': 'Системная папка Temp недоступна, используется {fallback}',
  'app.tempPrepareFailed': 'Не удалось подготовить резервную папку Temp',

  // ------------------------------------------------------------------------ tray
  'tray.createFailed': 'Не удалось создать значок в трее',
  'tray.noHotkey': 'не назначена',
  'tray.tooltip': 'Flushot — снимок экрана ({hotkey})',
  'tray.capture': 'Сделать снимок',
  'tray.fullscreen': 'Снимок всего экрана',
  'tray.upload': 'Снимок со ссылкой',
  'tray.settings': 'Настройки…',
  'tray.openFolder': 'Открыть папку сохранения',
  'tray.checkUpdates': 'Проверить обновления',
  'tray.checkingUpdates': 'Проверка обновлений…',
  'tray.updateReady': 'Установить обновление {version}',
  'tray.quit': 'Выход',

  // -------------------------------------------------------------------- update
  'update.readyNotify': 'Версия {version} скачана. Установится при выходе из Flushot.',
  'update.currentNotify': 'Установлена последняя версия — {version}',
  'update.failedNotify': 'Не удалось проверить обновления: {message}',

  // --------------------------------------------------------------------- capture
  'capture.noDisplay': 'Не найдено ни одного экрана',
  'capture.overlayFailed': 'Не удалось открыть оверлей выделения',
  'capture.startFailed': 'Не удалось запустить захват экрана',
  'capture.uiLoadFailed': 'Не удалось загрузить интерфейс выделения: {detail}',
  'capture.windowMissing': 'Окно выделения не найдено',
  'capture.displayMissing': 'Экран не найден',
  'capture.shotGone': 'Снимок экрана больше недоступен',
  'capture.sessionStale': 'Окно выделения устарело. Нажмите Ctrl+Shift+S снова.',
  'capture.tooSmall': 'Слишком маленькая область — выделите не меньше 8 × 8 пикселей',
  'capture.copiedNotSaved': 'Снимок скопирован, но не сохранён: {detail}',
  'capture.copiedNotSavedFolder':
    'Снимок скопирован, но не сохранён в папку «{directory}». Выберите другую в настройках.',
  'capture.saveFailed': 'Не удалось сохранить снимок',
  'capture.copied': 'Скопировано в буфер обмена · {width} × {height}',
  'capture.readyNotSaved': 'Снимок готов, но сохранить не удалось: {detail}',
  'capture.done': 'Готово · {width} × {height}',
  'capture.processFailed': 'Не удалось обработать выделенную область',
  'capture.settingsUnavailable': 'Настройки недоступны',
  'capture.captureFirst': 'Сначала создайте снимок',
  'capture.askEachTime': 'спрашивать каждый раз',
  'capture.hideArea': 'скрыть область',
  'capture.copyShortcutFailed': 'Не удалось зарегистрировать Ctrl+C для выделения',
  'capture.allScreens': 'Все экраны ({count})',
  'capture.oneScreen': 'Экран',

  // ---------------------------------------------------------------------- screens
  'screen.displayLabel': 'Экран {id}',
  'screen.captureTimeout': 'Истекло время ожидания захвата экрана',
  'screen.captureFailed': 'Не удалось получить снимок экрана',
  'screen.displayCaptureFailed': 'Не удалось захватить экран «{label}»',
  'screen.displayEmpty': 'Экран «{label}» вернул пустое изображение',

  // ---------------------------------------------------------------------- export
  'export.saveFailed': 'Не удалось сохранить снимок',
  'export.encodeFailed': 'Не удалось подготовить снимок',
  'export.clipboardFailed': 'Не удалось записать в буфер обмена',
  'export.noFolderAccess': 'Нет доступа к папке «{directory}». Выберите другую в настройках.',
  'export.saved': 'Сохранено · {file}',
  'export.saveDialogTitle': 'Сохранить снимок',
  'export.cancelled': 'Сохранение отменено',
  'export.prepareClipboardFailed': 'Не удалось подготовить изображение для буфера обмена',
  'export.copied': 'Скопировано в буфер обмена',
  'upload.uploaded': 'Ссылка скопирована: {url}',
  'upload.noticeTitle': 'Ссылка готова',
  'upload.notice': 'Работает до {expires}, потом снимок удалится с сервера.',
  'upload.noticeNoUrl': 'Снимок загружен, но ссылку скопировать не удалось.',
  'upload.uploadedNoClipboard': 'Снимок загружен, но скопировать ссылку не удалось: {url}',
  'upload.encodeFailed': 'Не удалось подготовить снимок к загрузке',
  'upload.offline': 'Не удалось связаться с сервером — проверьте подключение',
  'upload.timeout': 'Сервер не ответил вовремя — попробуйте ещё раз',
  'upload.tooBig': 'Снимок больше 3 МБ — сервер такой не примет',
  'upload.wrongType': 'Сервер не принял формат — сохраните снимок как PNG или WebP',
  'upload.tooOften': 'Слишком много загрузок подряд — подождите минуту',
  'upload.busy': 'Сервер сейчас не принимает снимки — попробуйте позже',
  'upload.serverError': 'Сервер ответил ошибкой {status}',
  'upload.malformed': 'Сервер ответил без ссылки — попробуйте ещё раз',
  'export.filenameFailed': 'Не удалось подобрать имя файла',
  'export.pathNotFolder': 'Выбранный путь не является папкой',

  // --------------------------------------------------------------------- imaging
  'imaging.emptyRegion': 'Пустая область выделения',
  'imaging.readShotFailed': 'Не удалось прочитать снимок экрана',
  'imaging.readRegionFailed': 'Не удалось прочитать выделенную область',
  'imaging.readPreviewFailed': 'Не удалось прочитать изображение для превью',
  'imaging.badColor': 'Некорректный цвет фона: {hex}',
  'imaging.badSize': 'Некорректный размер снимка',
  'imaging.shadowMaskFailed': 'Не удалось построить маску тени',

  // ------------------------------------------------------------------------- OCR
  'ocr.unavailable': 'Распознавание текста недоступно на этом компьютере',
  'ocr.prepareFailed': 'Не удалось подготовить снимок к распознаванию',
  'ocr.failed': 'Распознать текст не удалось',
  'ocr.noEngines': 'Ни одного движка распознавания нет',
  'ocr.timeout': 'Распознавание не ответило вовремя',
  'ocr.stopped': 'Распознавание остановлено',

  // ----------------------------------------------------------------------- shell
  'shell.unknownError': 'Неизвестная ошибка',
  'shell.handlerFailed': 'Ошибка обработчика IPC',
  'shell.ocrFailed': 'Ошибка распознавания текста',
  'shell.pickFolderTitle': 'Папка для сохранения снимков',
  'shell.autostartReadFailed': 'Не удалось прочитать автозапуск',
  'shell.autostartWriteFailed': 'Не удалось изменить автозапуск',
  'shell.settingsLoadFailed': 'Не удалось загрузить окно настроек',
  'shell.noRoot': 'Не найден корневой элемент',

  // -------------------------------------------------------------------- hotkeys
  'hotkey.snippingOwner': 'Ножницами Windows',
  'hotkey.snippingHint':
    'Windows забирает это сочетание себе и открывает свои Ножницы, поэтому Flushot его не получит. ' +
    'Либо удалите приложение «Ножницы» (Параметры → Приложения), либо выберите другое сочетание: ' +
    'Ctrl+Shift+S, PrintScreen или Ctrl+Shift+X.',
  'hotkey.clipboardOwner': 'журналом буфера обмена Windows',
  'hotkey.clipboardHint':
    'Это системное сочетание журнала буфера обмена. Выберите другое: Ctrl+Shift+S или PrintScreen.',
  'hotkey.explorerOwner': 'Проводником Windows',
  'hotkey.explorerHint':
    'Это системное сочетание Проводника. Выберите другое: Ctrl+Shift+S или PrintScreen.',
  'hotkey.lockOwner': 'блокировкой Windows',
  'hotkey.lockHint':
    'Это системное сочетание блокировки экрана. Выберите другое: Ctrl+Shift+S или PrintScreen.',

  // -------------------------------------------------------------------- settings
  'settings.loading': 'Загрузка настроек…',
  'settings.close': 'Закрыть (Esc)',
  'settings.previewLabel': 'Предпросмотр результата',
  'settings.previewAlt': 'Предпросмотр снимка',
  'settings.previewCaption': 'Снимок + рамка',
  'settings.saveFailed': 'Не удалось сохранить настройки',
  'settings.folderPickFailed': 'Не удалось выбрать папку',
  'settings.folderOpenFailed': 'Не удалось открыть папку',
  'settings.resetFailed': 'Не удалось сбросить настройки',
  'settings.hotkeyNeedsModifier': 'Добавьте модификатор: Ctrl, Alt или Shift',
  'settings.hotkeyClash': '{combo} уже занята {action} — выберите другое сочетание',
  'settings.actionRegion': 'выделением области',
  'settings.actionFullscreen': 'снимком всего экрана',
  'settings.actionUpload': 'снимком со ссылкой',
  'settings.hotkeyReserved': '{combo} занята {owner}. {hint}',
  'settings.hotkeyTakenWithHint': '{combo} занята {owner}. {hint}',
  'settings.hotkeyTaken': '{combo} занята другой программой — закройте её или наберите другое сочетание.',
  'settings.otherProgram': 'другой программой',
  'settings.hotkeySwitched': '{combo} занята другой программой — работает {active}',
  'settings.hotkeyNotAssigned': '{combo} не удалось назначить — выберите другое сочетание',
  'settings.hotkeyIntrusive': 'Клавиша {combo} перехватывается во всех программах — печатать её не получится',
  'settings.hotkeyChangeFailed': 'Не удалось изменить клавишу',
  'settings.hotkeyUnbound':
    'Клавиша не назначена: {requested} занята другой программой, и запасная комбинация тоже. Нажмите на поле и запишите другое сочетание.',
  'settings.hotkeyFallback':
    'Работает {active}: {requested} занята другой программой. Нажмите на поле, чтобы выбрать другое сочетание.',
  'settings.hotkeyTryThese':
    'Занято другой программой — Windows отдаёт сочетание первому, кто его занял. Свободны: ',
  'settings.hotkeyTakeThis': 'Назначить {combo}',
  'settings.recordingPrompt': 'Нажмите сочетание…',
  'settings.recordingTitle': 'Нажмите сочетание клавиш, Esc — отмена',
  'settings.recordTitle': 'Нажмите, чтобы записать сочетание',
  'settings.resetHotkey': 'Вернуть {combo}',
  'settings.resetHotkeyShort': 'Сброс',

  'settings.sectionAppearance': 'Оформление',
  'settings.theme': 'Тема',
  'settings.themeHint': 'Светлая по умолчанию',
  'settings.themeLight': 'Светлая',
  'settings.themeDark': 'Тёмная',
  'settings.background': 'Фон',
  'settings.backgroundHint': 'Свободное поле вокруг снимка',
  'settings.backgroundWhite': 'Белый',
  'settings.backgroundGray': 'Серый',
  'settings.backgroundCustom': 'Свой цвет',
  'settings.pickColor': 'Выбрать цвет',
  'settings.palette': 'Палитра',
  'settings.paletteRemove': '{color} — правый клик, чтобы убрать',
  'settings.paletteAdd': 'Сохранить этот цвет в палитру',
  'settings.paletteAddShort': 'В палитру',
  'settings.frameWidth': 'Толщина рамки',
  'settings.cornerRadius': 'Скругление углов',

  'settings.sectionCapture': 'Снимок',
  'settings.hotkey': 'Горячая клавиша',
  'settings.hotkeyHint': 'Выделение области — сочетание или одна клавиша',
  'settings.fullscreen': 'Весь экран',
  'settings.fullscreenHint': 'Сразу снимок всего экрана, без выделения',
  'settings.upload': 'Со ссылкой',
  'settings.uploadHint':
    'Снимок уходит на сервер, а в буфер попадает ссылка. Ссылка живёт час, потом снимок удаляется',
  'settings.uploadPrivacy':
    'Это единственная клавиша, которая отправляет снимок в сеть. Две другие работают только на вашем компьютере.',
  'settings.afterRegion': 'После выделения',
  'settings.afterRegionCopyHint':
    'Отпустили мышь — снимок уже в буфере, вставляйте через Ctrl+V. Shift при отпускании открывает пометки',
  'settings.afterRegionEditHint': 'Снимок открывается для пометок; скопировать можно по Ctrl+C',
  'settings.afterRegionCopy': 'Сразу в буфер',
  'settings.afterRegionEdit': 'Открывать',
  'settings.launchAtLogin': 'Запускать с Windows',
  'settings.launchAtLoginHint': 'Flushot стартует в трее, окно не открывается',

  'settings.sectionShadow': 'Тень',
  'settings.shadow': 'Тень вокруг снимка',
  'settings.shadowIntensity': 'Интенсивность',
  'settings.shadowBlur': 'Радиус размытия',

  'settings.sectionSaving': 'Сохранение',
  'settings.folder': 'Папка',
  'settings.folderHint': 'Нажмите на путь, чтобы открыть папку',
  'settings.folderOpen': 'Открыть {path}',
  'settings.folderChange': 'Изменить…',
  'settings.afterShot': 'После снимка',
  'settings.afterShotHint': 'Как поступать с готовым изображением',
  'settings.saveToFolder': 'Сохранять в папку',
  'settings.askWhere': 'Спрашивать',
  'settings.format': 'Формат',
  'settings.qualityWebp': 'Качество WebP',
  'settings.qualityJpeg': 'Качество JPEG',

  'settings.sectionLanguage': 'Язык',
  'settings.language': 'Язык интерфейса',
  'settings.languageHint': '«Как в системе» — по языку Windows',
  'settings.languageAuto': 'Как в системе',

  'settings.sectionUpdates': 'Обновления',
  'settings.checkUpdates': 'Проверять обновления',
  'settings.checkUpdatesHint': 'Раз в день, один запрос к GitHub',
  'settings.checkNow': 'Проверить сейчас',
  'settings.version': 'Версия',
  'settings.updateIdle': 'Обновления проверяются сами раз в день',
  'settings.updateOff': 'Проверка выключена — программа не обращается к сети',
  'settings.updateManual': 'Эта сборка обновляется вручную: скачайте новую версию с сайта',
  'settings.updateChecking': 'Проверяем…',
  'settings.updateCurrent': 'Версия {version} — последняя',
  'settings.updateDownloading': 'Скачиваем {version}: {percent}%',
  'settings.updateReady': 'Версия {version} скачана и установится при выходе',
  'settings.updateInstall': 'Установить и перезапустить',
  'settings.updateFailed': 'Не удалось проверить: {message}',
  'settings.updateCheckedAt': 'проверено {when}',

  'settings.resetTitle': 'Сбросить все настройки',
  'settings.resetHint':
    'Вернуть оформление, тень, сохранение и горячую клавишу к значениям по умолчанию',
  'settings.resetButton': 'Сбросить',
  'settings.footerHint': 'вызов выделения',

  // --------------------------------------------------------------------- overlay
  'overlay.demoScreen': 'Демо-экран',
  'overlay.demoNoCapture': 'Демо-режим: снимок не создаётся',
  'overlay.captureFailed': 'Не удалось создать снимок',
  'overlay.demoNoClipboard': 'Демо-режим: буфер недоступен',
  'overlay.demoNoSave': 'Демо-режим: сохранение недоступно',
  'overlay.copyFailed': 'Не удалось скопировать снимок',
  'overlay.demoNoUpload': 'В демо-режиме загрузка недоступна',
  'overlay.uploadFailed': 'Не удалось загрузить снимок',
  'overlay.actionFailed': 'Не удалось выполнить действие',
  'overlay.demoNoOcr': 'Демо-режим: распознавание недоступно',
  'overlay.ocrFailed': 'Распознать текст не удалось',
  'overlay.copied': 'Скопировано',
  'overlay.failed': 'Не удалось',
  'overlay.openForEdit': 'Открыть снимок для пометок (Enter)',
  'overlay.copyImmediately': 'Скопировать сразу, без пометок (Ctrl+C)',
  'overlay.resetSelection': 'Сбросить выделение (Esc)',
  'overlay.close': 'Закрыть (Esc)',
  'overlay.resultAlt': 'Готовый снимок',
  'overlay.create': 'Создать',
  'overlay.toolArrow': 'Стрелка',
  'overlay.toolLine': 'Линия (Shift — ровно)',
  'overlay.toolRect': 'Рамка',
  'overlay.toolPen': 'Карандаш',
  'overlay.toolText': 'Текст',
  'overlay.toolStep': 'Нумерация шагов',
  'overlay.toolMove': 'Перемещение',
  'overlay.toolBlur': 'Скрыть область',
  'overlay.colorSwatch': 'Цвет {color}',
  'overlay.textSize': 'Размер метки: {size}',
  'overlay.sizeSmall': 'мелкий',
  'overlay.sizeMedium': 'обычный',
  'overlay.sizeLarge': 'крупный',
  'overlay.lineThin': 'Тонкая линия',
  'overlay.lineNormal': 'Обычная линия',
  'overlay.lineThick': 'Толстая линия',
  'overlay.undoAnnotation': 'Отменить пометку (Ctrl+Z)',
  'overlay.copyToClipboard': 'Скопировать в буфер (Ctrl+C)',
  'overlay.copyLink': 'Скопировать ссылку (Ctrl+C)',
  'overlay.uploadLink': 'Загрузить и скопировать ссылку',
  'overlay.uploading': 'Загружаю…',
  'overlay.save': 'Сохранить (Ctrl+S)',
  'overlay.textSelectPrompt': 'Выделите на снимке область с текстом',
  'overlay.textToolTitle': 'Распознать текст: выделите область или кликните по снимку',
  'overlay.zoomOutTitle': 'Уменьшить (−)',
  'overlay.zoomOut': 'Уменьшить масштаб',
  'overlay.zoomLevel': 'Масштаб',
  'overlay.zoomInTitle': 'Увеличить (+)',
  'overlay.zoomIn': 'Увеличить масштаб',
  'overlay.fitToScreenTitle': 'Вписать в экран (0)',
  'overlay.fitToScreen': 'Вписать в экран',
  'overlay.selectAgain': 'Выделить заново',
  'overlay.cancel': 'Отменить (Esc)',
  'overlay.textNote': 'Текст · Enter — готово, Shift+Enter — новая строка',
  'overlay.selectTitle': 'Выделите область экрана',
  'overlay.hintDrag': 'Перетащите мышь, чтобы создать снимок',
  'overlay.hintDone': 'готово',
  'overlay.hintCopy': 'скопировать',
  'overlay.hintCancel': 'отмена',
  'overlay.hintRelease': 'Отпустите мышь — снимок сразу в буфере обмена',
  'overlay.hintShiftAnnotate': 'при отпускании — перейти к пометкам',
  'overlay.hintReleaseUpload': 'Отпустите мышь — снимок загрузится, ссылка попадёт в буфер',
  'overlay.hintShiftCopy': 'при отпускании — просто скопировать, без загрузки',
  'overlay.upload': 'Загрузить и скопировать ссылку',
  'overlay.hintSave': 'сохранить',
  'overlay.done': 'Готово',
  'overlay.copyShort': 'Копировать',
  'overlay.saveShort': 'Сохранить',
  'overlay.textPickHint': 'Выделите область с текстом',
  'overlay.sizeSmallText': 'Мелкий текст',
  'overlay.sizeMediumText': 'Обычный текст',
  'overlay.sizeLargeText': 'Крупный текст',
  'overlay.sizeTitle': 'Заголовок',

  // ---------------------------------------------------------------- text panel
  'text.nothing': 'ничего не найдено',
  'text.lines.one': '{count} строка',
  'text.lines.few': '{count} строки',
  'text.lines.many': '{count} строк',
  'text.fragmentTitle': 'Текст во фрагменте',
  'text.shotTitle': 'Текст на снимке',
  'text.closeTitle': 'Закрыть (Esc)',
  'text.closePanel': 'Закрыть панель текста',
  'text.editable': 'Распознанный текст, можно исправить',
  'text.copyEdited': 'Копировать исправленное',
  'text.copy': 'Копировать текст',
  'text.revert': 'Вернуть текст, который распознал движок',
  'text.canEdit': 'Текст можно править',
  'text.editHint': 'Можно править прямо здесь',
  'text.edited': 'правлено',
  'text.working': 'Распознаю текст…',
  'text.retry': 'Попробовать снова',
  'text.empty':
    'На этом снимке текст не найден. Попробуйте выделить область крупнее или с более чётким текстом.',
  'text.revertShort': 'Вернуть'
} as const

export type MessageKey = keyof typeof RU

/**
 * Typed as `Record<MessageKey, string>` on purpose: adding a Russian line without
 * an English one stops the build, which is the only reliable way to keep the two
 * in step when they live in different halves of a file.
 */
const EN: Record<MessageKey, string> = {
  'app.notifyTitle': 'Flushot — error',
  'app.startFailed': 'Flushot could not start',
  'app.startFailedDetail': 'The app could not start.\n\n{detail}',
  'app.notificationFailed': 'Could not show the notification',
  'app.hotkeysFailed': 'Could not assign the keyboard shortcuts',
  'app.hotkeysNotAssigned': 'No shortcuts assigned — set them in the settings.',
  'app.autostartRejected': 'Could not enable launch at login: Windows rejected the change.',
  'app.unhandledError': 'Unhandled error',
  'app.unexpectedError': 'Unexpected error: {message}',
  'app.unhandledRejection': 'Unhandled promise rejection',
  'app.comboRejected': 'The system does not accept {combo}',
  'app.hotkeysReleaseFailed': 'Could not release the previous shortcuts',
  'app.hotkeyUnavailable': 'Could not assign {combo} — choose another combination in the settings.',
  'app.hotkeyTaken': '{combo} is taken by another program. Flushot uses {active}.',
  'app.fullscreenHotkeyUnavailable':
    'Could not assign {combo} to the full-screen capture — choose another combination in the settings.',
  'app.fullscreenHotkeyTaken':
    '{combo} is taken by another program. The full-screen capture uses {active}.',
  'app.uploadHotkeyUnavailable':
    'Could not assign {combo} to the capture with a link — choose another combination in the settings.',
  'app.uploadHotkeyTaken':
    '{combo} is taken by another program. The capture with a link uses {active}.',
  'app.captureFailed': 'Could not start the capture',
  'app.tempUnavailable': 'The system Temp folder is unavailable, using {fallback}',
  'app.tempPrepareFailed': 'Could not prepare the fallback Temp folder',

  'tray.createFailed': 'Could not create the tray icon',
  'tray.noHotkey': 'not assigned',
  'tray.tooltip': 'Flushot — screenshot tool ({hotkey})',
  'tray.capture': 'Take a screenshot',
  'tray.fullscreen': 'Capture the whole screen',
  'tray.upload': 'Capture with a link',
  'tray.settings': 'Settings…',
  'tray.openFolder': 'Open the save folder',
  'tray.checkUpdates': 'Check for updates',
  'tray.checkingUpdates': 'Checking for updates…',
  'tray.updateReady': 'Install update {version}',
  'tray.quit': 'Quit',
  // -------------------------------------------------------------------- update
  'update.readyNotify': 'Version {version} downloaded. It installs when Flushot quits.',
  'update.currentNotify': 'The latest version is already installed — {version}',
  'update.failedNotify': 'Could not check for updates: {message}',


  'capture.noDisplay': 'No display found',
  'capture.overlayFailed': 'Could not open the selection overlay',
  'capture.startFailed': 'Could not start the screen capture',
  'capture.uiLoadFailed': 'Could not load the selection interface: {detail}',
  'capture.windowMissing': 'The selection window is gone',
  'capture.displayMissing': 'The display was not found',
  'capture.shotGone': 'The screen capture is no longer available',
  'capture.sessionStale': 'The selection window is out of date. Press Ctrl+Shift+S again.',
  'capture.tooSmall': 'The area is too small — select at least 8 × 8 pixels',
  'capture.copiedNotSaved': 'Copied, but not saved: {detail}',
  'capture.copiedNotSavedFolder':
    'Copied, but not saved to “{directory}”. Choose another folder in the settings.',
  'capture.saveFailed': 'Could not save the screenshot',
  'capture.copied': 'Copied to the clipboard · {width} × {height}',
  'capture.readyNotSaved': 'The screenshot is ready, but saving failed: {detail}',
  'capture.done': 'Done · {width} × {height}',
  'capture.processFailed': 'Could not process the selected area',
  'capture.settingsUnavailable': 'Settings are unavailable',
  'capture.captureFirst': 'Take a screenshot first',
  'capture.askEachTime': 'ask every time',
  'capture.hideArea': 'hide the area',
  'capture.copyShortcutFailed': 'Could not register Ctrl+C for the selection',
  'capture.allScreens': 'All screens ({count})',
  'capture.oneScreen': 'Screen',

  'screen.displayLabel': 'Display {id}',
  'screen.captureTimeout': 'The screen capture timed out',
  'screen.captureFailed': 'Could not take the screen capture',
  'screen.displayCaptureFailed': 'Could not capture the screen “{label}”',
  'screen.displayEmpty': 'The screen “{label}” returned an empty image',

  'export.saveFailed': 'Could not save the screenshot',
  'export.encodeFailed': 'Could not prepare the screenshot',
  'export.clipboardFailed': 'Could not write to the clipboard',
  'export.noFolderAccess': 'No access to the folder “{directory}”. Choose another one in the settings.',
  'export.saved': 'Saved · {file}',
  'export.saveDialogTitle': 'Save the screenshot',
  'export.cancelled': 'Saving cancelled',
  'export.prepareClipboardFailed': 'Could not prepare the image for the clipboard',
  'export.copied': 'Copied to the clipboard',
  'upload.uploaded': 'Link copied: {url}',
  'upload.noticeTitle': 'Your link is ready',
  'upload.notice': 'It works until {expires}, after which the picture is deleted from the server.',
  'upload.noticeNoUrl': 'The picture is uploaded, but the link could not be copied.',
  'upload.uploadedNoClipboard': 'The picture was uploaded, but the link could not be copied: {url}',
  'upload.encodeFailed': 'Could not prepare the picture for upload',
  'upload.offline': 'Could not reach the server — check your connection',
  'upload.timeout': 'The server did not answer in time — try again',
  'upload.tooBig': 'The picture is over 3 MB, which the server will not accept',
  'upload.wrongType': 'The server refused the format — save as PNG or WebP',
  'upload.tooOften': 'Too many uploads in a row — wait a minute',
  'upload.busy': 'The server is not accepting pictures right now — try later',
  'upload.serverError': 'The server answered with error {status}',
  'upload.malformed': 'The server answered without a link — try again',
  'export.filenameFailed': 'Could not work out a file name',
  'export.pathNotFolder': 'The chosen path is not a folder',

  'imaging.emptyRegion': 'The selected area is empty',
  'imaging.readShotFailed': 'Could not read the screen capture',
  'imaging.readRegionFailed': 'Could not read the selected area',
  'imaging.readPreviewFailed': 'Could not read the preview image',
  'imaging.badColor': 'Invalid background colour: {hex}',
  'imaging.badSize': 'Invalid screenshot size',
  'imaging.shadowMaskFailed': 'Could not build the shadow mask',

  'ocr.unavailable': 'Text recognition is not available on this computer',
  'ocr.prepareFailed': 'Could not prepare the screenshot for recognition',
  'ocr.failed': 'Text recognition failed',
  'ocr.noEngines': 'No recognition engine is installed',
  'ocr.timeout': 'Recognition did not answer in time',
  'ocr.stopped': 'Recognition stopped',

  'shell.unknownError': 'Unknown error',
  'shell.handlerFailed': 'IPC handler error',
  'shell.ocrFailed': 'Text recognition error',
  'shell.pickFolderTitle': 'Folder for saved screenshots',
  'shell.autostartReadFailed': 'Could not read the launch-at-login setting',
  'shell.autostartWriteFailed': 'Could not change the launch-at-login setting',
  'shell.settingsLoadFailed': 'Could not load the settings window',
  'shell.noRoot': 'The root element was not found',

  'hotkey.snippingOwner': 'the Windows Snipping Tool',
  'hotkey.snippingHint':
    'Windows keeps this combination for itself and opens its Snipping Tool, so Flushot cannot have it. ' +
    'Either remove the Snipping Tool (Settings → Apps) or choose another combination: ' +
    'Ctrl+Shift+S, PrintScreen or Ctrl+Shift+X.',
  'hotkey.clipboardOwner': 'the Windows clipboard history',
  'hotkey.clipboardHint':
    'This is the system clipboard history shortcut. Choose another one: Ctrl+Shift+S or PrintScreen.',
  'hotkey.explorerOwner': 'Windows File Explorer',
  'hotkey.explorerHint':
    'This is the system File Explorer shortcut. Choose another one: Ctrl+Shift+S or PrintScreen.',
  'hotkey.lockOwner': 'the Windows lock screen',
  'hotkey.lockHint':
    'This is the system lock-screen shortcut. Choose another one: Ctrl+Shift+S or PrintScreen.',

  'settings.loading': 'Loading settings…',
  'settings.close': 'Close (Esc)',
  'settings.previewLabel': 'Result preview',
  'settings.previewAlt': 'Screenshot preview',
  'settings.previewCaption': 'Screenshot + frame',
  'settings.saveFailed': 'Could not save the settings',
  'settings.folderPickFailed': 'Could not pick the folder',
  'settings.folderOpenFailed': 'Could not open the folder',
  'settings.resetFailed': 'Could not reset the settings',
  'settings.hotkeyNeedsModifier': 'Add a modifier: Ctrl, Alt or Shift',
  'settings.hotkeyClash': '{combo} is already used by {action} — choose another combination',
  'settings.actionRegion': 'the region capture',
  'settings.actionFullscreen': 'the full-screen capture',
  'settings.actionUpload': 'the capture with a link',
  'settings.hotkeyReserved': '{combo} is taken by {owner}. {hint}',
  'settings.hotkeyTakenWithHint': '{combo} is taken by {owner}. {hint}',
  'settings.hotkeyTaken': '{combo} is taken by another program — close it or type another combination.',
  'settings.otherProgram': 'another program',
  'settings.hotkeySwitched': '{combo} is taken by another program — {active} is in use',
  'settings.hotkeyNotAssigned': '{combo} could not be assigned — choose another combination',
  'settings.hotkeyIntrusive':
    '{combo} is intercepted in every program — you will not be able to type it',
  'settings.hotkeyChangeFailed': 'Could not change the shortcut',
  'settings.hotkeyUnbound':
    'No key is assigned: {requested} is taken by another program, and so is the alternative. Click the field and record a different combination.',
  'settings.hotkeyFallback':
    '{active} is in use: {requested} is taken by another program. Click the field to choose another combination.',
  'settings.hotkeyTryThese':
    'Taken by another program — Windows gives a combination to whoever registered it first. These are free: ',
  'settings.hotkeyTakeThis': 'Assign {combo}',
  'settings.recordingPrompt': 'Press the combination…',
  'settings.recordingTitle': 'Press the key combination, Esc to cancel',
  'settings.recordTitle': 'Click to record a combination',
  'settings.resetHotkey': 'Restore {combo}',
  'settings.resetHotkeyShort': 'Reset',

  'settings.sectionAppearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.themeHint': 'Light by default',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',
  'settings.background': 'Background',
  'settings.backgroundHint': 'The space around the screenshot',
  'settings.backgroundWhite': 'White',
  'settings.backgroundGray': 'Gray',
  'settings.backgroundCustom': 'Custom colour',
  'settings.pickColor': 'Pick a colour',
  'settings.palette': 'Palette',
  'settings.paletteRemove': '{color} — right-click to remove',
  'settings.paletteAdd': 'Keep this colour in the palette',
  'settings.paletteAddShort': 'To palette',
  'settings.frameWidth': 'Frame width',
  'settings.cornerRadius': 'Corner radius',

  'settings.sectionCapture': 'Capture',
  'settings.hotkey': 'Keyboard shortcut',
  'settings.hotkeyHint': 'Region capture — a combination or a single key',
  'settings.fullscreen': 'Whole screen',
  'settings.fullscreenHint': 'Capture the whole screen at once, without selecting',
  'settings.upload': 'With a link',
  'settings.uploadHint':
    'The picture goes to the server and the clipboard gets a link. The link works for an hour, then the picture is deleted',
  'settings.uploadPrivacy':
    'This is the only key that sends a picture over the network. The other two work on your computer alone.',
  'settings.afterRegion': 'After selecting',
  'settings.afterRegionCopyHint':
    'Release the mouse and the screenshot is already on the clipboard — paste with Ctrl+V. Holding Shift on release opens the annotations',
  'settings.afterRegionEditHint': 'The screenshot opens for annotations; Ctrl+C copies it',
  'settings.afterRegionCopy': 'Copy at once',
  'settings.afterRegionEdit': 'Open it',
  'settings.launchAtLogin': 'Start with Windows',
  'settings.launchAtLoginHint': 'Flushot starts in the tray, no window opens',

  'settings.sectionShadow': 'Shadow',
  'settings.shadow': 'Shadow around the screenshot',
  'settings.shadowIntensity': 'Intensity',
  'settings.shadowBlur': 'Blur radius',

  'settings.sectionSaving': 'Saving',
  'settings.folder': 'Folder',
  'settings.folderHint': 'Click the path to open the folder',
  'settings.folderOpen': 'Open {path}',
  'settings.folderChange': 'Change…',
  'settings.afterShot': 'After the shot',
  'settings.afterShotHint': 'What to do with the finished image',
  'settings.saveToFolder': 'Save to the folder',
  'settings.askWhere': 'Ask',
  'settings.format': 'Format',
  'settings.qualityWebp': 'WebP quality',
  'settings.qualityJpeg': 'JPEG quality',

  'settings.sectionLanguage': 'Language',
  'settings.language': 'Interface language',
  'settings.languageHint': 'The Windows language',
  'settings.languageAuto': 'Same as the system',

  'settings.sectionUpdates': 'Updates',
  'settings.checkUpdates': 'Check for updates',
  'settings.checkUpdatesHint': 'Once a day, one request to GitHub',
  'settings.checkNow': 'Check now',
  'settings.version': 'Version',
  'settings.updateIdle': 'Updates are checked once a day',
  'settings.updateOff': 'Checks are off — the program makes no network requests',
  'settings.updateManual': 'This build is updated by hand: download a new version from the site',
  'settings.updateChecking': 'Checking…',
  'settings.updateCurrent': 'Version {version} is the latest',
  'settings.updateDownloading': 'Downloading {version}: {percent}%',
  'settings.updateReady': 'Version {version} is downloaded and will install on quit',
  'settings.updateInstall': 'Install and restart',
  'settings.updateFailed': 'Could not check: {message}',
  'settings.updateCheckedAt': 'checked {when}',

  'settings.resetTitle': 'Reset every setting',
  'settings.resetHint':
    'Bring the appearance, the shadow, saving and the keyboard shortcut back to their defaults',
  'settings.resetButton': 'Reset',
  'settings.footerHint': 'starts the capture',

  'overlay.demoScreen': 'Demo screen',
  'overlay.demoNoCapture': 'Demo mode: nothing is captured',
  'overlay.captureFailed': 'Could not create the screenshot',
  'overlay.demoNoClipboard': 'Demo mode: the clipboard is not available',
  'overlay.demoNoSave': 'Demo mode: saving is not available',
  'overlay.copyFailed': 'Could not copy the screenshot',
  'overlay.demoNoUpload': 'Uploading is not available in the demo',
  'overlay.uploadFailed': 'Could not upload the screenshot',
  'overlay.actionFailed': 'Could not run the action',
  'overlay.demoNoOcr': 'Demo mode: recognition is not available',
  'overlay.ocrFailed': 'Text recognition failed',
  'overlay.copied': 'Copied',
  'overlay.failed': 'Failed',
  'overlay.openForEdit': 'Open the screenshot for annotations (Enter)',
  'overlay.copyImmediately': 'Copy straight away, without annotations (Ctrl+C)',
  'overlay.resetSelection': 'Reset the selection (Esc)',
  'overlay.close': 'Close (Esc)',
  'overlay.resultAlt': 'The finished screenshot',
  'overlay.create': 'Create',
  'overlay.toolArrow': 'Arrow',
  'overlay.toolLine': 'Line (Shift — perfectly straight)',
  'overlay.toolRect': 'Rectangle',
  'overlay.toolPen': 'Pencil',
  'overlay.toolText': 'Text',
  'overlay.toolStep': 'Numbered steps',
  'overlay.toolMove': 'Move',
  'overlay.toolBlur': 'Hide the area',
  'overlay.colorSwatch': 'Colour {color}',
  'overlay.textSize': 'Label size: {size}',
  'overlay.sizeSmall': 'small',
  'overlay.sizeMedium': 'normal',
  'overlay.sizeLarge': 'large',
  'overlay.lineThin': 'Thin line',
  'overlay.lineNormal': 'Normal line',
  'overlay.lineThick': 'Thick line',
  'overlay.undoAnnotation': 'Undo the annotation (Ctrl+Z)',
  'overlay.copyToClipboard': 'Copy to the clipboard (Ctrl+C)',
  'overlay.copyLink': 'Copy the link (Ctrl+C)',
  'overlay.uploadLink': 'Upload and copy the link',
  'overlay.uploading': 'Uploading…',
  'overlay.save': 'Save (Ctrl+S)',
  'overlay.textSelectPrompt': 'Select an area with text on the screenshot',
  'overlay.textToolTitle': 'Recognise text: select an area or click the screenshot',
  'overlay.zoomOutTitle': 'Zoom out (−)',
  'overlay.zoomOut': 'Zoom out',
  'overlay.zoomLevel': 'Zoom',
  'overlay.zoomInTitle': 'Zoom in (+)',
  'overlay.zoomIn': 'Zoom in',
  'overlay.fitToScreenTitle': 'Fit to the screen (0)',
  'overlay.fitToScreen': 'Fit to the screen',
  'overlay.selectAgain': 'Select again',
  'overlay.cancel': 'Cancel (Esc)',
  'overlay.textNote': 'Text · Enter — done, Shift+Enter — new line',
  'overlay.selectTitle': 'Select an area of the screen',
  'overlay.hintDrag': 'Drag the mouse to take a screenshot',
  'overlay.hintDone': 'done',
  'overlay.hintCopy': 'copy',
  'overlay.hintCancel': 'cancel',
  'overlay.hintRelease': 'Release the mouse — the screenshot is already on the clipboard',
  'overlay.hintShiftAnnotate': 'on release — go to the annotations',
  'overlay.hintReleaseUpload': 'Release the mouse — the picture uploads and the link lands in the clipboard',
  'overlay.hintShiftCopy': 'on release — just copy it, without uploading',
  'overlay.upload': 'Upload and copy the link',
  'overlay.hintSave': 'save',
  'overlay.done': 'Done',
  'overlay.copyShort': 'Copy',
  'overlay.saveShort': 'Save',
  'overlay.textPickHint': 'Select an area with text',
  'overlay.sizeSmallText': 'Small text',
  'overlay.sizeMediumText': 'Normal text',
  'overlay.sizeLargeText': 'Large text',
  'overlay.sizeTitle': 'Heading',

  'text.nothing': 'nothing found',
  'text.lines.one': '{count} line',
  'text.lines.few': '{count} lines',
  'text.lines.many': '{count} lines',
  'text.fragmentTitle': 'Text in the fragment',
  'text.shotTitle': 'Text on the screenshot',
  'text.closeTitle': 'Close (Esc)',
  'text.closePanel': 'Close the text panel',
  'text.editable': 'Recognised text, you can correct it',
  'text.copyEdited': 'Copy the corrected text',
  'text.copy': 'Copy the text',
  'text.revert': 'Bring back the text the engine recognised',
  'text.canEdit': 'The text can be edited',
  'text.editHint': 'You can edit it right here',
  'text.edited': 'edited',
  'text.working': 'Reading the text…',
  'text.retry': 'Try again',
  'text.empty':
    'No text was found on this screenshot. Try selecting a larger area or one with clearer text.',
  'text.revertShort': 'Revert'
}

export const MESSAGES: Record<Language, Record<MessageKey, string>> = { ru: RU, en: EN }

/**
 * Which language to use, given the saved preference and the operating system's.
 *
 * `auto` matches on the primary subtag only: Windows reports `ru-RU`, `en-GB` and
 * `be-BY`, and a user whose system is Belarusian is better served by Russian than
 * by a language they did not ask for. Anything unrecognised falls to English,
 * which is the safest bet for someone who did not get their own language either.
 */
export function resolveLanguage(
  preference: LanguagePreference | undefined,
  systemLocale: string | undefined
): Language {
  if (preference === 'ru' || preference === 'en') return preference
  const primary = (systemLocale ?? '').toLowerCase().split('-')[0]
  return primary === 'ru' ? 'ru' : 'en'
}

/**
 * Fill `{name}` placeholders.
 *
 * A placeholder with no value is left as written rather than replaced with
 * "undefined": a visible `{directory}` in a message is a bug report, while
 * "undefined" looks like the feature is broken.
 */
export function t(
  language: Language,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const template = MESSAGES[language][key] ?? MESSAGES.ru[key] ?? key
  if (!vars) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  )
}

/**
 * Which counted form a number takes.
 *
 * Russian needs three: 1 строка, 2 строки, 5 строк. The rule is not "ends with
 * 1/2-4" — 11 and 12 take the singular-ending form — which is exactly why this is
 * a function and not a table at each call site. English needs two.
 */
export function pluralForm(language: Language, count: number): 'one' | 'few' | 'many' {
  const n = Math.abs(Math.trunc(count))
  if (language === 'en') return n === 1 ? 'one' : 'many'
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'one'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few'
  return 'many'
}
