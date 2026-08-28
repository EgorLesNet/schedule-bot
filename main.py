import datetime
import pytz
import re
import os
import requests
import json
import logging
import time
import threading
import asyncio
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
    MessageHandler,
    filters
)
from telegram.error import BadRequest, TimedOut

# === НАСТРОЙКА ЛОГИРОВАНИЯ ===
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)


# === ЧТЕНИЕ ТОКЕНА ИЗ ФАЙЛА ===
def load_bot_token():
    """Читает токен бота из token.txt. Возвращает None, если файл не найден или пуст."""
    try:
        with open("token.txt", "r", encoding="utf-8") as f:
            token = f.read().strip()
        if not token:
            raise ValueError("Файл token.txt пустой")
        return token
    except FileNotFoundError:
        logging.error("✗ Файл token.txt не найден!")
        print("✗ ОШИБКА: Файл token.txt не найден!")
        return None


# === НАСТРОЙКИ ===
BOT_TOKEN = load_bot_token()
if not BOT_TOKEN:
    exit(1)

ADMIN_USERNAME = "fusuges"
GITHUB_BASE_URL = "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main"
GITHUB_RAW_URL = f"{GITHUB_BASE_URL}/main.py"

# === РАСПИСАНИЯ ПО КУРСАМ И ПОТОКАМ ===
# Каждый курс может иметь один или несколько вариантов расписания ("потоков").
# Если у курса всего один поток — бот выбирает его автоматически, без лишнего шага.
# Чтобы добавить новый поток для любого курса, достаточно дописать запись в этот словарь —
# менять остальной код не нужно.
SCHEDULES = {
    "1": {
        "sdi": {"name": "СДИ", "url": f"{GITHUB_BASE_URL}/GAUGN_1_kurs_СДИ_nodups.ics"},
        "theory": {"name": "Теория и практика", "url": f"{GITHUB_BASE_URL}/GAUGN_1_kurs_Теория_и_практика_nodups.ics"},
        "region1": {"name": "Регионы 1", "url": f"{GITHUB_BASE_URL}/GAUGN_1_kurs_Регионы_1_nodups.ics"},
        "region2": {"name": "Регионы 2", "url": f"{GITHUB_BASE_URL}/GAUGN_1_kurs_Регионы_2_nodups.ics"},
    },
    "2": {
        "main": {"name": "Общий поток", "url": f"{GITHUB_BASE_URL}/GAUGN_2kurs.ics"},
    },
    "3": {
        "main": {"name": "Общий поток", "url": f"{GITHUB_BASE_URL}/GAUGN_3kurs.ics"},
    },
    "4": {
        "main": {"name": "Общий поток", "url": f"{GITHUB_BASE_URL}/GAUGN_4kurs.ics"},
    },
}

TIMEZONE = pytz.timezone("Europe/Moscow")
USER_SETTINGS_FILE = "user_settings.json"
LAST_UPDATE_FILE = "last_update.txt"
ASSISTANTS_FILE = "assistants.json"
SUBJECT_RENAMES_FILE = "subject_renames.json"
SCHEDULE_EDITS_FILE = "schedule_edits.json"
PROXY_URL = "socks5://127.0.0.1:987"

TEACHER_PATTERNS = [
    r"Преподаватель:\s*([^\n\r]+)",
    r"Преподаватель\s*:\s*([^\n\r]+)",
    r"Teacher:\s*([^\n\r]+)",
    r"Teacher\s*:\s*([^\n\r]+)",
]

ROOM_PATTERNS = [
    r"Аудитория:\s*([^\n\r]+)",
    r"Аудитория\s*:\s*([^\n\r]+)",
    r"Room:\s*([^\n\r]+)",
    r"Room\s*:\s*([^\n\r]+)",
    r"Auditorium:\s*([^\n\r]+)",
    r"Auditorium\s*:\s*([^\n\r]+)",
]

ONLINE_KEYWORDS = [
    "онлайн", "online", "zoom", "teams", "вебинар", "webinar",
    "дистанционно", "distance", "удаленно", "remote", "ссылка",
    "конференция", "conference", "meet", "meeting", "call",
]

DAYS_RU = {
    'Monday': 'Понедельник', 'Tuesday': 'Вторник', 'Wednesday': 'Среда',
    'Thursday': 'Четверг', 'Friday': 'Пятница', 'Saturday': 'Суббота', 'Sunday': 'Воскресенье',
}

MONTHS_RU = {
    'January': 'января', 'February': 'февраля', 'March': 'марта',
    'April': 'апреля', 'May': 'мая', 'June': 'июня',
    'July': 'июля', 'August': 'августа', 'September': 'сентября',
    'October': 'октября', 'November': 'ноября', 'December': 'декабря',
}

# Глобальные переменные состояния (загружаются в main())
user_settings = {}
events_cache = {}
application = None
assistants = set()
subject_renames = {}
schedule_edits = {}


