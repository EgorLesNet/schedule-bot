import datetime
import pytz
import re
import os
import requests
import json
import logging
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
        print("Создайте файл token.txt с содержимым: BOT_TOKEN=ваш_токен_бота")
        return None

# === НАСТРОЙКИ ===
BOT_TOKEN = load_bot_token()
if not BOT_TOKEN:
    exit(1)

ADMIN_USERNAME = "fusuges"

# URLs для разных потоков
STREAM_URLS = {
    "1": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_1_kurs_1_potok_nodups.ics",
    "2": "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_1_kurs_2_potok_nodups.ics"
}

TIMEZONE = pytz.timezone("Europe/Moscow")
HOMEWORKS_FILE = "homeworks.json"

# Загрузка домашних заданий
def load_homeworks():
    try:
        with open(HOMEWORKS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_homeworks(homeworks):
    with open(HOMEWORKS_FILE, "w", encoding="utf-8") as f:
        json.dump(homeworks, f, ensure_ascii=False, indent=2)

# Глобальные переменные
homeworks = load_homeworks()
events_cache = {}

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
    
    # Ключевые слова для определения онлайн-пар
    online_keywords = ["онлайн", "online", "zoom", "teams", "вебинар", "webinar", "дистанционно"]
    
    return any(keyword in desc or keyword in summary for keyword in online_keywords)

def has_only_lunch_break(events, date):
    """Проверяет, есть ли в этот день только обеденный перерыв"""
    day_events = [e for e in events if e["start"].date() == date]
    
    if len(day_events) == 0:
        return False
    
    # Если все события - это обеденные перерывы
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
    if english_time:
        context.user_data['english_time'] = english_time
    
    keyboard = [
        [InlineKeyboardButton("📅 Сегодня", callback_data=f"today_{stream}"),
         InlineKeyboardButton("🔄 Завтра", callback_data=f"tomorrow_{stream}")],
        [InlineKeyboardButton("🗓 Эта неделя", callback_data=f"this_week_{stream}")],
        [InlineKeyboardButton("⏭ Следующая неделя", callback_data=f"next_week_{stream}")],
        [InlineKeyboardButton("🔄 Обновить расписание", callback_data=f"refresh_{stream}")],
    ]
    
    # Добавляем кнопку управления ДЗ для админа
    if is_admin(update):
        keyboard.append([InlineKeyboardButton("✏️ Управление ДЗ", callback_data=f"manage_hw_{stream}")])
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    english_text = ""
    if english_time == "morning":
        english_text = "\n🕘 Английский: 9:00-12:10"
    elif english_time == "afternoon":
        english_text = "\n🕑 Английский: 14:00-17:10"
    
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text=f"Выбран {stream} поток{english_text}\nВыбери действие:",
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            text=f"Выбран {stream} поток{english_text}\nВыбери действие:",
            reply_markup=reply_markup
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
        
    elif query.data.startswith('add_hw_'):
        stream = query.data.split('_')[-1]
        context.user_data['awaiting_hw_method'] = True
        context.user_data['hw_stream'] = stream
        
        keyboard = [
            [InlineKeyboardButton("📋 Выбрать из списка предметов", callback_data=f"select_subject_{stream}")],
            [InlineKeyboardButton("⌨️ Ввести вручную", callback_data=f"manual_hw_{stream}")],
            [InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{stream}")]
        ]
        
        await query.edit_message_text(
            text="Как вы хотите добавить домашнее задание?",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return
        
    elif query.data.startswith('select_subject_'):
        stream = query.data.split('_')[-1]
        subjects = get_unique_subjects(stream)
        
        if not subjects:
            await query.edit_message_text(
                text="❌ Не удалось загрузить список предметов",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"add_hw_{stream}")]])
            )
            return
            
        # Создаем кнопки для выбора предмета
        keyboard = []
        row = []
        for i, subject in enumerate(subjects):
            button_text = subject[:20] + "..." if len(subject) > 20 else subject
            row.append(InlineKeyboardButton(button_text, callback_data=f"subject_{stream}_{i}"))
            if len(row) == 2:
                keyboard.append(row)
                row = []
        if row:
            keyboard.append(row)
            
        keyboard.append([InlineKeyboardButton("🔙 Назад", callback_data=f"add_hw_{stream}")])
        
        context.user_data['subjects_list'] = subjects
        
        await query.edit_message_text(
            text="Выберите предмет:",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return
        
    elif query.data.startswith('subject_'):
        stream = query.data.split('_')[-2]
        subject_index = int(query.data.split('_')[-1])
        
        subjects_list = context.user_data.get('subjects_list', [])
        if subject_index < len(subjects_list):
            selected_subject = subjects_list[subject_index]
            context.user_data['selected_subject'] = selected_subject
            context.user_data['awaiting_hw_date'] = True
            
            await query.edit_message_text(
                text=f"Выбран предмет: {selected_subject}\n\n"
                     f"Введите дату в формате ГГГГ-ММ-ДД:\n"
                     f"Например: {datetime.datetime.now().strftime('%Y-%m-%d')}",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"select_subject_{stream}")]])
            )
        return
        
    elif query.data.startswith('manual_hw_'):
        stream = query.data.split('_')[-1]
        context.user_data['awaiting_hw_manual'] = True
        context.user_data['hw_stream'] = stream
        await query.edit_message_text(
            text="Введите домашнее задание в формате:\n"
                 "Дата (ГГГГ-ММ-ДД) | Предмет | Текст задания\n\n"
                 "Пример: 2024-01-15 | Математика | Решить задачи 1-5 на странице 42",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"add_hw_{stream}")]])
        )
        return
        
    elif query.data.startswith('view_hw_'):
        stream = query.data.split('_')[-1]
        stream_homeworks = {k: v for k, v in homeworks.items() if k.startswith(f"{stream}_")}
        
        if not stream_homeworks:
            text = "Домашних заданий нет."
        else:
            text = "📚 Домашние задания:\n\n"
            for key, hw_text in stream_homeworks.items():
                _, date, subject = key.split('_', 2)
                text += f"📅 {date} | {subject}\n📖 {hw_text}\n\n"
        
        await query.edit_message_text(
            text=text,
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{stream}")]])
        )
        return
        
    elif query.data.startswith('delete_hw_'):
        stream = query.data.split('_')[-1]
        stream_homeworks = {k: v for k, v in homeworks.items() if k.startswith(f"{stream}_")}
        
        if not stream_homeworks:
            await query.edit_message_text(
                text="Домашних заданий для удаления нет.",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{stream}")]])
            )
            return
            
        keyboard = []
        for key in stream_homeworks.keys():
            _, date, subject = key.split('_', 2)
            keyboard.append([InlineKeyboardButton(
                f"{date} | {subject}", 
                callback_data=f"confirm_delete_{key}"
            )])
        
        keyboard.append([InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{stream}")])
        
        await query.edit_message_text(
            text="Выберите ДЗ для удаления:",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return
        
    elif query.data.startswith('confirm_delete_'):
        hw_key = query.data.replace('confirm_delete_', '')
        if hw_key in homeworks:
            del homeworks[hw_key]
            save_homeworks(homeworks)
            await query.edit_message_text(
                text="✅ ДЗ удалено!",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{hw_key.split('_')[0]}")]])
            )
        return

    # Обработка основных команд
    if any(query.data.startswith(cmd) for cmd in ['today_', 'tomorrow_', 'this_week_', 'next_week_']):
        stream = query.data.split('_')[-1]
        today = datetime.datetime.now(TIMEZONE).date()
        events = load_events_from_github(stream)
        
        # Получаем выбранное время английского
        english_time = context.user_data.get('english_time')

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
            [InlineKeyboardButton("🔙 Главное меню", callback_data=f"select_stream_{stream}")]
        ]
        
        # Обрезаем текст если он слишком длинный для Telegram
        if len(text) > 4000:
            text = text[:4000] + "\n\n... (сообщение обрезано)"
            
        await query.edit_message_text(
            text=text,
            reply_markup=InlineKeyboardMarkup(keyboard)
        )

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Обработка ввода даты для домашнего задания (после выбора предмета)
    if context.user_data.get('awaiting_hw_date'):
        try:
            date_str = update.message.text.strip()
            # Проверяем формат даты
            datetime.datetime.strptime(date_str, "%Y-%m-%d")
            
            stream = context.user_data.get('hw_stream')
            subject = context.user_data.get('selected_subject')
            
            context.user_data['hw_date'] = date_str
            context.user_data['awaiting_hw_text'] = True
            del context.user_data['awaiting_hw_date']
            
            await update.message.reply_text(
                f"Дата: {date_str}\n"
                f"Предмет: {subject}\n\n"
                f"Введите текст домашнего задания:"
            )
            
        except ValueError:
            await update.message.reply_text("❌ Неправильный формат даты. Используйте ГГГГ-ММ-ДД")
            
    # Обработка ввода текста домашнего задания
    elif context.user_data.get('awaiting_hw_text'):
        hw_text = update.message.text
        stream = context.user_data.get('hw_stream')
        subject = context.user_data.get('selected_subject')
        date_str = context.user_data.get('hw_date')
        
        hw_key = f"{stream}_{date_str}_{subject}"
        homeworks[hw_key] = hw_text
        save_homeworks(homeworks)
        
        # Очищаем временные данные
        for key in ['hw_stream', 'selected_subject', 'hw_date', 'awaiting_hw_text', 'subjects_list']:
            if key in context.user_data:
                del context.user_data[key]
        
        await update.message.reply_text(
            f"✅ ДЗ добавлено!\n"
            f"Дата: {date_str}\n"
            f"Предмет: {subject}\n"
            f"Задание: {hw_text}",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{stream}")]])
        )
    
    # Обработка ручного ввода домашнего задания
    elif context.user_data.get('awaiting_hw_manual') and is_admin(update):
        try:
            stream = context.user_data.get('hw_stream')
            parts = update.message.text.split('|')
            if len(parts) == 3:
                date_str = parts[0].strip()
                subject = parts[1].strip()
                hw_text = parts[2].strip()
                
                # Проверяем формат даты
                datetime.datetime.strptime(date_str, "%Y-%m-%d")
                
                hw_key = f"{stream}_{date_str}_{subject}"
                homeworks[hw_key] = hw_text
                save_homeworks(homeworks)
                
                del context.user_data['awaiting_hw_manual']
                del context.user_data['hw_stream']
                
                await update.message.reply_text(
                    f"✅ ДЗ добавлено!\n"
                    f"Дата: {date_str}\n"
                    f"Предмет: {subject}\n"
                    f"Задание: {hw_text}",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{stream}")]])
                )
            else:
                await update.message.reply_text(
                    "❌ Неправильный формат. Используйте:\n"
                    "Дата (ГГГГ-ММ-ДД) | Предмет | Текст задания"
                )
        except ValueError:
            await update.message.reply_text("❌ Неправильный формат даты. Используйте ГГГГ-ММ-ДД")
        except Exception as e:
            await update.message.reply_text(f"❌ Ошибка: {str(e)}")
    else:
        await update.message.reply_text("Используйте /start для начала работы")

# === ЗАПУСК ===
def main():
    # Загружаем домашние задания при запуске
    global homeworks
    homeworks = load_homeworks()
    
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(handle_query))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    
    logging.info("Бот запускается...")
    print("=" * 50)
    print("🤖 Бот для расписания запущен!")
    print(f"👑 Админ: {ADMIN_USERNAME}")
    print(f"📚 Загружено домашних заданий: {len(homeworks)}")
    print("⏹️  Для остановки нажмите Ctrl+C")
    print("=" * 50)
    
    app.run_polling()

if __name__ == "__main__":
    main()
