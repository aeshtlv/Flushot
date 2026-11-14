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
| `smm/` | картинки и тексты для соцсетей |
| `source/` | шесть снимков интерфейса — вход для `build-site.cjs` |
| `logo/` | исходный знак, из него собираются favicon и иконки |
| `scripts/` | сборка, штамп хешей, проверки, скриншоты |

## Как посмотреть и собрать

```bash
npm install                          # один раз: нужен sharp
npm run serve                        # локальный сервер на 8123
npm run assets                       # пересобрать картинки, favicon и fonts.css
npm run stamp                        # обновить ?v= у ассетов после правки CSS/JS/картинок
npm run verify                       # проверки страницы без браузера
```

## Проверки

```bash
npm run verify        # контраст, токены тем, ссылки, хеши, вес страницы
npm run check:fold    # что видно на первом экране
npm run check:demo    # демонстрация выделения и перетаскивания
npm run check:live    # живой домен: сети, консоль, вёрстка
npm run shots         # отрендерить страницу в headless Edge и сохранить кадры
```

## Откуда берутся снимки интерфейса

`source/*.png` рисует не эта ветка, а репозиторий программы: `scripts/make-hero-image.cjs`
и `scripts/make-ui-shots.cjs` там запускают настоящий рендерер Flushot в headless-браузере.
Когда интерфейс меняется, снимки пересобираются в `main` (в `docs/`), затем шесть файлов
копируются сюда в `source/`, и `npm run assets` пересобирает из них весовые копии.

```text
main: docs/hero-framed.png      ->  site: source/hero-framed.png
main: docs/ui-overlay.png       ->  site: source/ui-overlay.png
main: docs/ui-annotate.png      ->  site: source/ui-annotate.png
main: docs/ui-ocr.png           ->  site: source/ui-ocr.png
main: docs/ui-settings.png      ->  site: source/ui-settings.png
main: docs/multi-monitor.png    ->  site: source/multi-monitor.png
```

## Публикация

`.github/workflows/pages.yml` публикует `site/` в GitHub Pages при каждом пуше в эту ветку.
Домен `flushot.ink` обслуживает сервер, который забирает `site/` из этой же ветки:
`deploy/deploy-site.sh` в `main` тянет архив ветки `site` и переключает симлинк.

Версия в `package.json` должна совпадать с версией программы: `verify-site.cjs` сверяет
её с именами файлов в ссылках на скачивание.
