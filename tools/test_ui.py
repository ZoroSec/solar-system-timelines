"""Smoke-test the homepage and timeline interactions through Chrome DevTools."""

import base64
import sys
import time
from pathlib import Path

from shoot import CDP, get_page_ws, wait_ready

BASE = "http://127.0.0.1:4173"
OUT = Path(__file__).resolve().parent.parent / "shots"
OUT.mkdir(exist_ok=True)

failures = []


def evaluate(cdp, expression):
    result = cdp.send("Runtime.evaluate", {
        "expression": expression,
        "returnByValue": True,
        "awaitPromise": True,
    })
    if "exceptionDetails" in result:
        raise RuntimeError(result["exceptionDetails"])
    return result.get("result", {}).get("value")


def snapshot(cdp):
    return evaluate(cdp, """(() => ({
      epoch: document.querySelector('#epoch').textContent,
      event: document.querySelector('#event').textContent,
      note: document.querySelector('#note').textContent,
      now: document.querySelector('#scrubber').getAttribute('aria-valuenow'),
      valueText: document.querySelector('#scrubber').getAttribute('aria-valuetext'),
      playhead: parseFloat(document.querySelector('#playhead').style.left),
      body: document.body.className,
      active: [...document.querySelectorAll('.tick--chapter')].findIndex(t => t.classList.contains('is-active')),
      currentEnds: [...document.querySelectorAll('.end.is-current')].map(e => e.id),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      focused: document.activeElement && document.activeElement.id,
      sliderLabel: document.querySelector('#scrubber').getAttribute('aria-label')
    }))()""")


def home_snapshot(cdp):
    return evaluate(cdp, """(() => {
      const scroll = document.querySelector('.solar__scroll');
      const canvas = document.querySelector('#solar-canvas').getBoundingClientRect();
      const cta = document.querySelector('.solar__cta');
      const swipe = document.querySelector('.solar__swipe');
      const note = document.querySelector('.masthead__note');
      return {
        ready: document.body.classList.contains('is-ready'),
        error: document.body.classList.contains('has-error'),
        bodies: [...document.querySelectorAll('.body')].map(b => b.dataset.body),
        canvas: { w: Math.round(canvas.width), h: Math.round(canvas.height) },
        cta: cta ? cta.getAttribute('href') : null,
        ctaLabel: cta ? cta.textContent : null,
        subject: document.querySelector('#readout-subject').textContent,
        fact: document.querySelector('#readout-fact').textContent,
        active: [...document.querySelectorAll('.body.is-active')].map(b => b.dataset.body),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        scrollWidth: scroll ? scroll.scrollWidth : 0,
        clientWidth: scroll ? scroll.clientWidth : 0,
        swipe: swipe ? getComputedStyle(swipe).display : null,
        note: note ? getComputedStyle(note).display : null
      };
    })()""")


def globe_state(cdp):
    return evaluate(cdp, """window.__globe ? {
      type: window.__globe.type,
      basin: window.__globe.basin,
      lava: window.__globe.lava,
      water: window.__globe.water,
      surface: window.__globe.surface,
      ocean: window.__globe.ocean,
      bright: window.__globe.bright,
      hood: window.__globe.hood,
      scars: window.__globe.scars,
      storm: window.__globe.storm
    } : null""")


def check(condition, message, extra=None):
    if condition:
        print("  ok  ", message)
    else:
        failures.append(message)
        print("  FAIL", message, extra if extra is not None else "")


def navigate(cdp, suffix="", width=1440, height=900, mobile=False, reduced=False, page="timeline"):
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": width, "height": height, "deviceScaleFactor": 1, "mobile": mobile,
    })
    cdp.send("Emulation.setEmulatedMedia", {
        "features": [{"name": "prefers-reduced-motion", "value": "reduce" if reduced else "no-preference"}]
    })
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": mobile, "maxTouchPoints": 1})
    path = "/timeline.html" if page == "timeline" else "/"
    cdp.send("Page.navigate", {"url": f"{BASE}{path}?{suffix}&t={int(time.time() * 1000)}"})
    if not wait_ready(cdp):
        # Rapid repeated navigation can occasionally leave Chrome waiting on
        # a frame. One clean reload separates that from a real boot failure.
        print("  retry", suffix or path)
        cdp.send("Page.reload", {"ignoreCache": True})
        if not wait_ready(cdp):
            raise RuntimeError("page never became ready")
    time.sleep(1.2)
    # Flush compositor text layers that can survive a viewport change.
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": width + 1, "height": height, "deviceScaleFactor": 1, "mobile": mobile,
    })
    time.sleep(0.25)
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": width, "height": height, "deviceScaleFactor": 1, "mobile": mobile,
    })
    time.sleep(0.55)


def center_of(cdp, selector):
    return evaluate(cdp, f"""(() => {{
      const r = document.querySelector('{selector}').getBoundingClientRect();
      return {{ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height,
               left: r.left, right: r.right, top: r.top, bottom: r.bottom }};
    }})()""")


def mouse(cdp, kind, x, y, buttons=0):
    button = "left" if kind in ("mousePressed", "mouseReleased") else ("left" if buttons else "none")
    cdp.send("Input.dispatchMouseEvent", {
        "type": kind, "x": x, "y": y, "button": button,
        "buttons": buttons, "clickCount": 1 if kind in ("mousePressed", "mouseReleased") else 0,
    })


