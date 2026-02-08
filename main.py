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

# === ФУНКЦИЯ ДЛЯ ЧТЕНИЯ ТОКЕНА ИЗ ФАЙЛА ===
def load_bot_token():
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
GITHUB_RAW_URL = "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/main.py"

# URLs для разных курсов
STREAM_URLS = {
    "1": {
        "sdi": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_1_kurs_СДИ_nodups.ics",
        "theory": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_1_kurs_Теория_и_практика_nodups.ics",
        "region1": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_1_kurs_Регионы_1_nodups.ics",
        "region2": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_1_kurs_Регионы_2_nodups.ics"
    },
    "2": {
        "1": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_2kurs.ics"
    },
    "3": {
        "1": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_3kurs.ics"
    },
    "4": {
        "1": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_4kurs.ics"
    }
}

# Словарь для отображения названий потоков
STREAM_NAMES = {
    "sdi": "СДИ",
    "theory": "Теория и практика",
    "region1": "Регионы 1",
    "region2": "Регионы 2"
}

TIMEZONE = pytz.timezone("Europe/Moscow")
USER_SETTINGS_FILE = "user_settings.json"
LAST_UPDATE_FILE = "last_update.txt"
ASSISTANTS_FILE = "assistants.json"
SUBJECT_RENAMES_FILE = "subject_renames.json"
SCHEDULE_EDITS_FILE = "schedule_edits.json"

# Глобальные переменные
user_settings = {}
events_cache = {}
application = None
assistants = set()
subject_renames = {}
schedule_edits = {}