# === ХРАНЕНИЕ ДАННЫХ (JSON-ФАЙЛЫ) ===
def load_assistants():
    """Загружает список username-помощников из файла."""
    try:
        with open(ASSISTANTS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return set(data.get("assistants", []))
    except FileNotFoundError:
        return set()


def save_assistants():
    """Сохраняет список username-помощников в файл."""
    with open(ASSISTANTS_FILE, "w", encoding="utf-8") as f:
        json.dump({"assistants": list(assistants)}, f, ensure_ascii=False, indent=2)


def load_subject_renames():
    """Загружает переименования предметов."""
    try:
        with open(SUBJECT_RENAMES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_subject_renames():
    """Сохраняет переименования предметов."""
    with open(SUBJECT_RENAMES_FILE, "w", encoding="utf-8") as f:
        json.dump(subject_renames, f, ensure_ascii=False, indent=2)


def load_schedule_edits():
    """Загружает правки расписания."""
    try:
        with open(SCHEDULE_EDITS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_schedule_edits():
    """Сохраняет правки расписания."""
    with open(SCHEDULE_EDITS_FILE, "w", encoding="utf-8") as f:
        json.dump(schedule_edits, f, ensure_ascii=False, indent=2)


def get_original_subject_name(course, stream, display_name):
    """Возвращает оригинальное (из .ics) название предмета по отображаемому."""
    key = f"{course}_{stream}"
    for original, renamed in subject_renames.get(key, {}).items():
        if renamed == display_name:
            return original
    return display_name


def get_display_subject_name(course, stream, original_name):
    """Возвращает отображаемое название предмета с учетом переименований."""
    key = f"{course}_{stream}"
    return subject_renames.get(key, {}).get(original_name, original_name)


def load_homeworks(course, stream):
    """Загружает домашние задания для указанного курса и потока."""
    filename = f"homeworks_{course}_{stream}.json"
    try:
        with open(filename, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_homeworks(course, stream, homeworks_data):
    """Сохраняет домашние задания для указанного курса и потока."""
    filename = f"homeworks_{course}_{stream}.json"
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(homeworks_data, f, ensure_ascii=False, indent=2)


def get_future_homeworks(course, stream):
    """Возвращает домашние задания с датой не раньше сегодняшней."""
    homeworks = load_homeworks(course, stream)
    today = datetime.datetime.now(TIMEZONE).date()

    future_homeworks = {}
    for hw_key, hw_text in homeworks.items():
        try:
            _, date_str = hw_key.split('|')
            hw_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
            if hw_date >= today:
                future_homeworks[hw_key] = hw_text
        except (ValueError, IndexError):
            continue
    return future_homeworks


def get_past_homeworks(course, stream):
    """Возвращает домашние задания с датой раньше сегодняшней."""
    homeworks = load_homeworks(course, stream)
    today = datetime.datetime.now(TIMEZONE).date()

    past_homeworks = {}
    for hw_key, hw_text in homeworks.items():
        try:
            _, date_str = hw_key.split('|')
            hw_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
            if hw_date < today:
                past_homeworks[hw_key] = hw_text
        except (ValueError, IndexError):
            continue
    return past_homeworks


def get_homeworks_for_tomorrow(course, stream):
    """Возвращает домашние задания на завтрашний день в виде списка (предмет, текст)."""
    tomorrow = datetime.datetime.now(TIMEZONE).date() + datetime.timedelta(days=1)
    tomorrow_homeworks = []
    homeworks = load_homeworks(course, stream)

    for hw_key, hw_text in homeworks.items():
        try:
            subject, date_str = hw_key.split('|')
            hw_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
            if hw_date == tomorrow:
                tomorrow_homeworks.append((subject, hw_text))
        except (ValueError, IndexError):
            continue
    return tomorrow_homeworks


def build_homework_list_text(course, stream):
    """Формирует читаемый текст со списком будущих домашних заданий (для всех пользователей)."""
    future_hws = get_future_homeworks(course, stream)

    if not future_hws:
        return "📋 Список домашних заданий пуст"

    text = "📋 Список домашних заданий:\n\n"
    for hw_key, hw_text in sorted(future_hws.items()):
        subject, date_str = hw_key.split('|')
        date_formatted = datetime.datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y")
        text += f"📖 {subject} ({date_formatted}):\n{hw_text}\n\n"
    return text


def load_user_settings():
    """Загружает настройки пользователей."""
    try:
        with open(USER_SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_user_settings(settings_data):
    """Сохраняет настройки пользователей."""
    with open(USER_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings_data, f, ensure_ascii=False, indent=2)


def load_last_update():
    """Возвращает дату последнего автообновления бота."""
    try:
        with open(LAST_UPDATE_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return None


def save_last_update():
    """Сохраняет дату последнего автообновления бота."""
    with open(LAST_UPDATE_FILE, "w", encoding="utf-8") as f:
        f.write(datetime.datetime.now().isoformat())


# === РАСПИСАНИЕ: ЗАГРУЗКА, ПРАВКИ, ПАРСИНГ ===
def get_stream_info(course, stream):
    """Возвращает описание потока ({'name', 'url'}) или None, если такого нет."""
    return SCHEDULES.get(course, {}).get(stream)


def get_stream_display_name(course, stream):
    """Возвращает читаемое название потока курса."""
    info = get_stream_info(course, stream)
    return info["name"] if info else stream


def apply_schedule_edits(course, stream, events):
    """Применяет ручные правки к загруженному расписанию (переименования, удаления, новые пары)."""
    key = f"{course}_{stream}"
    if key not in schedule_edits:
        return events

    stream_edits = schedule_edits[key]
    edited_events = []

    for event in events:
        event_date = event["start"].date().isoformat()
        event_key = f"{event['original_summary']}[{event['start'].strftime('%H:%M')}]"

        edit = stream_edits.get(event_date, {}).get(event_key)
        if edit is None:
            edited_events.append(event)
            continue
        if edit.get("deleted", False):
            continue
        if "new_summary" in edit:
            edited_event = event.copy()
            edited_event["summary"] = edit["new_summary"]
            if "new_desc" in edit:
                edited_event["desc"] = edit["new_desc"]
            edited_events.append(edited_event)
        else:
            edited_events.append(event)

    for date_str, date_edits in stream_edits.items():
        for edit in date_edits.values():
            if edit.get("new", False) and "start_time" in edit:
                try:
                    start_dt = TIMEZONE.localize(
                        datetime.datetime.strptime(f"{date_str} {edit['start_time']}", "%Y-%m-%d %H:%M"))
                    end_dt = TIMEZONE.localize(
                        datetime.datetime.strptime(f"{date_str} {edit['end_time']}", "%Y-%m-%d %H:%M"))
                    edited_events.append({
                        'summary': edit['new_summary'],
                        'original_summary': edit['new_summary'],
                        'start': start_dt,
                        'end': end_dt,
                        'desc': edit.get('new_desc', ''),
                    })
                except ValueError as e:
                    logging.error(f"Ошибка создания нового события: {e}")

    return edited_events


def load_events_from_github(course, stream):
    """Загружает и парсит .ics-расписание для курса/потока (с кэшированием и правками)."""
    cache_key = f"{course}_{stream}"
    if cache_key in events_cache:
        return apply_schedule_edits(course, stream, events_cache[cache_key])

    info = get_stream_info(course, stream)
    if not info:
        logging.error(f"Расписание не найдено для курса {course}, потока {stream}")
        return []

    events = []
    try:
        logging.info(f"Загрузка расписания для курса {course}, потока {stream} из GitHub...")
        response = requests.get(info["url"], timeout=15)
        response.raise_for_status()
        data = response.text

        for block in data.split('BEGIN:VEVENT'):
            if 'END:VEVENT' not in block:
                continue
            try:
                summary_match = re.search(r'SUMMARY:(.+?)(?:\n|$)', block)
                dtstart_match = re.search(
                    r'DTSTART(?:;VALUE=DATE-TIME)?(?:;TZID=Europe/Moscow)?:(\d{8}T\d{6})', block)
                dtend_match = re.search(
                    r'DTEND(?:;VALUE=DATE-TIME)?(?:;TZID=Europe/Moscow)?:(\d{8}T\d{6})', block)
                description_match = re.search(r'DESCRIPTION:(.+?)(?:\n|$)', block, re.DOTALL)

                if not all([summary_match, dtstart_match, dtend_match]):
                    continue

                original_summary = summary_match.group(1).strip()
                summary = get_display_subject_name(course, stream, original_summary)
                description = description_match.group(1).strip() if description_match else ""

                start_dt = TIMEZONE.localize(
                    datetime.datetime.strptime(dtstart_match.group(1), '%Y%m%dT%H%M%S'))
                end_dt = TIMEZONE.localize(
                    datetime.datetime.strptime(dtend_match.group(1), '%Y%m%dT%H%M%S'))

                events.append({
                    'summary': summary,
                    'original_summary': original_summary,
                    'start': start_dt,
                    'end': end_dt,
                    'desc': description,
                })
            except Exception as e:
                logging.warning(f"Ошибка парсинга события: {e}")
                continue

        events_cache[cache_key] = events
        logging.info(f"Успешно загружено {len(events)} событий для курса {course}, потока {stream}")
        return apply_schedule_edits(course, stream, events)

    except Exception as e:
        logging.error(f"Ошибка при загрузке файла с GitHub: {e}")
        return []


def get_unique_subjects(course, stream):
    """Возвращает отсортированный список уникальных предметов в расписании."""
    events = load_events_from_github(course, stream)
    return sorted({event["summary"] for event in events})


def get_subject_dates(course, stream, subject):
    """Возвращает отсортированный список дат занятий по предмету."""
    events = load_events_from_github(course, stream)
    return sorted(event["start"].date() for event in events if event["summary"] == subject)


# === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ФОРМАТИРОВАНИЯ ===
def get_week_range(date):
    """Возвращает (понедельник, воскресенье) недели, содержащей дату."""
    start = date - datetime.timedelta(days=date.weekday())
    end = start + datetime.timedelta(days=6)
    return start, end


def is_online_class(ev):
    """Проверяет, помечена ли пара как онлайн (по умолчанию все пары считаются очными)."""
    desc = ev.get("desc", "").lower()
    summary = ev.get("summary", "").lower()
    return any(k in desc for k in ONLINE_KEYWORDS) or any(k in summary for k in ONLINE_KEYWORDS)


def has_only_lunch_break(events, date):
    """Проверяет, что в указанный день из событий есть только обед/перерыв (то есть занятий нет)."""
    day_events = [e for e in events if e["start"].date() == date]
    if not day_events:
        return False
    lunch_breaks = [e for e in day_events if "обед" in e["summary"].lower() or "перерыв" in e["summary"].lower()]
    return len(lunch_breaks) == len(day_events)


def _extract_by_patterns(text, patterns):
    """Возвращает первое совпадение по списку регулярных выражений или пустую строку."""
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return ""


def parse_teacher_and_room(desc):
    """Извлекает из описания пары преподавателя и аудиторию (с эвристиками для нестандартных форматов)."""
    teacher = _extract_by_patterns(desc, TEACHER_PATTERNS)
    room = _extract_by_patterns(desc, ROOM_PATTERNS)

    if not room:
        if re.search(r"ИНИОН|INION", desc, re.IGNORECASE):
            room = "ИНИОН"
        elif re.search(r"марон|мар\s*он", desc, re.IGNORECASE):
            room = "Марон"
        else:
            room_match = re.search(r"(?:ауд|аудитория|room|зал|каб|кабинет)[\s:]*(\d{2,3})", desc, re.IGNORECASE)
            if room_match:
                room = room_match.group(1)
            else:
                room_match = re.search(r"\b(\d{3})\b", desc)
                if room_match:
                    room = room_match.group(1)

    if not teacher:
        name_match = re.search(r"([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)", desc)
        if name_match:
            teacher = name_match.group(1).strip()

    return teacher, room


def format_event(ev, course, stream):
    """Форматирует одну пару в строку для вывода пользователю (время, предмет, преподаватель, ДЗ и т.д.)."""
    desc = ev["desc"]
    teacher, room = parse_teacher_and_room(desc)

    online_marker = " 💻" if is_online_class(ev) else ""
    line = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')} {ev['summary']}{online_marker}"

    if teacher or room:
        line += "\n"
        if teacher:
            line += f"   👤 {teacher}"
        if room:
            if teacher:
                line += " | "
            line += f" 🏫 {room}"

    date_str = ev['start'].date().isoformat()
    hw_key = f"{ev['original_summary']}|{date_str}"
    homeworks = load_homeworks(course, stream)
    if hw_key in homeworks:
        line += f"\n   📝 ДЗ: {homeworks[hw_key]}"

    return line


def events_for_day(events, date, english_time=None):
    """Возвращает пары на указанный день, добавляя виртуальную пару английского по четвергам."""
    day_events = [e for e in events if e["start"].date() == date]

    if date.weekday() == 3 and english_time:
        if english_time == "morning":
            start_time = TIMEZONE.localize(datetime.datetime.combine(date, datetime.time(9, 0)))
            end_time = TIMEZONE.localize(datetime.datetime.combine(date, datetime.time(12, 10)))
        else:
            start_time = TIMEZONE.localize(datetime.datetime.combine(date, datetime.time(14, 0)))
            end_time = TIMEZONE.localize(datetime.datetime.combine(date, datetime.time(17, 10)))

        has_english = any("английский" in e["summary"].lower() for e in day_events)
        if not has_english:
            day_events.append({
                "summary": "Английский язык",
                "original_summary": "Английский язык",
                "start": start_time,
                "end": end_time,
                "desc": "Онлайн занятие",
            })

    return day_events


def format_day(date, events, course, stream, english_time=None, is_tomorrow=False):
    """Форматирует расписание на один день, включая заголовок и все пары."""
    if has_only_lunch_break(events, date):
        return f"{date.strftime('%A, %d %B')} — занятий нет\n"

    evs = events_for_day(events, date, english_time)

    day_ru = DAYS_RU.get(date.strftime('%A'), date.strftime('%A'))
    month_ru = MONTHS_RU.get(date.strftime('%B'), date.strftime('%B'))
    date_str = date.strftime(f"{day_ru}, %d {month_ru}")
    if is_tomorrow:
        date_str = f"Завтра, {date_str}"

    if not evs:
        return f"📅 {date_str} — занятий нет\n"

    text = f"📅 {date_str}:\n"
    for ev in sorted(evs, key=lambda x: x["start"]):
        text += f"{format_event(ev, course, stream)}\n\n"
    return text


# === ПРАВА ДОСТУПА ===
def is_admin(update: Update) -> bool:
    """Проверяет, является ли пользователь главным админом бота."""
    return update.effective_user.username == ADMIN_USERNAME


def is_assistant(update: Update) -> bool:
    """Проверяет, является ли пользователь админом или помощником."""
    username = update.effective_user.username
    return username == ADMIN_USERNAME or username in assistants


def can_manage_homework(update: Update) -> bool:
    """Проверяет, может ли пользователь добавлять/удалять домашние задания."""
    return is_assistant(update)


async def require_assistant(query) -> bool:
    """Проверяет права помощника для callback-обработчика; при отказе сама отвечает пользователю."""
    if not can_manage_homework(query):
        await query.answer("❌ У вас нет прав для управления ДЗ")
        return False
    return True


# === СТАТИСТИКА И ФОНОВЫЕ ЗАДАЧИ ===
def get_user_stats():
    """Собирает статистику по пользователям бота."""
    course_stats = {}
    reminders_stats = {"enabled": 0, "disabled": 0}
    english_time_stats = {"morning": 0, "afternoon": 0, "none": 0}

    for settings in user_settings.values():
        course = settings.get('course')
        stream = settings.get('stream', '1')

        if course:
            course_stats.setdefault(course, {})
            course_stats[course][stream] = course_stats[course].get(stream, 0) + 1

        if settings.get('reminders', False):
            reminders_stats["enabled"] += 1
        else:
            reminders_stats["disabled"] += 1

        english_time = settings.get('english_time')
        if english_time in ("morning", "afternoon"):
            english_time_stats[english_time] += 1
        else:
            english_time_stats["none"] += 1

    return {
        "total_users": len(user_settings),
        "course_stats": course_stats,
        "reminders_stats": reminders_stats,
        "english_time_stats": english_time_stats,
    }


async def send_homework_reminders():
    """Отправляет пользователям с включенными напоминаниями ДЗ на завтра."""
    if not application:
        return

    logging.info("🔔 Проверка напоминаний о ДЗ...")

    for user_id, settings in list(user_settings.items()):
        try:
            if not (settings.get('reminders', False) and settings.get('course') and settings.get('stream')):
                continue

            tomorrow_hws = get_homeworks_for_tomorrow(settings['course'], settings['stream'])
            if not tomorrow_hws:
                continue

            message = "🔔 Напоминание о домашних заданиях на завтра:\n\n"
            for subject, hw_text in tomorrow_hws:
                message += f"📖 {subject}:\n{hw_text}\n\n"

            try:
                await application.bot.send_message(chat_id=user_id, text=message)
                logging.info(f"📤 Отправлено напоминание пользователю {user_id}")
            except BadRequest as e:
                logging.error(f"❌ Ошибка отправки напоминания пользователю {user_id}: {e}")
                if "chat not found" in str(e).lower() or "bot was blocked" in str(e).lower():
                    user_settings.pop(user_id, None)
                    save_user_settings(user_settings)
        except Exception as e:
            logging.error(f"❌ Ошибка отправки напоминания пользователю {user_id}: {e}")


async def check_for_updates():
    """Проверяет обновления main.py на GitHub и перезагружает файл при изменениях."""
    try:
        logging.info("🔍 Проверка обновлений на GitHub...")
        response = requests.get(GITHUB_RAW_URL, timeout=15)
        if response.status_code != 200:
            return

        new_content = response.text
        with open(__file__, "r", encoding="utf-8") as f:
            current_content = f.read()

        if new_content == current_content:
            logging.info("📭 Обновлений нет")
            return

        with open(__file__, "w", encoding="utf-8") as f:
            f.write(new_content)
        save_last_update()
        logging.info("✅ Бот обновлен до последней версии!")

        if application:
            await application.bot.send_message(
                chat_id=ADMIN_USERNAME,
                text="✅ Бот автоматически обновлен до последней версии из GitHub!"
            )
    except Exception as e:
        logging.error(f"❌ Ошибка при проверке обновлений: {e}")


async def scheduler():
    """Фоновый цикл: напоминания о ДЗ в 20:00 и проверка обновлений в 9:00."""
    while True:
        now = datetime.datetime.now(TIMEZONE)

        if now.hour == 20 and now.minute == 0:
            await send_homework_reminders()
            await asyncio.sleep(60)
        elif now.hour == 9 and now.minute == 0:
            await check_for_updates()
            await asyncio.sleep(60)

        await asyncio.sleep(30)


async def safe_edit_message(update: Update, text: str, reply_markup=None):
    """Редактирует сообщение, игнорируя ошибку 'Message is not modified'."""
    try:
        await update.callback_query.edit_message_text(text=text, reply_markup=reply_markup)
    except BadRequest as e:
        if "Message is not modified" in str(e):
            logging.info("Message not modified - ignoring")
        else:
            raise


async def reply_or_edit(update: Update, text: str, reply_markup=None):
    """Отправляет ответ либо через редактирование callback-сообщения, либо новым сообщением."""
    if update.callback_query:
        await safe_edit_message(update, text=text, reply_markup=reply_markup)
    else:
        await update.message.reply_text(text=text, reply_markup=reply_markup)


# === ОСНОВНЫЕ ОБРАБОТЧИКИ КОМАНД ===
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик /start — выбор курса."""
    keyboard = [
        [InlineKeyboardButton(f"{course} курс", callback_data=f"select_course_{course}")]
        for course in sorted(SCHEDULES.keys(), key=int)
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text("Привет! 🎓\nВыбери свой курс:", reply_markup=reply_markup)


async def select_stream(update: Update, context: ContextTypes.DEFAULT_TYPE, course):
    """Показывает выбор расписания (потока) для курса. Если поток единственный — выбирает его автоматически."""
    streams = SCHEDULES.get(course, {})

    if not streams:
        await reply_or_edit(update, "❌ Расписание для этого курса пока не добавлено.")
        return

    if len(streams) == 1:
        only_stream = next(iter(streams))
        await select_english_time(update, context, course, only_stream)
        return

    keyboard = [
        [InlineKeyboardButton(f"📖 {info['name']}", callback_data=f"select_stream_{stream_key}_{course}")]
        for stream_key, info in streams.items()
    ]
    await reply_or_edit(update, "Выбери своё расписание:", InlineKeyboardMarkup(keyboard))


async def select_english_time(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream):
    """Выбор времени английского по четвергам. Логика оставлена без изменений."""
    keyboard = [
        [InlineKeyboardButton("🕘 9:00-12:10", callback_data=f"english_morning_{course}_{stream}")],
        [InlineKeyboardButton("🕑 14:00-17:10", callback_data=f"english_afternoon_{course}_{stream}")],
        [InlineKeyboardButton("❌ Без английского", callback_data=f"english_none_{course}_{stream}")],
    ]
    await reply_or_edit(update, "Выбери время для английского в четверг:", InlineKeyboardMarkup(keyboard))


async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream, english_time=None):
    """Показывает главное меню действий для выбранного курса/потока."""
    try:
        load_events_from_github(course, stream)

        user_id = str(update.effective_user.id)
        user_settings.setdefault(user_id, {})
        user_settings[user_id]['course'] = course
        user_settings[user_id]['stream'] = stream
        if english_time:
            user_settings[user_id]['english_time'] = english_time
        save_user_settings(user_settings)

        keyboard = [
            [InlineKeyboardButton("📅 Сегодня", callback_data=f"today_{course}_{stream}"),
             InlineKeyboardButton("📅 Завтра", callback_data=f"tomorrow_{course}_{stream}")],
            [InlineKeyboardButton("📊 Эта неделя", callback_data=f"this_week_{course}_{stream}"),
             InlineKeyboardButton("📊 След. неделя", callback_data=f"next_week_{course}_{stream}")],
            [InlineKeyboardButton("📝 Домашние задания", callback_data=f"view_hw_{course}_{stream}")],
            [InlineKeyboardButton("🔔 Настройка напоминаний", callback_data=f"reminders_settings_{course}_{stream}")],
            [InlineKeyboardButton("🔄 Обновить расписание", callback_data=f"refresh_{course}_{stream}")],
        ]
        if can_manage_homework(update):
            keyboard.append([InlineKeyboardButton("🛠 Управление ДЗ", callback_data=f"manage_hw_{course}_{stream}")])
        if len(SCHEDULES.get(course, {})) > 1:
            keyboard.append([InlineKeyboardButton("🔁 Сменить расписание", callback_data=f"select_course_{course}")])

        stream_name = get_stream_display_name(course, stream)
        course_text = f"{course} курс"
        if len(SCHEDULES.get(course, {})) > 1:
            course_text += f", {stream_name}"

        english_text = ""
        if english_time == "morning":
            english_text = "\n💡 Английский: 9:00-12:10"
        elif english_time == "afternoon":
            english_text = "\n💡 Английский: 14:00-17:10"

        reminders_on = user_settings[user_id].get('reminders', False)
        reminders_text = f"\n{'🔔' if reminders_on else '🔕'} Напоминания: {'вкл' if reminders_on else 'выкл'}"
        if reminders_on:
            reminders_text += f" ({user_settings[user_id].get('reminders_time', '20:00')})"

        message_text = f"Выбран {course_text}{english_text}{reminders_text}\nВыбери действие:"
        await reply_or_edit(update, message_text, InlineKeyboardMarkup(keyboard))

    except Exception as e:
        logging.error(f"Ошибка в show_main_menu: {e}")


def build_reminders_view(course, stream, reminders_enabled):
    """Строит текст и клавиатуру для экрана настройки напоминаний."""
    status_text = "включены ✅" if reminders_enabled else "выключены ❌"
    keyboard = [
        [InlineKeyboardButton(
            "🔔 Включить" if not reminders_enabled else "🔕 Выключить",
            callback_data=f"toggle_reminders_{course}_{stream}"
        )],
        [InlineKeyboardButton("⬅️ Назад", callback_data=f"back_to_menu_{course}_{stream}")],
    ]
    text = (
        f"⚙️ Настройка напоминаний\n\n"
        f"Напоминания о домашних заданиях {status_text}\n\n"
        f"Напоминания приходят каждый день в 20:00 с информацией о ДЗ на завтра."
    )
    return text, InlineKeyboardMarkup(keyboard)


async def handle_query(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Главный роутер всех inline-кнопок бота."""
    query = update.callback_query
    await query.answer()

    data = query.data
    user_id = str(update.effective_user.id)

    # --- Выбор курса ---
    if data.startswith('select_course_'):
        course = data.split('_')[-1]
        context.user_data['course'] = course
        await select_stream(update, context, course)

    # --- Выбор потока (расписания) ---
    elif data.startswith('select_stream_'):
        parts = data.split('_')
        if len(parts) >= 4:
            stream, course = parts[2], parts[3]
            context.user_data['stream'] = stream
            await select_english_time(update, context, course, stream)
        else:
            await query.answer("Ошибка: неверный формат данных")

    # --- Выбор времени английского (логика не изменена) ---
    elif data.startswith('english_'):
        parts = data.split('_')
        if len(parts) >= 4:
            english_time, course, stream = parts[1], parts[2], parts[3]
            if english_time == "none":
                english_time = None
            await show_main_menu(update, context, course, stream, english_time)
        else:
            await query.answer("Ошибка: неверный формат данных")

    # --- Просмотр дня ---
    elif data.startswith('today_') or data.startswith('tomorrow_'):
        action, course, stream = data.split('_')[:3]
        settings = user_settings.get(user_id, {})
        english_time = settings.get('english_time')
        events = load_events_from_github(course, stream)
        today = datetime.datetime.now(TIMEZONE).date()

        if action == "today":
            text = format_day(today, events, course, stream, english_time)
        else:
            text = format_day(today + datetime.timedelta(days=1), events, course, stream, english_time, is_tomorrow=True)

        keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data=f"back_to_menu_{course}_{stream}")]]
        await safe_edit_message(update, text=text, reply_markup=InlineKeyboardMarkup(keyboard))

    # --- Просмотр недели ---
    elif data.startswith('this_week_') or data.startswith('next_week_'):
        is_this_week = data.startswith('this_week_')
        parts = data.split('_')
        course, stream = parts[2], parts[3]

        settings = user_settings.get(user_id, {})
        english_time = settings.get('english_time')
        events = load_events_from_github(course, stream)
        today = datetime.datetime.now(TIMEZONE).date()

        if is_this_week:
            start_date, end_date = get_week_range(today)
        else:
            next_monday = today + datetime.timedelta(days=(7 - today.weekday()))
            start_date, end_date = get_week_range(next_monday)

        text = ""
        current_date = start_date
        while current_date <= end_date:
            text += format_day(current_date, events, course, stream, english_time)
            current_date += datetime.timedelta(days=1)

        keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data=f"back_to_menu_{course}_{stream}")]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        try:
            await safe_edit_message(update, text=text, reply_markup=reply_markup)
        except BadRequest as e:
            if "message is too long" in str(e).lower():
                chunks = [text[i:i + 4000] for i in range(0, len(text), 4000)]
                for i, chunk in enumerate(chunks):
                    if i == len(chunks) - 1:
                        await query.message.reply_text(chunk, reply_markup=reply_markup)
                    else:
                        await query.message.reply_text(chunk)
            else:
                raise

    # --- Обновление расписания ---
    elif data.startswith('refresh_'):
        _, course, stream = data.split('_')[:3]
        events_cache.pop(f"{course}_{stream}", None)
        load_events_from_github(course, stream)
        await query.answer("✅ Расписание обновлено!")

        settings = user_settings.get(user_id, {})
        await show_main_menu(update, context, course, stream, settings.get('english_time'))

    # --- Возврат в главное меню ---
    elif data.startswith('back_to_menu_'):
        parts = data.split('_')
        course, stream = parts[3], parts[4]
        settings = user_settings.get(user_id, {})
        await show_main_menu(update, context, course, stream, settings.get('english_time'))

    # --- Настройка напоминаний ---
    elif data.startswith('reminders_settings_'):
        parts = data.split('_')
        course, stream = parts[2], parts[3]
        reminders_enabled = user_settings.get(user_id, {}).get('reminders', False)
        text, reply_markup = build_reminders_view(course, stream, reminders_enabled)
        await safe_edit_message(update, text=text, reply_markup=reply_markup)

    elif data.startswith('toggle_reminders_'):
        parts = data.split('_')
        course, stream = parts[2], parts[3]
        user_settings.setdefault(user_id, {})
        new_status = not user_settings[user_id].get('reminders', False)
        user_settings[user_id]['reminders'] = new_status
        save_user_settings(user_settings)

        text, reply_markup = build_reminders_view(course, stream, new_status)
        await safe_edit_message(update, text=text, reply_markup=reply_markup)
        await query.answer(f"Напоминания {'включены' if new_status else 'выключены'}!")

    # --- Просмотр ДЗ (доступно всем пользователям) ---
    elif data.startswith('view_hw_'):
        parts = data.split('_')
        course, stream = parts[2], parts[3]
        text = build_homework_list_text(course, stream)
        keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data=f"back_to_menu_{course}_{stream}")]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        try:
            await safe_edit_message(update, text=text, reply_markup=reply_markup)
        except BadRequest as e:
            if "message is too long" in str(e).lower():
                await query.message.reply_text(text, reply_markup=reply_markup)
            else:
                raise

    # --- Управление ДЗ (только админ/помощники) ---
    elif data.startswith('manage_hw_'):
        if not await require_assistant(query):
            return
        parts = data.split('_')
        course, stream = parts[2], parts[3]
        keyboard = [
            [InlineKeyboardButton("➕ Добавить ДЗ", callback_data=f"add_hw_{course}_{stream}")],
            [InlineKeyboardButton("📋 Список ДЗ", callback_data=f"list_hw_{course}_{stream}")],
            [InlineKeyboardButton("🗑️ Удалить ДЗ", callback_data=f"delete_hw_{course}_{stream}")],
            [InlineKeyboardButton("⬅️ Назад", callback_data=f"back_to_menu_{course}_{stream}")],
        ]
        await safe_edit_message(update, text="🛠 Управление домашними заданиями\n\nВыбери действие:",
                                 reply_markup=InlineKeyboardMarkup(keyboard))

    elif data.startswith('add_hw_'):
        if not await require_assistant(query):
            return
        parts = data.split('_')
        course, stream = parts[2], parts[3]
        subjects = get_unique_subjects(course, stream)

        keyboard = [
            [InlineKeyboardButton(subject, callback_data=f"hw_select_subject_{course}_{stream}_{subject}")]
            for subject in subjects
        ]
        keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data=f"manage_hw_{course}_{stream}")])
        await safe_edit_message(update, text="Выбери предмет для добавления ДЗ:",
                                 reply_markup=InlineKeyboardMarkup(keyboard))

    elif data.startswith('hw_select_subject_'):
        if not await require_assistant(query):
            return
        parts = data.split('_')
        course, stream = parts[3], parts[4]
        subject = '_'.join(parts[5:])

        context.user_data['hw_subject'] = subject
        context.user_data['hw_course'] = course
        context.user_data['hw_stream'] = stream

        today = datetime.datetime.now(TIMEZONE).date()
        future_dates = [d for d in get_subject_dates(course, stream, subject) if d >= today]

        keyboard = [
            [InlineKeyboardButton(date.strftime("%d.%m.%Y"),
                                   callback_data=f"hw_select_date_{course}_{stream}_{date.isoformat()}")]
            for date in future_dates[:10]
        ]
        keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data=f"add_hw_{course}_{stream}")])
        await safe_edit_message(update, text=f"Выбери дату занятия для предмета '{subject}':",
                                 reply_markup=InlineKeyboardMarkup(keyboard))

    elif data.startswith('hw_select_date_'):
        if not await require_assistant(query):
            return
        parts = data.split('_')
        course, stream, date_str = parts[3], parts[4], parts[5]

        context.user_data['hw_date'] = date_str
        context.user_data['hw_course'] = course
        context.user_data['hw_stream'] = stream
        context.user_data['awaiting_hw_text'] = True

        await query.message.reply_text(
            "📝 Введи текст домашнего задания:\n\n"
            "(Например: 'Прочитать главу 5, ответить на вопросы 1-10')"
        )

    elif data.startswith('list_hw_'):
        if not await require_assistant(query):
            return
        parts = data.split('_')
        course, stream = parts[2], parts[3]
        text = build_homework_list_text(course, stream)
        keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data=f"manage_hw_{course}_{stream}")]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        try:
            await safe_edit_message(update, text=text, reply_markup=reply_markup)
        except BadRequest as e:
            if "message is too long" in str(e).lower():
                await query.message.reply_text(text, reply_markup=reply_markup)
            else:
                raise

    elif data.startswith('delete_hw_'):
        if not await require_assistant(query):
            return
        parts = data.split('_')
        course, stream = parts[2], parts[3]
        future_hws = get_future_homeworks(course, stream)

        if not future_hws:
            text = "📋 Нет домашних заданий для удаления"
            keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data=f"manage_hw_{course}_{stream}")]]
        else:
            text = "Выбери ДЗ для удаления:"
            keyboard = []
            for hw_key in sorted(future_hws.keys()):
                subject, date_str = hw_key.split('|')
                date_formatted = datetime.datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y")
                keyboard.append([InlineKeyboardButton(
                    f"{subject} ({date_formatted})",
                    callback_data=f"confirm_delete_hw_{course}_{stream}_{hw_key}"
                )])
            keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data=f"manage_hw_{course}_{stream}")])

        await safe_edit_message(update, text=text, reply_markup=InlineKeyboardMarkup(keyboard))

    elif data.startswith('confirm_delete_hw_'):
        if not await require_assistant(query):
            return
        parts = data.split('_')
        course, stream = parts[3], parts[4]
        hw_key = '_'.join(parts[5:])

        homeworks = load_homeworks(course, stream)
        if hw_key in homeworks:
            del homeworks[hw_key]
            save_homeworks(course, stream, homeworks)
            await query.answer("✅ Домашнее задание удалено!")
        else:
            await query.answer("❌ Домашнее задание не найдено")

        await handle_query(update, context)


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обрабатывает текстовые сообщения — используется для ввода текста ДЗ."""
    user_id = str(update.effective_user.id)

    if not context.user_data.get('awaiting_hw_text'):
        return

    if not can_manage_homework(update):
        await update.message.reply_text("❌ У вас нет прав для управления ДЗ")
        return

    hw_text = update.message.text
    subject = context.user_data.get('hw_subject')
    date_str = context.user_data.get('hw_date')
    course = context.user_data.get('hw_course')
    stream = context.user_data.get('hw_stream')

    original_subject = get_original_subject_name(course, stream, subject)
    hw_key = f"{original_subject}|{date_str}"

    homeworks = load_homeworks(course, stream)
    homeworks[hw_key] = hw_text
    save_homeworks(course, stream, homeworks)

    context.user_data['awaiting_hw_text'] = False

    date_formatted = datetime.datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y")
    await update.message.reply_text(
        f"✅ Домашнее задание добавлено!\n\n"
        f"📖 {subject}\n"
        f"📅 {date_formatted}\n"
        f"📝 {hw_text}"
    )

    settings = user_settings.get(user_id, {})
    await show_main_menu(update, context, course, stream, settings.get('english_time'))


# === АДМИНСКИЕ КОМАНДЫ ===
async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда /stats — статистика по пользователям бота (только для админа)."""
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для использования этой команды")
        return

    stats_data = get_user_stats()

    text = "📊 Статистика бота\n\n"
    text += f"👥 Всего пользователей: {stats_data['total_users']}\n\n"

    text += "📚 По курсам и потокам:\n"
    for course, streams in sorted(stats_data['course_stats'].items()):
        for stream, count in sorted(streams.items()):
            stream_name = get_stream_display_name(course, stream)
            if len(SCHEDULES.get(course, {})) > 1:
                text += f"  • {course} курс, {stream_name}: {count}\n"
            else:
                text += f"  • {course} курс: {count}\n"

    text += "\n🔔 Напоминания:\n"
    text += f"  • Включены: {stats_data['reminders_stats']['enabled']}\n"
    text += f"  • Выключены: {stats_data['reminders_stats']['disabled']}\n"

    text += "\n⏰ Английский язык:\n"
    text += f"  • Утро: {stats_data['english_time_stats']['morning']}\n"
    text += f"  • День: {stats_data['english_time_stats']['afternoon']}\n"
    text += f"  • Не выбрано: {stats_data['english_time_stats']['none']}\n"

    await update.message.reply_text(text)


