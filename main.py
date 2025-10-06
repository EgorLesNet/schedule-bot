import datetime
import pytz
import re
import os
import requests
import json
import logging
import schedule
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

# URLs для разных потоков
STREAM_URLS = {
    "1": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_1_kurs_1_potok_nodups.ics",
    "2": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_1_kurs_2_potok_nodups.ics"
}

TIMEZONE = pytz.timezone("Europe/Moscow")
HOMEWORKS_FILE = "homeworks.json"
USER_SETTINGS_FILE = "user_settings.json"
LAST_UPDATE_FILE = "last_update.txt"

# Глобальные переменные
homeworks = {}
user_settings = {}
events_cache = {}
application = None

# === ФУНКЦИИ ДЛЯ РАБОТЫ С ДАННЫМИ ===
def load_homeworks():
    try:
        with open(HOMEWORKS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_homeworks(homeworks_data):
    with open(HOMEWORKS_FILE, "w", encoding="utf-8") as f:
        json.dump(homeworks_data, f, ensure_ascii=False, indent=2)

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

# === ПАРСИНГ ICS ИЗ GITHUB ===
def load_events_from_github(stream):
    if stream in events_cache:
        return events_cache[stream]
        
    events = []
    try:
        logging.info(f"Загрузка расписания для потока {stream} из GitHub...")
        response = requests.get(STREAM_URLS[stream])
        response.raise_for_status()
        data = response.text
        
        for ev_block in data.split("BEGIN:VEVENT"):
            if "DTSTART" not in ev_block:
                continue
            try:
                start_str = re.search(r"DTSTART;TZID=Europe/Moscow:(\d{8}T\d{6})", ev_block).group(1)
                end_str = re.search(r"DTEND;TZID=Europe/Moscow:(\d{8}T\d{6})", ev_block).group(1)
                summary = re.search(r"SUMMARY:(.*)", ev_block).group(1).strip()
                desc_match = re.search(r"DESCRIPTION:(.*)", ev_block)
                desc = desc_match.group(1).strip() if desc_match else ""

                start = datetime.datetime.strptime(start_str, "%Y%m%dT%H%M%S")
                end = datetime.datetime.strptime(end_str, "%Y%m%dT%H%M%S")

                events.append({
                    "summary": summary,
                    "start": start,
                    "end": end,
                    "desc": desc
                })
            except Exception as e:
                logging.warning(f"Ошибка при чтении события: {e}")
                continue
                
        events_cache[stream] = events
        logging.info(f"Успешно загружено {len(events)} событий для потока {stream}")
        return events
        
    except Exception as e:
        logging.error(f"Ошибка при загрузке файла с GitHub: {e}")
        return []

# Получение уникальных предметов из расписания
def get_unique_subjects(stream):
    events = load_events_from_github(stream)
    subjects = set()
    for event in events:
        subjects.add(event["summary"])
    return sorted(list(subjects))

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

def format_event(ev, stream):
    desc = ev["desc"]
    teacher, room = "", ""
    if "Преподаватель" in desc:
        teacher = desc.split("Преподаватель:")[1].split("\\n")[0].strip()
    if "Аудитория" in desc:
        room = desc.split("Аудитория:")[1].split("\\n")[0].strip()
    
    # Добавляем пометку для онлайн-пар
    online_marker = " 💻" if is_online_class(ev) else ""
    
    line = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}  {ev['summary']}{online_marker}"
    if teacher or room:
        line += "\n"
    if teacher:
        line += f"👨‍🏫 {teacher}"
    if room:
        line += f" | 📍{room}"
    
    # Добавляем домашнее задание если есть
    hw_key = f"{stream}_{ev['start'].date()}_{ev['summary']}"
    if hw_key in homeworks:
        line += f"\n📚 ДЗ: {homeworks[hw_key]}"
    
    return line

def events_for_day(events, date, english_time=None):
    day_events = [e for e in events if e["start"].date() == date]
    
    # Добавляем английский язык в четверг в выбранное время
    if date.weekday() == 3 and english_time:  # 3 = четверг
        if english_time == "morning":
            start_time = datetime.datetime.combine(date, datetime.time(9, 0))
            end_time = datetime.datetime.combine(date, datetime.time(12, 10))
        else:  # afternoon
            start_time = datetime.datetime.combine(date, datetime.time(14, 0))
            end_time = datetime.datetime.combine(date, datetime.time(17, 10))
        
        # Проверяем, нет ли уже английского в расписании
        has_english = any("английский" in e["summary"].lower() for e in day_events)
        if not has_english:
            english_event = {
                "summary": "Английский язык 💻",
                "start": start_time,
                "end": end_time,
                "desc": "Онлайн занятие"
            }
            day_events.append(english_event)
    
    return day_events

