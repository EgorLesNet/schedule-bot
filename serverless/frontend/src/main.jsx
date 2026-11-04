import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'glisse/styles.css';
import './style.css';
import Homework from './homework';
import { Button, Panel, Field, Select, Textarea, Toggle, Status, ErrorBoundary } from './ui';
import { call, initTelegram, waitForServerless, clearReadCache, openLink } from './telegram';

const dateObject = value => new Date(value + 'T12:00:00Z');
const addDays = (value, amount) => { const date = dateObject(value); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); };
const weekStart = value => addDays(value, -((dateObject(value).getUTCDay() + 6) % 7));
const dateLabel = value => dateObject(value).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const currentDate = () => new Date(Date.now() + 10800000).toISOString().slice(0, 10);
const legacy = () => window.location.assign('../index.html');

function useQuery(name, params, revision = 0, enabled = true, cache = false) {
  const key = JSON.stringify([name, params, revision, enabled]);
  const [state, setState] = useState({ key: '', data: null, loading: true, error: null, cached: false });
  useEffect(() => {
    let alive = true;
    if (!enabled) { setState({ key, data: null, loading: false, error: null, cached: false }); return; }
    setState({ key, data: null, loading: true, error: null, cached: false });
    call(name, params, { cache }).then(result => { if (alive) setState({ key, ...result, loading: false, error: null }); }, error => { if (alive) setState({ key, data: null, loading: false, error, cached: false }); });
    return () => { alive = false; };
  }, [key, cache]);
  return state.key === key ? state : { data: null, loading: enabled, error: null, cached: false };
}
function QueryStatus({ query }) {
  if (query.loading) return <Status>Загрузка…</Status>;
  if (query.error) return <Status error>{query.error.message}</Status>;
  if (query.cached) return <Status>Нет связи: показана сохранённая копия. Изменения требуют подключения.</Status>;
  return null;
}
function useMutation(onError) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async task => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onError(null);
    try { await task(); } catch (error) { onError(error.message || String(error)); } finally { lock.current = false; setBusy(false); }
  };
  return [busy, run];
}
function Lesson({ item, day, me, setMe }) {
  const key = item.original + '|' + day.date + '|' + item.start;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(me.notes?.[key] || '');
  const [error, setError] = useState(null);
  const [busy, run] = useMutation(setError);
  const favourite = (me.favs || []).includes(item.original);
  return <article className="app-lesson"><div className="app-lesson-time">{item.start}–{item.end}</div><div className="app-lesson-body"><h3>{item.summary}</h3><p className="app-muted">{[item.teacher, item.room].filter(Boolean).join(' · ')}</p>{item.hw && <p className="app-prose">{item.hw}</p>}{me.notes?.[key] && <p className="app-prose app-muted">Заметка: {me.notes[key]}</p>}<div className="app-actions"><Button disabled={busy} aria-pressed={favourite} onClick={() => run(async () => setMe((await call('me', { action: 'fav', subject: item.original, value: !favourite })).data))}>{favourite ? '★ В избранном' : '☆ Избранное'}</Button><Button onClick={() => setEditing(!editing)} aria-expanded={editing}>Заметка</Button>{item.link && <Button primary disabled={busy} onClick={() => run(async () => openLink(item.link))}>Подключиться</Button>}</div>{editing && <div className="app-stack"><Textarea label="Личная заметка" maxLength={500} value={note} onChange={event => setNote(event.target.value)} /><Button primary disabled={busy} onClick={() => run(async () => { setMe((await call('me', { action: 'note', key, text: note })).data); setEditing(false); })}>Сохранить</Button></div>}{error && <p role="alert" className="app-error-text">{error}</p>}</div></article>;
}
function Schedule({ boot, me, setMe, revision }) {
  const [mode, setMode] = useState('day');
  const [date, setDate] = useState(boot.today || currentDate());
  const [onlyFav, setOnlyFav] = useState(false);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const timer = setTimeout(() => setTerm(search.trim()), 350); return () => clearTimeout(timer); }, [search]);
  const isSearch = term.length >= 2;
  const from = mode === 'week' ? weekStart(date) : date;
  const query = useQuery(isSearch ? 'search' : 'range', isSearch ? { q: term } : { from, days: mode === 'week' ? 7 : 1 }, revision, true, !isSearch);
  const days = isSearch ? Object.values((query.data || []).reduce((result, item) => { const day = result[item.date] ||= { date: item.date, label: dateLabel(item.date), items: [] }; day.items.push(item); return result; }, {})) : (query.data || []);
  return <><Panel><div className="app-actions" role="group" aria-label="Период"><Button primary={mode === 'day'} aria-pressed={mode === 'day'} onClick={() => setMode('day')}>День</Button><Button primary={mode === 'week'} aria-pressed={mode === 'week'} onClick={() => setMode('week')}>Неделя</Button></div><Field label="Дата" type="date" value={date} onValueChange={value => { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setDate(value); }} /><div className="app-actions"><Button aria-label="Предыдущий период" onClick={() => setDate(addDays(date, mode === 'week' ? -7 : -1))}>Назад</Button><Button onClick={() => setDate(currentDate())}>Сегодня</Button><Button aria-label="Следующий период" onClick={() => setDate(addDays(date, mode === 'week' ? 7 : 1))}>Вперёд</Button></div><Field label="Поиск предмета или преподавателя" value={search} onValueChange={setSearch} placeholder="Не менее двух символов" /><Toggle label="Только избранные" checked={onlyFav} onCheckedChange={setOnlyFav} /></Panel><QueryStatus query={query} />{!query.loading && !query.error && !days.length && <Status>Ничего не найдено</Status>}{days.map(day => { const items = (day.items || []).filter(item => !onlyFav || (me.favs || []).includes(item.original)); return <Panel title={day.label || dateLabel(day.date)} key={day.date}>{items.length ? items.map(item => <Lesson key={item.original + '|' + item.start} item={item} day={day} me={me} setMe={setMe} />) : <p className="app-muted">{onlyFav ? 'Нет избранных занятий' : 'Занятий нет'}</p>}</Panel>; })}<Panel><p className="app-muted">Переносы, отмены и редактирование ссылок пока доступны в старом интерфейсе.</p><Button onClick={legacy}>Открыть все действия</Button></Panel></>;
}
function Settings({ boot, reload }) {
  const user = boot.user || {};
  const [faculty, setFaculty] = useState(String(user.faculty ?? 0));
  const [course, setCourse] = useState(String(user.course || '1'));
  const [direction, setDirection] = useState(String(user.direction ?? 0));
  const [stream, setStream] = useState(user.stream || '');
  const [langStart, setLangStart] = useState(user.langStart || '');
  const [reminders, setReminders] = useState(!!user.reminders);
  const [error, setError] = useState(null);
  const [busy, run] = useMutation(setError);
  const faculties = boot.faculties || [];
  const directions = faculties[Number(faculty)]?.directions || [];
  const schedules = (boot.schedules || []).find(item => String(item.course) === course)?.streams || [];
  const availableDirections = directions.map((label, index) => ({ label, index })).filter(item => schedules.some(schedule => (boot.files?.[faculty + ':' + item.index] || []).includes(schedule.file)));
  const selectedDirection = availableDirections.some(item => String(item.index) === direction) ? direction : String(availableDirections[0]?.index ?? '');
  const streams = schedules.filter(item => (boot.files?.[faculty + ':' + selectedDirection] || []).includes(item.file));
  const selectedStream = streams.some(item => item.key === stream) ? stream : (streams[0]?.key || '');
  const times = Array.from({ length: 21 }, (_, index) => { const minutes = 480 + index * 30; return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0'); });
  return <Panel title="Моё расписание"><Select label="Факультет" value={faculty} disabled={busy} onChange={event => setFaculty(event.target.value)}>{faculties.map((item, index) => <option value={index} key={item.name}>{item.name}</option>)}</Select><Select label="Курс" value={course} disabled={busy} onChange={event => setCourse(event.target.value)}>{Array.from({ length: boot.courses || 4 }, (_, index) => <option key={index} value={String(index + 1)}>{index + 1} курс</option>)}</Select><Select label="Направление" value={selectedDirection} disabled={busy} onChange={event => setDirection(event.target.value)}>{!availableDirections.length && <option value="">Нет расписаний для этого курса</option>}{availableDirections.map(item => <option value={String(item.index)} key={item.index}>{item.label}</option>)}</Select><Select label="Поток / расписание" value={selectedStream} disabled={busy} onChange={event => setStream(event.target.value)}>{!streams.length && <option value="">Нет расписания</option>}{streams.map(item => <option value={item.key} key={item.key}>{item.name}</option>)}</Select>{['1', '2'].includes(course) && <Select label="Время начала иностранного языка" value={langStart} disabled={busy} onChange={event => setLangStart(event.target.value)}><option value="">Не выбрано</option>{times.map(item => <option key={item}>{item}</option>)}</Select>}<Toggle label="Напоминания" checked={reminders} disabled={busy} onCheckedChange={setReminders} /><Button primary disabled={busy || !selectedStream} onClick={() => run(async () => { await call('settings', { faculty: Number(faculty), direction: Number(selectedDirection), course, stream: selectedStream, langStart: ['1', '2'].includes(course) ? langStart : '', reminders }); clearReadCache(); await reload(); })}>{busy ? 'Сохранение…' : 'Сохранить настройки'}</Button>{error && <p role="alert" className="app-error-text">{error}</p>}</Panel>;
}
function App() {
  const [boot, setBoot] = useState(null);
  const [me, setMe] = useState({ favs: [], notes: {}, done: [] });
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('schedule');
  const [revision, setRevision] = useState(0);
  const [bootRevision, setBootRevision] = useState(0);
  useEffect(() => initTelegram(), []);
  const reload = async () => { const result = await call('bootstrap'); setBoot(result.data); setMe(result.data.me || { favs: [], notes: {}, done: [] }); setBootRevision(value => value + 1); setRevision(value => value + 1); if (!result.data.user?.course) setTab('settings'); };
  useEffect(() => { let alive = true; (async () => { try { await waitForServerless(); const result = await call('bootstrap'); if (!alive) return; setBoot(result.data); setMe(result.data.me || { favs: [], notes: {}, done: [] }); if (!result.data.user?.course) setTab('settings'); } catch (failure) { if (alive) setError(failure.message); } })(); return () => { alive = false; }; }, []);
  const selected = boot?.user?.course;
  return <div className="app-shell"><header className="app-header"><div><p className="app-eyebrow">Telegram Serverless · React preview · этап 2</p><h1>Расписание</h1></div><Button onClick={legacy}>Старая версия</Button></header><Panel className="app-preview"><p>Тестовая React-версия. Расписание и расширенные ДЗ перенесены частично; остальные разделы доступны в старой версии. Главная страница приложения не заменена.</p></Panel>{error ? <Status error>{error}<div className="app-actions"><Button onClick={() => window.location.reload()}>Повторить</Button></div></Status> : !boot ? <Status>Подключение к Telegram…</Status> : <><nav className="app-navigation" aria-label="Разделы приложения">{[['schedule', 'Расписание'], ['homework', 'ДЗ'], ['settings', 'Настройки'], ['more', 'Ещё']].map(([id, label]) => <Button key={id} primary={tab === id} aria-current={tab === id ? 'page' : undefined} disabled={!selected && ['schedule', 'homework'].includes(id)} onClick={() => setTab(id)}>{label}</Button>)}</nav><main className="app-stack">{tab === 'schedule' && <Schedule key={bootRevision} boot={boot} me={me} setMe={setMe} revision={revision} />}{tab === 'homework' && <Homework key={bootRevision} boot={boot} me={me} setMe={setMe} revision={revision} refresh={() => setRevision(value => value + 1)} />}{tab === 'settings' && <Settings key={bootRevision} boot={boot} reload={reload} />}{tab === 'more' && <Panel title="Остальные разделы"><p>Новости, библиотека, клубы, экзамены, административные функции и расширенные настройки пока не перенесены. Они сохранены в действующей версии.</p><Button primary onClick={legacy}>Открыть действующее приложение</Button></Panel>}</main></>}</div>;
}
createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
