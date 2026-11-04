import React, { useEffect, useRef, useState } from 'react';
import { Button, Panel, Field, Select, Textarea, Toggle, Status } from './ui';
import { call, clearReadCache, confirmDelete, openLink } from './telegram';

const labelDate = value => new Date(value + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
function useRead(name, params, revision, enabled = true) {
  const signature = JSON.stringify([name, params, revision, enabled]);
  const [state, setState] = useState({ signature: '', loading: true, data: null, error: null });
  useEffect(() => {
    let active = true;
    setState({ signature, loading: enabled, data: null, error: null });
    if (enabled) call(name, params).then(result => { if (active) setState({ signature, loading: false, data: result.data, error: null }); }, error => { if (active) setState({ signature, loading: false, data: null, error: error.message }); });
    return () => { active = false; };
  }, [signature]);
  return state.signature === signature ? state : { loading: enabled, data: null, error: null };
}
function ReadStatus({ value }) {
  return value.loading ? <Status>Загрузка…</Status> : value.error ? <Status error>{value.error}</Status> : null;
}
function FileNames({ files = [] }) {
  return files.length ? <ul className="app-prose">{files.map((file, index) => <li key={file.uid || file.id || index}>{file.name || 'Файл'}{file.size ? ' · ' + Math.ceil(file.size / 1024) + ' КБ' : ''}</li>)}</ul> : null;
}
function InboxPicker({ value, onChange, busy, run, revision }) {
  const [localRevision, setLocalRevision] = useState(0);
  const query = useRead('files', { action: 'inbox' }, revision + ':' + localRevision);
  const items = query.data?.items || [];
  const selected = value.filter(id => items.some(file => file.id === id));
  useEffect(() => { if (!query.loading && !query.error && selected.length !== value.length) onChange(selected); }, [query.data]);
  const username = query.data?.username;
  return <section aria-label="Вложения из чата с ботом"><p className="app-muted">Сначала отправьте файлы в личный чат с ботом, затем обновите список. Можно выбрать до 10 файлов.</p><div className="app-actions">{username && <Button disabled={busy} onClick={() => run(async () => openLink('https://t.me/' + username))}>Открыть чат с ботом</Button>}<Button disabled={busy || query.loading} onClick={() => setLocalRevision(number => number + 1)}>Обновить входящие</Button></div><ReadStatus value={query} />{!query.loading && !query.error && !items.length && <p className="app-muted">Входящих файлов нет</p>}{items.map(file => <Toggle key={file.id} label={(file.name || 'Файл') + (file.size ? ' · ' + Math.ceil(file.size / 1024) + ' КБ' : '')} checked={selected.includes(file.id)} disabled={busy || (!selected.includes(file.id) && selected.length >= 10)} onCheckedChange={checked => onChange(checked ? [...selected, file.id] : selected.filter(id => id !== file.id))} />)}{!!selected.length && <Button danger disabled={busy || query.loading} onClick={() => run(async () => { if (!await confirmDelete('Удалить выбранные файлы из входящих?')) return; await call('files', { action: 'drop', ids: selected }); onChange([]); setLocalRevision(number => number + 1); })}>Удалить выбранные из входящих</Button>}</section>;
}
function Editor({ item, busy, run, refresh, revision, close }) {
  const [text, setText] = useState(item.text);
  const [newDate, setNewDate] = useState(item.date);
  const [removeFiles, setRemoveFiles] = useState([]);
  const [files, setFiles] = useState([]);
  return <section className="app-stack" aria-label="Редактирование задания"><Textarea label="Текст ДЗ" value={text} maxLength={20000} disabled={busy} onChange={event => setText(event.target.value)} /><Field label="Новая дата" type="date" value={newDate} disabled={busy} onValueChange={setNewDate} />{!!item.files?.length && <div><p className="app-muted">Отметьте вложения, которые нужно удалить при сохранении.</p>{item.files.map(file => <Toggle key={file.uid} label={'Удалить: ' + file.name} checked={removeFiles.includes(file.uid)} disabled={busy} onCheckedChange={checked => setRemoveFiles(checked ? [...removeFiles, file.uid] : removeFiles.filter(uid => uid !== file.uid))} />)}</div>}<InboxPicker value={files} onChange={setFiles} busy={busy} run={run} revision={revision} /><div className="app-actions"><Button primary disabled={busy || !text.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)} onClick={() => run(async () => { if (!await confirmDelete('Сохранить изменения этого задания для всего потока?')) return; await call('homework', { action: 'edit', subject: item.subject, date: item.date, newDate, text: text.trim(), files, removeFiles }); clearReadCache(); close(); refresh(); })}>Сохранить изменения</Button><Button disabled={busy} onClick={close}>Отмена</Button></div></section>;
}
function History({ item, busy, run, refresh, revision }) {
  const query = useRead('homework', { action: 'history', subject: item.subject, date: item.date }, revision);
  return <section className="app-stack" aria-label="История текста задания"><ReadStatus value={query} />{!query.loading && !query.error && !query.data?.versions?.length && <p>История пуста</p>}{(query.data?.versions || []).map(version => <div key={version.i}><p className="app-muted">{version.t ? new Date(version.t).toLocaleString('ru-RU') : 'Дата неизвестна'} · {version.by || 'Автор неизвестен'}</p><p className="app-prose">{version.text}</p><Button disabled={busy} onClick={() => run(async () => { if (!await confirmDelete('Восстановить этот текст для всего потока? Вложения не изменятся.')) return; await call('homework', { action: 'restore', subject: item.subject, date: item.date, index: version.i }); clearReadCache(); refresh(); })}>Восстановить текст</Button></div>)}</section>;
}
function HomeworkCard({ item, assistant, me, setMe, busy, run, refresh, revision, notify, archive }) {
  const [section, setSection] = useState('');
  const done = (me.done || []).includes(item.key);
  return <Panel title={item.subject} className={done ? 'app-completed' : ''}><p className="app-muted">{labelDate(item.date)}</p><p className="app-prose">{item.text}</p><FileNames files={item.files} />{item.edited && <p className="app-muted">Изменено: {new Date(item.edited.t).toLocaleString('ru-RU')} · {item.edited.by}</p>}<div className="app-actions">{!archive && <Button primary={done} disabled={busy} aria-pressed={done} onClick={() => run(async () => setMe((await call('me', { action: 'done', key: item.key, value: !done })).data))}>{done ? '✓ Выполнено' : 'Отметить выполненным'}</Button>}{!!item.files?.length && <Button disabled={busy} onClick={() => run(async () => { const result = await call('files', { action: 'send', subject: item.subject, date: item.date }); notify('Файлы отправлены в чат: ' + result.data.sent + ' из ' + result.data.total); })}>Получить файлы в чат</Button>}{assistant && <><Button disabled={busy} aria-expanded={section === 'edit'} onClick={() => setSection(section === 'edit' ? '' : 'edit')}>Редактировать</Button><Button disabled={busy} aria-expanded={section === 'history'} onClick={() => setSection(section === 'history' ? '' : 'history')}>История</Button><Button danger disabled={busy} onClick={() => run(async () => { if (!await confirmDelete('Удалить это ДЗ и его вложения для всего потока?')) return; await call('homework', { action: 'delete', subject: item.subject, date: item.date }); clearReadCache(); refresh(); })}>Удалить ДЗ</Button>{!!item.files?.length && <Button danger disabled={busy} onClick={() => run(async () => { if (!await confirmDelete('Удалить все вложения этого ДЗ для всего потока? Текст останется.')) return; await call('files', { action: 'clear', subject: item.subject, date: item.date }); refresh(); })}>Очистить вложения</Button>}</>}</div>{assistant && section === 'edit' && <Editor key={item.key + ':' + revision} item={item} busy={busy} run={run} refresh={refresh} revision={revision} close={() => setSection('')} />}{assistant && section === 'history' && <History item={item} busy={busy} run={run} refresh={refresh} revision={revision} />}</Panel>;
}
function CreateForm({ assistant, busy, run, refresh, revision, notify }) {
  const subjects = useRead('subjects', {}, revision);
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const selectedSubject = subjects.data?.includes(subject) ? subject : (subjects.data?.[0] || '');
  const dates = useRead('subjectDates', { subject: selectedSubject }, revision, !!selectedSubject);
  const selectedDate = dates.data?.includes(date) ? date : (dates.data?.[0] || '');
  const limit = assistant ? 20000 : 10000;
  return <Panel title={assistant ? 'Добавить ДЗ' : 'Предложить ДЗ'}><ReadStatus value={subjects} /><ReadStatus value={dates} /><Select label="Предмет" value={selectedSubject} disabled={busy || subjects.loading} onChange={event => { setSubject(event.target.value); setDate(''); }}>{(subjects.data || []).map(value => <option key={value}>{value}</option>)}</Select><Select label="Дата занятия" value={selectedDate} disabled={busy || dates.loading} onChange={event => setDate(event.target.value)}>{!dates.data?.length && <option value="">Нет доступных занятий</option>}{(dates.data || []).map(value => <option value={value} key={value}>{labelDate(value)}</option>)}</Select><Textarea label={'Текст задания, до ' + limit + ' символов'} value={text} maxLength={limit} disabled={busy} onChange={event => setText(event.target.value)} />{!assistant && <p className="app-muted">Предложение проверит ассистент. Ограничения типов файлов и частоты отправки проверяются сервером.</p>}<InboxPicker value={files} onChange={setFiles} busy={busy} run={run} revision={revision} /><Button primary disabled={busy || subjects.loading || dates.loading || !!subjects.error || !!dates.error || !selectedSubject || !selectedDate || !text.trim() || text.length > limit} onClick={() => run(async () => { if (assistant && !await confirmDelete('Опубликовать этот текст как ДЗ для всего потока? Если задание уже существует, его текст будет заменён.')) return; await call(assistant ? 'homework' : 'proposal', { action: 'add', subject: selectedSubject, date: selectedDate, text: text.trim(), files }); clearReadCache(); setText(''); setFiles([]); notify(assistant ? 'ДЗ опубликовано' : 'Предложение отправлено на проверку'); refresh(); })}>{busy ? 'Подождите…' : assistant ? 'Опубликовать' : 'Предложить'}</Button></Panel>;
}
function ProposalCard({ proposal, assistant, busy, run, refresh }) {
  const [text, setText] = useState(proposal.text);
  return <Panel title={proposal.subject}><p className="app-muted">{labelDate(proposal.date)} · {proposal.uname ? '@' + proposal.uname : 'Студент'}</p>{assistant ? <Textarea label="Текст для публикации" value={text} maxLength={20000} disabled={busy} onChange={event => setText(event.target.value)} /> : <p className="app-prose">{proposal.text}</p>}<FileNames files={proposal.files} /><div className="app-actions">{assistant ? <><Button primary disabled={busy || !text.trim()} onClick={() => run(async () => { if (!await confirmDelete('Принять предложение? Текст заменит существующее ДЗ на эту дату, вложения будут добавлены.')) return; await call('proposal', { action: 'approve', id: proposal.id, text: text.trim() }); clearReadCache(); refresh(); })}>Принять</Button><Button danger disabled={busy} onClick={() => run(async () => { if (!await confirmDelete('Отклонить это предложение?')) return; await call('proposal', { action: 'reject', id: proposal.id }); refresh(); })}>Отклонить</Button></> : <Button danger disabled={busy} onClick={() => run(async () => { if (!await confirmDelete('Отозвать это предложение?')) return; await call('proposal', { action: 'cancel', id: proposal.id }); refresh(); })}>Отозвать</Button>}</div></Panel>;
}
export default function Homework({ boot, me, setMe, revision, refresh }) {
  const [mode, setMode] = useState('current');
  const [search, setSearch] = useState('');
  const [queryText, setQueryText] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const isArchive = mode === 'archive';
  const tasks = useRead('homework', isArchive ? { action: 'archive', q: queryText, offset } : { action: 'list' }, revision, mode !== 'proposals');
  const proposals = useRead('proposal', { action: 'list' }, revision, mode === 'proposals');
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (failure) { setError(failure.message || String(failure)); } finally { lock.current = false; setBusy(false); }
  };
  const changeMode = value => { if (busy) return; setMode(value); setOffset(0); setError(''); setMessage(''); };
  const items = isArchive ? (tasks.data?.items || []) : [...(tasks.data || [])].sort((a, b) => Number((me.done || []).includes(a.key)) - Number((me.done || []).includes(b.key)));
  const proposalItems = boot.assistant ? proposals.data?.pending : proposals.data?.mine;
  return <><Panel><div className="app-actions" role="group" aria-label="Разделы ДЗ">{[['current', 'Актуальные'], ['archive', 'Архив'], ['proposals', boot.assistant ? 'На проверке' : 'Мои предложения']].map(([value, label]) => <Button key={value} primary={mode === value} aria-pressed={mode === value} disabled={busy} onClick={() => changeMode(value)}>{label}</Button>)}<Button disabled={busy} onClick={refresh}>Обновить</Button></div></Panel>{error && <Status error>{error}<p>При ошибке после сохранения сначала обновите список: сервер мог успеть принять изменения. Автоматического повтора нет.</p></Status>}{message && <Status>{message}</Status>}{mode === 'proposals' ? <><ReadStatus value={proposals} />{!proposals.loading && !proposals.error && !proposalItems?.length && <Status>Предложений нет</Status>}{(proposalItems || []).map(proposal => <ProposalCard key={proposal.id} proposal={proposal} assistant={!!boot.assistant} busy={busy} run={run} refresh={refresh} />)}</> : <>{isArchive && <Panel><Field label="Поиск по предмету и тексту в архиве" value={search} maxLength={60} disabled={busy} onValueChange={setSearch} /><Button disabled={busy} onClick={() => { setQueryText(search.trim()); setOffset(0); }}>Найти</Button></Panel>}<ReadStatus value={tasks} />{!tasks.loading && !tasks.error && !items.length && <Status>{isArchive ? 'Архив пуст или ничего не найдено' : 'Домашних заданий нет'}</Status>}{items.map(item => <HomeworkCard key={item.key} item={item} assistant={!!boot.assistant} me={me} setMe={setMe} busy={busy} run={run} refresh={refresh} revision={revision} notify={setMessage} archive={isArchive} />)}{isArchive && <Panel><p className="app-muted">Найдено: {tasks.data?.total ?? '…'}. Страница {Math.floor(offset / 20) + 1}.</p><div className="app-actions"><Button disabled={busy || tasks.loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}>Предыдущая</Button><Button disabled={busy || tasks.loading || !!tasks.error || !tasks.data?.more} onClick={() => setOffset(value => value + 20)}>Следующая</Button></div></Panel>}</>}{mode === 'current' && <CreateForm assistant={!!boot.assistant} busy={busy} run={run} refresh={refresh} revision={revision} notify={setMessage} />}</>;
}
