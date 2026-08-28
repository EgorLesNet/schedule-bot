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

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)


def load_bot_token():
    """читает токен бота из token.txt"""
    try:
        with open("token.txt", "r", encoding="utf-8") as f:
            token = f.read().strip()
        if not token:
            raise ValueError("empty token")
        return token
    except FileNotFoundError:
        logging.error("token.txt not found")
        return None


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

SCHEDULE_FILENAME_PATTERN = re.compile(r'^GAUGN_(\d+)_kurs_(.+)\.ics$', re.IGNORECASE)
SCHEDULES_CACHE_FILE = "schedules_cache.json"

TIMEZONE = pytz.timezone("Europe/Moscow")
USER_SETTINGS_FILE = "user_settings.json"
LAST_UPDATE_FILE = "last_update.txt"
ASSISTANTS_FILE = "assistants.json"
SUBJECT_RENAMES_FILE = "subject_renames.json"
SCHEDULE_EDITS_FILE = "schedule_edits.json"
PROXY_URL = "socks5://127.0.0.1:987"

PLACEHOLDER_MARK_FOR_REPLACEMENT = True
