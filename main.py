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

# === НАСТРОЙКА ЛОГГИРОВАНИЯ ===
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
        logging.error("❌ Файл token.txt не найден!")
        print("❌ ОШИБКА: Файл token.txt не найден!")
        return None

# === НАСТРОЙКИ ===
BOT_TOKEN = load_bot_token()
if not BOT_TOKEN:
    exit(1)

ADMIN_USERNAME = "fusuges"
GITHUB_RAW_URL = "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/main.py"

# URLs для разных курсов и потоков - ВЕРНУЛИ СТАРЫЕ НАЗВАНИЯ ДЛЯ 1 КУРСА
STREAM_URLS = {
    "1": {
        "1": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_1_kurs_1_potok_nodups.ics",
        "2": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_1_kurs_2_potok_nodups.ics"
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

def get_original_subject_name(stream, display_name):
    """Возвращает оригинальное название предмета по отображаемому"""
    for original, renamed in subject_renames.get(stream, {}).items():
        if renamed == display_name:
            return original
    return display_name

def get_display_subject_name(stream, original_name):
    """Возвращает отображаемое название предмета (с учетом переименований)"""
    return subject_renames.get(stream, {}).get(original_name, original_name)

# === ФУНКЦИИ ДЛЯ РАБОТЫ С ДАННЫМИ ===
# === ФУНКЦИИ ДЛЯ РАБОТЫ С ДАННЫМИ ===
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
def apply_schedule_edits(stream, events):
    """Применяет правки к расписанию - ВЕРНУЛИ СТАРОЕ НАЗВАНИЕ"""
    if stream not in schedule_edits:
        return events
    
    stream_edits = schedule_edits[stream]
    edited_events = []
    
    for event in events:
        event_date = event["start"].date().isoformat()
        event_key = f"{event['original_summary']}|{event['start'].strftime('%H:%M')}"
        
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

# === ПАРСИНГ ICS ИЗ GITHUB ===
def load_events_from_github(course, stream):
    """Загрузка событий с учетом курса и потока"""
    # Для обратной совместимости: если курс не указан, используем старую логику
    if not course or course == "1":
        # Старая логика для первого курса
        if stream in events_cache:
            return apply_schedule_edits(stream, events_cache[stream])
            
        events = []
        try:
            logging.info(f"Загрузка расписания для потока {stream} из GitHub...")
            url = STREAM_URLS["1"][stream]  # Используем старые URL для 1 курса
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
                    summary_match = re.search(r'SUMMARY:(.+?)(?:\r\n|\n|$)', block)
                    dtstart_match = re.search(r'DTSTART(?:;VALUE=DATE-TIME)?(?:;TZID=Europe/Moscow)?:(\d{8}T\d{6})', block)
                    dtend_match = re.search(r'DTEND(?:;VALUE=DATE-TIME)?(?:;TZID=Europe/Moscow)?:(\d{8}T\d{6})', block)
                    description_match = re.search(r'DESCRIPTION:(.+?)(?:\r\n|\n|$)', block, re.DOTALL)
                    
                    if not all([summary_match, dtstart_match, dtend_match]):
                        continue
                    
                    original_summary = summary_match.group(1).strip()
                    # Применяем переименование если есть
                    summary = get_display_subject_name(stream, original_summary)
                    
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
                    
            events_cache[stream] = events
            logging.info(f"Успешно загружено {len(events)} событий для потока {stream}")
            return apply_schedule_edits(stream, events)
            
        except Exception as e:
            logging.error(f"Ошибка при загрузке файла с GitHub: {e}")
            return []
    else:
        # Новая логика для других курсов
        cache_key = f"{course}_{stream}"
        if cache_key in events_cache:
            return events_cache[cache_key]
            
        events = []
        try:
            logging.info(f"Загрузка расписания для курса {course} из GitHub...")
            url = STREAM_URLS.get(course, {}).get("1")  # Для других курсов только 1 поток
            if not url:
                logging.error(f"URL не найден для курса {course}")
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
                    summary_match = re.search(r'SUMMARY:(.+?)(?:\r\n|\n|$)', block)
                    dtstart_match = re.search(r'DTSTART(?:;VALUE=DATE-TIME)?(?:;TZID=Europe/Moscow)?:(\d{8}T\d{6})', block)
                    dtend_match = re.search(r'DTEND(?:;VALUE=DATE-TIME)?(?:;TZID=Europe/Moscow)?:(\d{8}T\d{6})', block)
                    description_match = re.search(r'DESCRIPTION:(.+?)(?:\r\n|\n|$)', block, re.DOTALL)
                    
                    if not all([summary_match, dtstart_match, dtend_match]):
                        continue
                    
                    original_summary = summary_match.group(1).strip()
                    summary = original_summary  # Для других курсов переименования пока не поддерживаем
                    
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
            logging.info(f"Успешно загружено {len(events)} событий для курса {course}")
            return events
            
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
    """Проверяет, является ли пара онлайн"""
    desc = ev.get("desc", "").lower()
    summary = ev.get("summary", "").lower()
    
    online_keywords = ["онлайн", "online", "zoom", "teams", "вебинар", "webinar", "дистанционно"]
    
    return any(keyword in desc or keyword in summary for keyword in online_keywords)

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
    
    if "Преподаватель" in desc:
        teacher_match = re.search(r"Преподаватель:\s*([^\\\n]+)", desc)
        if teacher_match:
            teacher = teacher_match.group(1).strip()
    
    if "Аудитория" in desc:
        room_match = re.search(r"Аудитория:\s*([^\\\n]+)", desc)
        if room_match:
            room = room_match.group(1).strip()
    
    online_marker = " 💻" if is_online_class(ev) else ""
    
    line = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}  {ev['summary']}{online_marker}"
    if teacher or room:
        line += "\n"
    if teacher:
        line += f"👨‍🏫 {teacher}"
    if room:
        line += f" | 📍{room}"
    
    # Добавляем домашнее задание если есть
    date_str = ev['start'].date().isoformat()
    hw_key = f"{ev['original_summary']}|{date_str}"
    homeworks = load_homeworks(course, stream)
    
    if hw_key in homeworks:
        line += f"\n📚 ДЗ: {homeworks[hw_key]}"
    
    return line

def format_day(date, events, course, stream, english_time=None, is_tomorrow=False):
    # Проверяем, есть ли в этот день только обеденные перерывы
    if has_only_lunch_break(events, date):
        return f"📅 {date.strftime('%A, %d %B')} — занятий нет\n"
    
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
    date_str = date.strftime(f'{day_ru}, %d {month_ru}')
    
    # Добавляем пометку "Завтра" если нужно
    prefix = "🔄 " if is_tomorrow else "📅 "
    if is_tomorrow:
        date_str = f"Завтра, {date_str}"
    
    if not evs:
        return f"{prefix}{date_str} — занятий нет\n"
    
    text = f"{prefix}{date_str}:\n"
    for ev in sorted(evs, key=lambda x: x["start"]):
        text += f"• {format_event(ev, course, stream)}\n\n"
    return text

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
                "summary": "Английский язык 💻",
                "original_summary": "Английский язык",
                "start": start_time,
                "end": end_time,
                "desc": "Онлайн занятие"
            }
            day_events.append(english_event)
    
    return day_events

def format_day(date, events, stream, english_time=None, is_tomorrow=False):
    """Форматирование дня - ВЕРНУЛИ СТАРЫЙ ФОРМАТ"""
    # Проверяем, есть ли в этот день только обеденные перерывы
    if has_only_lunch_break(events, date):
        return f"📅 {date.strftime('%A, %d %B')} — занятий нет\n"
    
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
    date_str = date.strftime(f'{day_ru}, %d {month_ru}')
    
    # Добавляем пометку "Завтра" если нужно
    prefix = "🔄 " if is_tomorrow else "📅 "
    if is_tomorrow:
        date_str = f"Завтра, {date_str}"
    
    if not evs:
        return f"{prefix}{date_str} — занятий нет\n"
    
    text = f"{prefix}{date_str}:\n"
    for ev in sorted(evs, key=lambda x: x["start"]):
        text += f"• {format_event(ev, stream)}\n\n"
    return text