def format_day(date, events, stream, english_time=None, is_tomorrow=False):
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
        'Sunday': 'Воскресеньe'
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

def get_homeworks_for_tomorrow(stream):
    """Получает домашние задания на завтра"""
    tomorrow = datetime.datetime.now(TIMEZONE).date() + datetime.timedelta(days=1)
    tomorrow_homeworks = []
    
    for hw_key, hw_text in homeworks.items():
        if hw_key.startswith(f"{stream}_"):
            try:
                hw_date_str = hw_key.split('_')[1]
                hw_date = datetime.datetime.strptime(hw_date_str, "%Y-%m-%d").date()
                if hw_date == tomorrow:
                    subject = hw_key.split('_', 2)[2]
                    tomorrow_homeworks.append((subject, hw_text))
            except (ValueError, IndexError):
                continue
    
    return tomorrow_homeworks

async def send_homework_reminders():
    """Отправляет напоминания о домашних заданиях"""
    if not application:
        return
        
    logging.info("🔔 Проверка напоминаний о ДЗ...")
    
    for user_id, settings in user_settings.items():
        try:
            if settings.get('reminders', False) and settings.get('stream'):
                stream = settings['stream']
                tomorrow_hws = get_homeworks_for_tomorrow(stream)
                
                if tomorrow_hws:
                    message = "🔔 Напоминание о домашних заданиях на завтра:\n\n"
                    for subject, hw_text in tomorrow_hws:
                        message += f"📖 {subject}:\n{hw_text}\n\n"
                    
                    await application.bot.send_message(chat_id=user_id, text=message)
                    logging.info(f"📤 Отправлено напоминание пользователю {user_id}")
                
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

def run_scheduler():
    """Запускает планировщик для напоминаний и обновлений"""
    # Напоминания о ДЗ каждый день в 20:00
    schedule.every().day.at("20:00").do(
        lambda: asyncio.run(send_homework_reminders())
    )
    
    # Проверка обновлений каждый день в 09:00
    schedule.every().day.at("09:00").do(
        lambda: asyncio.run(check_for_updates())
    )
    
    # Проверка обновлений при запуске
    asyncio.run(check_for_updates())
    
    while True:
        schedule.run_pending()
        time.sleep(60)

# === ОБРАБОТЧИКИ ===
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("📚 1 поток", callback_data="select_stream_1")],
        [InlineKeyboardButton("📚 2 поток", callback_data="select_stream_2")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        "Привет! 👋\nВыбери свой поток:",
        reply_markup=reply_markup
    )

async def select_english_time(update: Update, context: ContextTypes.DEFAULT_TYPE, stream):
    keyboard = [
        [InlineKeyboardButton("🕘 9:00-12:10", callback_data=f"english_morning_{stream}")],
        [InlineKeyboardButton("🕑 14:00-17:10", callback_data=f"english_afternoon_{stream}")],
        [InlineKeyboardButton("❌ Без английского", callback_data=f"english_none_{stream}")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text="Выбери время для английского в четверг:",
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            text="Выбери время для английского в четверг:",
            reply_markup=reply_markup
        )

async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE, stream, english_time=None):
    events = load_events_from_github(stream)
    
    # Сохраняем выбор пользователя
    user_id = str(update.effective_user.id)
    if user_id not in user_settings:
        user_settings[user_id] = {}
    
    user_settings[user_id]['stream'] = stream
    if english_time:
        user_settings[user_id]['english_time'] = english_time
    save_user_settings(user_settings)
    
    # Создаем клавиатуру основного меню
    keyboard = [
        [InlineKeyboardButton("📅 Сегодня", callback_data=f"today_{stream}"),
         InlineKeyboardButton("🔄 Завтра", callback_data=f"tomorrow_{stream}")],
        [InlineKeyboardButton("🗓 Эта неделя", callback_data=f"this_week_{stream}"),
         InlineKeyboardButton("⏭ След. неделя", callback_data=f"next_week_{stream}")],
        [InlineKeyboardButton("🔔 Напоминания", callback_data=f"reminders_{stream}")],
        [InlineKeyboardButton("🔄 Обновить расписание", callback_data=f"refresh_{stream}")],
    ]
    
    # Добавляем кнопку управления ДЗ для админа
    if is_admin(update):
        keyboard.append([InlineKeyboardButton("✏️ Управление ДЗ", callback_data=f"manage_hw_{stream}")])
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Текст с информацией о настройках
    english_text = ""
    if english_time == "morning":
        english_text = "\n🕘 Английский: 9:00-12:10"
    elif english_time == "afternoon":
        english_text = "\n🕑 Английский: 14:00-17:10"
    
    reminders_status = "🔔" if user_settings[user_id].get('reminders', False) else "🔕"
    reminders_text = f"\n{reminders_status} Напоминания: {'вкл' if user_settings[user_id].get('reminders', False) else 'выкл'}"
    
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text=f"Выбран {stream} поток{english_text}{reminders_text}\nВыбери действие:",
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            text=f"Выбран {stream} поток{english_text}{reminders_text}\nВыбери действие:",
            reply_markup=reply_markup
        )