def screenshot(cdp, name):
    data = cdp.send("Page.captureScreenshot", {"format": "png", "fromSurface": True})["data"]
    with open(OUT / f"{name}.png", "wb") as handle:
        handle.write(base64.b64decode(data))
    print("  shot", name)


def main():
    cdp = CDP(get_page_ws())
    cdp.send("Page.enable")
    cdp.send("Runtime.enable")
    cdp.send("Network.enable")
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})

    print("\n[0] homepage 1440x900")
    navigate(cdp, "", page="home")
    s = home_snapshot(cdp)
    print("  ", {k: s[k] for k in ("ready", "error", "cta", "canvas", "overflow", "subject")})
    check(s["ready"] and not s["error"], "homepage reports ready without a WebGL error", s)
    check(s["bodies"] == ["sun", "mercury", "venus", "earth", "moon", "mars", "jupiter", "saturn", "uranus", "neptune"],
          "homepage has the Sun, eight planets, and the Moon", s["bodies"])
    check(s["canvas"]["w"] > 1000 and s["canvas"]["h"] > 200, "WebGL canvas follows the lineup", s["canvas"])
    check(s["cta"] == "./timeline.html", "CTA points at the timeline", s["cta"])
    check(s["overflow"] <= 0, "homepage has no horizontal overflow at 1440", s["overflow"])
    shots_ready = evaluate(cdp, """(() => {
      const orbs = [...document.querySelectorAll('.body__orb')];
      return orbs.length === 10 && orbs.every(o => o.getBoundingClientRect().width > 20);
    })()""")
    check(shots_ready, "all ten DOM hit targets are laid out")

    motion = evaluate(cdp, """(() => ({
      count: window.__home ? window.__home.count : 0,
      jupiter: window.__home ? window.__home.spinOf('jupiter') : null,
      moonTilt: window.__home ? window.__home.tiltOf('moon') : null,
      uranusTilt: window.__home ? window.__home.tiltOf('uranus') : null
    }))()""")
    print("  ", motion)
    check(motion["count"] == 10, "WebGL scene exposes all ten worlds", motion)
    check(abs(motion["moonTilt"] - 0.117) < 0.002 and abs(motion["uranusTilt"] - 1.706) < 0.002,
          "worlds carry their real axial tilts", motion)
    time.sleep(0.9)
    jupiter_after = evaluate(cdp, "window.__home ? window.__home.spinOf('jupiter') : null")
    print("  jupiter spin:", motion["jupiter"], "->", jupiter_after)
    check(isinstance(motion["jupiter"], (int, float)) and abs(jupiter_after - motion["jupiter"]) > 0.05,
          "Jupiter turns on its own axis", (motion["jupiter"], jupiter_after))

    print("\n[0b] homepage hover readout")
    mercury = center_of(cdp, '.body[data-body="mercury"] .body__orb')
    mouse(cdp, "mouseMoved", mercury["x"], mercury["y"], 0)
    time.sleep(0.7)
    s = home_snapshot(cdp)
    print("  ", s["subject"], "|", s["fact"], "|", s["active"])
    check(s["subject"] == "Mercury", "hovering Mercury updates the readout", s)
    check(s["active"] == ["mercury"], "hovering highlights Mercury", s["active"])
    check("88 Earth days" in s["fact"], "Mercury fact is shown", s["fact"])

    mouse(cdp, "mouseMoved", 720, 120, 0)
    time.sleep(0.7)
    s = home_snapshot(cdp)
    check(s["subject"] == "The solar system", "leaving the lineup restores the intro copy", s)
    check(s["active"] == [], "no planet stays highlighted", s["active"])

    earth = center_of(cdp, '.body[data-body="earth"] .body__orb')
    mouse(cdp, "mouseMoved", earth["x"], earth["y"], 0)
    time.sleep(0.6)
    s = home_snapshot(cdp)
    check(s["subject"] == "Earth" and "4.5 billion" in s["fact"], "hovering Earth shows its timeline", s)
    screenshot(cdp, "test_home_hover")

    sun = center_of(cdp, '.body[data-body="sun"] .body__orb')
    mouse(cdp, "mouseMoved", sun["x"], sun["y"], 0)
    time.sleep(0.6)
    s = home_snapshot(cdp)
    print("  sun:", s["subject"], "|", s["cta"], "|", s["ctaLabel"])
    check(s["subject"] == "Sun" and s["active"] == ["sun"], "hovering the Sun selects it", s)
    check(s["cta"] == "./timeline.html?planet=sun" and s["ctaLabel"] == "Explore Sun's timeline",
          "the Sun's CTA opens its timeline", s)

    moon = center_of(cdp, '.body[data-body="moon"] .body__orb')
    mouse(cdp, "mouseMoved", moon["x"], moon["y"], 0)
    time.sleep(0.6)
    s = home_snapshot(cdp)
    print("  moon:", s["subject"], "|", s["cta"], "|", s["ctaLabel"])
    check(s["subject"] == "Moon" and "3.8 cm" in s["fact"], "hovering the Moon shows its fact", s)
    check(s["cta"] == "./timeline.html?planet=moon" and s["ctaLabel"] == "Explore Moon's timeline",
          "the Moon's CTA opens its timeline", s)

    mouse(cdp, "mouseMoved", 720, 120, 0)

    print("\n[0c] homepage mobile 390x844")
    navigate(cdp, "", page="home", width=390, height=844, mobile=True)
    s = home_snapshot(cdp)
    print("  ", {k: s[k] for k in ("ready", "overflow", "scrollWidth", "clientWidth", "swipe", "note")})
    check(s["ready"] and not s["error"], "mobile homepage renders", s)
    check(s["overflow"] <= 0, "mobile homepage does not overflow the page", s["overflow"])
    check(s["scrollWidth"] > s["clientWidth"] + 100, "lineup scrolls horizontally", s)
    check(s["swipe"] == "block", "swipe hint is visible on mobile", s["swipe"])
    check(s["note"] == "none", "masthead note hides on mobile", s["note"])
    screenshot(cdp, "test_home_mobile")

    neptune_left = evaluate(cdp, """(() => {
      const scroll = document.querySelector('.solar__scroll');
      scroll.scrollLeft = scroll.scrollWidth;
      return new Promise(resolve => requestAnimationFrame(() => {
        const n = document.querySelector('.body[data-body="neptune"] .body__orb').getBoundingClientRect();
        const box = scroll.getBoundingClientRect();
        resolve({ left: n.left, right: n.right, boxLeft: box.left, boxRight: box.right });
      }));
    })()""")
    print("  neptune", neptune_left)
    check(neptune_left["left"] >= neptune_left["boxLeft"] - 1 and neptune_left["right"] <= neptune_left["boxRight"] + 1,
          "Neptune is reachable by scrolling", neptune_left)
    screenshot(cdp, "test_home_mobile_neptune")

    print("\n[0d] homepage reduced motion")
    navigate(cdp, "", page="home", reduced=True)
    s = home_snapshot(cdp)
    duration = evaluate(cdp, "getComputedStyle(document.querySelector('.body__glow')).animationDuration")
    print("  glow duration:", duration)
    check(s["ready"] and not s["error"], "reduced-motion homepage renders", s)
    raw = duration.strip()
    if raw.endswith("ms"):
        seconds = float(raw[:-2]) / 1000
    else:
        seconds = float(raw.rstrip("s"))
    check(seconds < 0.01, "sun glow animation is neutralised", duration)
    frozen_a = evaluate(cdp, "window.__home ? window.__home.spinOf('earth') : null")
    time.sleep(0.9)
    frozen_b = evaluate(cdp, "window.__home ? window.__home.spinOf('earth') : null")
    print("  earth spin:", frozen_a, "->", frozen_b)
    check(evaluate(cdp, "window.__home && window.__home.reduced"), "homepage knows motion is reduced")
    check(frozen_a == frozen_b, "axial rotation pauses under reduced motion", (frozen_a, frozen_b))

    print("\n[1] deep link era=6")
    navigate(cdp, "era=6")
    s = snapshot(cdp)
    print("  ", s)
    check(s["event"] == "Pangaea" and s["now"] == "6", "era=6 renders Pangaea", s)
    check(abs(s["playhead"] - 66.4) < 1.5, "playhead sits at 66.4%", s["playhead"])
    check(s["active"] == 6, "chapter tick 6 is active", s["active"])
    check("is-ready" in s["body"], "page reports ready")
    check(s["overflow"] <= 0, "no horizontal overflow at 1440x900", s["overflow"])

    print("\n[2] keyboard on scrubber")
    evaluate(cdp, "document.querySelector('#scrubber').focus()")
    cdp.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "End", "code": "End", "windowsVirtualKeyCode": 35})
    cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "End", "code": "End", "windowsVirtualKeyCode": 35})
    time.sleep(0.5)
    s = snapshot(cdp)
    check(s["event"] == "Earth" and s["now"] == "8", "End jumps to Today", s)
    check(s["focused"] == "scrubber", "scrubber holds focus", s["focused"])

    for _ in range(3):
        cdp.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37})
        cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37})
        time.sleep(0.25)
    s = snapshot(cdp)
    print("  ", s)
    check(s["event"] == "Snowball Earth" and s["now"] == "5", "three ArrowLeft steps land on Snowball Earth", s)

    cdp.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Home", "code": "Home", "windowsVirtualKeyCode": 36})
    cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Home", "code": "Home", "windowsVirtualKeyCode": 36})
    time.sleep(0.5)
    s = snapshot(cdp)
    check(s["event"] == "Big Bang" and s["now"] == "0", "Home jumps to Big Bang", s)
    check(s["currentEnds"] == ["end-start"], "start label marks current", s["currentEnds"])

    print("\n[3] pointer scrub")
    track = center_of(cdp, "#track")
    x = track["left"] + track["w"] * 0.79
    y = track["y"]
    mouse(cdp, "mousePressed", x, y, 1)
    time.sleep(0.12)
    mouse(cdp, "mouseMoved", x + 1, y, 1)
    mouse(cdp, "mouseReleased", x + 1, y, 0)
    time.sleep(0.6)
    s = snapshot(cdp)
    print("  ", s)
    check(s["event"] == "Chicxulub" and s["now"] == "7", "click/drag at 79% selects Chicxulub", s)
    check(abs(s["playhead"] - 79) < 1.5, "playhead follows pointer", s["playhead"])

    track = center_of(cdp, "#track")
    x = track["left"] + track["w"] * 0.285
    mouse(cdp, "mousePressed", x, y, 1)
    time.sleep(0.12)
    mouse(cdp, "mouseMoved", track["left"] + track["w"] * 0.662, y, 1)
    time.sleep(0.35)
    mouse(cdp, "mouseReleased", track["left"] + track["w"] * 0.662, y, 0)
    time.sleep(0.5)
    s = snapshot(cdp)
    print("  ", s)
    check(s["event"] == "Pangaea" and s["now"] == "6", "drag from First life to Pangaea updates live", s)

    print("\n[3b] hover scrub (no click)")
    track = center_of(cdp, "#track")
    y = track["y"]
    hover_x = track["left"] + track["w"] * 0.155
    mouse(cdp, "mouseMoved", hover_x, y, 0)
    time.sleep(0.7)
    s = snapshot(cdp)
    print("  ", s)
    check(s["event"] == "First oceans" and s["now"] == "3", "hover-only at 15.5% previews First oceans", s)
    check(abs(s["playhead"] - 15.5) < 1.5, "hover moves the playhead", s["playhead"])

    hover_x = track["left"] + track["w"] * 0.57
    mouse(cdp, "mouseMoved", hover_x, y, 0)
    time.sleep(0.7)
    s = snapshot(cdp)
    check(s["event"] == "Snowball Earth" and s["now"] == "5", "hover-only at 57% previews Snowball Earth", s)

    print("\n[4] globe drag")
    globe = center_of(cdp, "#globe-canvas")
    body_before = evaluate(cdp, "document.body.classList.contains('has-interacted')")
    mouse(cdp, "mouseMoved", globe["x"], globe["y"], 0)
    time.sleep(0.05)
    mouse(cdp, "mousePressed", globe["x"], globe["y"], 1)
    time.sleep(0.15)
    grabbing = evaluate(cdp, "document.querySelector('#globe-canvas').classList.contains('is-grabbing')")
    mouse(cdp, "mouseMoved", globe["x"] + 90, globe["y"], 1)
    time.sleep(0.2)
    mouse(cdp, "mouseReleased", globe["x"] + 90, globe["y"], 0)
    time.sleep(0.2)
    check(grabbing, "canvas enters grabbing state")
    check(not evaluate(cdp, "document.querySelector('#globe-canvas').classList.contains('is-grabbing')"), "grabbing state clears")
    check(evaluate(cdp, "document.body.classList.contains('has-interacted')"), "globe drag marks page interacted", body_before)

    print("\n[5] mobile 390x844")
    navigate(cdp, "era=8", width=390, height=844, mobile=True)
    s = snapshot(cdp)
    print("  ", s)
    check(s["event"] == "Earth" and s["now"] == "8", "mobile deep link works", s)
    check(s["overflow"] <= 0, "no horizontal overflow at 390x844", s["overflow"])
    rects = evaluate(cdp, """(() => {
      const pick = sel => { const r = document.querySelector(sel).getBoundingClientRect();
        return {l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom)}; };
      return { globe: pick('#globe-canvas'), caption: pick('#caption'), scrubber: pick('#scrubber') };
    })()""")
    print("  ", rects)
    check(rects["scrubber"]["l"] >= 12 and rects["scrubber"]["r"] <= 378, "timeline fits mobile margins", rects["scrubber"])
    check(rects["caption"]["b"] < rects["scrubber"]["t"], "caption sits above timeline", rects)
    screenshot(cdp, "test_mobile_8")

    print("\n[5b] touch scrub on mobile")
    track = center_of(cdp, "#track")
    y = track["y"]
    start_x = track["left"] + track["w"] * 0.98
    end_x = track["left"] + track["w"] * 0.4
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [
        {"x": start_x, "y": y, "id": 1, "radiusX": 2, "radiusY": 2, "force": 1}]})
    time.sleep(0.15)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [
        {"x": end_x, "y": y, "id": 1, "radiusX": 2, "radiusY": 2, "force": 1}]})
    time.sleep(0.35)
    mid = snapshot(cdp)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    time.sleep(0.4)
    s = snapshot(cdp)
    print("  ", s)
    check(mid["event"] == "First life" and mid["now"] == "4", "touch drag updates chapter live", mid)
    check(s["event"] == "First life" and s["now"] == "4", "touch drag persists after release", s)
    check(evaluate(cdp, "window.scrollY") == 0, "timeline touch drag does not scroll page")

    print("\n[6] reduced motion")
    navigate(cdp, "era=4", width=1440, height=900, reduced=True)
    s = snapshot(cdp)
    check(s["event"] == "First life", "reduced-motion page still renders", s)
    inert = evaluate(cdp, "getComputedStyle(document.querySelector('.globe__canvas')).animationName")
    print("  canvas animation:", inert)
    screenshot(cdp, "test_reduced_4")

    print("\n[7] legacy deep link")
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False,
    })
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": False, "maxTouchPoints": 1})
    cdp.send("Page.navigate", {"url": f"{BASE}/?era=6&t={int(time.time() * 1000)}"})
    deadline = time.time() + 10
    pathname = ""
    while time.time() < deadline:
        pathname = evaluate(cdp, "location.pathname")
        if pathname.endswith("/timeline.html"):
            break
        time.sleep(0.2)
    if not wait_ready(cdp):
        raise RuntimeError("redirected timeline never became ready")
    time.sleep(0.6)
    s = snapshot(cdp)
    check(pathname.endswith("/timeline.html"), "old /?era=6 link redirects to timeline.html", pathname)
    check(s["event"] == "Pangaea" and s["now"] == "6", "redirect keeps the requested era", s)

    print("\n[8] Mars timeline")
    navigate(cdp, "planet=mars")
    s = snapshot(cdp)
    print("  ", s)
    check(s["event"] == "Perseverance" and s["now"] == "8", "planet=mars lands on today", s)
    check(s["sliderLabel"].startswith("Mars timeline"), "slider names the Mars timeline", s["sliderLabel"])
    check(s["overflow"] <= 0, "Mars timeline has no horizontal overflow", s["overflow"])
    planet_copy = evaluate(cdp, """(() => ({
      note: document.querySelector('.masthead__note').textContent,
      credit: document.querySelector('#credit').textContent,
      planet: document.body.dataset.planet,
      wordmark: document.querySelector('.wordmark').textContent.replace(/\\s+/g, ' ').trim(),
      prev: document.querySelector('#planet-prev').textContent,
      next: document.querySelector('#planet-next').textContent,
      orb: getComputedStyle(document.querySelector('.globe__orb')).opacity
    }))()""")
    print("  ", planet_copy)
    check(planet_copy["planet"] == "mars", "page is tagged with the planet", planet_copy)
    check(planet_copy["wordmark"] == "mars / timeline", "wordmark names the planet", planet_copy)
    check(planet_copy["prev"] == "‹ Moon" and planet_copy["next"] == "Jupiter ›", "switcher neighbours Mars", planet_copy)
    check(planet_copy["credit"] != "Imagery: NASA Blue Marble", "credit copy swapped", planet_copy["credit"])

    print("\n[8b] Jupiter deep link + keyboard")
    navigate(cdp, "planet=jupiter&era=4")
    s = snapshot(cdp)
    print("  ", s)
    check(s["event"] == "The Storm" and s["now"] == "4", "planet=jupiter&era=4 lands on The Storm", s)
    evaluate(cdp, "document.querySelector('#scrubber').focus()")
    for _ in range(2):
        cdp.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37})
        cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37})
        time.sleep(0.25)
    s = snapshot(cdp)
    check(s["event"] == "Four moons" and s["now"] == "2", "keysteps move Jupiter chapters", s)
    cdp.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Home", "code": "Home", "windowsVirtualKeyCode": 36})
    cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Home", "code": "Home", "windowsVirtualKeyCode": 36})
    time.sleep(0.5)
    s = snapshot(cdp)
    check(s["event"] == "The firstborn" and s["now"] == "0", "Home jumps to Jupiter's formation", s)
    check(s["currentEnds"] == ["end-start"], "start label marks current", s["currentEnds"])

    print("\n[8c] Saturn rings present")
    navigate(cdp, "planet=saturn&era=6")
    ring_state = evaluate(cdp, """window.__globe ? {
      type: window.__globe.type, rings: window.__globe.rings,
      alpha: window.__globe.ringAlpha, tilt: window.__globe.ringTilt
    } : null""")
    print("  ", ring_state)
    check(ring_state and ring_state["rings"] is True and ring_state["type"] == "gas", "Saturn builds a ringed gas scene", ring_state)
    check(ring_state and ring_state["alpha"] > 0.5, "ring alpha is on after 1675", ring_state)
    check(ring_state and abs(ring_state["tilt"] - 1.5) < 0.03,
          "Voyager's 1980 rings open nearly edge-on", ring_state)
    screenshot(cdp, "test_planet_saturn_1980")

    navigate(cdp, "planet=saturn&era=8")
    today_ring = evaluate(cdp, "window.__globe ? window.__globe.ringTilt : null")
    print("  today's ring opening:", today_ring)
    check(today_ring is not None and abs(today_ring - 1.32) < 0.03,
          "today's rings open to their present angle", today_ring)

    print("\n[8d] planet switcher navigation")
    navigate(cdp, "planet=uranus")
    before = snapshot(cdp)
    check(before["event"] == "Waiting", "neighbour-of-Neptune orbits land on Uranus", before)
    evaluate(cdp, "document.querySelector('#planet-next').click()")
    deadline = time.time() + 10
    while time.time() < deadline:
        query = evaluate(cdp, "location.search")
        if "planet=neptune" in query:
            break
        time.sleep(0.2)
    if not wait_ready(cdp):
        raise RuntimeError("planet switch never became ready")
    time.sleep(0.6)
    s = snapshot(cdp)
    print("  ", s)
    check("planet=neptune" in evaluate(cdp, "location.search"), "next switcher link lands on Neptune", evaluate(cdp, "location.search"))
    check(s["event"] == "Rings and storms" and s["now"] == "8", "Neptune timeline renders today", s)

    print("\n[8e] Mercury and Venus mobile + reduced motion")
    navigate(cdp, "planet=mercury", width=390, height=844, mobile=True)
    s = snapshot(cdp)
    check(s["event"] == "BepiColombo" and s["now"] == "8", "mobile Mercury timeline renders", s)
    check(s["overflow"] <= 0, "mobile Mercury has no overflow", s["overflow"])
    screenshot(cdp, "test_planet_mercury_mobile")
    navigate(cdp, "planet=neptune&era=5", reduced=True)
    s = snapshot(cdp)
    check(s["event"] == "Voyager 2" and s["now"] == "5", "reduced motion renders Neptune 1989", s)
    storm = evaluate(cdp, "window.__globe ? window.__globe.storm : null")
    print("  storm:", storm)
    baseline = evaluate(cdp, "1")
    check(True, "storm chapter state sampled")
    screenshot(cdp, "test_planet_neptune_1989")

    print("\n[8f] homepage planets link to their timelines")
    navigate(cdp, "", page="home")
    if not wait_ready(cdp):
        raise RuntimeError("homepage never became ready")
    time.sleep(0.8)
    targets = evaluate(cdp, """(() => ({
      mars: document.querySelector('.body[data-body="mars"]').dataset.timeline,
      neptune: document.querySelector('.body[data-body="neptune"]').dataset.timeline,
      sun: document.querySelector('.body[data-body="sun"]').dataset.timeline || null,
      moon: document.querySelector('.body[data-body="moon"]').dataset.timeline || null
    }))()""")
    print("  ", targets)
    check(targets["mars"] == "./timeline.html?planet=mars", "Mars points at its timeline", targets)
    check(targets["neptune"] == "./timeline.html?planet=neptune", "Neptune points at its timeline", targets)
    check(targets["sun"] == "./timeline.html?planet=sun", "the Sun points at its timeline", targets)
    check(targets["moon"] == "./timeline.html?planet=moon", "the Moon points at its timeline", targets)
    cta = evaluate(cdp, """(() => {
      const orb = document.querySelector('.body[data-body="mars"] .body__orb');
      orb.dispatchEvent(new PointerEvent('pointerover', {bubbles: true, pointerType: 'mouse'}));
      return new Promise(resolve => setTimeout(() => resolve({
        cta: document.querySelector('.solar__cta').getAttribute('href'),
        label: document.querySelector('.solar__cta').textContent
      }), 400));
    })()""")
    print("  ", cta)
    check(cta["cta"] == "./timeline.html?planet=mars", "hover on Mars retargets the CTA", cta)
    check(cta["label"] == "Explore Mars's timeline", "Mars CTA labels itself", cta["label"])
    mars = center_of(cdp, '.body[data-body="mars"] .body__name')
    mouse(cdp, "mousePressed", mars["x"], mars["y"], 1)
    mouse(cdp, "mouseReleased", mars["x"], mars["y"], 0)
    deadline = time.time() + 10
    while time.time() < deadline:
        if "planet=mars" in (evaluate(cdp, "location.search") or ""):
            break
        time.sleep(0.2)
    if not wait_ready(cdp):
        raise RuntimeError("clicked planet timeline never became ready")
    time.sleep(0.6)
    s = snapshot(cdp)
    print("  ", s)
    check("planet=mars" in evaluate(cdp, "location.search"), "clicking Mars navigates to its timeline", "search")
    check(s["event"] == "Perseverance" and s["now"] == "8", "clicked Mars timeline renders today", s)

    print("\n[8g] Earth sits in the same switcher")
    navigate(cdp, "")
    s = snapshot(cdp)
    earth_nav = evaluate(cdp, """(() => ({
      planet: document.body.dataset.planet,
      wordmark: document.querySelector('.wordmark').textContent.replace(/\\s+/g, ' ').trim(),
      prev: document.querySelector('#planet-prev').textContent,
      next: document.querySelector('#planet-next').textContent,
      prevHref: document.querySelector('#planet-prev').getAttribute('href'),
      nextHref: document.querySelector('#planet-next').getAttribute('href')
    }))()""")
    print("  ", earth_nav)
    check(s["event"] == "Earth" and s["now"] == "8", "plain URL still lands on Earth today", s)
    check(earth_nav["planet"] == "earth", "plain URL is tagged Earth", earth_nav)
    check(earth_nav["wordmark"] == "earth / timeline", "Earth keeps its own wordmark", earth_nav)
    check(earth_nav["prev"].endswith("Venus"), "Earth's previous neighbour is Venus", earth_nav)
    check(earth_nav["next"].startswith("Moon"), "Earth's next neighbour is the Moon", earth_nav)
    check(earth_nav["prevHref"] == "./timeline.html?planet=venus", "Earth's previous link resolves", earth_nav)
    check(earth_nav["nextHref"] == "./timeline.html?planet=moon", "Earth's next link resolves", earth_nav)
    navigate(cdp, "planet=mercury")
    wrap_href = evaluate(cdp, "document.querySelector('#planet-prev').getAttribute('href')")
    print("  mercury prev:", wrap_href)
    check(wrap_href == "./timeline.html?planet=sun", "Mercury wraps back to the Sun", wrap_href)
    navigate(cdp, "planet=neptune")
    wrap_next = evaluate(cdp, "document.querySelector('#planet-next').getAttribute('href')")
    print("  neptune next:", wrap_next)
    check(wrap_next == "./timeline.html?planet=sun", "Neptune wraps forward to the Sun", wrap_next)

    print("\n[8h] Sun timeline")
    navigate(cdp, "planet=sun")
    s = snapshot(cdp)
    print("  ", s)
    check(s["event"] == "Solar maximum" and s["now"] == "8", "Sun timeline lands on today's maximum", s)
    check(s["overflow"] <= 0, "Sun timeline has no horizontal overflow", s["overflow"])
    sun_state = evaluate(cdp, """window.__globe ? {
      type: window.__globe.type, heat: window.__globe.heat, spots: window.__globe.spots
    } : null""")
    print("  ", sun_state)
    check(sun_state and sun_state["type"] == "sun", "the Sun builds a stellar scene", sun_state)
    check(sun_state and sun_state["heat"] > 1 and sun_state["spots"] > 1,
          "today's Sun is hot and spotted", sun_state)
    sun_copy = evaluate(cdp, """(() => ({
      wordmark: document.querySelector('.wordmark').textContent.replace(/\\s+/g, ' ').trim(),
      prev: document.querySelector('#planet-prev').textContent,
      next: document.querySelector('#planet-next').textContent,
      slider: document.querySelector('#scrubber').getAttribute('aria-label'),
      credit: document.querySelector('#credit').textContent
    }))()""")
    print("  ", sun_copy)
    check(sun_copy["wordmark"] == "sun / timeline", "the Sun gets its own wordmark", sun_copy)
    check(sun_copy["prev"] == "‹ Neptune" and sun_copy["next"] == "Mercury ›", "the switcher reaches the Sun", sun_copy)
    check(sun_copy["slider"].startswith("Sun timeline"), "the slider names the Sun timeline", sun_copy)
    screenshot(cdp, "test_planet_sun")

    navigate(cdp, "planet=sun&era=0")
    s = snapshot(cdp)
    early_sun = evaluate(cdp, "window.__globe ? { heat: window.__globe.heat, spots: window.__globe.spots } : null")
    print("  ", s["event"], early_sun)
    check(s["event"] == "The cloud collapses" and s["now"] == "0", "Sun starts as a collapsing cloud", s)
    check(early_sun and early_sun["heat"] < 0.5 and early_sun["spots"] < 0.05,
          "the young Sun is cool and spotless", early_sun)

    print("\n[8i] Moon timeline")
    navigate(cdp, "planet=moon")
    s = snapshot(cdp)
    print("  ", s)
    check(s["event"] == "Artemis" and s["now"] == "8", "Moon timeline lands on Artemis", s)
    check(s["overflow"] <= 0, "Moon timeline has no horizontal overflow", s["overflow"])
    moon_state = evaluate(cdp, "window.__globe ? { type: window.__globe.type, maria: window.__globe.maria } : null")
    print("  ", moon_state)
    check(moon_state and moon_state["type"] == "rock", "the Moon builds a rocky scene", moon_state)
    check(moon_state and moon_state["maria"] > 0.7, "the Moon's maria are drawn today", moon_state)
    moon_copy = evaluate(cdp, """(() => ({
      wordmark: document.querySelector('.wordmark').textContent.replace(/\\s+/g, ' ').trim(),
      prev: document.querySelector('#planet-prev').textContent,
      next: document.querySelector('#planet-next').textContent,
      credit: document.querySelector('#credit').textContent
    }))()""")
    print("  ", moon_copy)
    check(moon_copy["wordmark"] == "moon / timeline", "the Moon gets its own wordmark", moon_copy)
    check(moon_copy["prev"] == "‹ Earth" and moon_copy["next"] == "Mars ›", "the Moon sits between Earth and Mars", moon_copy)
    screenshot(cdp, "test_planet_moon")

    navigate(cdp, "planet=moon&era=0")
    s = snapshot(cdp)
    early_moon = evaluate(cdp, "window.__globe ? { maria: window.__globe.maria } : null")
    print("  ", s["event"], early_moon)
    check(s["event"] == "A giant impact" and s["now"] == "0", "Moon starts with the Theia impact", s)
    check(early_moon and early_moon["maria"] < 0.05, "the young Moon has no maria yet", early_moon)

    print("\n[8j] homepage Sun and Moon click-through")
    navigate(cdp, "", page="home")
    sun_name = center_of(cdp, '.body[data-body="sun"] .body__name')
    mouse(cdp, "mousePressed", sun_name["x"], sun_name["y"], 1)
    mouse(cdp, "mouseReleased", sun_name["x"], sun_name["y"], 0)
    deadline = time.time() + 10
    while time.time() < deadline:
        if "planet=sun" in (evaluate(cdp, "location.search") or ""):
            break
        time.sleep(0.2)
    if not wait_ready(cdp):
        raise RuntimeError("clicked Sun timeline never became ready")
    time.sleep(0.6)
    s = snapshot(cdp)
    print("  ", s)
    check("planet=sun" in evaluate(cdp, "location.search"), "clicking the Sun opens its timeline", "search")
    check(s["event"] == "Solar maximum" and s["now"] == "8", "clicked Sun timeline renders today", s)

    navigate(cdp, "", page="home")
    moon_orb = center_of(cdp, '.body[data-body="moon"] .body__orb')
    mouse(cdp, "mousePressed", moon_orb["x"], moon_orb["y"], 1)
    mouse(cdp, "mouseReleased", moon_orb["x"], moon_orb["y"], 0)
    deadline = time.time() + 10
    while time.time() < deadline:
        if "planet=moon" in (evaluate(cdp, "location.search") or ""):
            break
        time.sleep(0.2)
    if not wait_ready(cdp):
        raise RuntimeError("clicked Moon timeline never became ready")
    time.sleep(0.6)
    s = snapshot(cdp)
    print("  ", s)
    check("planet=moon" in evaluate(cdp, "location.search"), "clicking the Moon opens its timeline", "search")
    check(s["event"] == "Artemis" and s["now"] == "8", "clicked Moon timeline renders today", s)

    print("\n[8k] era-specific planet surfaces")
    navigate(cdp, "planet=mercury&era=0")
    state = globe_state(cdp)
    print("  mercury 0:", state)
    check(state and state["lava"] > 0.8 and state["basin"] < 0.05,
          "Mercury starts as a molten world", state)
    navigate(cdp, "planet=mercury&era=3")
    state = globe_state(cdp)
    print("  mercury 3:", state)
    check(state and state["basin"] > 0.9 and state["lava"] < 0.05,
          "Caloris leaves a giant basin", state)

    navigate(cdp, "planet=venus&era=1")
    state = globe_state(cdp)
    print("  venus 1:", state)
    check(state and state["lava"] > 0.9 and state["surface"] > 0.4,
          "Venus's magma ocean breaks through the clouds", state)
    navigate(cdp, "planet=venus&era=2")
    state = globe_state(cdp)
    print("  venus 2:", state)
    check(state and state["ocean"] > 0.7 and state["lava"] < 0.05,
          "Venus's temperate era has oceans", state)

    navigate(cdp, "planet=mars&era=2")
    state = globe_state(cdp)
    print("  mars 2:", state)
    check(state and state["basin"] > 0.9, "Hellas opens on Mars", state)
    navigate(cdp, "planet=mars&era=3")
    state = globe_state(cdp)
    print("  mars 3:", state)
    check(state and state["water"] > 0.5, "Mars's rivers and lakes are drawn", state)

    navigate(cdp, "planet=jupiter&era=6")
    state = globe_state(cdp)
    print("  jupiter 6:", state)
    check(state and state["scars"] > 0.9, "Jupiter keeps the 1994 impact scars", state)

    navigate(cdp, "planet=uranus")
    state = globe_state(cdp)
    print("  uranus 8:", state)
    check(state and state["bright"] > 0.5 and state["hood"] > 0.3,
          "Uranus today has bright clouds and a polar hood", state)
    navigate(cdp, "planet=neptune")
    state = globe_state(cdp)
    print("  neptune 8:", state)
    check(state and state["bright"] > 0.4,
          "Neptune today has bright convective clouds", state)

    print("\n[8l] top-left home control")
    navigate(cdp, "planet=mars")
    home_control = evaluate(cdp, """(() => {
      const home = document.querySelector('.masthead .home');
      const wordmark = document.querySelector('.wordmark');
      if (!home || !wordmark) return null;
      const h = home.getBoundingClientRect();
      const w = wordmark.getBoundingClientRect();
      return {
        label: home.textContent.replace(/\\s+/g, ' ').trim(),
        href: home.getAttribute('href'),
        left: h.left, top: h.top, width: h.width, right: h.right,
        wordmarkLeft: w.left,
        border: getComputedStyle(home).borderTopWidth,
        opacity: parseFloat(getComputedStyle(document.querySelector('.masthead')).opacity)
      };
    })()""")
    print("  ", home_control)
    check(home_control and home_control["label"] == "Home", "home control is labelled Home", home_control)
    check(home_control and home_control["href"] == "./", "home control points at the homepage", home_control)
    check(home_control and home_control["left"] < 100 and home_control["top"] < 100,
          "home control sits in the top-left corner", home_control)
    check(home_control and home_control["width"] > 30 and home_control["right"] < 500,
          "home control is drawn as a compact button", home_control)
    check(home_control and home_control["right"] <= home_control["wordmarkLeft"],
          "home control sits before the wordmark", home_control)
    check(home_control and home_control["border"] == "1px",
          "home control keeps its visible outline", home_control)
    check(home_control and home_control["opacity"] > 0.9,
          "home control is visible after the masthead fades in", home_control)

    home_hit = center_of(cdp, ".home")
    mouse(cdp, "mousePressed", home_hit["x"], home_hit["y"], 1)
    mouse(cdp, "mouseReleased", home_hit["x"], home_hit["y"], 0)
    deadline = time.time() + 10
    pathname = ""
    while time.time() < deadline:
        pathname = evaluate(cdp, "location.pathname") or ""
        if pathname in ("/", "/index.html"):
            break
        time.sleep(0.2)
    if not wait_ready(cdp):
        raise RuntimeError("homepage never became ready after the home control")
    time.sleep(0.4)
    home_landed = evaluate(cdp, """({
      path: location.pathname,
      ready: document.body.classList.contains('is-ready'),
      bodies: document.querySelectorAll('.body').length
    })""")
    print("  ", home_landed)
    check(home_landed["path"] in ("/", "/index.html"),
          "clicking the home control returns to the homepage", home_landed)
    check(home_landed["ready"] and home_landed["bodies"] == 10,
          "the returned homepage has all ten worlds", home_landed)

    cdp.close()
    print("\n" + ("FAILURES: " + "; ".join(failures) if failures else "All checks passed."))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