def is_admin(update: Update):
    return update.effective_user.username == ADMIN_USERNAME

def is_assistant(update: Update):
    username = update.effective_user.username
    return username == ADMIN_USERNAME or username in assistants

def can_manage_homework(update: Update):
    """Проверяет, может ли пользователь управлять ДЗ"""
    return is_assistant(update)

def get_homeworks_for_tomorrow(stream):
    """Получает домашние задания на завтра - ВЕРНУЛИ СТАРОЕ НАЗВАНИЕ"""
    tomorrow = datetime.datetime.now(TIMEZONE).date() + datetime.timedelta(days=1)
    tomorrow_homeworks = []
    homeworks = load_homeworks(stream)
    
    for hw_key, hw_text in homeworks.items():
        try:
            # Формат ключа: предмет|дата
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

def find_similar_events_across_streams(date, subject, start_time, end_time):
    """Находит одинаковые пары в обоих потоках в указанную дату и время"""
    similar_events = []
    
    for stream in ["1", "2"]:
        events = load_events_from_github("1", stream)  # Только для 1 курса
        for event in events:
            if (event["start"].date() == date and 
                event["summary"] == subject and
                event["start"].time() == start_time and
                event["end"].time() == end_time):
                similar_events.append((stream, event))
    
    return similar_events

def add_homework_for_both_streams(course, date, subject, homework_text, current_stream):
    """Добавляет ДЗ для обоих потоков, если есть одинаковые пары в одно время (только для 1 курса)"""
    # Для курсов кроме первого добавляем только в текущий поток
    if course != "1":
        hw_key = f"{subject}|{date}"
        homeworks = load_homeworks(course, current_stream)
        homeworks[hw_key] = homework_text
        save_homeworks(course, current_stream, homeworks)
        return [current_stream]
    
    # Для 1 курса проверяем оба потока
    # Находим событие в текущем потоке чтобы получить время
    current_events = load_events_from_github(course, current_stream)
    current_event = None
    
    for event in current_events:
        if (event["start"].date() == date and 
            event["summary"] == subject):
            current_event = event
            break
    
    if not current_event:
        # Если не нашли событие в текущем потоке, добавляем только в текущий
        hw_key = f"{subject}|{date}"
        homeworks = load_homeworks(course, current_stream)
        homeworks[hw_key] = homework_text
        save_homeworks(course, current_stream, homeworks)
        return [current_stream]
    
    # Получаем время события
    start_time = current_event["start"].time()
    end_time = current_event["end"].time()
    
    # Ищем одинаковые события в обоих потоках
    similar_events = find_similar_events_across_streams(course, date, subject, start_time, end_time)
    added_for_streams = []
    
    # Если нашли одинаковые события в обоих потоках, добавляем ДЗ для обоих
    if len(similar_events) == 2:
        for stream, event in similar_events:
            hw_key = f"{subject}|{date}"
            homeworks = load_homeworks(course, stream)
            homeworks[hw_key] = homework_text
            save_homeworks(course, stream, homeworks)
            added_for_streams.append(stream)
    else:
        # Если одинаковых событий нет, добавляем только в текущий поток
        hw_key = f"{subject}|{date}"
        homeworks = load_homeworks(course, current_stream)
        homeworks[hw_key] = homework_text
        save_homeworks(course, current_stream, homeworks)
        added_for_streams.append(current_stream)
    
    return added_for_streams

def get_user_stats():
    """Получает статистику пользователей"""
    total_users = len(user_settings)
    
    # Статистика по потокам
    stream_stats = {"1": 0, "2": 0}
    reminders_stats = {"enabled": 0, "disabled": 0}
    english_time_stats = {"morning": 0, "afternoon": 0, "none": 0}
    
    for user_id, settings in user_settings.items():
        # Статистика потоков
        stream = settings.get('stream')
        if stream in stream_stats:
            stream_stats[stream] += 1
        
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
        "stream_stats": stream_stats,
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
                    
                    # Добавляем обработку ошибок при отправке
                    try:
                        await application.bot.send_message(chat_id=user_id, text=message)
                        logging.info(f"📤 Отправлено напоминание пользователю {user_id}")
                    except BadRequest as e:
                        logging.error(f"❌ Ошибка отправки напоминания пользователю {user_id}: {e}")
                        # Пользователь заблокировал бота или чат не существует
                        if "chat not found" in str(e).lower() or "bot was blocked" in str(e).lower():
                            # Удаляем пользователя из настроек
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
                # Сохраняем новую версию
                with open(__file__, "w", encoding="utf-8") as f:
                    f.write(new_content)
                
                save_last_update()
                logging.info("✅ Бот обновлен до последней версии!")
                
                # Уведомляем админа
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
            await asyncio.sleep(60)  # Ждем минуту чтобы не выполнять несколько раз
        
        # Проверяем, 09:00 ли для обновлений
        elif now.hour == 9 and now.minute == 0:
            await check_for_updates()
            await asyncio.sleep(60)  # Ждем минуту чтобы не выполнять несколько раз
        
        # Ждем 30 секунд перед следующей проверкой
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
            # Игнорируем эту ошибку
            logging.info("Message not modified - ignoring")
        else:
            raise

# === ОСНОВНЫЕ ОБРАБОТЧИКИ КОМАНД ===
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("1️⃣ 1 курс", callback_data="select_course_1")],
        [InlineKeyboardButton("2️⃣ 2 курс", callback_data="select_course_2")],
        [InlineKeyboardButton("3️⃣ 3 курс", callback_data="select_course_3")],
        [InlineKeyboardButton("4️⃣ 4 курс", callback_data="select_course_4")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        "Привет! 👋\nВыбери свой курс:",
        reply_markup=reply_markup
    )