# === ФУНКЦИИ ДЛЯ РАБОТЫ С ДАННЫМИ ===
def load_assistants():
    """Загружает список помощников"""
    try:
        with open(ASSISTANTS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return set(data.get("assistants", []))
    except FileNotFoundError:
        return set()

def save_assistants():
    """Сохраняет список помощников"""
    with open(ASSISTANTS_FILE, "w", encoding="utf-8") as f:
        json.dump({"assistants": list(assistants)}, f, ensure_ascii=False, indent=2)

def load_subject_renames():
    """Загружает переименования предметов"""
    try:
        with open(SUBJECT_RENAMES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_subject_renames():
    """Сохраняет переименования предметов"""
    with open(SUBJECT_RENAMES_FILE, "w", encoding="utf-8") as f:
        json.dump(subject_renames, f, ensure_ascii=False, indent=2)

def load_schedule_edits():
    """Загружает правки расписания"""
    try:
        with open(SCHEDULE_EDITS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_schedule_edits():
    """Сохраняет правки расписания"""
    with open(SCHEDULE_EDITS_FILE, "w", encoding="utf-8") as f:
        json.dump(schedule_edits, f, ensure_ascii=False, indent=2)

def get_original_subject_name(course, stream, display_name):
    """Возвращает оригинальное название предмета по отображаемому"""
    key = f"{course}_{stream}"
    for original, renamed in subject_renames.get(key, {}).items():
        if renamed == display_name:
            return original
    return display_name

def get_display_subject_name(course, stream, original_name):
    """Возвращает отображаемое название предмета (с учетом переименований)"""
    key = f"{course}_{stream}"
    return subject_renames.get(key, {}).get(original_name, original_name)

def load_homeworks(course, stream):
    """Загружает домашние задания для указанного курса и потока"""
    filename = f"homeworks_{course}_{stream}.json"
    try:
        with open(filename, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_homeworks(course, stream, homeworks_data):
    """Сохраняет домашние задания для указанного курса и потока"""
    filename = f"homeworks_{course}_{stream}.json"
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(homeworks_data, f, ensure_ascii=False, indent=2)

def get_future_homeworks(course, stream):
    """Получает только будущие домашние задания"""
    homeworks = load_homeworks(course, stream)
    today = datetime.datetime.now(TIMEZONE).date()

    future_homeworks = {}
    for hw_key, hw_text in homeworks.items():
        try:
            parts = hw_key.split('|')
            if len(parts) != 2:
                continue
            date_str = parts[1]
            hw_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
            if hw_date >= today:
                future_homeworks[hw_key] = hw_text
        except (ValueError, IndexError):
            continue
    return future_homeworks

def get_past_homeworks(course, stream):
    """Получает только прошедшие домашние задания"""
    homeworks = load_homeworks(course, stream)
    today = datetime.datetime.now(TIMEZONE).date()

    past_homeworks = {}
    for hw_key, hw_text in homeworks.items():
        try:
            parts = hw_key.split('|')
            if len(parts) != 2:
                continue
            date_str = parts[1]
            hw_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
            if hw_date < today:
                past_homeworks[hw_key] = hw_text
        except (ValueError, IndexError):
            continue
    return past_homeworks

def get_homeworks_for_tomorrow(course, stream):
    """Получает домашние задания на завтра"""
    tomorrow = datetime.datetime.now(TIMEZONE).date() + datetime.timedelta(days=1)
    tomorrow_homeworks = []
    homeworks = load_homeworks(course, stream)

    for hw_key, hw_text in homeworks.items():
        try:
            parts = hw_key.split('|')
            if len(parts) != 2:
                continue
            subject = parts[0]
            date_str = parts[1]
            hw_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
            if hw_date == tomorrow:
                tomorrow_homeworks.append((subject, hw_text))
        except (ValueError, IndexError):
            continue
    return tomorrow_homeworks

def load_user_settings():
    try:
        with open(USER_SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_user_settings(settings_data):
    with open(USER_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings_data, f, ensure_ascii=False, indent=2)

def load_last_update():
    try:
        with open(LAST_UPDATE_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return None

def save_last_update():
    with open(LAST_UPDATE_FILE, "w", encoding="utf-8") as f:
        f.write(datetime.datetime.now().isoformat())

# === ФУНКЦИИ РЕДАКТИРОВАНИЯ РАСПИСАНИЯ ===
def apply_schedule_edits(course, stream, events):
    """Применяет правки к расписанию"""
    key = f"{course}_{stream}"
    if key not in schedule_edits:
        return events

    stream_edits = schedule_edits[key]
    edited_events = []

    for event in events:
        event_date = event["start"].date().isoformat()
        event_key = f"{event['original_summary']}[{event['start'].strftime('%H:%M')}]"

        if event_date in stream_edits and event_key in stream_edits[event_date]:
            edit = stream_edits[event_date][event_key]

            if edit.get("deleted", False):
                continue
            elif "new_summary" in edit:
                edited_event = event.copy()
                edited_event["summary"] = edit["new_summary"]
                if "new_desc" in edit:
                    edited_event["desc"] = edit["new_desc"]
                edited_events.append(edited_event)
            else:
                edited_events.append(event)
        else:
            edited_events.append(event)

    for date_str, date_edits in stream_edits.items():
        for event_key, edit in date_edits.items():
            if edit.get("new", False) and "start_time" in edit:
                try:
                    start_dt = datetime.datetime.strptime(f"{date_str} {edit['start_time']}", "%Y-%m-%d %H:%M")
                    end_dt = datetime.datetime.strptime(f"{date_str} {edit['end_time']}", "%Y-%m-%d %H:%M")

                    start_dt = TIMEZONE.localize(start_dt)
                    end_dt = TIMEZONE.localize(end_dt)

                    new_event = {
                        'summary': edit['new_summary'],
                        'original_summary': edit['new_summary'],
                        'start': start_dt,
                        'end': end_dt,
                        'desc': edit.get('new_desc', '')
                    }
                    edited_events.append(new_event)
                except ValueError as e:
                    logging.error(f"Ошибка создания нового события: {e}")

    return edited_events

def load_events_from_github(course, stream):
    """Загрузка событий с учетом курса и потока"""
    cache_key = f"{course}_{stream}"
    if cache_key in events_cache:
        return apply_schedule_edits(course, stream, events_cache[cache_key])

    events = []
    try:
        logging.info(f"Загрузка расписания для курса {course}, потока {stream} из GitHub...")
        url = STREAM_URLS.get(course, {}).get(stream)
        if not url:
            logging.error(f"URL не найден для курса {course}, потока {stream}")
            return []

        response = requests.get(url)
        response.raise_for_status()
        data = response.text

        event_blocks = data.split('BEGIN:VEVENT')

        for block in event_blocks:
            if 'END:VEVENT' not in block:
                continue

            try:
                summary_match = re.search(r'SUMMARY:(.+?)(?:\n|$)', block)
                dtstart_match = re.search(r'DTSTART(?:;VALUE=DATE-TIME)?(?:;TZID=Europe/Moscow)?:(\d{8}T\d{6})', block)
                dtend_match = re.search(r'DTEND(?:;VALUE=DATE-TIME)?(?:;TZID=Europe/Moscow)?:(\d{8}T\d{6})', block)
                description_match = re.search(r'DESCRIPTION:(.+?)(?:\n|$)', block, re.DOTALL)

                if not all([summary_match, dtstart_match, dtend_match]):
                    continue

                original_summary = summary_match.group(1).strip()
                summary = get_display_subject_name(course, stream, original_summary)

                start_str = dtstart_match.group(1)
                end_str = dtend_match.group(1)
                description = description_match.group(1).strip() if description_match else ""

                start_dt = datetime.datetime.strptime(start_str, '%Y%m%dT%H%M%S')
                end_dt = datetime.datetime.strptime(end_str, '%Y%m%dT%H%M%S')

                start_dt = TIMEZONE.localize(start_dt)
                end_dt = TIMEZONE.localize(end_dt)

                events.append({
                    'summary': summary,
                    'original_summary': original_summary,
                    'start': start_dt,
                    'end': end_dt,
                    'desc': description
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
    events = load_events_from_github(course, stream)
    subjects = set()
    for event in events:
        subjects.add(event["summary"])
    return sorted(list(subjects))

def get_subject_dates(course, stream, subject):
    """Получает все даты для указанного предмета"""
    events = load_events_from_github(course, stream)
    dates = []
    for event in events:
        if event["summary"] == subject:
            dates.append(event["start"].date())
    return sorted(dates)

# === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
def get_week_range(date):
    start = date - datetime.timedelta(days=date.weekday())
    end = start + datetime.timedelta(days=6)
    return start, end

def is_online_class(ev):
    """Проверяет, является ли пара онлайн - ТЕПЕРЬ ПО УМОЛЧАНИЮ ВСЕ ОФФЛАЙН"""
    desc = ev.get("desc", "").lower()
    summary = ev.get("summary", "").lower()

    online_keywords = [
        "онлайн", "online", "zoom", "teams", "вебинар", "webinar",
        "дистанционно", "distance", "удаленно", "remote", "ссылка",
        "конференция", "conference", "meet", "meeting", "call"
    ]

    desc_online = any(keyword in desc for keyword in online_keywords)
    summary_online = any(keyword in summary for keyword in online_keywords)

    return desc_online or summary_online

def has_only_lunch_break(events, date):
    """Проверяет, есть ли в этот день только обеденный перерыв"""
    day_events = [e for e in events if e["start"].date() == date]

    if len(day_events) == 0:
        return False

    lunch_breaks = [e for e in day_events if "обед" in e["summary"].lower() or "перерыв" in e["summary"].lower()]
    return len(lunch_breaks) == len(day_events)

def format_event(ev, course, stream):
    desc = ev["desc"]
    teacher, room = "", ""

    teacher_patterns = [
        r"Преподаватель:\s*([^\n\r]+)",
        r"Преподаватель\s*:\s*([^\n\r]+)",
        r"Teacher:\s*([^\n\r]+)",
        r"Teacher\s*:\s*([^\n\r]+)"
    ]

    for pattern in teacher_patterns:
        teacher_match = re.search(pattern, desc, re.IGNORECASE)
        if teacher_match:
            teacher = teacher_match.group(1).strip()
            break

    room_patterns = [
        r"Аудитория:\s*([^\n\r]+)",
        r"Аудитория\s*:\s*([^\n\r]+)",
        r"Room:\s*([^\n\r]+)",
        r"Room\s*:\s*([^\n\r]+)",
        r"Auditorium:\s*([^\n\r]+)",
        r"Auditorium\s*:\s*([^\n\r]+)"
    ]

    for pattern in room_patterns:
        room_match = re.search(pattern, desc, re.IGNORECASE)
        if room_match:
            room = room_match.group(1).strip()
            break

    if not room:
        inion_patterns = [
            r"ИНИОН",
            r"INION",
            r"инион",
            r"inion"
        ]

        for pattern in inion_patterns:
            if re.search(pattern, desc, re.IGNORECASE):
                room = "ИНИОН"
                break

    if not teacher:
        name_pattern = r"([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)"
        name_match = re.search(name_pattern, desc)
        if name_match:
            teacher = name_match.group(1).strip()

    online_marker = " 💻" if is_online_class(ev) else ""

    line = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')} {ev['summary']}{online_marker}"

    if teacher or room:
        line += "\n"
        if teacher:
            line += f"  👤 {teacher}"
        if room:
            if teacher:
                line += " | "
            line += f"  🏫 {room}"

    date_str = ev['start'].date().isoformat()
    hw_key = f"{ev['original_summary']}|{date_str}"
    homeworks = load_homeworks(course, stream)

    if hw_key in homeworks:
        line += f"\n   📝 ДЗ: {homeworks[hw_key]}"
    return line

def events_for_day(events, date, english_time=None):
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
            english_event = {
                "summary": "Английский язык",
                "original_summary": "Английский язык",
                "start": start_time,
                "end": end_time,
                "desc": "Онлайн занятие"
            }
            day_events.append(english_event)

    return day_events

def format_day(date, events, course, stream, english_time=None, is_tomorrow=False):
    """Форматирование дня с учетом курса и потока"""
    if has_only_lunch_break(events, date):
        return f"{date.strftime('%A, %d %B')} — занятий нет\n"

    evs = events_for_day(events, date, english_time)

    days_ru = {
        'Monday': 'Понедельник',
        'Tuesday': 'Вторник',
        'Wednesday': 'Среда',
        'Thursday': 'Четверг',
        'Friday': 'Пятница',
        'Saturday': 'Суббота',
        'Sunday': 'Воскресенье'
    }

    months_ru = {
        'January': 'января', 'February': 'февраля', 'March': 'марта',
        'April': 'апреля', 'May': 'мая', 'June': 'июня',
        'July': 'июля', 'August': 'августа', 'September': 'сентября',
        'October': 'октября', 'November': 'ноября', 'December': 'декабря'
    }

    day_en = date.strftime('%A')
    month_en = date.strftime('%B')
    day_ru = days_ru.get(day_en, day_en)
    month_ru = months_ru.get(month_en, month_en)
    date_str = date.strftime(f"{day_ru}, %d {month_ru}")

    prefix = "📅"
    if is_tomorrow:
        date_str = f"Завтра, {date_str}"


    if not evs:
        return f"{prefix} {date_str} — занятий нет\n"

    text = f"{prefix} {date_str}:\n"
    for ev in sorted(evs, key=lambda x: x["start"]):
        text += f"{format_event(ev, course, stream)}\n\n"

    return text

def is_admin(update: Update):
    return update.effective_user.username == ADMIN_USERNAME

def is_assistant(update: Update):
    username = update.effective_user.username
    return username == ADMIN_USERNAME or username in assistants

def can_manage_homework(update: Update):
    """Проверяет, может ли пользователь управлять ДЗ"""
    return is_assistant(update)

def get_user_stats():
    """Получает статистику пользователей"""
    total_users = len(user_settings)

    course_stats = {}
    reminders_stats = {"enabled": 0, "disabled": 0}
    english_time_stats = {"morning": 0, "afternoon": 0, "none": 0}

    for user_id, settings in user_settings.items():
        course = settings.get('course')
        stream = settings.get('stream', '1')

        if course:
            if course not in course_stats:
                course_stats[course] = {}

            if stream not in course_stats[course]:
                course_stats[course][stream] = 0
            course_stats[course][stream] += 1

        if settings.get('reminders', False):
            reminders_stats["enabled"] += 1
        else:
            reminders_stats["disabled"] += 1

        english_time = settings.get('english_time')
        if english_time == "morning":
            english_time_stats["morning"] += 1
        elif english_time == "afternoon":
            english_time_stats["afternoon"] += 1
        else:
            english_time_stats["none"] += 1

    return {
        "total_users": total_users,
        "course_stats": course_stats,
        "reminders_stats": reminders_stats,
        "english_time_stats": english_time_stats
    }

async def send_homework_reminders():
    """Отправляет напоминания о домашних заданиях"""
    if not application:
        return

    logging.info("🔔 Проверка напоминаний о ДЗ...")

    for user_id, settings in user_settings.items():
        try:
            if settings.get('reminders', False) and settings.get('course') and settings.get('stream'):
                course = settings['course']
                stream = settings['stream']
                tomorrow_hws = get_homeworks_for_tomorrow(course, stream)

                if tomorrow_hws:
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
    """Проверяет обновления на GitHub"""
    try:
        logging.info("🔍 Проверка обновлений на GitHub...")
        response = requests.get(GITHUB_RAW_URL)
        if response.status_code == 200:
            new_content = response.text
            with open(__file__, "r", encoding="utf-8") as f:
                current_content = f.read()

            if new_content != current_content:
                with open(__file__, "w", encoding="utf-8") as f:
                    f.write(new_content)

                save_last_update()
                logging.info("✅ Бот обновлен до последней версии!")

                if application:
                    await application.bot.send_message(
                        chat_id=ADMIN_USERNAME,
                        text="✅ Бот автоматически обновлен до последней версии из GitHub!"
                    )
            else:
                logging.info("📭 Обновлений нет")

    except Exception as e:
        logging.error(f"❌ Ошибка при проверке обновлений: {e}")

async def scheduler():
    """Асинхронный планировщик для напоминаний и обновлений"""
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
    """Безопасное редактирование сообщения с обработкой ошибок"""
    try:
        await update.callback_query.edit_message_text(
            text=text,
            reply_markup=reply_markup
        )
    except BadRequest as e:
        if "Message is not modified" in str(e):
            logging.info("Message not modified - ignoring")
        else:
            raise

# === ОСНОВНЫЕ ОБРАБОТЧИКИ КОМАНД ===
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("1 курс", callback_data="select_course_1")],
        [InlineKeyboardButton("2 курс", callback_data="select_course_2")],
        [InlineKeyboardButton("3 курс", callback_data="select_course_3")],
        [InlineKeyboardButton("4 курс", callback_data="select_course_4")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        "Привет! 🎓\nВыбери свой курс:",
        reply_markup=reply_markup
    )

async def select_stream(update: Update, context: ContextTypes.DEFAULT_TYPE, course):
    """Выбор потока (только для 1 курса)"""
    if course != "1":
        await select_english_time(update, context, course, "1")
        return

    keyboard = [
        [InlineKeyboardButton("📖 СДИ", callback_data=f"select_stream_sdi_{course}")],
        [InlineKeyboardButton("📖 Теория и практика", callback_data=f"select_stream_theory_{course}")],
        [InlineKeyboardButton("📖 Регионы 1", callback_data=f"select_stream_region1_{course}")],
        [InlineKeyboardButton("📖 Регионы 2", callback_data=f"select_stream_region2_{course}")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    if update.callback_query:
        await safe_edit_message(
            update,
            text="Выбери тип расписания:",
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            text="Выбери тип расписания:",
            reply_markup=reply_markup
        )

async def select_english_time(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream):
    keyboard = [
        [InlineKeyboardButton("🕘 9:00-12:10", callback_data=f"english_morning_{course}_{stream}")],
        [InlineKeyboardButton("🕑 14:00-17:10", callback_data=f"english_afternoon_{course}_{stream}")],
        [InlineKeyboardButton("❌ Без английского", callback_data=f"english_none_{course}_{stream}")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    if update.callback_query:
        await safe_edit_message(
            update,
            text="Выбери время для английского в четверг:",
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            text="Выбери время для английского в четверг:",
            reply_markup=reply_markup
        )

async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream, english_time=None):
    try:
        events = load_events_from_github(course, stream)

        user_id = str(update.effective_user.id)
        if user_id not in user_settings:
            user_settings[user_id] = {}

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
            [InlineKeyboardButton("🔔 Настройка напоминаний", callback_data=f"reminders_settings_{course}_{stream}")],
            [InlineKeyboardButton("🔄 Обновить расписание", callback_data=f"refresh_{course}_{stream}")],
        ]

        if can_manage_homework(update):
            keyboard.append([InlineKeyboardButton("📝 Управление ДЗ", callback_data=f"manage_hw_{course}_{stream}")])

        reply_markup = InlineKeyboardMarkup(keyboard)

        stream_display = STREAM_NAMES.get(stream, stream) if course == "1" else ""
        course_text = f"{course} курс"
        if course == "1":
            course_text += f", {stream_display}"

        english_text = ""
        if english_time == "morning":
            english_text = "\n💡 Английский: 9:00-12:10"
        elif english_time == "afternoon":
            english_text = "\n💡 Английский: 14:00-17:10"

        reminders_status = "🔔" if user_settings[user_id].get('reminders', False) else "🔕"
        reminders_time = user_settings[user_id].get('reminders_time', '20:00')
        reminders_text = f"\n{reminders_status} Напоминания: {'вкл' if user_settings[user_id].get('reminders', False) else 'выкл'}"
        if user_settings[user_id].get('reminders', False):
            reminders_text += f" ({reminders_time})"

        message_text = f"Выбран {course_text}{english_text}{reminders_text}\nВыбери действие:"

        if update.callback_query:
            try:
                await safe_edit_message(
                    update,
                    text=message_text,
                    reply_markup=reply_markup
                )
            except BadRequest as e:
                if "Message is not modified" not in str(e):
                    raise
        else:
            await update.message.reply_text(
                text=message_text,
                reply_markup=reply_markup
            )

    except Exception as e:
        logging.error(f"Ошибка в show_main_menu: {e}")

async def handle_query(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    data = query.data
    user_id = str(update.effective_user.id)

    # === ОБРАБОТКА ВЫБОРА КУРСА ===
    if data.startswith('select_course_'):
        course = data.split('_')[-1]
        context.user_data['course'] = course
        await select_stream(update, context, course)

    # === ОБРАБОТКА ВЫБОРА ПОТОКА (ИСПРАВЛЕНО ДЛЯ НОВЫХ ТИПОВ) ===
    elif data.startswith('select_stream_'):
        parts = data.split('_')
        if len(parts) >= 4:
            stream = parts[2]  # sdi, theory, region1, region2
            course = parts[3]
            context.user_data['stream'] = stream
            await select_english_time(update, context, course, stream)
        else:
            await query.answer("Ошибка: неверный формат данных")
            return

    # === ОБРАБОТКА ВЫБОРА ВРЕМЕНИ АНГЛИЙСКОГО ===
    elif data.startswith('english_'):
        parts = data.split('_')
        if len(parts) >= 4:
            english_time = parts[1]  # morning, afternoon, none
            course = parts[2]
            stream = parts[3]
            
            if english_time == "none":
                english_time = None
            
            await show_main_menu(update, context, course, stream, english_time)
        else:
            await query.answer("Ошибка: неверный формат данных")
            return

    # === ОБРАБОТКА ПРОСМОТРА РАСПИСАНИЯ ===
    elif data.startswith('today_') or data.startswith('tomorrow_'):
        parts = data.split('_')
        action = parts[0]
        course = parts[1]
        stream = parts[2]

        settings = user_settings.get(user_id, {})
        english_time = settings.get('english_time')

        events = load_events_from_github(course, stream)
        today = datetime.datetime.now(TIMEZONE).date()

        if action == "today":
            text = format_day(today, events, course, stream, english_time)
        else:  # tomorrow
            tomorrow = today + datetime.timedelta(days=1)
            text = format_day(tomorrow, events, course, stream, english_time, is_tomorrow=True)

        keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data=f"back_to_menu_{course}_{stream}")]]
        reply_markup = InlineKeyboardMarkup(keyboard)

        await safe_edit_message(update, text=text, reply_markup=reply_markup)

    # === ОБРАБОТКА ПРОСМОТРА НЕДЕЛИ ===
    elif data.startswith('this_week_') or data.startswith('next_week_'):
        parts = data.split('_')
        if parts[0] == "this":
            action = "this_week"
            course = parts[2]
            stream = parts[3]
        else:
            action = "next_week"
            course = parts[2]
            stream = parts[3]

        settings = user_settings.get(user_id, {})
        english_time = settings.get('english_time')

        events = load_events_from_github(course, stream)
        today = datetime.datetime.now(TIMEZONE).date()

        if action == "this_week":
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
                parts_list = [text[i:i+4000] for i in range(0, len(text), 4000)]
                for i, part in enumerate(parts_list):
                    if i == len(parts_list) - 1:
                        await query.message.reply_text(part, reply_markup=reply_markup)
                    else:
                        await query.message.reply_text(part)
            else:
                raise

    # === ОБНОВЛЕНИЕ РАСПИСАНИЯ ===
    elif data.startswith('refresh_'):
        parts = data.split('_')
        course = parts[1]
        stream = parts[2]

        cache_key = f"{course}_{stream}"
        if cache_key in events_cache:
            del events_cache[cache_key]

        events = load_events_from_github(course, stream)

        await query.answer("✅ Расписание обновлено!")
        
        settings = user_settings.get(user_id, {})
        english_time = settings.get('english_time')
        await show_main_menu(update, context, course, stream, english_time)

    # === ВОЗВРАТ В ГЛАВНОЕ МЕНЮ ===
    elif data.startswith('back_to_menu_'):
        parts = data.split('_')
        course = parts[3]
        stream = parts[4]

        settings = user_settings.get(user_id, {})
        english_time = settings.get('english_time')
        await show_main_menu(update, context, course, stream, english_time)

    # === НАСТРОЙКА НАПОМИНАНИЙ ===
    elif data.startswith('reminders_settings_'):
        parts = data.split('_')
        course = parts[2]
        stream = parts[3]

        settings = user_settings.get(user_id, {})
        reminders_enabled = settings.get('reminders', False)

        status_text = "включены ✅" if reminders_enabled else "выключены ❌"

        keyboard = [
            [InlineKeyboardButton(
                "🔔 Включить" if not reminders_enabled else "🔕 Выключить",
                callback_data=f"toggle_reminders_{course}_{stream}"
            )],
            [InlineKeyboardButton("⬅️ Назад", callback_data=f"back_to_menu_{course}_{stream}")]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        text = f"⚙️ Настройка напоминаний\n\nНапоминания о домашних заданиях {status_text}\n\n"
        text += "Напоминания приходят каждый день в 20:00 с информацией о ДЗ на завтра."

        await safe_edit_message(update, text=text, reply_markup=reply_markup)

    # === ПЕРЕКЛЮЧЕНИЕ НАПОМИНАНИЙ ===
    elif data.startswith('toggle_reminders_'):
        parts = data.split('_')
        course = parts[2]
        stream = parts[3]

        if user_id not in user_settings:
            user_settings[user_id] = {}

        current_status = user_settings[user_id].get('reminders', False)
        user_settings[user_id]['reminders'] = not current_status
        save_user_settings(user_settings)

        new_status = user_settings[user_id]['reminders']
        status_text = "включены ✅" if new_status else "выключены ❌"

        keyboard = [
            [InlineKeyboardButton(
                "🔔 Включить" if not new_status else "🔕 Выключить",
                callback_data=f"toggle_reminders_{course}_{stream}"
            )],
            [InlineKeyboardButton("⬅️ Назад", callback_data=f"back_to_menu_{course}_{stream}")]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        text = f"⚙️ Настройка напоминаний\n\nНапоминания о домашних заданиях {status_text}\n\n"
        text += "Напоминания приходят каждый день в 20:00 с информацией о ДЗ на завтра."

        await safe_edit_message(update, text=text, reply_markup=reply_markup)
        await query.answer(f"Напоминания {'включены' if new_status else 'выключены'}!")

    # === УПРАВЛЕНИЕ ДОМАШНИМИ ЗАДАНИЯМИ ===
    elif data.startswith('manage_hw_'):
        if not can_manage_homework(update):
            await query.answer("❌ У вас нет прав для управления ДЗ")
            return

        parts = data.split('_')
        course = parts[2]
        stream = parts[3]

        keyboard = [
            [InlineKeyboardButton("➕ Добавить ДЗ", callback_data=f"add_hw_{course}_{stream}")],
            [InlineKeyboardButton("📋 Список ДЗ", callback_data=f"list_hw_{course}_{stream}")],
            [InlineKeyboardButton("🗑️ Удалить ДЗ", callback_data=f"delete_hw_{course}_{stream}")],
            [InlineKeyboardButton("⬅️ Назад", callback_data=f"back_to_menu_{course}_{stream}")]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        text = "📝 Управление домашними заданиями\n\nВыбери действие:"

        await safe_edit_message(update, text=text, reply_markup=reply_markup)

    # === ДОБАВЛЕНИЕ ДЗ - ШАГ 1: ВЫБОР ПРЕДМЕТА ===
    elif data.startswith('add_hw_'):
        if not can_manage_homework(update):
            await query.answer("❌ У вас нет прав для управления ДЗ")
            return

        parts = data.split('_')
        course = parts[2]
        stream = parts[3]

        subjects = get_unique_subjects(course, stream)

        keyboard = []
        for subject in subjects:
            keyboard.append([InlineKeyboardButton(
                subject,
                callback_data=f"hw_select_subject_{course}_{stream}_{subject}"
            )])
        keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data=f"manage_hw_{course}_{stream}")])

        reply_markup = InlineKeyboardMarkup(keyboard)
        text = "Выбери предмет для добавления ДЗ:"

        await safe_edit_message(update, text=text, reply_markup=reply_markup)

    # === ДОБАВЛЕНИЕ ДЗ - ШАГ 2: ВЫБОР ДАТЫ ===
    elif data.startswith('hw_select_subject_'):
        if not can_manage_homework(update):
            await query.answer("❌ У вас нет прав для управления ДЗ")
            return

        parts = data.split('_')
        course = parts[3]
        stream = parts[4]
        subject = '_'.join(parts[5:])

        context.user_data['hw_subject'] = subject
        context.user_data['hw_course'] = course
        context.user_data['hw_stream'] = stream

        dates = get_subject_dates(course, stream, subject)
        future_dates = [d for d in dates if d >= datetime.datetime.now(TIMEZONE).date()]

        keyboard = []
        for date in future_dates[:10]:
            date_str = date.strftime("%d.%m.%Y")
            keyboard.append([InlineKeyboardButton(
                date_str,
                callback_data=f"hw_select_date_{course}_{stream}_{date.isoformat()}"
            )])
        keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data=f"add_hw_{course}_{stream}")])

        reply_markup = InlineKeyboardMarkup(keyboard)
        text = f"Выбери дату занятия для предмета '{subject}':"

        await safe_edit_message(update, text=text, reply_markup=reply_markup)

    # === ДОБАВЛЕНИЕ ДЗ - ШАГ 3: ВВОД ТЕКСТА ===
    elif data.startswith('hw_select_date_'):
        if not can_manage_homework(update):
            await query.answer("❌ У вас нет прав для управления ДЗ")
            return

        parts = data.split('_')
        course = parts[3]
        stream = parts[4]
        date_str = parts[5]

        context.user_data['hw_date'] = date_str
        context.user_data['hw_course'] = course
        context.user_data['hw_stream'] = stream
        context.user_data['awaiting_hw_text'] = True

        await query.message.reply_text(
            "📝 Введи текст домашнего задания:\n\n"
            "(Например: 'Прочитать главу 5, ответить на вопросы 1-10')"
        )

    # === ПРОСМОТР СПИСКА ДЗ ===
    elif data.startswith('list_hw_'):
        parts = data.split('_')
        course = parts[2]
        stream = parts[3]

        future_hws = get_future_homeworks(course, stream)

        if not future_hws:
            text = "📋 Список домашних заданий пуст"
        else:
            text = "📋 Список домашних заданий:\n\n"
            for hw_key, hw_text in sorted(future_hws.items()):
                parts = hw_key.split('|')
                subject = parts[0]
                date_str = parts[1]
                date_obj = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
                date_formatted = date_obj.strftime("%d.%m.%Y")
                text += f"📖 {subject} ({date_formatted}):\n{hw_text}\n\n"

        keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data=f"manage_hw_{course}_{stream}")]]
        reply_markup = InlineKeyboardMarkup(keyboard)

        try:
            await safe_edit_message(update, text=text, reply_markup=reply_markup)
        except BadRequest as e:
            if "message is too long" in str(e).lower():
                await query.message.reply_text(text, reply_markup=reply_markup)
            else:
                raise

    # === УДАЛЕНИЕ ДЗ ===
    elif data.startswith('delete_hw_'):
        if not can_manage_homework(update):
            await query.answer("❌ У вас нет прав для управления ДЗ")
            return

        parts = data.split('_')
        course = parts[2]
        stream = parts[3]

        future_hws = get_future_homeworks(course, stream)

        if not future_hws:
            text = "📋 Нет домашних заданий для удаления"
            keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data=f"manage_hw_{course}_{stream}")]]
        else:
            text = "Выбери ДЗ для удаления:"
            keyboard = []
            for hw_key in sorted(future_hws.keys()):
                parts = hw_key.split('|')
                subject = parts[0]
                date_str = parts[1]
                date_obj = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
                date_formatted = date_obj.strftime("%d.%m.%Y")
                
                button_text = f"{subject} ({date_formatted})"
                callback_data = f"confirm_delete_hw_{course}_{stream}_{hw_key}"
                
                keyboard.append([InlineKeyboardButton(button_text, callback_data=callback_data)])
            
            keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data=f"manage_hw_{course}_{stream}")])

        reply_markup = InlineKeyboardMarkup(keyboard)
        await safe_edit_message(update, text=text, reply_markup=reply_markup)

    # === ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ ДЗ ===
    elif data.startswith('confirm_delete_hw_'):
        if not can_manage_homework(update):
            await query.answer("❌ У вас нет прав для управления ДЗ")
            return

        parts = data.split('_')
        course = parts[3]
        stream = parts[4]
        hw_key = '_'.join(parts[5:])

        homeworks = load_homeworks(course, stream)
        if hw_key in homeworks:
            del homeworks[hw_key]
            save_homeworks(course, stream, homeworks)
            await query.answer("✅ Домашнее задание удалено!")
        else:
            await query.answer("❌ Домашнее задание не найдено")

        await handle_query(update, context)

# === ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ===
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)

    # Обработка добавления ДЗ
    if context.user_data.get('awaiting_hw_text'):
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

        date_obj = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
        date_formatted = date_obj.strftime("%d.%m.%Y")

        await update.message.reply_text(
            f"✅ Домашнее задание добавлено!\n\n"
            f"📖 {subject}\n"
            f"📅 {date_formatted}\n"
            f"📝 {hw_text}"
        )

        settings = user_settings.get(user_id, {})
        english_time = settings.get('english_time')
        await show_main_menu(update, context, course, stream, english_time)

# === АДМИНСКИЕ КОМАНДЫ ===
async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для использования этой команды")
        return

    stats_data = get_user_stats()

    text = "📊 Статистика бота\n\n"
    text += f"👥 Всего пользователей: {stats_data['total_users']}\n\n"

    text += "📚 По курсам и потокам:\n"
    for course, streams in sorted(stats_data['course_stats'].items()):
        for stream, count in sorted(streams.items()):
            stream_name = STREAM_NAMES.get(stream, stream)
            if course == "1":
                text += f"  • {course} курс, {stream_name}: {count}\n"
            else:
                text += f"  • {course} курс: {count}\n"

    text += f"\n🔔 Напоминания:\n"
    text += f"  • Включены: {stats_data['reminders_stats']['enabled']}\n"
    text += f"  • Выключены: {stats_data['reminders_stats']['disabled']}\n"

    text += f"\n⏰ Английский язык:\n"
    text += f"  • Утро: {stats_data['english_time_stats']['morning']}\n"
    text += f"  • День: {stats_data['english_time_stats']['afternoon']}\n"
    text += f"  • Не выбрано: {stats_data['english_time_stats']['none']}\n"

    await update.message.reply_text(text)

