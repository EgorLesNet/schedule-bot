{\rtf1\ansi\ansicpg1252\cocoartf2865
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;\f1\fnil\fcharset0 AppleColorEmoji;\f2\fnil\fcharset0 STIXTwoMath-Regular;
}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 import datetime\
import pytz\
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup\
from telegram.ext import ApplicationBuilder, CallbackQueryHandler, CommandHandler, ContextTypes\
from ics import Calendar\
\
# === \uc0\u1053 \u1040 \u1057 \u1058 \u1056 \u1054 \u1049 \u1050 \u1048  ===\
BOT_TOKEN = "8016190941:AAFqoM5ysLgaGF6MtKh3KM9z-gKWLmW8kBs"\
ICS_FILE = "GAUGN_1_kurs_2_potok_nodups.ics"\
TIMEZONE = pytz.timezone("Europe/Moscow")\
\
# === \uc0\u1047 \u1040 \u1043 \u1056 \u1059 \u1047 \u1050 \u1040  \u1056 \u1040 \u1057 \u1055 \u1048 \u1057 \u1040 \u1053 \u1048 \u1071  ===\
with open(ICS_FILE, "r", encoding="utf-8") as f:\
    cal = Calendar(f.read())\
\
# \uc0\u1055 \u1088 \u1077 \u1086 \u1073 \u1088 \u1072 \u1079 \u1091 \u1077 \u1084  \u1089 \u1086 \u1073 \u1099 \u1090 \u1080 \u1103  \u1074  \u1089 \u1087 \u1080 \u1089 \u1086 \u1082 \
events = []\
for e in cal.events:\
    start = e.begin.astimezone(TIMEZONE).replace(tzinfo=None)\
    end = e.end.astimezone(TIMEZONE).replace(tzinfo=None)\
    events.append(\{\
        "summary": e.name.strip(),\
        "start": start,\
        "end": end,\
        "desc": e.description or "",\
    \})\
\
# === \uc0\u1060 \u1059 \u1053 \u1050 \u1062 \u1048 \u1048  ===\
def get_week_range(date):\
    start = date - datetime.timedelta(days=date.weekday())\
    end = start + datetime.timedelta(days=6)\
    return start, end\