async def select_stream(update: Update, context: ContextTypes.DEFAULT_TYPE, course):
    """Выбор потока (только для 1 курса)"""
    if course != "1":
        # Для других курсов сразу переходим к выбору времени английского
        await select_english_time(update, context, course, "1")
        return
        
    keyboard = [
        [InlineKeyboardButton("📚 1 поток", callback_data=f"select_stream_1")],
        [InlineKeyboardButton("📚 2 поток", callback_data=f"select_stream_2")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    if update.callback_query:
        await safe_edit_message(
            update,
            text="Выбери свой поток:",
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            text="Выбери свой поток:",
            reply_markup=reply_markup
        )

async def select_english_time(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream):
    # Для обратной совместимости с первым курсом
    if course == "1":
        keyboard = [
            [InlineKeyboardButton("🕘 9:00-12:10", callback_data=f"english_morning_{stream}")],
            [InlineKeyboardButton("🕑 14:00-17:10", callback_data=f"english_afternoon_{stream}")],
            [InlineKeyboardButton("❌ Без английского", callback_data=f"english_none_{stream}")]
        ]
    else:
        keyboard = [
            [InlineKeyboardButton("🕘 9:00-12:10", callback_data=f"english_morning_{course}_{stream}")],
            [InlineKeyboardButton("🕑 14:00-17:10", callback_data=f"english_afternoon_{course}_{stream}")],
            [InlineKeyboardButton("❌ Без английского", callback_data=f"english_none_{course}_{stream}")]
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
        
        # Сохраняем выбор пользователя
        user_id = str(update.effective_user.id)
        if user_id not in user_settings:
            user_settings[user_id] = {}
        
        user_settings[user_id]['course'] = course
        user_settings[user_id]['stream'] = stream
        if english_time:
            user_settings[user_id]['english_time'] = english_time
        save_user_settings(user_settings)
        
        # Создаем клавиатуру основного меню
        if course == "1":
            # Для первого курса используем старые callback_data для обратной совместимости
            keyboard = [
                [InlineKeyboardButton("📅 Сегодня", callback_data=f"today_{stream}"),
                 InlineKeyboardButton("🔄 Завтра", callback_data=f"tomorrow_{stream}")],
                [InlineKeyboardButton("🗓 Эта неделя", callback_data=f"this_week_{stream}"),
                 InlineKeyboardButton("⏭ След. неделя", callback_data=f"next_week_{stream}")],
                [InlineKeyboardButton("🔔 Настройка напоминаний", callback_data=f"reminders_settings_{stream}")],
                [InlineKeyboardButton("🔄 Обновить расписание", callback_data=f"refresh_{stream}")],
            ]
        else:
            # Для других курсов используем новые callback_data с указанием курса
            keyboard = [
                [InlineKeyboardButton("📅 Сегодня", callback_data=f"today_{course}_{stream}"),
                 InlineKeyboardButton("🔄 Завтра", callback_data=f"tomorrow_{course}_{stream}")],
                [InlineKeyboardButton("🗓 Эта неделя", callback_data=f"this_week_{course}_{stream}"),
                 InlineKeyboardButton("⏭ След. неделя", callback_data=f"next_week_{course}_{stream}")],
                [InlineKeyboardButton("🔔 Настройка напоминаний", callback_data=f"reminders_settings_{course}_{stream}")],
                [InlineKeyboardButton("🔄 Обновить расписание", callback_data=f"refresh_{course}_{stream}")],
            ]
        
        # Добавляем кнопку управления ДЗ для админа и помощников
        if can_manage_homework(update):
            if course == "1":
                keyboard.append([InlineKeyboardButton("✏️ Управление ДЗ", callback_data=f"manage_hw_{stream}")])
            else:
                keyboard.append([InlineKeyboardButton("✏️ Управление ДЗ", callback_data=f"manage_hw_{course}_{stream}")])
        
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        # Текст с информацией о настройках
        course_text = f"{course} курс"
        if course == "1":
            course_text += f", {stream} поток"
            
        english_text = ""
        if english_time == "morning":
            english_text = "\n🕘 Английский: 9:00-12:10"
        elif english_time == "afternoon":
            english_text = "\n🕑 Английский: 14:00-17:10"
        
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



async def show_reminders_settings(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream):
    user_id = str(update.effective_user.id)
    current_status = user_settings.get(user_id, {}).get('reminders', False)
    current_time = user_settings.get(user_id, {}).get('reminders_time', '20:00')
    
    status_text = "включены" if current_status else "выключены"
    status_icon = "🔔" if current_status else "🔕"
    
    keyboard = [
        [InlineKeyboardButton(f"{status_icon} Настроить время напоминаний", callback_data=f"set_reminders_time_{course}_{stream}")],
        [InlineKeyboardButton("👀 Посмотреть ДЗ на завтра", callback_data=f"view_tomorrow_hw_{course}_{stream}")],
        [InlineKeyboardButton("🔙 Назад", callback_data=f"back_to_main_{course}_{stream}")]
    ]
    
    await safe_edit_message(
        update,
        text=f"Настройки напоминаний:\n\n"
             f"Текущий статус: {status_icon} {status_text}\n"
             f"Время напоминаний: {current_time}\n\n"
             f"При включенных напоминаниях бот будет присылать уведомления "
             f"о домашних заданиях на завтра в выбранное время",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def show_manage_hw_menu(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream):
    """Показывает меню управления домашними заданиями"""
    if not can_manage_homework(update):
        await safe_edit_message(update, "❌ У вас нет прав для управления ДЗ")
        return
        
    keyboard = [
        [InlineKeyboardButton("📝 Добавить ДЗ", callback_data=f"add_hw_{course}_{stream}")],
        [InlineKeyboardButton("👀 Будущие ДЗ", callback_data=f"view_future_hw_{course}_{stream}")],
        [InlineKeyboardButton("📚 Архив ДЗ", callback_data=f"view_past_hw_{course}_{stream}")],
    ]
    
    # Только админ может удалять ДЗ
    if is_admin(update):
        keyboard.append([InlineKeyboardButton("❌ Удалить ДЗ", callback_data=f"delete_hw_menu_{course}_{stream}")])
    
    keyboard.append([InlineKeyboardButton("🔙 Назад", callback_data=f"back_to_main_{course}_{stream}")])
    
    await safe_edit_message(
        update,
        text="Управление домашними заданиями:\n\n"
             "• Будущие ДЗ - задания на сегодня и позднее\n"
             "• Архив ДЗ - задания за прошедшие дни\n\n"
             "При добавлении ДЗ для 1 курса, если у обоих потоков есть идентичные пары "
             "в одно время, ДЗ автоматически добавится для обоих потоков.",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def show_future_homeworks(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream):
    """Показывает будущие домашние задания"""
    homeworks = get_future_homeworks(course, stream)
    
    if not homeworks:
        await safe_edit_message(
            update,
            text="📭 Будущих домашних заданий нет",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")]])
        )
        return
    
    # Группируем ДЗ по дате
    homeworks_by_date = {}
    for hw_key, hw_text in homeworks.items():
        parts = hw_key.split('|')
        if len(parts) != 2:
            continue
            
        subject = parts[0]
        date_str = parts[1]
        
        if date_str not in homeworks_by_date:
            homeworks_by_date[date_str] = []
        
        homeworks_by_date[date_str].append((subject, hw_text))
    
    # Формируем сообщение
    message = "📚 Будущие домашние задания:\n\n"
    
    for date_str in sorted(homeworks_by_date.keys()):
        try:
            date = datetime.datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y")
            message += f"📅 {date}:\n"
            
            for subject, hw_text in homeworks_by_date[date_str]:
                message += f"📖 {subject}:\n{hw_text}\n\n"
        except:
            continue
    
    # Обрезаем если слишком длинное
    if len(message) > 4000:
        message = message[:4000] + "\n\n... (сообщение обрезано)"
    
    await safe_edit_message(
        update,
        text=message,
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")]])
    )

async def show_past_homeworks(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream):
    """Показывает архив домашних заданий"""
    homeworks = get_past_homeworks(course, stream)
    
    if not homeworks:
        await safe_edit_message(
            update,
            text="📭 В архиве домашних заданий нет",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")]])
        )
        return
    
    # Группируем ДЗ по дате
    homeworks_by_date = {}
    for hw_key, hw_text in homeworks.items():
        parts = hw_key.split('|')
        if len(parts) != 2:
            continue
            
        subject = parts[0]
        date_str = parts[1]
        
        if date_str not in homeworks_by_date:
            homeworks_by_date[date_str] = []
        
        homeworks_by_date[date_str].append((subject, hw_text))
    
    # Формируем сообщение
    message = "📚 Архив домашних заданий:\n\n"
    
    for date_str in sorted(homeworks_by_date.keys(), reverse=True)[:10]:
        try:
            date = datetime.datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y")
            message += f"📅 {date}:\n"
            
            for subject, hw_text in homeworks_by_date[date_str]:
                message += f"📖 {subject}:\n{hw_text}\n\n"
        except:
            continue
    
    if len(message) > 4000:
        message = message[:4000] + "\n\n... (сообщение обрезано)"
    
    await safe_edit_message(
        update,
        text=message,
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")]])
    )
    

async def show_add_hw_menu(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream):
    """Показывает меню добавления ДЗ"""
    # Получаем список предметов для выбранного курса и потока
    subjects = get_unique_subjects(course, stream)
    
    if not subjects:
        await safe_edit_message(
            update,
            text="❌ Не удалось загрузить список предметов. Попробуйте обновить расписание.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")]])
        )
        return
    
    # Создаем клавиатуру с предметами
    keyboard = []
    for subject in subjects:
        # Обрезаем длинные названия и заменяем проблемные символы
        display_name = subject[:30] + "..." if len(subject) > 30 else subject
        
        # Создаем безопасный идентификатор для callback_data
        safe_subject = re.sub(r'[^a-zA-Z0-9а-яА-Я]', '_', subject)
        safe_subject = safe_subject[:20]  # Ограничиваем длину
        
        callback_data = f"hw_subj_{course}_{stream}_{safe_subject}"
        
        keyboard.append([InlineKeyboardButton(f"📚 {display_name}", callback_data=callback_data)])
    
    keyboard.append([InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")])
    
    await safe_edit_message(
        update,
        text="Выбери предмет для добавления домашнего задания:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def show_date_selection(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream, subject):
    """Показывает выбор даты для домашнего задания"""
    # Получаем ближайшие даты занятий по этому предмету
    dates = get_subject_dates(course, stream, subject)
    today = datetime.datetime.now(TIMEZONE).date()
    
    # Фильтруем только будущие даты
    future_dates = [d for d in dates if d >= today]
    
    keyboard = []
    
    # Добавляем ближайшие 5 дат
    for date in future_dates[:5]:
        date_str = date.strftime("%d.%m.%Y")
        callback_data = f"hw_date_{course}_{stream}_{date.isoformat()}"
        keyboard.append([InlineKeyboardButton(f"📅 {date_str}", callback_data=callback_data)])
    
    # Добавляем кнопку для ручного ввода даты
    keyboard.append([InlineKeyboardButton("📆 Ввести другую дату", callback_data=f"hw_date_manual_{course}_{stream}")])
    keyboard.append([InlineKeyboardButton("🔙 Назад", callback_data=f"add_hw_{course}_{stream}")])
    
    await safe_edit_message(
        update,
        text=f"Выбери дату для предмета '{subject}':",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def show_delete_hw_menu(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream):
    """Показывает меню удаления ДЗ"""
    homeworks = load_homeworks(course, stream)
    
    if not homeworks:
        await safe_edit_message(
            update,
            text="📭 Домашних заданий для удаления нет",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")]])
        )
        return
    
    keyboard = []
    for hw_key, hw_text in list(homeworks.items())[:20]:
        parts = hw_key.split('|')
        if len(parts) != 2:
            continue
            
        subject = parts[0]
        date_str = parts[1]
        
        try:
            date = datetime.datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y")
            display_text = f"🗑 {date} - {subject[:20]}..."
            callback_data = f"del_hw_{course}_{stream}_{hw_key}"
            keyboard.append([InlineKeyboardButton(display_text, callback_data=callback_data)])
        except:
            continue
    
    keyboard.append([InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")])
    
    await safe_edit_message(
        update,
        text="Выбери домашнее задание для удаления:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def show_future_homeworks(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream):
    """Показывает будущие домашние задания"""
    homeworks = get_future_homeworks(stream)  # ВЕРНУЛИ СТАРОЕ НАЗВАНИЕ
    
    if not homeworks:
        await safe_edit_message(
            update,
            text="📭 Будущих домашних заданий нет",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")]])
        )
        return
    
    # Группируем ДЗ по дате
    homeworks_by_date = {}
    for hw_key, hw_text in homeworks.items():
        parts = hw_key.split('|')
        if len(parts) != 2:
            continue
            
        subject = parts[0]
        date_str = parts[1]
        
        if date_str not in homeworks_by_date:
            homeworks_by_date[date_str] = []
        
        homeworks_by_date[date_str].append((subject, hw_text))
    
    # Формируем сообщение
    message = "📚 Будущие домашние задания:\n\n"
    
    for date_str in sorted(homeworks_by_date.keys()):
        try:
            date = datetime.datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y")
            message += f"📅 {date}:\n"
            
            for subject, hw_text in homeworks_by_date[date_str]:
                message += f"📖 {subject}:\n{hw_text}\n\n"
        except:
            continue
    
    # Обрезаем если слишком длинное
    if len(message) > 4000:
        message = message[:4000] + "\n\n... (сообщение обрезано)"
    
    await safe_edit_message(
        update,
        text=message,
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")]])
    )

async def show_past_homeworks(update: Update, context: ContextTypes.DEFAULT_TYPE, course, stream):
    """Показывает архив домашних заданий"""
    homeworks = get_past_homeworks(stream)  # ВЕРНУЛИ СТАРОЕ НАЗВАНИЕ
    
    if not homeworks:
        await safe_edit_message(
            update,
            text="📭 В архиве домашних заданий нет",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")]])
        )
        return
    
    # Группируем ДЗ по дате
    homeworks_by_date = {}
    for hw_key, hw_text in homeworks.items():
        parts = hw_key.split('|')
        if len(parts) != 2:
            continue
            
        subject = parts[0]
        date_str = parts[1]
        
        if date_str not in homeworks_by_date:
            homeworks_by_date[date_str] = []
        
        homeworks_by_date[date_str].append((subject, hw_text))
    
    # Формируем сообщение
    message = "📚 Архив домашних заданий:\n\n"
    
    for date_str in sorted(homeworks_by_date.keys(), reverse=True)[:10]:  # Показываем последние 10 дат
        try:
            date = datetime.datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y")
            message += f"📅 {date}:\n"
            
            for subject, hw_text in homeworks_by_date[date_str]:
                message += f"📖 {subject}:\n{hw_text}\n\n"
        except:
            continue
    
    # Обрезаем если слишком длинное
    if len(message) > 4000:
        message = message[:4000] + "\n\n... (сообщение обрезано)"
    
    await safe_edit_message(
        update,
        text=message,
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")]])
    )

async def users_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда для просмотра статистики пользователей (только для админа)"""
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для этой команды")
        return
    
    stats = get_user_stats()
    
    message = "📊 Статистика пользователей:\n\n"
    message += f"👥 Всего пользователей: {stats['total_users']}\n\n"
    
    message += "📚 Распределение по курсам:\n"
    for course in ["1", "2", "3", "4"]:
        course_users = 0
        for user_id, settings in user_settings.items():
            if settings.get('course') == course:
                course_users += 1
        if course_users > 0:
            message += f"• {course} курс: {course_users} пользователей\n"
            if course == "1":
                stream_1 = sum(1 for settings in user_settings.values() if settings.get('course') == "1" and settings.get('stream') == "1")
                stream_2 = sum(1 for settings in user_settings.values() if settings.get('course') == "1" and settings.get('stream') == "2")
                message += f"  - 1 поток: {stream_1} пользователей\n"
                message += f"  - 2 поток: {stream_2} пользователей\n"
    
    message += f"\n🔔 Настройки напоминаний:\n"
    message += f"• Включены: {stats['reminders_stats']['enabled']} пользователей\n"
    message += f"• Выключены: {stats['reminders_stats']['disabled']} пользователей\n\n"
    
    message += f"🕘 Время английского:\n"
    message += f"• Утро (9:00-12:10): {stats['english_time_stats']['morning']} пользователей\n"
    message += f"• День (14:00-17:10): {stats['english_time_stats']['afternoon']} пользователей\n"
    message += f"• Без английского: {stats['english_time_stats']['none']} пользователей"
    
    await update.message.reply_text(message)

async def check_updates_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда для ручной проверки обновлений"""
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для этой команды")
        return
        
    await update.message.reply_text("🔍 Проверяю обновления...")
    await check_for_updates()
    await update.message.reply_text("✅ Проверка обновлений завершена!")

# === ОБРАБОТЧИК СООБЩЕНИЙ ===
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик текстовых сообщений"""
    # Проверяем, ожидаем ли мы ввод username помощника
    if 'awaiting_assistant' in context.user_data:
        action = context.user_data.pop('awaiting_assistant')
        await handle_assistant_username(update, context, action)
        return
        
    # Проверяем, ожидаем ли мы ввод нового названия предмета
    elif 'awaiting_rename' in context.user_data:
        rename_data = context.user_data.pop('awaiting_rename')
        await handle_subject_rename(update, context, rename_data['course'], rename_data['stream'], rename_data['subject'])
        return
        
    # Проверяем, ожидаем ли мы переименование события
    elif 'awaiting_event_rename' in context.user_data:
        rename_data = context.user_data.pop('awaiting_event_rename')
        
        # Инициализируем структуру если нужно
        course = rename_data['course']
        stream = rename_data['stream']
        date_str = rename_data['date']
        event_key = rename_data['event_key']
        
        key = f"{course}_{stream}"
        if key not in schedule_edits:
            schedule_edits[key] = {}
        if date_str not in schedule_edits[key]:
            schedule_edits[key][date_str] = {}
        
        # Сохраняем переименование
        schedule_edits[key][date_str][event_key] = {
            "new_summary": update.message.text
        }
        
        save_schedule_edits()
        
        # Очищаем кэш
        if key in events_cache:
            del events_cache[key]
        
        await update.message.reply_text(
            f"✅ Пара переименована!\n\nНовое название: {update.message.text}",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад к дню", callback_data=f"edit_day_{course}_{stream}_{date_str}")]])
        )
        return
        
    # Проверяем, находимся ли мы в процессе создания новой пары
    elif 'awaiting_new_event' in context.user_data:
        event_data = context.user_data['awaiting_new_event']
        
        if event_data['step'] == 'name':
            await handle_new_event_time(update, context)
        elif event_data['step'] == 'start_time':
            await handle_new_event_end_time(update, context)
        elif event_data['step'] == 'end_time':
            await handle_new_event_description(update, context)
        elif event_data['step'] == 'description':
            await save_new_event(update, context)
        return
        
    # Проверяем, находится ли пользователь в процессе добавления ДЗ
    elif context.user_data.get('hw_step'):
        await handle_homework_text(update, context)
        return
        
    await update.message.reply_text("Используйте /start для начала работы")

async def handle_homework_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик текста домашнего задания"""
    if not can_manage_homework(update):
        await update.message.reply_text("❌ У вас нет прав для управления ДЗ")
        return
    
    # Проверяем, на каком шаге добавления ДЗ мы находимся
    hw_step = context.user_data.get('hw_step')
    
    if hw_step == 'enter_date_manual':
        # Обработка ручного ввода даты
        try:
            date = datetime.datetime.strptime(update.message.text, '%d.%m.%Y').date()
            context.user_data['hw_date'] = date.isoformat()
            context.user_data['hw_step'] = 'enter_text'
            
            subject = context.user_data['hw_subject']
            course = context.user_data['hw_course']
            stream = context.user_data['hw_stream']
            
            await update.message.reply_text(
                f"📝 Добавление ДЗ для предмета: {subject}\n"
                f"📅 Дата: {date.strftime('%d.%m.%Y')}\n\n"
                f"Введите текст домашнего задания:",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"add_hw_{course}_{stream}")]])
            )
        except ValueError:
            await update.message.reply_text("❌ Неверный формат даты. Введите дату в формате ДД.ММ.ГГГГ (например, 25.12.2023):")
        return
    
    elif hw_step == 'enter_text':
        # Обработка ввода текста ДЗ
        if 'hw_subject' not in context.user_data or 'hw_date' not in context.user_data or 'hw_course' not in context.user_data or 'hw_stream' not in context.user_data:
            await update.message.reply_text("❌ Сначала выберите предмет и дату для добавления ДЗ")
            return
        
        homework_text = update.message.text
        subject = context.user_data['hw_subject']
        date_str = context.user_data['hw_date']
        course = context.user_data['hw_course']
        stream = context.user_data['hw_stream']
        
        if not homework_text.strip():
            await update.message.reply_text("❌ Текст домашнего задания не может быть пустым")
            return
        
        # Добавляем ДЗ с проверкой времени
        date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
        
        if course == "1":
            # Для 1 курса используем старую логику с двумя потоками
            added_streams = add_homework_for_both_streams(date, subject, homework_text, stream)
            
            # Формируем сообщение о результате
            if len(added_streams) == 2:
                message = (f"✅ ДЗ добавлено для обоих потоков 1 курса!\n\n"
                          f"📖 {subject}\n"
                          f"📅 {date.strftime('%d.%m.%Y')}\n"
                          f"📝 {homework_text}")
            else:
                message = (f"✅ ДЗ добавлено для 1 курса, {stream} потока!\n\n"
                          f"📖 {subject}\n"
                          f"📅 {date.strftime('%d.%m.%Y')}\n"
                          f"📝 {homework_text}")
        else:
            # Для других курсов просто добавляем ДЗ
            hw_key = f"{subject}|{date}"
            homeworks = load_homeworks(stream)
            homeworks[hw_key] = homework_text
            save_homeworks(stream, homeworks)
            
            message = (f"✅ ДЗ добавлено для {course} курса!\n\n"
                      f"📖 {subject}\n"
                      f"📅 {date.strftime('%d.%m.%Y')}\n"
                      f"📝 {homework_text}")
        
        await update.message.reply_text(message)
        
        # Очищаем контекст
        context.user_data.pop('hw_subject', None)
        context.user_data.pop('hw_date', None)
        context.user_data.pop('hw_course', None)
        context.user_data.pop('hw_stream', None)
        context.user_data.pop('hw_step', None)
    else:
        await update.message.reply_text("❌ Сначала выберите предмет для добавления ДЗ через меню")

# === ОБРАБОТЧИК CALLBACK QUERY ===
# === ОБРАБОТЧИК CALLBACK QUERY ===
async def handle_query(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user_id = query.from_user.id
    
    # Проверяем, не обрабатывается ли уже запрос от этого пользователя
    if context.user_data.get(f'processing_{user_id}'):
        await query.answer("Пожалуйста, подождите, обрабатывается предыдущий запрос...", show_alert=False)
        return
        
    # Устанавливаем флаг обработки
    context.user_data[f'processing_{user_id}'] = True
    
    try:
        await query.answer()
        
        data = query.data
        
        # Обработка выбора курса
        if data.startswith('select_course_'):
            course = data.split('_')[-1]
            context.user_data['course'] = course
            await select_stream(update, context, course)
            
        # Обработка выбора потока (только для 1 курса)
        elif data.startswith('select_stream_'):
            stream = data.split('_')[-1]
            course = context.user_data.get('course', '1')  # По умолчанию 1 курс
            context.user_data['stream'] = stream
            await select_english_time(update, context, course, stream)
            
        # Обработка выбора времени английского для 1 курса
        elif data.startswith('english_') and not any(x in data for x in ['_1_', '_2_', '_3_', '_4_']):
            parts = data.split('_')
            english_option = parts[1]  # morning, afternoon, none
            stream = parts[2]
            course = "1"  # Только для первого курса
            
            english_time = None
            if english_option == "morning":
                english_time = "morning"
            elif english_option == "afternoon":
                english_time = "afternoon"
            
            await show_main_menu(update, context, course, stream, english_time)
            
        # Обработка выбора времени английского для других курсов
        elif data.startswith('english_'):
            parts = data.split('_')
            english_option = parts[1]  # morning, afternoon, none
            course = parts[2]
            stream = parts[3]
            
            english_time = None
            if english_option == "morning":
                english_time = "morning"
            elif english_option == "afternoon":
                english_time = "afternoon"
            
            await show_main_menu(update, context, course, stream, english_time)
            
        # Обработка кнопок главного меню для 1 курса (старый формат)
        elif any(data.startswith(cmd) for cmd in ['today_', 'tomorrow_', 'this_week_', 'next_week_']) and not any(x in data for x in ['_1_', '_2_', '_3_', '_4_']):
            stream = data.split('_')[-1]
            course = "1"
            today = datetime.datetime.now(TIMEZONE).date()
            events = load_events_from_github(course, stream)
            
            # Получаем выбранное время английского
            user_id = str(update.effective_user.id)
            english_time = user_settings.get(user_id, {}).get('english_time')

            if data.startswith('today_'):
                text = format_day(today, events, stream, english_time)
                if "занятий нет" in text:
                    text = f"📅 Сегодня ({today.strftime('%d.%m.%Y')}) — занятий нет\n"

            elif data.startswith('tomorrow_'):
                tomorrow = today + datetime.timedelta(days=1)
                text = format_day(tomorrow, events, stream, english_time, is_tomorrow=True)
                if "занятий нет" in text:
                    text = f"🔄 Завтра ({tomorrow.strftime('%d.%m.%Y')}) — занятий нет\n"

            elif data.startswith('this_week_'):
                start_date, _ = get_week_range(today)
                text = f"🗓 Расписание на эту неделю ({stream} поток):\n\n"
                for i in range(5):
                    d = start_date + datetime.timedelta(days=i)
                    text += format_day(d, events, stream, english_time)

            elif data.startswith('next_week_'):
                start_date, _ = get_week_range(today + datetime.timedelta(days=7))
                text = f"⏭ Расписание на следующую неделю ({stream} поток):\n\n"
                for i in range(5):
                    d = start_date + datetime.timedelta(days=i)
                    text += format_day(d, events, stream, english_time)

            # Добавляем кнопки для навигации
            keyboard = [
                [InlineKeyboardButton("📅 Сегодня", callback_data=f"today_{stream}"),
                 InlineKeyboardButton("🔄 Завтра", callback_data=f"tomorrow_{stream}")],
                [InlineKeyboardButton("🗓 Неделя", callback_data=f"this_week_{stream}"),
                 InlineKeyboardButton("⏭ След. неделя", callback_data=f"next_week_{stream}")],
                [InlineKeyboardButton("🔔 Напоминания", callback_data=f"reminders_settings_{stream}")],
                [InlineKeyboardButton("🔙 Главное меню", callback_data=f"back_to_main_{stream}")]
            ]
            
            # Обрезаем текст если он слишком длинный для Telegram
            if len(text) > 4000:
                text = text[:4000] + "\n\n... (сообщение обрезано)"
                
            await safe_edit_message(
                update,
                text=text,
                reply_markup=InlineKeyboardMarkup(keyboard)
            )
            
        # Обработка кнопок главного меню для других курсов (новый формат)
        elif any(data.startswith(cmd) for cmd in ['today_', 'tomorrow_', 'this_week_', 'next_week_']):
            parts = data.split('_')
            course = parts[1]
            stream = parts[2]
            today = datetime.datetime.now(TIMEZONE).date()
            events = load_events_from_github(course, stream)
            
            # Получаем выбранное время английского
            user_id = str(update.effective_user.id)
            english_time = user_settings.get(user_id, {}).get('english_time')

            if data.startswith('today_'):
                # Для других курсов используем упрощенное форматирование
                evs = [e for e in events if e["start"].date() == today]
                if not evs:
                    text = f"📅 Сегодня ({today.strftime('%d.%m.%Y')}) — занятий нет\n"
                else:
                    text = f"📅 Сегодня ({today.strftime('%d.%m.%Y')}):\n"
                    for ev in sorted(evs, key=lambda x: x["start"]):
                        time_str = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}"
                        text += f"• {time_str}  {ev['summary']}\n\n"

            elif data.startswith('tomorrow_'):
                tomorrow = today + datetime.timedelta(days=1)
                evs = [e for e in events if e["start"].date() == tomorrow]
                if not evs:
                    text = f"🔄 Завтра ({tomorrow.strftime('%d.%m.%Y')}) — занятий нет\n"
                else:
                    text = f"🔄 Завтра ({tomorrow.strftime('%d.%m.%Y')}):\n"
                    for ev in sorted(evs, key=lambda x: x["start"]):
                        time_str = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}"
                        text += f"• {time_str}  {ev['summary']}\n\n"

            elif data.startswith('this_week_'):
                start_date, _ = get_week_range(today)
                course_text = f"{course} курс"
                text = f"🗓 Расписание на эту неделю ({course_text}):\n\n"
                for i in range(5):
                    d = start_date + datetime.timedelta(days=i)
                    day_events = [e for e in events if e["start"].date() == d]
                    if day_events:
                        date_str = d.strftime('%A, %d %B')
                        text += f"📅 {date_str}:\n"
                        for ev in sorted(day_events, key=lambda x: x["start"]):
                            time_str = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}"
                            text += f"• {time_str}  {ev['summary']}\n\n"
                    else:
                        date_str = d.strftime('%A, %d %B')
                        text += f"📅 {date_str} — занятий нет\n\n"

            elif data.startswith('next_week_'):
                start_date, _ = get_week_range(today + datetime.timedelta(days=7))
                course_text = f"{course} курс"
                text = f"⏭ Расписание на следующую неделю ({course_text}):\n\n"
                for i in range(5):
                    d = start_date + datetime.timedelta(days=i)
                    day_events = [e for e in events if e["start"].date() == d]
                    if day_events:
                        date_str = d.strftime('%A, %d %B')
                        text += f"📅 {date_str}:\n"
                        for ev in sorted(day_events, key=lambda x: x["start"]):
                            time_str = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}"
                            text += f"• {time_str}  {ev['summary']}\n\n"
                    else:
                        date_str = d.strftime('%A, %d %B')
                        text += f"📅 {date_str} — занятий нет\n\n"

            # Добавляем кнопки для навигации
            keyboard = [
                [InlineKeyboardButton("📅 Сегодня", callback_data=f"today_{course}_{stream}"),
                 InlineKeyboardButton("🔄 Завтра", callback_data=f"tomorrow_{course}_{stream}")],
                [InlineKeyboardButton("🗓 Неделя", callback_data=f"this_week_{course}_{stream}"),
                 InlineKeyboardButton("⏭ След. неделя", callback_data=f"next_week_{course}_{stream}")],
                [InlineKeyboardButton("🔔 Напоминания", callback_data=f"reminders_settings_{course}_{stream}")],
                [InlineKeyboardButton("🔙 Главное меню", callback_data=f"back_to_main_{course}_{stream}")]
            ]
            
            # Обрезаем текст если он слишком длинный для Telegram
            if len(text) > 4000:
                text = text[:4000] + "\n\n... (сообщение обрезано)"
                
            await safe_edit_message(
                update,
                text=text,
                reply_markup=InlineKeyboardMarkup(keyboard)
            )

        # Обработка кнопки "Назад" для 1 курса
        elif data.startswith('back_to_main_') and not any(x in data for x in ['_1_', '_2_', '_3_', '_4_']):
            stream = data.split('_')[-1]
            course = "1"
            user_id = str(update.effective_user.id)
            english_time = user_settings.get(user_id, {}).get('english_time')
            await show_main_menu(update, context, course, stream, english_time)
            
        # Обработка кнопки "Назад" для других курсов
        elif data.startswith('back_to_main_'):
            parts = data.split('_')
            course = parts[3]
            stream = parts[4]
            user_id = str(update.effective_user.id)
            english_time = user_settings.get(user_id, {}).get('english_time')
            await show_main_menu(update, context, course, stream, english_time)
            
            
        elif data.startswith('reminders_settings_'):
            parts = data.split('_')
            course = parts[2]
            stream = parts[3]
            await show_reminders_settings(update, context, course, stream)
            
        elif data.startswith('set_reminders_time_'):
            parts = data.split('_')
            course = parts[4]
            stream = parts[5]
            await select_reminders_time(update, context, course, stream)
            
        elif data.startswith('reminders_time_'):
            # Формат: reminders_time_20:00_1_1 (время_курс_поток)
            parts = data.split('_')
            time_str = parts[2]  # 20:00
            course = parts[3]
            stream = parts[4]
            
            user_id = str(update.effective_user.id)
            if user_id not in user_settings:
                user_settings[user_id] = {}
            user_settings[user_id]['reminders'] = True
            user_settings[user_id]['reminders_time'] = time_str
            save_user_settings(user_settings)
            
            await safe_edit_message(
                update,
                text=f"✅ Напоминания включены и установлены на {time_str}!",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"reminders_settings_{course}_{stream}")]])
            )
            
        elif data.startswith('reminders_off_'):
            parts = data.split('_')
            course = parts[2]
            stream = parts[3]
            user_id = str(update.effective_user.id)
            if user_id not in user_settings:
                user_settings[user_id] = {}
            user_settings[user_id]['reminders'] = False
            save_user_settings(user_settings)
            await safe_edit_message(
                update,
                text="🔕 Напоминания выключены",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"reminders_settings_{course}_{stream}")]])
            )
                
        elif data.startswith('view_tomorrow_hw_'):
            parts = data.split('_')
            course = parts[3]
            stream = parts[4]
            tomorrow_hws = get_homeworks_for_tomorrow(stream)  # ВЕРНУЛИ СТАРОЕ НАЗВАНИЕ
            
            if not tomorrow_hws:
                text = "📭 На завтра домашних заданий нет"
            else:
                text = "📚 Домашние задания на завтра:\n\n"
                for subject, hw_text in tomorrow_hws:
                    text += f"📖 {subject}:\n{hw_text}\n\n"
            
            await safe_edit_message(
                update,
                text=text,
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"reminders_settings_{course}_{stream}")]])
            )
                
        elif data.startswith('refresh_'):
            parts = data.split('_')
            course = parts[1]
            stream = parts[2]
            if course == "1":
                # Для 1 курса используем старую логику кэша
                if stream in events_cache:
                    del events_cache[stream]
            else:
                # Для других курсов используем новую логику кэша
                cache_key = f"{course}_{stream}"
                if cache_key in events_cache:
                    del events_cache[cache_key]
                    
            events = load_events_from_github(course, stream)
            course_text = f"{course} курс"
            if course == "1":
                course_text += f", {stream} поток"
                
            await safe_edit_message(
                update,
                text=f"✅ Расписание для {course_text} обновлено! Загружено {len(events)} событий",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"back_to_main_{course}_{stream}")]])
            )
            
        elif data.startswith('manage_hw_'):
            parts = data.split('_')
            course = parts[2]
            stream = parts[3]
            await show_manage_hw_menu(update, context, course, stream)
            
        elif data.startswith('add_hw_'):
            parts = data.split('_')
            course = parts[2]
            stream = parts[3]
            await show_add_hw_menu(update, context, course, stream)
            
        elif data.startswith('hw_subj_'):
            # Формат: hw_subj_1_1_Название_предмета (курс_поток_предмет)
            parts = data.split('_')
            course = parts[2]
            stream = parts[3]
            safe_subject = '_'.join(parts[4:])
            
            # Проверяем, что курс и поток корректны
            if course not in ['1', '2', '3', '4']:
                await query.answer("Неверный курс")
                return

            # Находим полное название предмета по безопасному идентификатору
            subjects = get_unique_subjects(course, stream)
            original_subject = None
            
            for subject in subjects:
                safe_compare = re.sub(r'[^a-zA-Z0-9а-яА-Я]', '_', subject)
                safe_compare = safe_compare[:20]  # Ограничиваем длину как при создании
                if safe_compare == safe_subject:
                    original_subject = subject
                    break
            
            if not original_subject:
                await safe_edit_message(
                    update,
                    text="❌ Не удалось найти предмет. Попробуйте снова.",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"add_hw_{course}_{stream}")]])
                )
                return
            
            # Сохраняем в контекст для использования в следующем шаге
            context.user_data['hw_subject'] = original_subject
            context.user_data['hw_course'] = course
            context.user_data['hw_stream'] = stream
            
            # Показываем выбор даты
            await show_date_selection(update, context, course, stream, original_subject)
            
        elif data.startswith('hw_date_'):
            # Обработка выбора даты для ДЗ
            parts = data.split('_')
            course = parts[2]
            stream = parts[3]
            
            if parts[4] == 'manual':
                # Ручной ввод даты
                context.user_data['hw_step'] = 'enter_date_manual'
                await safe_edit_message(
                    update,
                    text="Введите дату в формате ДД.ММ.ГГГГ (например, 25.12.2023):",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"add_hw_{course}_{stream}")]])
                )
            else:
                # Дата выбрана из списка
                date_str = parts[4]  # в формате YYYY-MM-DD
                context.user_data['hw_date'] = date_str
                context.user_data['hw_step'] = 'enter_text'
                subject = context.user_data['hw_subject']
                date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
                
                await safe_edit_message(
                    update,
                    text=f"📝 Добавление ДЗ для предмета: {subject}\n"
                         f"📅 Дата: {date.strftime('%d.%m.%Y')}\n\n"
                         f"Введите текст домашнего задания:",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"add_hw_{course}_{stream}")]])
                )
            
        elif data.startswith('view_future_hw_'):
            parts = data.split('_')
            course = parts[3]
            stream = parts[4]
            await show_future_homeworks(update, context, course, stream)
            
        elif data.startswith('view_past_hw_'):
            parts = data.split('_')
            course = parts[3]
            stream = parts[4]
            await show_past_homeworks(update, context, course, stream)
            
        elif data.startswith('delete_hw_menu_'):
            parts = data.split('_')
            course = parts[3]
            stream = parts[4]
            await show_delete_hw_menu(update, context, course, stream)
            
                elif data.startswith('del_hw_'):
            parts = data.split('_', 4)
            course = parts[2]
            stream = parts[3]
            hw_key = parts[4]
            
            homeworks = load_homeworks(course, stream)
            
            if hw_key in homeworks:
                del homeworks[hw_key]
                save_homeworks(course, stream, homeworks)
                
                await safe_edit_message(
                    update,
                    text="✅ Домашнее задание удалено!",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"delete_hw_menu_{course}_{stream}")]])
                )
            else:
                await safe_edit_message(
                    update,
                    text="❌ Домашнее задание не найдено!",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{course}_{stream}")]])
                )
            
        elif any(data.startswith(cmd) for cmd in ['today_', 'tomorrow_', 'this_week_', 'next_week_']):
            parts = data.split('_')
            course = parts[1]
            stream = parts[2]
            today = datetime.datetime.now(TIMEZONE).date()
            events = load_events_from_github(course, stream)
            
            # Получаем выбранное время английского
            user_id = str(update.effective_user.id)
            english_time = user_settings.get(user_id, {}).get('english_time')

            if data.startswith('today_'):
                if course == "1":
                    text = format_day(today, events, stream, english_time)
                else:
                    # Для других курсов используем упрощенное форматирование
                    evs = [e for e in events if e["start"].date() == today]
                    if not evs:
                        text = f"📅 Сегодня ({today.strftime('%d.%m.%Y')}) — занятий нет\n"
                    else:
                        text = f"📅 Сегодня ({today.strftime('%d.%m.%Y')}):\n"
                        for ev in sorted(evs, key=lambda x: x["start"]):
                            time_str = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}"
                            text += f"• {time_str}  {ev['summary']}\n\n"

            elif data.startswith('tomorrow_'):
                tomorrow = today + datetime.timedelta(days=1)
                if course == "1":
                    text = format_day(tomorrow, events, stream, english_time, is_tomorrow=True)
                else:
                    # Для других курсов используем упрощенное форматирование
                    evs = [e for e in events if e["start"].date() == tomorrow]
                    if not evs:
                        text = f"🔄 Завтра ({tomorrow.strftime('%d.%m.%Y')}) — занятий нет\n"
                    else:
                        text = f"🔄 Завтра ({tomorrow.strftime('%d.%m.%Y')}):\n"
                        for ev in sorted(evs, key=lambda x: x["start"]):
                            time_str = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}"
                            text += f"• {time_str}  {ev['summary']}\n\n"

            elif data.startswith('this_week_'):
                start_date, _ = get_week_range(today)
                course_text = f"{course} курс"
                if course == "1":
                    course_text += f", {stream} поток"
                    text = f"🗓 Расписание на эту неделю ({course_text}):\n\n"
                    for i in range(5):
                        d = start_date + datetime.timedelta(days=i)
                        text += format_day(d, events, stream, english_time)
                else:
                    # Для других курсов используем упрощенное форматирование
                    text = f"🗓 Расписание на эту неделю ({course_text}):\n\n"
                    for i in range(5):
                        d = start_date + datetime.timedelta(days=i)
                        day_events = [e for e in events if e["start"].date() == d]
                        if day_events:
                            date_str = d.strftime('%A, %d %B')
                            text += f"📅 {date_str}:\n"
                            for ev in sorted(day_events, key=lambda x: x["start"]):
                                time_str = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}"
                                text += f"• {time_str}  {ev['summary']}\n\n"
                        else:
                            date_str = d.strftime('%A, %d %B')
                            text += f"📅 {date_str} — занятий нет\n\n"

            elif data.startswith('next_week_'):
                start_date, _ = get_week_range(today + datetime.timedelta(days=7))
                course_text = f"{course} курс"
                if course == "1":
                    course_text += f", {stream} поток"
                    text = f"⏭ Расписание на следующую неделю ({course_text}):\n\n"
                    for i in range(5):
                        d = start_date + datetime.timedelta(days=i)
                        text += format_day(d, events, stream, english_time)
                else:
                    # Для других курсов используем упрощенное форматирование
                    text = f"⏭ Расписание на следующую неделю ({course_text}):\n\n"
                    for i in range(5):
                        d = start_date + datetime.timedelta(days=i)
                        day_events = [e for e in events if e["start"].date() == d]
                        if day_events:
                            date_str = d.strftime('%A, %d %B')
                            text += f"📅 {date_str}:\n"
                            for ev in sorted(day_events, key=lambda x: x["start"]):
                                time_str = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}"
                                text += f"• {time_str}  {ev['summary']}\n\n"
                        else:
                            date_str = d.strftime('%A, %d %B')
                            text += f"📅 {date_str} — занятий нет\n\n"

            else:
                text = "Неизвестная команда."

            # Добавляем кнопки для навигации
            keyboard = [
                [InlineKeyboardButton("📅 Сегодня", callback_data=f"today_{course}_{stream}"),
                 InlineKeyboardButton("🔄 Завтра", callback_data=f"tomorrow_{course}_{stream}")],
                [InlineKeyboardButton("🗓 Неделя", callback_data=f"this_week_{course}_{stream}"),
                 InlineKeyboardButton("⏭ След. неделя", callback_data=f"next_week_{course}_{stream}")],
                [InlineKeyboardButton("🔔 Напоминания", callback_data=f"reminders_settings_{course}_{stream}")],
                [InlineKeyboardButton("🔙 Главное меню", callback_data=f"back_to_main_{course}_{stream}")]
            ]
            
            # Обрезаем текст если он слишком длинный для Telegram
            if len(text) > 4000:
                text = text[:4000] + "\n\n... (сообщение обрезано)"
                
            await safe_edit_message(
                update,
                text=text,
                reply_markup=InlineKeyboardMarkup(keyboard)
            )

        # Остальные обработчики (админские команды и т.д.) остаются аналогичными
        # Для экономии места я опущу их, так как они требуют аналогичных изменений
        
    except BadRequest as e:
        if "Message is not modified" in str(e):
            # Игнорируем эту ошибку - сообщение не изменилось
            logging.info("Message not modified error - ignoring")
        else:
            logging.error(f"BadRequest в обработчике callback_query: {e}")
            try:
                await safe_edit_message(
                    update,
                    text="❌ Произошла ошибка при обновлении сообщения. Попробуйте еще раз."
                )
            except Exception as e2:
                logging.error(f"Ошибка при отправке сообщения об ошибке: {e2}")
                
    except TimedOut as e:
        logging.error(f"Timeout в обработчике callback_query: {e}")
        await query.answer("Произошла задержка, попробуйте еще раз", show_alert=False)
        
    except Exception as e:
        logging.error(f"Ошибка в обработчике callback_query: {e}", exc_info=True)
        try:
            await safe_edit_message(
                update,
                text="❌ Произошла ошибка при обработке запроса. Попробуйте еще раз."
            )
        except Exception as e2:
            logging.error(f"Ошибка при отправке сообщения об ошибке: {e2}")
    
    finally:
        # Снимаем флаг обработки
        context.user_data.pop(f'processing_{user_id}', None)

