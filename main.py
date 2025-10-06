import datetime
import pytz
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CallbackQueryHandler, CommandHandler, ContextTypes
from ics import Calendar

# === НАСТРОЙКИ ===
BOT_TOKEN = "ВСТАВЬ_СВОЙ_ТОКЕН_ОТ_BOTFATHER"
ICS_FILE = "GAUGN_1_kurs_2_potok_nodups.ics"
TIMEZONE = pytz.timezone("Europe/Moscow")

# === ЗАГРУЗКА РАСПИСАНИЯ ===
with open(ICS_FILE, "r", encoding="utf-8") as f:
    cal = Calendar(f.read())

# Преобразуем события в список
events = []
for e in cal.events:
    start = e.begin.astimezone(TIMEZONE).replace(tzinfo=None)
    end = e.end.astimezone(TIMEZONE).replace(tzinfo=None)
    events.append({
        "summary": e.name.strip(),
        "start": start,
        "end": end,
        "desc": e.description or "",
    })

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
