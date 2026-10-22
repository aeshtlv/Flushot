# Как выложить проект на GitHub

Пошагово, с командами. Всё проверено на git 2.50; `gh` (GitHub CLI) на машине автора не установлен,
поэтому для него команды даны отдельно — их можно пропустить и всё сделать через сайт.

## Что попадёт в репозиторий

Исходники и документация — около 6 МБ. Всё тяжёлое уже исключено через `.gitignore`:

| Исключено | Почему |
|---|---|
| `node_modules/` | ставится `npm install` |
| `out/`, `release/` | результат сборки |
| `share/*.zip`, `site/downloads/*.zip` | по 110–160 МБ на файл: GitHub отклоняет файлы больше 100 МБ, а три таких архива раздули бы репозиторий до 400 МБ |
| `.tmp/`, `.cache/`, `.npm-cache/` | рабочий мусор |

Архивы живут не в репозитории, а в **Releases** — там лимит на файл 2 ГБ, и они не попадают в историю
git. Ссылки в `README.md` уже указывают на `releases/latest/download/...`, так что после публикации
релиза кнопки заработают сами.

## Шаг 1. Создать пустой репозиторий

На github.com: **New repository** → имя `Flushot` → **Public** → **не** добавлять README, `.gitignore`
и лицензию (они уже есть) → **Create repository**.

## Шаг 2. Первый коммит и push

Репозиторий уже инициализирован и в нём сделан первый коммит, поэтому нужен только адрес:

```bash
git remote add origin https://github.com/<ваш-логин>/Flushot.git
git push -u origin main
```

Если репозиторий ещё не инициализирован (например, вы скопировали проект заново):

```bash
git init -b main
git add .
git commit -m "Flushot 2.2.8"
git remote add origin https://github.com/<ваш-логин>/Flushot.git
git push -u origin main
```

Проверить, что ничего лишнего не попало:

```bash
git ls-files | Measure-Object -Line     # сколько файлов
git ls-files -z | ForEach-Object { ... }  # или просто: git count-objects -vH
```

Самый крупный файл в индексе — `package-lock.json` (198 КБ) и кадры интерфейса по 200–300 КБ.

## Шаг 3. Релиз с архивами

Архивы собираются командой `npm run dist`, затем упаковываются в `share/` (см.
[DEVELOPMENT.md](DEVELOPMENT.md#сборка-и-упаковка)). Дальше — на сайте GitHub:
**Releases → Draft a new release** → тег `v2.2.8` → прикрепить три файла из `share/`:

- `Flushot-2.2.8-win64.zip`
- `Flushot-2.2.8-installer.zip`
- `Flushot-2.2.8-portable.zip`

С `gh` это одной командой:

```bash
gh release create v2.2.8 --title "Flushot 2.2.8" --notes-file CHANGELOG.md ^
  share/Flushot-2.2.8-win64.zip share/Flushot-2.2.8-installer.zip share/Flushot-2.2.8-portable.zip
```

Тег версии должен совпадать с `version` в `package.json` — иначе имя файла в ссылке не сойдётся с
релизом, и кнопка «Скачать» отдаст 404. При выпуске новой версии: поднять версию, собрать, поставить
новый тег, прикрепить новые архивы.

## Шаг 4. Сайт на GitHub Pages (по желанию)

Лендинг в `site/` — статика без сборщика, но у него есть одна особенность: кнопки скачивания ведут на
`site/downloads/*.zip`, а эта папка в `.gitignore`, потому что архивы слишком велики для репозитория.
На Pages такие ссылки дадут 404.

Два выхода:

1. **Ссылки на Releases (правильный).** Заменить в `site/index.html` три адреса вида
   `href="downloads/Flushot-2.2.8-win64.zip"` на
   `href="https://github.com/<логин>/Flushot/releases/latest/download/Flushot-2.2.8-win64.zip"`.
   Файлы `site/downloads/` тогда не нужны вовсе, а страница обновляется без пересборки.
2. **Отдельный хостинг для архивов** (S3, свой сервер) и замена тех же трёх ссылок.

Публикация: **Settings → Pages → Build and deployment → Source: GitHub Actions**, затем добавить
workflow, который выкладывает папку `site/`. Либо собрать вручную и положить содержимое `site/` в ветку
`gh-pages`:

```bash
git subtree push --prefix site origin gh-pages
```

Перед публикацией стоит прогнать проверки страницы:

```bash
node scripts/build-site.cjs --skip-downloads
node scripts/verify-site.cjs --no-archives
```

Оба ключа нужны потому, что в репозитории нет архивов; без них проверки честно сообщат, что скачивание
проверить не на чем.

## Шаг 5. Что проверить после публикации

- Главная страница репозитория показывает `README.md` с картинками (они лежат в `docs/` и `logo/`).
- Вкладка **Releases** содержит три архива, и ссылки из README открываются.
- Вкладка **Actions** — зелёная сборка: `typecheck` и `test` на Windows.
- В файловом дереве нет ни одного файла больше 100 МБ.

## Чего в репозитории намеренно нет

- **Готовых exe.** Они в Releases: в git они попали бы в историю навсегда, и каждый выпуск утраивал бы
  размер клона.
- **Скриншотов рабочего стола.** Все кадры в `docs/` — синтетическая сцена, отрисованная в настоящей
  сборке интерфейса. Ничего личного в истории нет.
- **Сертификата подписи.** Сборки не подписаны, поэтому SmartScreen предупреждает. Для распространения
  нужен сертификат code signing и настройка `win.signingHashAlgorithms` в `electron-builder.yml`.