async def broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для использования этой команды")
        return

    if not context.args:
        await update.message.reply_text(
            "Использование: /broadcast <сообщение>\n"
            "Пример: /broadcast Привет всем!"
        )
        return

    message_text = ' '.join(context.args)
    
    success_count = 0
    fail_count = 0

    for user_id in user_settings.keys():
        try:
            await context.bot.send_message(chat_id=user_id, text=message_text)
            success_count += 1
            await asyncio.sleep(0.05)
        except Exception as e:
            logging.error(f"Ошибка отправки сообщения пользователю {user_id}: {e}")
            fail_count += 1

    await update.message.reply_text(
        f"✅ Рассылка завершена!\n"
        f"📤 Отправлено: {success_count}\n"
        f"❌ Ошибок: {fail_count}"
    )

async def add_assistant(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для использования этой команды")
        return

    if not context.args:
        await update.message.reply_text(
            "Использование: /add_assistant <username>\n"
            "Пример: /add_assistant johndoe"
        )
        return

    username = context.args[0].replace('@', '')
    
    if username in assistants:
        await update.message.reply_text(f"❌ Пользователь @{username} уже является помощником")
        return

    assistants.add(username)
    save_assistants()

    await update.message.reply_text(f"✅ Пользователь @{username} добавлен в помощники!")

async def remove_assistant(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для использования этой команды")
        return

    if not context.args:
        await update.message.reply_text(
            "Использование: /remove_assistant <username>\n"
            "Пример: /remove_assistant johndoe"
        )
        return

    username = context.args[0].replace('@', '')
    
    if username not in assistants:
        await update.message.reply_text(f"❌ Пользователь @{username} не является помощником")
        return

    assistants.remove(username)
    save_assistants()

    await update.message.reply_text(f"✅ Пользователь @{username} удален из помощников!")

async def list_assistants(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для использования этой команды")
        return

    if not assistants:
        await update.message.reply_text("📋 Список помощников пуст")
        return

    text = "📋 Список помощников:\n\n"
    for username in sorted(assistants):
        text += f"• @{username}\n"

    await update.message.reply_text(text)

# === ГЛАВНАЯ ФУНКЦИЯ ===
async def post_init(application):
    """Инициализация после запуска бота"""
    asyncio.create_task(scheduler())
    logging.info("✅ Планировщик запущен!")

def main():
    global user_settings, application, assistants, subject_renames, schedule_edits

    # Загружаем данные
    user_settings = load_user_settings()
    assistants = load_assistants()
    subject_renames = load_subject_renames()
    schedule_edits = load_schedule_edits()

    logging.info("🤖 Запуск бота...")

    # Создаем приложение С post_init
    application = ApplicationBuilder().token(BOT_TOKEN).post_init(post_init).build()

    # Добавляем обработчики команд
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("stats", stats))
    application.add_handler(CommandHandler("broadcast", broadcast))
    application.add_handler(CommandHandler("add_assistant", add_assistant))
    application.add_handler(CommandHandler("remove_assistant", remove_assistant))
    application.add_handler(CommandHandler("list_assistants", list_assistants))

    # Добавляем обработчики callback
    application.add_handler(CallbackQueryHandler(handle_query))

    # Добавляем обработчик текстовых сообщений
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    logging.info("✅ Бот успешно запущен!")
    
    # Запускаем polling
    application.run_polling()

if __name__ == '__main__':
    main()
