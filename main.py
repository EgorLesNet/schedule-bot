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
from urllib.parse import quote
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


# === ЧТЕНИЕ ТОКЕНА ИЗ ФАИЛА ===
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
GITHUB_OWNER = "EgorLesNet"
GITHUB_REPO = "schedule-bot"
GITHUB_BASE_URL = f"https://raw.githubusercontent.com/{GITHUB_OWNER}/{GITHUB_REPO}/main"
GITHUB_RAW_URL = f"{GITHUB_BASE_URL}/main.py"
GITHUB_API_CONTENTS_URL = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/contents/"
GITHUB_API_HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "schedule-bot"}

# Расписания .ics-файлов называются по шаблону: GAUGN_<курс>_kurs_<название потока>.ics
# Например: GAUGN_1_kurs_Общий.ics, GAUGN_2_kurs_Поток_1.ics
# Бот сам сканирует репозиторий на GitHub и строит список курсов/потоков из названий файлов —
# чтобы добавить новый курс или поток, достаточно залить .ics-файл с правильным именем.
SCHEDULE_FILENAME_PATTERN = re.compile(r'^GAUGN_(\d+)_kurs_(.+)\.ics$', re.IGNORECASE)
SCHEDULES_CACHE_FILE = "schedules_cache.json"

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
SCHEDULES = {}  # заполняется через discover_schedules()


# === АВТООПРЕДЕЛЕНИЕ КУРСОВ И ПОТОКОВ ПО ФАИЛАМ НА GITHUB ===
def _natural_sort_key(text):
    """Ключ для 'человеческой' сортировки строк с числами (Поток 2 < Поток 10)."""
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r'(\d+)', text)]


def _slugify_stream_name(display_name):
    """Делает из названия потока безопасный ключ для callback_data (без подчеркиваний)."""
    slug = re.sub(r'[^0-9a-zA-Zа-яА-ЯёЁ]+', '', display_name).lower()
    return slug or "poток"


def load_schedules_cache():
    """Загружает последний удачно определенный список курсов/потоков (на случай сбоя GitHub API)."""
    try:
        with open(SCHEDULES_CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_schedules_cache(schedules):
    """Сохраняет список курсов/потоков локально, чтобы бот работал даже если GitHub API недоступен."""
    with open(SCHEDULES_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(schedules, f, ensure_ascii=False, indent=2)


def discover_schedules():
    """
    Сканирует корень репозитория на GitHub и определяет курсы/потоки по названиям .ics-файлов
    формата GAUGN_<курс>_kurs_<поток>.ics. При недоступности GitHub API использует локальный кэш.
    """
    try:
        response = requests.get(GITHUB_API_CONTENTS_URL, headers=GITHUB_API_HEADERS, timeout=15)
        response.raise_for_status()
        items = response.json()
    except Exception as e:
        logging.error(f"❌ Не удалось получить список файлов расписания с GitHub: {e}")
        cached = load_schedules_cache()
        if cached:
            logging.info("📦 Использую последний сохраненный список курсов/потоков")
        return cached

    raw_by_course = {}
    for item in items:
        if item.get("type") != "file":
            continue
        match = SCHEDULE_FILENAME_PATTERN.match(item["name"])
        if not match:
            continue
        course, raw_stream_name = match.group(1), match.group(2)
        display_name = raw_stream_name.replace('_', ' ').strip()
        raw_by_course.setdefault(course, []).append({
            "display_name": display_name,
            "filename": item["name"],
        })

    schedules = {}
    for course, streams in raw_by_course.items():
        streams_sorted = sorted(streams, key=lambda s: _natural_sort_key(s["display_name"]))
        course_schedules = {}
        for stream in streams_sorted:
            key = _slugify_stream_name(stream["display_name"])
            course_schedules[key] = {
                "name": stream["display_name"],
                "url": f"{GITHUB_BASE_URL}/{quote(stream['filename'])}",
            }
        schedules[course] = course_schedules

    if schedules:
        save_schedules_cache(schedules)
        logging.info(f"✅ Найдены расписания для курсов: {', '.join(sorted(schedules.keys(), key=int))}")
        return schedules

    logging.warning("⚠️ На GitHub не найдено ни одного файла расписания подходящего формата")
    return load_schedules_cache()


def refresh_schedules():
    """Обновляет глобальный список курсов/потоков (SCHEDULES) из репозитория."""
    global SCHEDULES
    new_schedules = discover_schedules()
    if new_schedules:
        SCHEDULES = new_schedules
    return SCHEDULES