async def broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда /broadcast — рассылка сообщения всем пользователям (только для админа)."""
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для использования этой команды")
        return

    if not context.args:
        await update.message.reply_text("Использование: /broadcast <сообщение>\nПример: /broadcast Привет всем!")
        return

    message_text = ' '.join(context.args)
    success_count, fail_count = 0, 0

    for user_id in user_settings.keys():
        try:
            await context.bot.send_message(chat_id=user_id, text=message_text)
            success_count += 1
            await asyncio.sleep(0.05)
        except Exception as e:
            logging.error(f"Ошибка отправки сообщения пользователю {user_id}: {e}")
            fail_count += 1

    await update.message.reply_text(f"✅ Рассылка завершена!\n📤 Отправлено: {success_count}\n❌ Ошибок: {fail_count}")


async def add_assistant(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда /add_assistant — добавляет помощника, который может вести ДЗ (только для админа)."""
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для использования этой команды")
        return

    if not context.args:
        await update.message.reply_text("Использование: /add_assistant <username>\nПример: /add_assistant johndoe")
        return

    username = context.args[0].replace('@', '')
    if username in assistants:
        await update.message.reply_text(f"❌ Пользователь @{username} уже является помощником")
        return

    assistants.add(username)
    save_assistants()
    await update.message.reply_text(f"✅ Пользователь @{username} добавлен в помощники!")