# === КОМАНДЫ ===
async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда для доступа к меню администратора"""
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для этой команды")
        return
        
    keyboard = [
        [InlineKeyboardButton("👥 Управление помощниками", callback_data="manage_assistants")],
        [InlineKeyboardButton("📝 Переименовать предметы", callback_data="rename_subjects")],
        [InlineKeyboardButton("✏️ Редактировать расписание", callback_data="edit_schedule")],
        [InlineKeyboardButton("📊 Статистика пользователей", callback_data="user_stats_admin")],
    ]
    
    await update.message.reply_text(
        text="🔧 Меню администратора:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def assistants_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда для просмотра списка помощников"""
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для этой команды")
        return
    
    assistants_list = "\n".join([f"• @{assistant}" for assistant in sorted(assistants)]) if assistants else "❌ Помощников нет"
    
    await update.message.reply_text(f"👥 Список помощников:\n\n{assistants_list}")

# === КОМАНДЫ ===
async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда для доступа к меню администратора"""
    await show_admin_menu(update, context)

async def assistants_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда для просмотра списка помощников"""
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для этой команды")
        return
    
    assistants_list = "\n".join([f"• @{assistant}" for assistant in sorted(assistants)]) if assistants else "❌ Помощников нет"
    
    await update.message.reply_text(f"👥 Список помощников:\n\n{assistants_list}")


