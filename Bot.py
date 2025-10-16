import os, json, re
from datetime import datetime, timezone, timedelta
from pathlib import Path

from flask import Flask, request, abort
from dotenv import load_dotenv
import pytz

from linebot import LineBotApi, WebhookHandler
from linebot.exceptions import InvalidSignatureError
from linebot.models import MessageEvent, TextMessage, TextSendMessage, QuickReply, QuickReplyButton, MessageAction

load_dotenv()
app = Flask(__name__)

CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET")
CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")
TZ_NAME = os.getenv("TZ", "Asia/Bangkok")

if not CHANNEL_SECRET or not CHANNEL_ACCESS_TOKEN:
    raise RuntimeError("Please set LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN in .env")

line_bot_api = LineBotApi(CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(CHANNEL_SECRET)

DATA_DIR = Path("data")
PAYERS_FILE = DATA_DIR / "payers.json"
STATUS_FILE = DATA_DIR / "status.json"

DATA_DIR.mkdir(exist_ok=True)
if not STATUS_FILE.exists():
    STATUS_FILE.write_text("[]", encoding="utf-8")

def bkk_now():
    return datetime.now(pytz.timezone(TZ_NAME))

def year_month_key(dt=None):
    dt = dt or bkk_now()
    return f"{dt.year}-{str(dt.month).zfill(2)}"

def load_payers():
    if not PAYERS_FILE.exists():
        return []
    return json.loads(PAYERS_FILE.read_text(encoding="utf-8"))

def load_status():
    return json.loads(STATUS_FILE.read_text(encoding="utf-8"))

def save_status(rows):
    STATUS_FILE.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

def is_paid(user_id, yyyymm):
    return any(r["userId"] == user_id and r["month"] == yyyymm and r.get("paid") for r in load_status())

def mark_paid(user_id, when=None):
    rows = load_status()
    yyyymm = year_month_key(when)
    # update if exists
    for r in rows:
        if r["userId"] == user_id and r["month"] == yyyymm:
            r["paid"] = True
            r["paidAt"] = bkk_now().isoformat()
            save_status(rows)
            return
    # else insert
    rows.append({
        "userId": user_id,
        "month": yyyymm,
        "paid": True,
        "paidAt": bkk_now().isoformat()
    })
    save_status(rows)

def set_unsubscribed(user_id, flag=True):
    # simple unsubscribe by storing a status record with paid=False and note='stop' for this month
    rows = load_status()
    yyyymm = year_month_key()
    rows.append({
        "userId": user_id,
        "month": yyyymm,
        "paid": False,
        "note": "stop" if flag else "resume",
        "at": bkk_now().isoformat()
    })
    save_status(rows)

def quick_reply_paid():
    return QuickReply(items=[
        QuickReplyButton(action=MessageAction(label="ชำระแล้ว", text="จ่ายแล้ว")),
        QuickReplyButton(action=MessageAction(label="Paid", text="paid")),
    ])

@app.route("/webhook", methods=["POST"])
def webhook():
    signature = request.headers.get("X-Line-Signature", "")
    body = request.get_data(as_text=True)
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        abort(401, "Invalid signature")
    return "OK"

@handler.add(MessageEvent, message=TextMessage)
def on_text_message(event: MessageEvent):
    text = (event.message.text or "").strip().lower()
    user_id = event.source.user_id

    if re.match(r"^(paid|จ่ายแล้ว)\b", text):
        mark_paid(user_id)
        line_bot_api.reply_message(
            event.reply_token,
            TextSendMessage(text="รับทราบการชำระแล้วครับ ✅ ขอบคุณมาก!", quick_reply=quick_reply_paid())
        )
        return

    if text in ("stop", "ยกเลิก"):
        set_unsubscribed(user_id, True)
        line_bot_api.reply_message(event.reply_token, TextSendMessage(text="โอเค จะไม่ส่งเตือนอีกในรอบนี้ 🙏"))
        return

    if text in ("help", "ช่วยด้วย", "how"):
        line_bot_api.reply_message(event.reply_token, TextSendMessage(
            text='พิมพ์ "จ่ายแล้ว" หรือ "paid" เพื่อบันทึกการชำระ\nพิมพ์ "stop" หรือ "ยกเลิก" เพื่อหยุดเตือนรอบนี้',
            quick_reply=quick_reply_paid()
        ))
        return

    # default help
    line_bot_api.reply_message(event.reply_token, TextSendMessage(
        text='สวัสดี! พิมพ์ "จ่ายแล้ว" หรือ "paid" เพื่อบันทึกการชำระ 👍',
        quick_reply=quick_reply_paid()
    ))

@app.route("/cron/monthly", methods=["GET"])
def cron_monthly():
    """Call this via an external scheduler on the day/time you want."""
    payers = load_payers()
    now = bkk_now()
    y, m, d = now.year, now.month, now.day
    yyyymm = year_month_key(now)

    sent = 0
    for p in payers:
        # skip if not today or already paid
        if int(p.get("cycle_day", 1)) != d:
            continue
        if is_paid(p["id"], yyyymm):
            continue

        link = f"promptpay://{p['promptpay']}" if p.get("promptpay") else "กรุณาโอนตามช่องทางเดิม"
        text = (
            f"สวัสดี {p.get('name','เพื่อน')} ✨\n"
            f"ย้ำเตือนค่าใช้จ่าย {m:02d}/{y} จำนวน {p.get('amount',0)} บาท\n"
            f"ชำระได้ที่นี่: {link}\n"
            f'พิมพ์ "จ่ายแล้ว" หรือ "paid" เมื่อโอนเสร็จนะครับ/ค่ะ 🙏'
        )

        try:
            line_bot_api.push_message(
                p["id"],
                TextSendMessage(text=text, quick_reply=quick_reply_paid())
            )
            sent += 1
        except Exception as e:
            print("Push failed:", e)

    return f"Pushed {sent} reminders on {now.isoformat()}"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 3000)))
