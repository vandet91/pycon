import os
import sqlite3
import random
import feedparser
import requests
from bs4 import BeautifulSoup
from datetime import datetime
from zoneinfo import ZoneInfo
from telegram import Update, constants, ReplyKeyboardMarkup, KeyboardButton
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes

# --- CONFIGURATION ---
ADMIN_ID = 648195309
TOKEN = os.getenv("BOT_TOKEN", "8697978271:AAERfsG2KxnIPesQViRSoSzdfdEwbQfT9SU")

# Global history to prevent duplicates during the current session
news_history = []

# --- DATABASE LOGIC ---
def init_db():
    conn = sqlite3.connect('bot_database.db')
    cursor = conn.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS subscribers
                      (user_id INTEGER PRIMARY KEY, username TEXT, full_name TEXT)''')
    conn.commit()
    conn.close()

def add_subscriber(user_id, username, full_name):
    conn = sqlite3.connect('bot_database.db')
    cursor = conn.cursor()
    cursor.execute('INSERT OR IGNORE INTO subscribers VALUES (?, ?, ?)', (user_id, username, full_name))
    conn.commit()
    conn.close()

def get_all_subscribers():
    conn = sqlite3.connect('bot_database.db')
    cursor = conn.cursor()
    cursor.execute('SELECT user_id, full_name, username FROM subscribers')
    users = cursor.fetchall()
    conn.close()
    return users

# --- KHMER CALENDAR LOGIC ---
class KhmerCalendarLogic:
    @staticmethod
    def to_kh_numeral(number):
        kh_numbers = {'0': '០', '1': '១', '2': '២', '3': '៣', '4': '៤',
                      '5': '៥', '6': '៦', '7': '៧', '8': '៨', '9': '៩'}
        return ''.join(kh_numbers.get(char, char) for char in str(number))

    @staticmethod
    def get_khmer_date(dt):
        kh_days = ["អាទិត្យ", "ច័ន្ទ", "អង្គារ", "ពុធ", "ព្រហស្បតិ៍", "សុក្រ", "សៅរ៍"]
        kh_months_lunar = ["ចេត្រ", "ពិសាខ", "ជេស្ឋ", "អាសាឍ", "ស្រាពណ៍", "ភទ្របទ", "អស្សុជ", "កក្ដិក", "មិគសិរ", "បុស្ស", "មាឃ", "ផល្គុន"]
        kh_months_solar = ["មករា", "កុម្ភៈ", "មីនា", "មេសា", "ឧសភា", "មិថុនា", "កក្កដា", "សីហា", "កញ្ញា", "តុលា", "វិច្ឆិកា", "ធ្នូ"]
        kh_zodiac = ["ជូត", "ឆ្លូវ", "ខាល", "ថោះ", "រោង", "ម្សាញ់", "មមី", "មមែ", "វក", "រកា", "ច", "កុរ"]
        kh_eras = ["ឯកស័ក", "ទោស័ក", "ត្រីស័ក", "ចត្វាស័ក", "បញ្ចស័ក", "ឆស័ក", "សប្តស័ក", "អដ្ឋស័ក", "នព្វស័ក", "សំរឹទ្ធិស័ក"]

        solar_day = KhmerCalendarLogic.to_kh_numeral(dt.day)
        solar_month = kh_months_solar[dt.month - 1]
        solar_year = KhmerCalendarLogic.to_kh_numeral(dt.year)
        day_name = kh_days[int(dt.strftime("%w"))]
        lunar_num = KhmerCalendarLogic.to_kh_numeral((dt.day % 15) or 15)
        phase = "កើត" if (dt.day <= 15) else "រោច"
        lunar_month = kh_months_lunar[(dt.month - 1) % 12]
        zodiac_name = kh_zodiac[(dt.year - 4) % 12]
        era_name = kh_eras[(dt.year - 2) % 10]
        be_year = KhmerCalendarLogic.to_kh_numeral(dt.year + 544)

        return (f"ថ្ងៃទី{solar_day} ខែ {solar_month} គ.ស {solar_year} ត្រូវនឹង "
                f"ថ្ងៃ{day_name} {lunar_num}{phase} ខែ{lunar_month} ឆ្នាំ{zodiac_name} {era_name} ព.ស {be_year}")

# --- NEWS LOGIC ---
async def fetch_khmer_news():
    global news_history
    all_articles = []

    rss_urls = [
        "https://kohsantepheapdaily.com.kh/feed",
        "https://www.kampucheathmey.com/feed",
        "https://www.rfi.fr/km/general/rss",
        "https://thmeythmey.com/rss",
        "https://cambodianess.com/feed"
    ]
    for url in rss_urls:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                all_articles.append({"title": entry.title, "link": entry.link})
        except:
            continue

    try:
        fn_res = requests.get("https://m.freshnews.com.kh/kh/", timeout=5)
        fn_soup = BeautifulSoup(fn_res.content, "html.parser")
        for item in fn_soup.select(".news-list-item"):
            title = item.select_one(".news-title").text.strip()
            link = "https://m.freshnews.com.kh" + item.select_one("a")['href']
            all_articles.append({"title": title, "link": link})
    except:
        pass

    try:
        akp_res = requests.get("https://akp.gov.kh/kh", timeout=5)
        akp_soup = BeautifulSoup(akp_res.content, "html.parser")
        for item in akp_soup.select(".news-title"):
            title = item.text.strip()
            link = "https://akp.gov.kh" + item.select_one("a")['href']
            all_articles.append({"title": title, "link": link})
    except:
        pass

    try:
        vod_res = requests.get("https://www.vodkhmer.news/category/national/", timeout=5)
        vod_soup = BeautifulSoup(vod_res.content, "html.parser")
        for item in vod_soup.select(".post-title"):
            all_articles.append({"title": item.text.strip(), "link": item.select_one("a")['href']})
    except:
        pass

    available = [a for a in all_articles if a['title'] not in news_history]
    if len(available) < 5:
        news_history = []
        available = all_articles

    if not available:
        return None

    random.shuffle(available)
    selection = available[:5]
    news_history.extend([a['title'] for a in selection])
    return selection

# --- HANDLERS ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    add_subscriber(user.id, user.username, user.full_name)

    keyboard = [
        [KeyboardButton("📅 ថ្ងៃនេះ (Today)"), KeyboardButton("🔥 ព័ត៌មានថ្មីៗ (News)")],
        [KeyboardButton("📘 Help")]
    ]

    if user.id == ADMIN_ID:
        keyboard.insert(1, [KeyboardButton("👥 បញ្ជីអ្នកប្រើប្រាស់ (Admin Only)")])
        keyboard.insert(2, [KeyboardButton("📢 ផ្សព្វផ្សាយព័ត៌មាន (Broadcast)")])

    reply_markup = ReplyKeyboardMarkup(keyboard, resize_keyboard=True)
    await update.message.reply_text(
        "👋 សូមស្វាគមន៍មកកាន់ Khmer Date Bot!",
        reply_markup=reply_markup,
        parse_mode=constants.ParseMode.MARKDOWN
    )

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    user_id = update.effective_user.id

    if text == "📅 ថ្ងៃនេះ (Today)":
        now = datetime.now(ZoneInfo("Asia/Phnom_Penh"))
        kh_date = KhmerCalendarLogic.get_khmer_date(now)
        await update.message.reply_text(f"`{kh_date}`", parse_mode=constants.ParseMode.MARKDOWN_V2)

    elif text == "🔥 ព័ត៌មានថ្មីៗ (News)":
        articles = await fetch_khmer_news()
        if articles:
            formatted = "\n\n".join([
                f"{KhmerCalendarLogic.to_kh_numeral(i+1)}. <a href='{a['link']}'>{a['title']}</a>"
                for i, a in enumerate(articles)
            ])
            await update.message.reply_text(
                f"📰 <b>ព័ត៌មានថ្មីៗបំផុត៖</b>\n\n{formatted}",
                parse_mode=constants.ParseMode.HTML,
                disable_web_page_preview=True
            )
        else:
            await update.message.reply_text("មិនមានព័ត៌មានដែលគួរអោយចាប់អារម្មណ៍នោះទេ")

    elif text == "📢 ផ្សព្វផ្សាយព័ត៌មាន (Broadcast)" and user_id == ADMIN_ID:
        articles = await fetch_khmer_news()
        if not articles:
            await update.message.reply_text("មិនមានព័ត៌មានសម្រាប់ផ្សព្វផ្សាយឡើយ។")
            return

        formatted = "\n\n".join([
            f"{KhmerCalendarLogic.to_kh_numeral(i+1)}. <a href='{a['link']}'>{a['title']}</a>"
            for i, a in enumerate(articles)
        ])
        broadcast_msg = f"📢 <b>ការផ្សព្វផ្សាយព័ត៌មានថ្មីៗ៖</b>\n\n{formatted}"

        subscribers = get_all_subscribers()
        count = 0
        for sub in subscribers:
            try:
                # FIX: sub is (user_id, full_name, username) — use sub[0]
                await context.bot.send_message(
                    chat_id=sub[0],
                    text=broadcast_msg,
                    parse_mode=constants.ParseMode.HTML,
                    disable_web_page_preview=True
                )
                count += 1
            except:
                continue

        await update.message.reply_text(
            f"✅ បានផ្សព្វផ្សាយដល់អ្នកប្រើប្រាស់ចំនួន {KhmerCalendarLogic.to_kh_numeral(count)} នាក់។"
        )

    elif text == "👥 បញ្ជីអ្នកប្រើប្រាស់ (Admin Only)" and user_id == ADMIN_ID:
        users = get_all_subscribers()
        if not users:
            await update.message.reply_text("មិនទាន់មានអ្នកប្រើប្រាស់ណាម្នាក់នៅឡើយ។")
            return
        # FIX: u is (user_id, full_name, username)
        user_list = "\n".join([f"• {u[1]} (@{u[2] or 'N/A'}) — ID: {u[0]}" for u in users])
        await update.message.reply_text(
            f"👥 <b>បញ្ជីឈ្មោះអ្នកប្រើប្រាស់ ({len(users)} នាក់)៖</b>\n\n{user_list}",
            parse_mode=constants.ParseMode.HTML
        )

    elif text == "📘 Help":
        await update.message.reply_text(
            "សូមផ្ញើថ្ងៃខែជាទម្រង់ `DD-MM-YYYY` (ឧទាហរណ៍៖ `07-05-2026`)។"
        )

    else:
        try:
            dt = datetime.strptime(text, "%d-%m-%Y")
            kh_date = KhmerCalendarLogic.get_khmer_date(dt)
            await update.message.reply_text(f"`{kh_date}`", parse_mode=constants.ParseMode.MARKDOWN_V2)
        except ValueError:
            await update.message.reply_text(
                "❌ សូមប្រើទម្រង់៖ `DD-MM-YYYY` (ឧទាហរណ៍៖ `07-05-2026`)។"
            )

if __name__ == '__main__':
    init_db()
    app = ApplicationBuilder().token(TOKEN).build()

    # FIX: register start command handler
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), handle_message))

    print("Bot is running...")
    app.run_polling()
