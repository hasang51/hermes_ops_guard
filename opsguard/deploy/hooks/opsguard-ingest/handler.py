import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

INGEST_URL = "http://127.0.0.1:3000/api/ingest"
LOG_FILE = Path(__file__).with_name("hook.log")


def _log(message: str) -> None:
    try:
        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with LOG_FILE.open("a", encoding="utf-8") as log:
            log.write(f"{timestamp} {message}\n")
    except Exception:
        pass


def _deliver(payload: dict, chat_id: str, session_id: str) -> None:
    try:
        request = Request(
            INGEST_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=120) as response:
            response.read(1024)
            _log(
                f"delivered status={response.status} "
                f"chat_id={chat_id} session_id={session_id}"
            )
    except Exception as error:
        _log(
            f"delivery_failed error={type(error).__name__} "
            f"chat_id={chat_id} session_id={session_id}"
        )


def handle(event_type: str, context: dict) -> None:
    try:
        if event_type != "agent:start" or context.get("platform") != "telegram":
            return

        message = str(context.get("message") or "").strip()
        user_id = str(context.get("user_id") or "").strip()
        chat_id = str(context.get("chat_id") or "").strip()
        session_id = str(context.get("session_id") or "").strip()

        if not message or message.startswith("/") or not user_id:
            return

        payload = {
            "source": "telegram",
            "sender": f"telegram:{user_id}",
            "text": message,
        }
        threading.Thread(
            target=_deliver,
            args=(payload, chat_id, session_id),
            name="opsguard-ingest",
            daemon=True,
        ).start()
        _log(f"queued chat_id={chat_id} session_id={session_id}")
    except Exception as error:
        _log(f"handler_failed error={type(error).__name__}")
