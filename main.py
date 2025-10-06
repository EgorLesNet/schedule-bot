import datetime
import pytz
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CallbackQueryHandler, CommandHandler, ContextTypes

# === НАСТРОЙКИ ===
BOT_TOKEN = "8016190941:AAFqoM5ysLgaGF6MtKh3KM9z-gKWLmW8kBs"
ICS_FILE = "GAUGN_1_kurs_2_potok_nodups.ics"
TIMEZONE = pytz.timezone("Europe/Moscow")

# === ЗАГРУЗКА РАСПИСАНИЯ (без ics parser) ===
import re

events = []
with open(ICS_FILE, "r", encoding="utf-8") as f:
    data = f.read()

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
        print("⚠️ Ошибка в событии:", e)
        continue
# === ФУНКЦИИ ===
def get_week_range(date):
    start = date - datetime.timedelta(days=date.weekday())
    end = start + datetime.timedelta(days=6)
    return start, end

def format_event(ev):
    desc = ev["desc"]
    teacher = ""
    room = ""
    # Преподаватель и аудитория из текста
    if "Преподаватель" in desc:
        teacher = desc.split("Преподаватель:")[1].split("\\n")[0].strip()
    if "Аудитория" in desc:
        room = desc.split("Аудитория:")[1].split("\\n")[0].strip()
    return (f"{ev['start'].strftime('%H:%M')}–{ev['end'].strftime('%H:%M')}  {ev['summary']}"
            + (f"\n👨‍🏫 {teacher}" if teacher else "")
            + (f" | 📍{room}" if room else ""))

def events_for_day(date):
    return [e for e in events if e["start"].date() == date]

def events_for_week(start_date):
    start, end = get_week_range(start_date)
    return [e for e in events if start <= e["start"].date() <= end]

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
        [InlineKeyboardButton("⏭ Следующая неделя", callback_data="next_week")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text("Привет! 👋\nВыбери, что показать:", reply_markup=reply_markup)

async def handle_query(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    today = datetime.datetime.now(TIMEZONE).date()
    if query.data == "today":
        evs = events_for_day(today)
        text = format_day(today, evs)

    elif query.data == "this_week":
        start, end = get_week_range(today)
        text = "🗓 Расписание на эту неделю:\n\n"
        for i in range(5):  # Пн–Пт
            d = start + datetime.timedelta(days=i)
            text += format_day(d, events_for_day(d)) + "\n"

    elif query.data == "next_week":
        start, end = get_week_range(today + datetime.timedelta(days=7))
        text = "⏭ Расписание на следующую неделю:\n\n"
        for i in range(5):
            d = start + datetime.timedelta(days=i)
            text += format_day(d, events_for_day(d)) + "\n"

    else:
        text = "Неизвестная команда"

    keyboard = [
        [InlineKeyboardButton("📅 Сегодня", callback_data="today")],
        [InlineKeyboardButton("🗓 Эта неделя", callback_data="this_week")],
        [InlineKeyboardButton("⏭ Следующая неделя", callback_data="next_week")]
    ]
    await query.edit_message_text(text=text, reply_markup=InlineKeyboardMarkup(keyboard))

# === ЗАПУСК ===
def main():
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(handle_query))
    app.run_polling()

if __name__ == "__main__":
    main()
