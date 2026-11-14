/**
 * The words inside the demonstration desktop.
 *
 * They live here, apart from the drawing in `renderer/overlay/demoScene.ts`,
 * because two very different things need them: the module that draws the picture
 * and the test that checks the English picture has no Russian left in it. Keep
 * the tables next to the drawing and that test cannot import them without
 * dragging the whole renderer into the Node build.
 *
 * This is not the interface dictionary: the scene is a picture of *another*
 * program, so its words are not translated by key and do not change with the
 * app's own language settings — the caller says which table to use.
 */

/**
 * The two languages the scene is drawn in.
 *
 * Deliberately its own type: the scene depends on nothing, which is what lets a
 * plain Node process load it (see scripts/scene-loader.cjs).
 */
export type SceneLanguage = 'ru' | 'en'

export interface SceneStrings {
  title: string
  sidebar: string[]
  initials: string
  person: string
  role: string
  heading: string
  subtitle: string
  paragraph: string[]
  download: string
  share: string
  chartTitle: string
  chartUnit: string
  indicator: string
  plan: string
  fact: string
  rows: { name: string; plan: string; fact: string; delta: string; up: boolean }[]
  saved: string
  others: string[]
}

const SCENE_RU: SceneStrings = {
  title: 'Квартальный отчёт — Q3 2026',
  sidebar: ['Обзор', 'Документы', 'Отчёты', 'Команда', 'Клиенты', 'Настройки'],
  initials: 'АС',
  person: 'А. Смирнов',
  role: 'Аналитик',
  heading: 'Квартальный отчёт',
  subtitle: 'Июль — сентябрь 2026 · обновлено 12 октября',
  paragraph: [
    'Выручка выросла на 18 % относительно прошлого квартала. Рост дали',
    'новые клиенты в среднем сегменте: 134 договора вместо плановых 120.',
    'Отток снизился до 2,1 % — лучший показатель за год.'
  ],
  download: 'Скачать PDF',
  share: 'Поделиться',
  chartTitle: 'Выручка по кварталам',
  chartUnit: 'млн ₽',
  indicator: 'ПОКАЗАТЕЛЬ',
  plan: 'ПЛАН',
  fact: 'ФАКТ',
  rows: [
    { name: 'Выручка, млн ₽', plan: '42,0', fact: '45,8', delta: '+9 %', up: true },
    { name: 'Новые клиенты', plan: '120', fact: '134', delta: '+12 %', up: true },
    { name: 'Средний чек, ₽', plan: '18 400', fact: '17 900', delta: '−3 %', up: false },
    { name: 'Отток, %', plan: '3,0', fact: '2,1', delta: '−0,9', up: true }
  ],
  saved: 'Все изменения сохранены',
  others: ['АС', 'МК']
}

const SCENE_EN: SceneStrings = {
  title: 'Quarterly report — Q3 2026',
  sidebar: ['Overview', 'Documents', 'Reports', 'Team', 'Clients', 'Settings'],
  initials: 'AS',
  person: 'A. Smirnov',
  role: 'Analyst',
  heading: 'Quarterly report',
  subtitle: 'July — September 2026 · updated 12 October',
  paragraph: [
    'Revenue grew 18 % against the previous quarter. The growth came from',
    'new mid-market clients: 134 contracts instead of the planned 120.',
    'Churn fell to 2.1 %, the best figure of the year.'
  ],
  download: 'Download PDF',
  share: 'Share',
  chartTitle: 'Revenue by quarter',
  chartUnit: '₽m',
  indicator: 'INDICATOR',
  plan: 'PLAN',
  fact: 'ACTUAL',
  rows: [
    { name: 'Revenue, ₽m', plan: '42.0', fact: '45.8', delta: '+9 %', up: true },
    { name: 'New clients', plan: '120', fact: '134', delta: '+12 %', up: true },
    { name: 'Average order, ₽', plan: '18 400', fact: '17 900', delta: '−3 %', up: false },
    { name: 'Churn, %', plan: '3.0', fact: '2.1', delta: '−0.9', up: true }
  ],
  saved: 'All changes saved',
  others: ['AS', 'MK']
}

const SCENE: Record<SceneLanguage, SceneStrings> = { ru: SCENE_RU, en: SCENE_EN }

/** The words for one language. */
export function sceneStrings(lang: SceneLanguage): SceneStrings {
  return SCENE[lang]
}
