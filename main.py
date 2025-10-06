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

# === НАСТРОЙКИ ===
BOT_TOKEN = os.getenv("BOT_TOKEN", "8016190941:AAFqoM5ysLgaGF6MtKh3KM9z-gKWLmW8kBs")
ADMIN_USERNAME = "@fusuges"

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

# Глобальные переменные для домашних заданий и событий
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

# === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
def get_week_range(date):
    start = date - datetime.timedelta(days=date.weekday())
    end = start + datetime.timedelta(days=6)
    return start, end

def format_event(ev, stream):
    desc = ev["desc"]
    teacher, room = "", ""
    if "Преподаватель" in desc:
        teacher = desc.split("Преподаватель:")[1].split("\\n")[0].strip()
    if "Аудитория" in desc:
        room = desc.split("Аудитория:")[1].split("\\n")[0].strip()
    
    line = f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}  {ev['summary']}"
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

def events_for_day(events, date):
    return [e for e in events if e["start"].date() == date]

def format_day(date, events, stream):
    evs = events_for_day(events, date)
    if not evs:
        return f"📅 {date.strftime('%A, %d %B')} — занятий нет\n"
    text = f"📅 {date.strftime('%A, %d %B')}:\n"
    for ev in sorted(evs, key=lambda x: x["start"]):
        text += f"{format_event(ev, stream)}\n\n"
    return text

def is_admin(update: Update):
    return update.effective_user.username == ADMIN_USERNAME.replace('@', '')

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

async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE, stream):
    events = load_events_from_github(stream)
    
    keyboard = [
        [InlineKeyboardButton("📅 Сегодня", callback_data=f"today_{stream}")],
        [InlineKeyboardButton("🗓 Эта неделя", callback_data=f"this_week_{stream}")],
        [InlineKeyboardButton("⏭ Следующая неделя", callback_data=f"next_week_{stream}")],
        [InlineKeyboardButton("🔄 Обновить расписание", callback_data=f"refresh_{stream}")],
    ]
    
    # Добавляем кнопку управления ДЗ для админа
    if is_admin(update):
        keyboard.append([InlineKeyboardButton("✏️ Управление ДЗ", callback_data=f"manage_hw_{stream}")])
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text=f"Выбран {stream} поток\nВыбери действие:",
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            text=f"Выбран {stream} поток\nВыбери действие:",
            reply_markup=reply_markup
        )

async def handle_query(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    if query.data.startswith('select_stream_'):
        stream = query.data.split('_')[-1]
        context.user_data['stream'] = stream
        await show_main_menu(update, context, stream)
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
        context.user_data['awaiting_hw'] = True
        context.user_data['hw_stream'] = stream
        await query.edit_message_text(
            text="Введите домашнее задание в формате:\n"
                 "Дата (ГГГГ-ММ-ДД) | Предмет | Текст задания\n\n"
                 "Пример: 2024-01-15 | Математика | Решить задачи 1-5 на странице 42",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Назад", callback_data=f"manage_hw_{stream}")]])
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

    # Обработка основных команд (сегодня, неделя и т.д.)
    if any(query.data.startswith(cmd) for cmd in ['today_', 'this_week_', 'next_week_']):
        stream = query.data.split('_')[-1]
        today = datetime.datetime.now(TIMEZONE).date()
        events = load_events_from_github(stream)

        if query.data.startswith('today_'):
            evs = events_for_day(events, today)
            text = format_day(today, events, stream)

        elif query.data.startswith('this_week_'):
            start_date, _ = get_week_range(today)
            text = f"🗓 Расписание на эту неделю ({stream} поток):\n\n"
            for i in range(5):
                d = start_date + datetime.timedelta(days=i)
                text += format_day(d, events, stream) + "\n"

        elif query.data.startswith('next_week_'):
            start_date, _ = get_week_range(today + datetime.timedelta(days=7))
            text = f"⏭ Расписание на следующую неделю ({stream} поток):\n\n"
            for i in range(5):
                d = start_date + datetime.timedelta(days=i)
                text += format_day(d, events, stream) + "\n"

        else:
            text = "Неизвестная команда."

        await show_main_menu(update, context, stream)

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if context.user_data.get('awaiting_hw') and is_admin(update):
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
                
                del context.user_data['awaiting_hw']
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
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(handle_query))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    
    logging.info("Бот запускается...")
    print("=" * 50)
    print("🤖 Бот для расписания запущен!")
    print(f"👑 Админ: {ADMIN_USERNAME}")
    print("⏹️  Для остановки нажмите Ctrl+C")
    print("=" * 50)
    
    app.run_polling()

if __name__ == "__main__":
    main()