async def show_reminders_menu(update: Update, context: ContextTypes.DEFAULT_TYPE, stream):
    user_id = str(update.effective_user.id)
    current_status = user_settings.get(user_id, {}).get('reminders', False)
    
    status_text = "включены" if current_status else "выключены"
    status_icon = "🔔" if current_status else "🔕"
    
    keyboard = [
        [InlineKeyboardButton(f"{status_icon} Включить напоминания", callback_data=f"reminders_on_{stream}")],
        [InlineKeyboardButton(f"{status_icon} Выключить напоминания", callback_data=f"reminders_off_{stream}")],
        [InlineKeyboardButton("👀 Посмотреть ДЗ на завтра", callback_data=f"view_tomorrow_hw_{stream}")],
        [InlineKeyboardButton("🔙 Назад", callback_data=f"select_stream_{stream}")]
    ]
    
    await update.callback_query.edit_message_text(
        text=f"Управление напоминаниями:\n\n"
             f"Текущий статус: {status_icon} {status_text}\n\n"
             f"При включенных напоминаниях бот будет присылать уведомления "
             f"о домашних заданиях на завтра каждый день в 20:00",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def handle_query(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    if query.data.startswith('select_stream_'):
        stream = query.data.split('_')[-1]
        context.user_data['stream'] = stream
        await select_english_time(update, context, stream)
        return
        
    elif query.data.startswith('english_'):
        parts = query.data.split('_')
        english_option = parts[1]  # morning, afternoon, none
        stream = parts[2]
        
        english_time = None
        if english_option == "morning":
            english_time = "morning"
        elif english_option == "afternoon":
            english_time = "afternoon"
        # для "none" оставляем english_time = None
        
        await show_main_menu(update, context, stream, english_time)
        return
        
    elif query.data.startswith('reminders_'):
        stream = query.data.split('_')[-1]
        
        if query.data.startswith('reminders_on_'):
            user_id = str(update.effective_user.id)
            if user_id not in user_settings:
                user_settings[user_id] = {}
            user_settings[user_id]['reminders'] = True
            save_user_settings(user_settings)
            await query.edit_message_text(
                text="✅ Напоминания включены!\nБот будет присылать уведомления о ДЗ каждый день в 20:00",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"reminders_{stream}")]])
            )
            return
            
        elif query.data.startswith('reminders_off_'):
            user_id = str(update.effective_user.id)
            if user_id not in user_settings:
                user_settings[user_id] = {}
            user_settings[user_id]['reminders'] = False
            save_user_settings(user_settings)
            await query.edit_message_text(
                text="🔕 Напоминания выключены",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"reminders_{stream}")]])
            )
            return
            
        elif query.data.startswith('view_tomorrow_hw_'):
            stream = query.data.split('_')[-1]
            tomorrow_hws = get_homeworks_for_tomorrow(stream)
            
            if not tomorrow_hws:
                text = "📭 На завтра домашних заданий нет"
            else:
                text = "📚 Домашние задания на завтра:\n\n"
                for subject, hw_text in tomorrow_hws:
                    text += f"📖 {subject}:\n{hw_text}\n\n"
            
            await query.edit_message_text(
                text=text,
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"reminders_{stream}")]])
            )
            return
            
        else:
            await show_reminders_menu(update, context, stream)
            return
        
    elif query.data.startswith('refresh_'):
        stream = query.data.split('_')[-1]
        if stream in events_cache:
            del events_cache[stream]
        events = load_events_from_github(stream)
        await query.edit_message_text(
            text=f"✅ Расписание для {stream} потока обновлено! Загружено {len(events)} событий",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"select_stream_{stream}")]])
        )
        return
        
    elif query.data.startswith('manage_hw_'):
        stream = query.data.split('_')[-1]
        if not is_admin(update):
            await query.edit_message_text("❌ У вас нет прав для управления ДЗ")
            return
            
        keyboard = [
            [InlineKeyboardButton("📝 Добавить ДЗ", callback_data=f"add_hw_{stream}")],
            [InlineKeyboardButton("👀 Просмотреть ДЗ", callback_data=f"view_hw_{stream}")],
            [InlineKeyboardButton("❌ Удалить ДЗ", callback_data=f"delete_hw_{stream}")],
            [InlineKeyboardButton("🔙 Назад", callback_data=f"select_stream_{stream}")],
        ]
        await query.edit_message_text(
            text="Управление домашними заданиями:",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return

    # Обработка основных команд
    if any(query.data.startswith(cmd) for cmd in ['today_', 'tomorrow_', 'this_week_', 'next_week_']):
        stream = query.data.split('_')[-1]
        today = datetime.datetime.now(TIMEZONE).date()
        events = load_events_from_github(stream)
        
        # Получаем выбранное время английского
        user_id = str(update.effective_user.id)
        english_time = user_settings.get(user_id, {}).get('english_time')

        if query.data.startswith('today_'):
            text = format_day(today, events, stream, english_time)
            if "занятий нет" in text:
                text = f"📅 Сегодня ({today.strftime('%d.%m.%Y')}) — занятий нет\n"

        elif query.data.startswith('tomorrow_'):
            tomorrow = today + datetime.timedelta(days=1)
            text = format_day(tomorrow, events, stream, english_time, is_tomorrow=True)
            if "занятий нет" in text:
                text = f"🔄 Завтра ({tomorrow.strftime('%d.%m.%Y')}) — занятий нет\n"

        elif query.data.startswith('this_week_'):
            start_date, _ = get_week_range(today)
            text = f"🗓 Расписание на эту неделю ({stream} поток):\n\n"
            for i in range(5):
                d = start_date + datetime.timedelta(days=i)
                text += format_day(d, events, stream, english_time)

        elif query.data.startswith('next_week_'):
            start_date, _ = get_week_range(today + datetime.timedelta(days=7))
            text = f"⏭ Расписание на следующую неделю ({stream} поток):\n\n"
            for i in range(5):
                d = start_date + datetime.timedelta(days=i)
                text += format_day(d, events, stream, english_time)

        else:
            text = "Неизвестная команда."

        # Добавляем кнопки для навигации
        keyboard = [
            [InlineKeyboardButton("📅 Сегодня", callback_data=f"today_{stream}"),
             InlineKeyboardButton("🔄 Завтра", callback_data=f"tomorrow_{stream}")],
            [InlineKeyboardButton("🗓 Неделя", callback_data=f"this_week_{stream}"),
             InlineKeyboardButton("⏭ След. неделя", callback_data=f"next_week_{stream}")],
            [InlineKeyboardButton("🔔 Напоминания", callback_data=f"reminders_{stream}")],
            [InlineKeyboardButton("🔙 Главное меню", callback_data=f"select_stream_{stream}")]
        ]
        
        # Обрезаем текст если он слишком длинный для Telegram
        if len(text) > 4000:
            text = text[:4000] + "\n\n... (сообщение обрезано)"
            
        await query.edit_message_text(
            text=text,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )

async def check_updates_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда для ручной проверки обновлений"""
    if not is_admin(update):
        await update.message.reply_text("❌ У вас нет прав для этой команды")
        return
        
    await update.message.reply_text("🔍 Проверяю обновления...")
    await check_for_updates()
    await update.message.reply_text("✅ Проверка обновлений завершена!")

# === ЗАПУСК ===
def main():
    global homeworks, user_settings, application
    
    # Загружаем данные при запуске
    homeworks = load_homeworks()
    user_settings = load_user_settings()
    
    # Создаем приложение
    application = ApplicationBuilder().token(BOT_TOKEN).build()
    
    # Добавляем обработчики
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("update", check_updates_command))
    application.add_handler(CallbackQueryHandler(handle_query))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, lambda update, context: asyncio.run(handle_message(update, context))))
    
    # Запускаем планировщик в отдельном потоке
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    
    logging.info("Бот запускается...")
    print("=" * 50)
    print("🤖 Бот для расписания запущен!")
    print(f"👑 Админ: {ADMIN_USERNAME}")
    print(f"📚 Загружено домашних заданий: {len(homeworks)}")
    print(f"👥 Пользователей с напоминаниями: {sum(1 for s in user_settings.values() if s.get('reminders', False))}")
    print("🔔 Напоминания: каждый день в 20:00")
    print("🔄 Автообновление: каждый день в 09:00")
    print("⏹️  Для остановки нажмите Ctrl+C")
    print("=" * 50)
    
    # Запускаем бота
    application.run_polling()

# Добавляем обработчик сообщений отдельно
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Ваш код обработки сообщений здесь
    await update.message.reply_text("Используйте /start для начала работы")

if __name__ == "__main__":
    main()