async def remove_assistant(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда /remove_assistant — убирает помощника (только для админа)."""
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для использования этой команды")
        return

    if not context.args:
        await update.message.reply_text("Использование: /remove_assistant <username>\nПример: /remove_assistant johndoe")
        return

    username = context.args[0].replace('@', '')
    if username not in assistants:
        await update.message.reply_text(f"❌ Пользователь @{username} не является помощником")
        return

    assistants.remove(username)
    save_assistants()
    await update.message.reply_text(f"✅ Пользователь @{username} удален из помощников!")


async def list_assistants(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда /list_assistants — показывает список текущих помощников (только для админа)."""
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для использования этой команды")
        return

    if not assistants:
        await update.message.reply_text("📋 Список помощников пуст")
        return

    text = "📋 Список помощников:\n\n" + "\n".join(f"• @{u}" for u in sorted(assistants))
    await update.message.reply_text(text)


# === ГЛАВНАЯ ФУНКЦИЯ ===
async def post_init(application):
    """Запускает фоновый планировщик после инициализации приложения."""
    asyncio.create_task(scheduler())
    logging.info("✅ Планировщик запущен!")


def main():
    global user_settings, application, assistants, subject_renames, schedule_edits

    user_settings = load_user_settings()
    assistants = load_assistants()
    subject_renames = load_subject_renames()
    schedule_edits = load_schedule_edits()

    logging.info("🤖 Запуск бота...")

    application = (
        ApplicationBuilder()
        .token(BOT_TOKEN)
        .proxy(PROXY_URL)
        .get_updates_proxy(PROXY_URL)
        .post_init(post_init)
        .build()
    )

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("stats", stats))
    application.add_handler(CommandHandler("broadcast", broadcast))
    application.add_handler(CommandHandler("add_assistant", add_assistant))
    application.add_handler(CommandHandler("remove_assistant", remove_assistant))
    application.add_handler(CommandHandler("list_assistants", list_assistants))
    application.add_handler(CallbackQueryHandler(handle_query))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    logging.info("✅ Бот успешно запущен!")
    application.run_polling()


if __name__ == '__main__':
    main()
