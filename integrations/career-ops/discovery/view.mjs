const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const groups = {
  'remote-cz': 'Удалённо · в локации указана Чехия',
  'remote-region': 'Удалённо · регион включает Чехию',
  review: 'Удалёнка требует проверки · страна найма и поездки в офис',
  prague: 'Прага · офис, гибрид или формат не указан',
};
const status = { ok: 'Прочитан', partial: 'Частично', error: 'Ошибка' };
function list(jobs) {
  const roles = new Map();
  for (const job of jobs) {
    const key = JSON.stringify([job.company.trim().toLowerCase(), job.title.trim().toLowerCase()]);
    if (!roles.has(key)) roles.set(key, []);
    roles.get(key).push(job);
  }
  return '<ul>' + [...roles.values()].map(([job, ...others]) => {
    const details = [job.location, job.language, job.source, job.posted].filter(Boolean).map(escape).join(' · ');
    const links = others.map(o => '<a rel="noreferrer" href="' + escape(o.url) + '">' + escape([o.source, o.posted || o.location].filter(Boolean).join(' · ')) + '</a>');
    return '<li><a rel="noreferrer" href="' + escape(job.url) + '">' + escape(job.title) + '</a> · ' + escape(job.company) +
      '<br><small>' + details + (links.length ? '<br>Другие объявления этой роли: ' + links.join(' · ') : '') + '</small></li>';
  }).join('') + '</ul>';
}
export function render(report, archives = []) {
  const jobs = report.jobs.toSorted((a, b) => (a.python === 'title' ? 0 : 1) - (b.python === 'title' ? 0 : 1)
    || (b.posted || '').localeCompare(a.posted || '') || a.company.localeCompare(b.company));
  const sections = Object.entries(groups).map(([id, title]) => {
    const selected = jobs.filter(job => job.group === id);
    const direct = selected.filter(job => job.python === 'title');
    const mentions = selected.filter(job => job.python === 'description');
    const search = selected.filter(job => job.python === 'search');
    return '<section><h2>' + title + ' (' + selected.length + ')</h2>' +
      (direct.length ? list(direct) : '<p>Вакансий с Python или его фреймворком в названии в этой выборке нет.</p>') +
      (mentions.length ? '<details><summary>Python встречается в описании (' + mentions.length + ')</summary>' + list(mentions) + '</details>' : '') +
      (search.length ? '<details><summary>Найдены по поисковому запросу, стек требует проверки (' + search.length + ')</summary>' + list(search) + '</details>' : '') + '</section>';
  }).join('');
  const sources = report.sources.map(s => '<tr><td>' + escape(s.name) + '</td><td>' + status[s.status] + '</td><td>' + (s.read ?? '—') + '</td><td>' + s.matched + '</td></tr>').join('');
  const time = new Intl.DateTimeFormat('ru', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(new Date(report.created));
  return '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вакансии Python</title>' +
    '<style>body{font:17px/1.5 system-ui,sans-serif;color:#172f30;background:#f8fbfa;max-width:58rem;margin:auto;padding:2rem 1.2rem}h1,h2{line-height:1.2}li{margin:.7rem 0}a{color:#145b6a}small{color:#495c61}table{border-collapse:collapse}td,th{padding:.22rem .8rem;text-align:left;border-bottom:1px solid #baccc8}section{margin:2rem 0}</style>' +
    '<main><a href="/#pilot-evaluate">К оценке вакансии</a><h1>Вакансии Python</h1><p>' + time + ' · Прага</p><p>Проверьте в объявлении страну найма, рабочие часы и роль Python в стеке. Для оценки скопируйте описание вакансии в Career-Ops.</p>' +
    (archives.length ? '<nav><h2>Предыдущие подборки</h2>' + archives.map(file => '<a href="' + escape(file) + '">' + escape(file.match(/\d{4}-\d{2}-\d{2}/)[0]) + '</a>').join(' · ') + '</nav>' : '') +
    sections + '<details><summary>Источники и покрытие</summary><table><tr><th>Источник</th><th>Статус</th><th>Карточек</th><th>Отобрано</th></tr>' +
    sources + '</table></details></main></html>';
}