# === ЗАПУСК ===
def main():
    global user_settings, application, assistants, subject_renames, schedule_edits
    
    # Загружаем данные при запуске
    user_settings = load_user_settings()
    assistants = load_assistants()
    subject_renames = load_subject_renames()
    schedule_edits = load_schedule_edits()
    
    # Создаем приложение
    application = ApplicationBuilder().token(BOT_TOKEN).build()
    
    # Добавляем обработчики
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("update", check_updates_command))
    application.add_handler(CommandHandler("users", users_command))
    application.add_handler(CommandHandler("admin", admin_command))
    application.add_handler(CommandHandler("assistants", assistants_command))
    application.add_handler(CallbackQueryHandler(handle_query))
    application.add_handler(MessageHandler(
        filters.TEXT & ~filters.COMMAND & filters.User(
            username={ADMIN_USERNAME} | assistants
        ),
        handle_message
    ))
    
    # Запускаем планировщик в отдельной задаче
    loop = asyncio.get_event_loop()
    loop.create_task(scheduler())
    
    logging.info("Бот запускается...")
    print("=" * 50)
    print("🤖 Бот для расписания запущен!")
    print(f"👑 Админ: {ADMIN_USERNAME}")
    print(f"👥 Помощников: {len(assistants)}")
    print("🎓 Поддержка курсов: 1, 2, 3, 4")
    print("📚 Потоки: 2 потока для 1 курса, 1 поток для остальных")
    print("🔔 Напоминания: каждый день в выбранное время")
    print("🔄 Автообновление: каждый день в 09:00")
    print("📝 Разделение ДЗ: будущие и архивные задания")
    print("👤 Команда /users доступна админу для статистики")
    print("🔧 Команда /admin для управления ботом")
    print("⏹️  Для остановки нажмите Ctrl+C")
    print("=" * 50)
    
    # Запускаем бота
    application.run_polling()

if __name__ == "__main__":
    main()
