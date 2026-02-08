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

        # Проверяем, есть ли правка для этого события
        if event_date in stream_edits and event_key in stream_edits[event_date]:
            edit = stream_edits[event_date][event_key]

            if edit.get("deleted", False):
                # Пропускаем удаленные события
                continue
            elif "new_summary" in edit:
                # Применяем изменения к событию
                edited_event = event.copy()
                edited_event["summary"] = edit["new_summary"]
                if "new_desc" in edit:
                    edited_event["desc"] = edit["new_desc"]
                edited_events.append(edited_event)
            else:
                # Оставляем событие без изменений
                edited_events.append(event)
        else:
            # Оставляем событие без изменений
            edited_events.append(event)

    # Добавляем новые события
    for date_str, date_edits in stream_edits.items():
        for event_key, edit in date_edits.items():
            if edit.get("new", False) and "start_time" in edit:
                # Это новое событие
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

# === ПАРСИНГ ICS ИЗ GitHub ===
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

        # Разбиваем на события
        event_blocks = data.split('BEGIN:VEVENT')

        for block in event_blocks:
            if 'END:VEVENT' not in block:
                continue

            try:
                # Извлекаем данные из блока события
                summary_match = re.search(r'SUMMARY:(.+?)(?:\n|$)', block)
                dtstart_match = re.search(r'DTSTART(?:;VALUE=DATE-TIME)?(?:;TZID=Europe/Moscow)?:(\d{8}T\d{6})', block)
                dtend_match = re.search(r'DTEND(?:;VALUE=DATE-TIME)?(?:;TZID=Europe/Moscow)?:(\d{8}T\d{6})', block)
                description_match = re.search(r'DESCRIPTION:(.+?)(?:\n|$)', block, re.DOTALL)

                if not all([summary_match, dtstart_match, dtend_match]):
                    continue

                original_summary = summary_match.group(1).strip()
                # Применяем переименование если есть
                summary = get_display_subject_name(course, stream, original_summary)

                start_str = dtstart_match.group(1)
                end_str = dtend_match.group(1)
                description = description_match.group(1).strip() if description_match else ""

                # Парсим даты
                start_dt = datetime.datetime.strptime(start_str, '%Y%m%dT%H%M%S')
                end_dt = datetime.datetime.strptime(end_str, '%Y%m%dT%H%M%S')

                # Локализуем в московское время
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

# Получение уникальных предметов из расписания
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

    # Проверяем наличие ключевых слов в описании или названии
    desc_online = any(keyword in desc for keyword in online_keywords)
    summary_online = any(keyword in summary for keyword in online_keywords)

    # Теперь только если явно указано, что онлайн - возвращаем True
    # По умолчанию все оффлайн
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

    # Улучшенный парсинг преподавателя
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

    # Улучшенный парсинг аудитории
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

    # Если аудитория не найдена стандартными способами, ищем ИНИОН
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

    # Если преподаватель не найден стандартными способами, ищем в описании
    if not teacher:
        # Ищем ФИО преподавателя (три слова с заглавными буквами)
        name_pattern = r"([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)"
        name_match = re.search(name_pattern, desc)
        if name_match:
            teacher = name_match.group(1).strip()

    # ИКОНКА НОУТБУКА ТОЛЬКО ЕСЛИ ЯВНО УКАЗАНО, ЧТО ОНЛАЙН
    online_marker = " 💻" if is_online_class(ev) else ""

    line = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')} {ev['summary']}{online_marker}"

    # Добавляем информацию о преподавателе и аудитории
    if teacher or room:
        line += "\n"
        if teacher:
            line += f"  👤 {teacher}"
        if room:
            if teacher:
                line += " | "
            line += f"  🏫 {room}"

    # Добавляем домашнее задание если есть
    date_str = ev['start'].date().isoformat()
    hw_key = f"{ev['original_summary']}|{date_str}"
    homeworks = load_homeworks(course, stream)

    if hw_key in homeworks:
        line += f"\n   📝 ДЗ: {homeworks[hw_key]}"
    return line

def events_for_day(events, date, english_time=None):
    day_events = [e for e in events if e["start"].date() == date]

    # Добавляем английский язык в четверг в выбранное время
    if date.weekday() == 3 and english_time:  # 3 = четверг
        if english_time == "morning":
            start_time = TIMEZONE.localize(datetime.datetime.combine(date, datetime.time(9, 0)))
            end_time = TIMEZONE.localize(datetime.datetime.combine(date, datetime.time(12, 10)))
        else:  # afternoon
            start_time = TIMEZONE.localize(datetime.datetime.combine(date, datetime.time(14, 0)))
            end_time = TIMEZONE.localize(datetime.datetime.combine(date, datetime.time(17, 10)))

        # Проверяем, нет ли уже английского в расписании
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
    # Проверяем, есть ли в этот день только обеденные перерывы
    if has_only_lunch_break(events, date):
        return f"{date.strftime('%A, %d %B')} — занятий нет\n"

    evs = events_for_day(events, date, english_time)

    # Русские названия дней недели
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

    # Добавляем пометку "Завтра" если нужно
    prefix = "📅" if is_tomorrow else "📅"
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

    # Статистика по курсам и потокам
    course_stats = {}
    reminders_stats = {"enabled": 0, "disabled": 0}
    english_time_stats = {"morning": 0, "afternoon": 0, "none": 0}

    for user_id, settings in user_settings.items():
        # Статистика курсов и потоков
        course = settings.get('course')
        stream = settings.get('stream', '1')

        if course:
            if course not in course_stats:
                course_stats[course] = {}

            if stream not in course_stats[course]:
                course_stats[course][stream] = 0
            course_stats[course][stream] += 1

        # Статистика напоминаний
        if settings.get('reminders', False):
            reminders_stats["enabled"] += 1
        else:
            reminders_stats["disabled"] += 1

        # Статистика времени английского
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

        # Проверяем, 20:00 ли для напоминаний
        if now.hour == 20 and now.minute == 0:
            await send_homework_reminders()
            await asyncio.sleep(60)

        # Проверяем, 09:00 ли для обновлений
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
        # Для других курсов сразу переходим к выбору времени английского с потоком 1
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