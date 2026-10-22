# Публикация

Репозиторий: **https://github.com/aeshtlv/Flushot**. Страница программы: **https://aeshtlv.github.io/Flushot/**.

## Что лежит в репозитории

Исходники, документация и кадры интерфейса. Всё тяжёлое исключено через `.gitignore`:

| Исключено | Причина |
|---|---|
| `node_modules/` | восстанавливается командой `npm install` |
| `out/`, `release/` | результат сборки |
| `share/*.zip` | 110–160 МБ на файл: GitHub отклоняет файлы больше 100 МБ, а три архива раздули бы репозиторий до 400 МБ |
| `.tmp/`, `.cache/`, `.npm-cache/` | рабочие каталоги |

Архивы с программой живут в **Releases**: там лимит на файл 2 ГБ, и они не попадают в историю git.
`README.md` и кнопки на сайте указывают на `releases/latest/download/...`, поэтому после публикации
релиза ссылки работают сами.

## Выпуск новой версии

1. Поднять `version` в `package.json` — она должна совпадать с тегом релиза, иначе имя файла
   в ссылке разойдётся с прикреплённым архивом и кнопка «Скачать» отдаст 404.
2. Собрать и упаковать: `npm run dist`, затем разложить архивы в `share/` — см.
   [DEVELOPMENT.md](DEVELOPMENT.md#сборка-и-упаковка).
3. Создать релиз с тегом `v<версия>` и прикрепить три файла из `share/`:

   - `Flushot-<версия>-win64.zip`
   - `Flushot-<версия>-installer.zip`
   - `Flushot-<версия>-portable.zip`

Через веб-интерфейс: **Releases → Draft a new release**. Через GitHub CLI:

```bash
gh release create v2.2.8 --title "Flushot 2.2.8" --notes-file CHANGELOG.md ^
  share/Flushot-2.2.8-win64.zip share/Flushot-2.2.8-installer.zip share/Flushot-2.2.8-portable.zip
```

4. Обновить `CHANGELOG.md` и имена архивов в `README.md`, `README.en.md` и `site/index.html`,
   затем прогнать `npm run verify:site` и `npm run verify:docs`.

## Сайт

`site/` — статика без сборщика. Кнопки скачивания ведут в Releases, поэтому папку можно публиковать
целиком, ничего не копируя внутрь.

Workflow `.github/workflows/pages.yml` выкладывает `site/` на GitHub Pages при каждом изменении в
`main`. Источник уже настроен: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Если Pages придётся включить заново (новый форк, переезд), выбрать этот источник и запустить workflow
`Pages` на вкладке **Actions**.

Альтернатива без workflow:

```bash
git subtree push --prefix site origin gh-pages
```

и затем выбрать источником ветку `gh-pages`. Минус: папку нужно пушить заново после каждой правки.

Проверки страницы:

```bash
npm run verify:site            # ссылки, контраст, разметка, шрифты, адреса архивов
node scripts/shot-site.cjs     # рендер в headless-браузере на пяти ширинах
```

При переезде на другой домен нужно обновить `canonical`, `og:url`, `og:image` и `twitter:image`
в начале `site/index.html` — им нужен абсолютный адрес. Подробнее — в
[site/КАК ОПУБЛИКОВАТЬ.txt](../site/КАК%20ОПУБЛИКОВАТЬ.txt).

## Что проверить после публикации

- Главная страница репозитория показывает `README.md` с картинками из `docs/` и `logo/`.
- Вкладка **Releases** содержит три архива, и ссылки из README открываются.
- Вкладка **Actions** — зелёные прогоны `CI` (типы, тесты, сайт, документация) и `Pages`.
- Сайт открывается по адресу `https://aeshtlv.github.io/Flushot/`, кнопки на нём скачивают архивы.
- В файловом дереве нет ни одного файла больше 100 МБ.

## Чего в репозитории намеренно нет

- **Готовых exe.** Они в Releases: в git они попали бы в историю навсегда, и каждый выпуск утраивал бы
  размер клона.
- **Снимков рабочего стола.** Все кадры в `docs/` отрисованы в настоящей сборке интерфейса.
- **Сертификата подписи.** Сборки не подписаны, поэтому SmartScreen предупреждает. Для распространения
  нужен сертификат code signing и настройка `win.signingHashAlgorithms` в `electron-builder.yml`.
