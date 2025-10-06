import datetime
import pytz
import re
import os
import requests
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
)

# === НАСТРОЙКА ЛОГГИРОВАНИЯ ===
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

# === НАСТРОЙКИ ===
BOT_TOKEN = os.getenv("BOT_TOKEN", "8016190941:AAFqoM5ysLgaGF6MtKh3KM9z-gKWLmW8kBs")
ICS_URL = "https://raw.githubusercontent.com/EgorLesNet/schedule-bot/main/GAUGN_1_kurs_2_potok_nodups.ics"
TIMEZONE = pytz.timezone("Europe/Moscow")

# === ПАРСИНГ ICS ИЗ GITHUB ===
def load_events_from_github():
    events = []
    try:
        logging.info("Загрузка расписания из GitHub...")
        response = requests.get(ICS_URL)
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
                
        logging.info(f"Успешно загружено {len(events)} событий")
        return events
        
    except Exception as e:
        logging.error(f"Ошибка при загрузке файла с GitHub: {e}")
        return []

# === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
def get_week_range(date):
    start = date - datetime.timedelta(days=date.weekday())
    end = start + datetime.timedelta(days=6)
    return start, end

def format_event(ev):
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
    return line

def events_for_day(date):
    return [e for e in events if e["start"].date() == date]

def format_day(date, evs):
    if not evs:
        return f"📅 {date.strftime('%A, %d %B')} — занятий нет\n"
    text = f"📅 {date.strftime('%A, %d %B')}:\n"
    for ev in sorted(evs, key=lambda x: x["start"]):
        text += f"{format_event(ev)}\n\n"
    return text

# === ОБРАБОТЧИКИ ===
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("📅 Сегодня", callback_data="today")],
        [InlineKeyboardButton("🗓 Эта неделя", callback_data="this_week")],
        [InlineKeyboardButton("⏭ Следующая неделя", callback_data="next_week")],
        [InlineKeyboardButton("🔄 Обновить расписание", callback_data="refresh")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        "Привет! 👋\nВыбери, что показать:",
        reply_markup=reply_markup
    )

async def handle_query(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    today = datetime.datetime.now(TIMEZONE).date()

    # Обработка команды обновления расписания
    if query.data == "refresh":
        global events
        events = load_events_from_github()
        await query.edit_message_text(
            text=f"✅ Расписание обновлено! Загружено {len(events)} событий",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("📅 Сегодня", callback_data="today")],
                [InlineKeyboardButton("🗓 Эта неделя", callback_data="this_week")],
                [InlineKeyboardButton("⏭ Следующая неделя", callback_data="next_week")],
            ])
        )
        return

    if query.data == "today":
        evs = events_for_day(today)
        text = format_day(today, evs)

    elif query.data == "this_week":
        start_date, _ = get_week_range(today)
        text = "🗓 Расписание на эту неделю:\n\n"
        for i in range(5):
            d = start_date + datetime.timedelta(days=i)
            text += format_day(d, events_for_day(d)) + "\n"

    elif query.data == "next_week":
        start_date, _ = get_week_range(today + datetime.timedelta(days=7))
        text = "⏭ Расписание на следующую неделю:\n\n"
        for i in range(5):
            d = start_date + datetime.timedelta(days=i)
            text += format_day(d, events_for_day(d)) + "\n"

    else:
        text = "Неизвестная команда."

    keyboard = [
        [InlineKeyboardButton("📅 Сегодня", callback_data="today")],
        [InlineKeyboardButton("🗓 Эта неделя", callback_data="this_week")],
        [InlineKeyboardButton("⏭ Следующая неделя", callback_data="next_week")],
        [InlineKeyboardButton("🔄 Обновить расписание", callback_data="refresh")],
    ]
    await query.edit_message_text(
        text=text,
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

# === ЗАПУСК ===
def main():
    # Загружаем события при запуске
    global events
    events = load_events_from_github()
    
    if not events:
        logging.error("Не удалось загрузить события. Бот будет работать с пустым расписанием.")
    
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(handle_query))
    
    logging.info("Бот запускается...")
    print("=" * 50)
    print("🤖 Бот для расписания запущен!")
    print(f"📅 Загружено событий: {len(events)}")
    print("⏹️  Для остановки нажмите Ctrl+C")
    print("=" * 50)
    
    app.run_polling()

if __name__ == "__main__":
    main()