\
def format_event(ev):\
    desc = ev["desc"]\
    teacher = ""\
    room = ""\
    # \uc0\u1055 \u1088 \u1077 \u1087 \u1086 \u1076 \u1072 \u1074 \u1072 \u1090 \u1077 \u1083 \u1100  \u1080  \u1072 \u1091 \u1076 \u1080 \u1090 \u1086 \u1088 \u1080 \u1103  \u1080 \u1079  \u1090 \u1077 \u1082 \u1089 \u1090 \u1072 \
    if "\uc0\u1055 \u1088 \u1077 \u1087 \u1086 \u1076 \u1072 \u1074 \u1072 \u1090 \u1077 \u1083 \u1100 " in desc:\
        teacher = desc.split("\uc0\u1055 \u1088 \u1077 \u1087 \u1086 \u1076 \u1072 \u1074 \u1072 \u1090 \u1077 \u1083 \u1100 :")[1].split("\\\\n")[0].strip()\
    if "\uc0\u1040 \u1091 \u1076 \u1080 \u1090 \u1086 \u1088 \u1080 \u1103 " in desc:\
        room = desc.split("\uc0\u1040 \u1091 \u1076 \u1080 \u1090 \u1086 \u1088 \u1080 \u1103 :")[1].split("\\\\n")[0].strip()\
    return (f"\{ev['start'].strftime('%H:%M')\}\'96\{ev['end'].strftime('%H:%M')\}  \{ev['summary']\}"\
            + (f"\\n
\f1 \uc0\u55357 \u56424 \u8205 \u55356 \u57323 
\f0  \{teacher\}" if teacher else "")\
            + (f" | 
\f1 \uc0\u55357 \u56525 
\f0 \{room\}" if room else ""))\
\
def events_for_day(date):\
    return [e for e in events if e["start"].date() == date]\
\
def events_for_week(start_date):\
    start, end = get_week_range(start_date)\
    return [e for e in events if start <= e["start"].date() <= end]\
\
def format_day(date, evs):\
    if not evs:\
        return f"
\f1 \uc0\u55357 \u56517 
\f0  \{date.strftime('%A, %d %B')\} \'97 \uc0\u1079 \u1072 \u1085 \u1103 \u1090 \u1080 \u1081  \u1085 \u1077 \u1090 \\n"\
    text = f"
\f1 \uc0\u55357 \u56517 
\f0  \{date.strftime('%A, %d %B')\}:\\n"\
    for ev in sorted(evs, key=lambda x: x["start"]):\
        text += f"\{format_event(ev)\}\\n\\n"\
    return text\
\
# === \uc0\u1054 \u1041 \u1056 \u1040 \u1041 \u1054 \u1058 \u1063 \u1048 \u1050 \u1048  ===\
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):\
    keyboard = [\
        [InlineKeyboardButton("
\f1 \uc0\u55357 \u56517 
\f0  \uc0\u1057 \u1077 \u1075 \u1086 \u1076 \u1085 \u1103 ", callback_data="today")],\
        [InlineKeyboardButton("
\f1 \uc0\u55357 \u56787 
\f0  \uc0\u1069 \u1090 \u1072  \u1085 \u1077 \u1076 \u1077 \u1083 \u1103 ", callback_data="this_week")],\
        [InlineKeyboardButton("
\f2 \uc0\u9197 
\f0  \uc0\u1057 \u1083 \u1077 \u1076 \u1091 \u1102 \u1097 \u1072 \u1103  \u1085 \u1077 \u1076 \u1077 \u1083 \u1103 ", callback_data="next_week")]\
    ]\
    reply_markup = InlineKeyboardMarkup(keyboard)\
    await update.message.reply_text("\uc0\u1055 \u1088 \u1080 \u1074 \u1077 \u1090 ! 
\f1 \uc0\u55357 \u56395 
\f0 \\n\uc0\u1042 \u1099 \u1073 \u1077 \u1088 \u1080 , \u1095 \u1090 \u1086  \u1087 \u1086 \u1082 \u1072 \u1079 \u1072 \u1090 \u1100 :", reply_markup=reply_markup)\
\
async def handle_query(update: Update, context: ContextTypes.DEFAULT_TYPE):\
    query = update.callback_query\
    await query.answer()\
\
    today = datetime.datetime.now(TIMEZONE).date()\
    if query.data == "today":\
        evs = events_for_day(today)\
        text = format_day(today, evs)\
\
    elif query.data == "this_week":\
        start, end = get_week_range(today)\
        text = "
\f1 \uc0\u55357 \u56787 
\f0  \uc0\u1056 \u1072 \u1089 \u1087 \u1080 \u1089 \u1072 \u1085 \u1080 \u1077  \u1085 \u1072  \u1101 \u1090 \u1091  \u1085 \u1077 \u1076 \u1077 \u1083 \u1102 :\\n\\n"\
        for i in range(5):  # \uc0\u1055 \u1085 \'96\u1055 \u1090 \
            d = start + datetime.timedelta(days=i)\
            text += format_day(d, events_for_day(d)) + "\\n"\
\
    elif query.data == "next_week":\
        start, end = get_week_range(today + datetime.timedelta(days=7))\
        text = "
\f2 \uc0\u9197 
\f0  \uc0\u1056 \u1072 \u1089 \u1087 \u1080 \u1089 \u1072 \u1085 \u1080 \u1077  \u1085 \u1072  \u1089 \u1083 \u1077 \u1076 \u1091 \u1102 \u1097 \u1091 \u1102  \u1085 \u1077 \u1076 \u1077 \u1083 \u1102 :\\n\\n"\
        for i in range(5):\
            d = start + datetime.timedelta(days=i)\
            text += format_day(d, events_for_day(d)) + "\\n"\
\
    else:\
        text = "\uc0\u1053 \u1077 \u1080 \u1079 \u1074 \u1077 \u1089 \u1090 \u1085 \u1072 \u1103  \u1082 \u1086 \u1084 \u1072 \u1085 \u1076 \u1072 "\
\
    keyboard = [\
        [InlineKeyboardButton("
\f1 \uc0\u55357 \u56517 
\f0  \uc0\u1057 \u1077 \u1075 \u1086 \u1076 \u1085 \u1103 ", callback_data="today")],\
        [InlineKeyboardButton("
\f1 \uc0\u55357 \u56787 
\f0  \uc0\u1069 \u1090 \u1072  \u1085 \u1077 \u1076 \u1077 \u1083 \u1103 ", callback_data="this_week")],\
        [InlineKeyboardButton("
\f2 \uc0\u9197 
\f0  \uc0\u1057 \u1083 \u1077 \u1076 \u1091 \u1102 \u1097 \u1072 \u1103  \u1085 \u1077 \u1076 \u1077 \u1083 \u1103 ", callback_data="next_week")]\
    ]\
    await query.edit_message_text(text=text, reply_markup=InlineKeyboardMarkup(keyboard))\
\
# === \uc0\u1047 \u1040 \u1055 \u1059 \u1057 \u1050  ===\
def main():\
    app = ApplicationBuilder().token(BOT_TOKEN).build()\
    app.add_handler(CommandHandler("start", start))\
    app.add_handler(CallbackQueryHandler(handle_query))\
    app.run_polling()\
\
if __name__ == "__main__":\
    main()}