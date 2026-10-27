"""Small CDP screenshot helper for design review (uses the installed Chrome).

Usage:
    python tools/shoot.py                 # era 8
    python tools/shoot.py 0 4 8           # selected eras
    python tools/shoot.py home            # homepage, desktop
    python tools/shoot.py home-mobile     # homepage, phone
    python tools/shoot.py planets         # every world timeline, today
    python tools/shoot.py planet-saturn   # one planet timeline, today
    python tools/shoot.py planet-mars-3   # one planet, chapter 3
    python tools/shoot.py all             # homepage + every era + planets
"""

import base64
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import websocket

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "shots"
PORT = int(os.environ.get("CDP_PORT", "9334"))
BASE = f"http://127.0.0.1:{PORT}"
SITE = os.environ.get("SITE_URL", "http://127.0.0.1:4173")

PLANETS = ["sun", "mercury", "venus", "earth", "moon", "mars", "jupiter", "saturn", "uranus", "neptune"]


def get_page_ws():
    for _ in range(50):
        try:
            with urllib.request.urlopen(f"{BASE}/json/list", timeout=2) as response:
                pages = json.load(response)
            for page in pages:
                if page.get("type") == "page":
                    return page["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.2)
    raise RuntimeError("Chrome DevTools endpoint not ready")


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=30, suppress_origin=True)
        self.message_id = 0

    def send(self, method, params=None):
        self.message_id += 1
        payload = {"id": self.message_id, "method": method, "params": params or {}}
        self.ws.send(json.dumps(payload))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == self.message_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})

    def close(self):
        self.ws.close()


def wait_ready(cdp, timeout=20.0):
    start = time.time()
    time.sleep(0.6)
    while time.time() - start < timeout:
        result = cdp.send("Runtime.evaluate", {
            "expression": "document.body.classList.contains('is-ready')",
            "returnByValue": True,
        })
        if result.get("result", {}).get("value"):
            return True
        time.sleep(0.25)
    return False


def shoot(cdp, url, out, wait=1.8, width=1440, height=900, mobile=False, reduced=False):
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": width,
        "height": height,
        "deviceScaleFactor": 1,
        "mobile": mobile,
    })
    cdp.send("Emulation.setEmulatedMedia", {
        "features": [{"name": "prefers-reduced-motion", "value": "reduce" if reduced else "no-preference"}]
    })
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": mobile, "maxTouchPoints": 1})
    cdp.send("Emulation.setPageScaleFactor", {"pageScaleFactor": 1})
    time.sleep(0.4)
    cdp.send("Page.navigate", {"url": url})
    if not wait_ready(cdp):
        print("warning: page did not signal ready:", url)
    time.sleep(wait)

    # Switching between phone and desktop emulation can leave stale text
    # layers on the compositor. Nudge the viewport so every layer is
    # rasterised again at the final scale before the screenshot.
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": width + 1,
        "height": height,
        "deviceScaleFactor": 1,
        "mobile": mobile,
    })
    time.sleep(0.25)
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": width,
        "height": height,
        "deviceScaleFactor": 1,
        "mobile": mobile,
    })
    time.sleep(0.9)

    result = cdp.send("Page.captureScreenshot", {
        "format": "png",
        "fromSurface": True,
        "captureBeyondViewport": False,
    })
    with open(out, "wb") as handle:
        handle.write(base64.b64decode(result["data"]))
    print("wrote", out)


def main():
    targets = sys.argv[1:] or ["8"]
    if "all" in targets:
        targets = ["home", "home-mobile", "planets"] + [str(era) for era in range(9)]

    cdp = CDP(get_page_ws())
    cdp.send("Page.enable")
    cdp.send("Runtime.enable")
    cdp.send("Network.enable")
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
    OUT.mkdir(exist_ok=True)
    stamp = int(time.time())

    for target in list(targets):
        if target == "planets":
            index = targets.index(target)
            targets[index:index + 1] = [f"planet-{key}" for key in PLANETS]
    targets = list(dict.fromkeys(targets))

    for target in targets:
        if target == "home":
            shoot(
                cdp,
                f"{SITE}/?shot={stamp}",
                OUT / "home.png",
                wait=2.2,
            )
        elif target == "home-mobile":
            shoot(
                cdp,
                f"{SITE}/?shot={stamp}",
                OUT / "home_mobile.png",
                wait=2.2,
                width=390,
                height=844,
                mobile=True,
            )
        elif target.startswith("planet-"):
            parts = target.split("-")
            key = parts[1]
            if key not in PLANETS:
                raise SystemExit(f"unknown planet: {key}")
            era = parts[2] if len(parts) > 2 and parts[2].isdigit() else None
            suffix = f"planet={key}" + (f"&era={era}" if era else "")
            shoot(
                cdp,
                f"{SITE}/timeline.html?{suffix}&shot={stamp}",
                OUT / f"planet_{key}{f'_{era}' if era else ''}.png",
            )
        else:
            shoot(
                cdp,
                f"{SITE}/timeline.html?era={target}&shot={stamp}",
                OUT / f"era_{target}.png",
            )
    cdp.close()


if __name__ == "__main__":
    main()
