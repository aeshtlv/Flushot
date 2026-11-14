# Flushot — сайт

Лендинг [flushot.ink](https://flushot.ink) в отдельной ветке. Программа живёт в ветке
`main` того же репозитория; здесь только страница, её картинки и скрипты, которые её
собирают и проверяют.

Ветка независимая: **`main` в неё не вливается**. В `main` нет ни `site/`, ни `smm/`,
а слияние вернуло бы их обратно и снесло историю страницы. Общие файлы — `logo/logo.svg`
и шесть снимков интерфейса в `source/` — лежат здесь копиями, и это осознанно: страница
должна публиковаться, не собирая приложение.

## Что где

| Папка | Содержимое |
|---|---|
| `site/` | то, что публикуется: HTML, CSS, JS, шрифты, картинки |
| `site/en/` | английская страница — генерируется, руками не правится |
| `smm/` | картинки и тексты для соцсетей |
| `source/` | шесть снимков интерфейса — вход для `build-site.cjs` |
| `source/en/` | те же шесть снимков на английском |
| `logo/` | исходный знак, из него собираются favicon и иконки |
| `scripts/` | сборка, штамп хешей, проверки, скриншоты |

## Как посмотреть и собрать

```bash
npm install                          # один раз: нужен sharp
npm run serve                        # локальный сервер на 8123
npm run assets                       # пересобрать картинки, favicon и fonts.css
npm run stamp                        # пересобрать английскую страницу и обновить ?v= у ассетов
npm run verify                       # проверки страницы без браузера
```

## Проверки

```bash
npm run verify        # контраст, токены тем, ссылки, хеши, вес страницы
npm run check:fold    # что видно на первом экране (--lang=en для английского)
npm run check:demo    # демонстрация выделения и перетаскивания
npm run check:live    # живой домен: сети, консоль, вёрстка
npm run shots         # отрендерить обе страницы в headless Edge и сохранить кадры
```

`npm run shots` меряет обе языковые версии на семи ширинах: английский текст длиннее
русского, и заголовок, который на одном языке влезает в строку, на другом уезжает
в следующую секцию. Он же проверяет переключатель языка — что он виден, стоит в шапке
и не наезжает на кнопку темы — и слова, которые `app.js` пишет в страницу по ходу
работы: они берутся из таблицы по `lang` документа, и пропущенная строка вставила бы
русское слово в английскую страницу.

## Два языка

Английская страница не написана отдельно — она собирается из русской:

```bash
node scripts/build-en-page.cjs   # site/en/index.html из site/index.html и scripts/en-page-text.cjs
```

`scripts/en-page-text.cjs` — таблица пар «русская строка → английская», 199 пар. Сборка
подставляет их от длинных к коротким, переключает `lang`, `canonical`, `og:url`,
`og:locale` и `inLanguage`, переписывает пути к картинкам на `../assets/en/` и падает,
если хоть одна пара не нашлась или на странице осталась хоть одна кириллическая буква
(кроме подписи ссылки назад — «Русская версия», её читает тот, кто английского не знает).
Хеши `?v=` сборка проставляет сама.

Правится всегда `site/index.html`, потом `npm run stamp`. `npm run verify` пересобирает
английскую страницу в памяти и сравнивает: если её забыли пересобрать, проверка краснеет.
`site/en/` в `.gitignore` не лежит — сгенерированный файл лежит в репозитории, чтобы
Pages мог его опубликовать.

## Откуда берутся снимки интерфейса

`source/*.png` рисует не эта ветка, а репозиторий программы: `scripts/make-hero-image.cjs`
и `scripts/make-ui-shots.cjs` там запускают настоящий рендерер Flushot в headless-браузере.
Когда интерфейс меняется, снимки пересобираются в `main` (в `docs/`), затем шесть файлов
копируются сюда в `source/`, и `npm run assets` пересобирает из них весовые копии.
На английском те же снимки снимаются тем же скриптом с ключом `--lang=en` и ложатся
в `docs/en/`; оттуда они копируются в `source/en/`.

```text
main: docs/hero-framed.png      ->  site: source/hero-framed.png
main: docs/ui-overlay.png       ->  site: source/ui-overlay.png
main: docs/ui-annotate.png      ->  site: source/ui-annotate.png
main: docs/ui-ocr.png           ->  site: source/ui-ocr.png
main: docs/ui-settings.png      ->  site: source/ui-settings.png
main: docs/multi-monitor.png    ->  site: source/multi-monitor.png

main: docs/en/hero-framed.png   ->  site: source/en/hero-framed.png
main: docs/en/ui-overlay.png    ->  site: source/en/ui-overlay.png
main: docs/en/ui-annotate.png   ->  site: source/en/ui-annotate.png
main: docs/en/ui-ocr.png        ->  site: source/en/ui-ocr.png
main: docs/en/ui-settings.png   ->  site: source/en/ui-settings.png
main: docs/en/multi-monitor.png ->  site: source/en/multi-monitor.png
```

Английские снимки — это настоящий интерфейс с переключённым языком, а не русские
картинки с подписями. Проверка `verify-ui-shots.cjs` в `main` сверяет, что оба набора
на месте и что они отличаются друг от друга.

Устройство страницы — почему демонстрация нарисована разметкой, откуда взялись
`--rule` и `--border`, как устроены шрифты в `fonts.css` — описано в [docs/SITE.md](docs/SITE.md).

## Публикация

`.github/workflows/pages.yml` публикует `site/` в GitHub Pages при каждом пуше в эту ветку.
Домен `flushot.ink` обслуживает сервер, который забирает `site/` из этой же ветки:
`deploy/deploy-site.sh` в `main` тянет архив ветки `site` и переключает симлинк.

Версия в `package.json` должна совпадать с версией программы: `verify-site.cjs` сверяет
её с именами файлов в ссылках на скачивание.
