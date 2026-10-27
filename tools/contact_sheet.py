"""Build the ten-world timeline contact sheet from today's captures."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
OUT = SHOTS / "planet_timelines.png"

WORLDS = ["sun", "mercury", "venus", "earth", "moon",
          "mars", "jupiter", "saturn", "uranus", "neptune"]

COLS = 5
TILE_W = 520
SHOT_H = 325
TILE_H = 449
LABEL = (250, 250, 250)
INK = (23, 23, 20)
MUTED = (140, 137, 129)
RULE = (227, 226, 222)

TITLE_FONT = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 20)
SUB_FONT = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 13)


def ink_top(font, text, target):
    """Return a draw y so the first inked row lands on target."""
    return target - font.getbbox(text)[1]


def main():
    rows = (len(WORLDS) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * TILE_W, rows * TILE_H), LABEL)
    draw = ImageDraw.Draw(sheet)

    for index, world in enumerate(WORLDS):
        shot = Image.open(SHOTS / f"planet_{world}.png").convert("RGB")
        shot = shot.resize((TILE_W, SHOT_H), Image.LANCZOS)
        col = index % COLS
        row = index // COLS
        x = col * TILE_W
        y = row * TILE_H
        sheet.paste(shot, (x, y))

        title = f"{world} / timeline"
        draw.text((x + 24, ink_top(TITLE_FONT, title, y + 362)),
                  title, font=TITLE_FONT, fill=INK)

        subtitle = "Today · chapter 9 of 9"
        draw.text((x + 24, ink_top(SUB_FONT, subtitle, y + 396)),
                  subtitle, font=SUB_FONT, fill=MUTED)

        draw.line((x + 22, y + 423, x + TILE_W - 22, y + 423), fill=RULE, width=1)

    sheet.save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
