"""Generate a stylised, equirectangular Pangaea land texture.

The texture packs three channels used by the globe shader:
  R  land mask
  G  terrain / elevation variation
  B  coastal shelf mask

It is an artistic reconstruction for the timeline piece, not a
scientific palaeogeographic model.
"""

import numpy as np
import cv2
from pathlib import Path

W, H = 2048, 1024
rng = np.random.default_rng(7)
XX, YY = np.meshgrid(np.linspace(0, 1, W), np.linspace(0, 1, H))
ASPECT = W / H  # 2.0


def smooth_noise(w, h, cells_x, cells_y, seed):
    r = np.random.default_rng(seed)
    base = r.random((cells_y, cells_x)).astype(np.float32)
    field = cv2.resize(base, (w, h), interpolation=cv2.INTER_CUBIC)
    field = cv2.GaussianBlur(field, (0, 0), sigmaX=w / cells_x * 0.35, sigmaY=h / cells_y * 0.35)
    field -= field.min()
    field /= max(field.max(), 1e-6)
    return field


def fbm(w, h, seed):
    total = np.zeros((h, w), np.float32)
    amp = 0.55
    norm = 0.0
    for i, (cx, cy) in enumerate([(6, 3), (12, 6), (24, 12), (48, 24), (96, 48)]):
        total += amp * smooth_noise(w, h, cx, cy, seed + i * 11)
        norm += amp
        amp *= 0.5
    return total / norm


def ellipse(cx, cy, rx, ry, rot=0.0, soft=0.0):
    """Signed field, positive inside an ellipse (x is in aspect units)."""
    x = (XX - cx) * ASPECT
    y = YY - cy
    c, s = np.cos(rot), np.sin(rot)
    xr = x * c + y * s
    yr = -x * s + y * c
    d = 1.0 - np.sqrt((xr / (rx * ASPECT)) ** 2 + (yr / ry) ** 2)
    if soft:
        d = d / soft
        d = np.clip(d, -1.0, 1.0)
    return d


def metaball(cx, cy, rx, ry, rot=0.0):
    x = (XX - cx) * ASPECT
    y = YY - cy
    c, s = np.cos(rot), np.sin(rot)
    xr = x * c + y * s
    yr = -x * s + y * c
    return np.exp(-3.0 * ((xr / (rx * ASPECT)) ** 2 + (yr / ry) ** 2))


# --- continental masses -------------------------------------------------
field = np.zeros((H, W), np.float32)
MASSES = [
    # central Africa / South America core
    (0.492, 0.500, 0.170, 0.235, -0.10, 1.00),
    # north-west arm (Laurentia)
    (0.398, 0.360, 0.125, 0.115, 0.35, 0.95),
    (0.355, 0.292, 0.085, 0.070, -0.20, 0.80),
    # north-east arm (Baltica / Siberia)
    (0.586, 0.355, 0.125, 0.100, -0.22, 0.95),
    (0.663, 0.318, 0.110, 0.090, -0.50, 0.85),
    (0.718, 0.356, 0.070, 0.070, 0.00, 0.60),
    # west/south Atlantic margin
    (0.438, 0.636, 0.090, 0.130, 0.35, 0.80),
    (0.475, 0.748, 0.125, 0.090, -0.10, 0.70),
    # east / India / Australia
    (0.600, 0.594, 0.105, 0.105, 0.20, 0.85),
    (0.646, 0.678, 0.075, 0.060, 0.00, 0.65),
    (0.690, 0.620, 0.045, 0.035, 0.00, 0.45),
    # southern Antarctica arm
    (0.520, 0.842, 0.195, 0.090, 0.00, 0.85),
    (0.590, 0.792, 0.100, 0.065, 0.35, 0.65),
]

for cx, cy, rx, ry, rot, weight in MASSES:
    field = np.maximum(field, weight * metaball(cx, cy, rx * 0.86, ry * 0.86, rot))

# Tethys notch and inland seas
subtract = np.zeros((H, W), np.float32)
for cx, cy, rx, ry, rot, weight in [
    (0.632, 0.485, 0.105, 0.115, 0.20, 1.15),
    (0.553, 0.445, 0.038, 0.060, -0.15, 0.70),
    (0.477, 0.385, 0.030, 0.045, 0.20, 0.50),
    (0.430, 0.560, 0.022, 0.070, 0.30, 0.45),
]:
    subtract = np.maximum(subtract, weight * metaball(cx, cy, rx, ry, rot))

field -= subtract * 0.55

# --- organic coastline --------------------------------------------------
coast = fbm(W, H, 21)
detail = fbm(W, H, 87)
field += (coast - 0.5) * 0.10 + (detail - 0.5) * 0.045

# islands
islands = np.zeros((H, W), np.float32)
for i in range(30):
    cx = 0.26 + rng.random() * 0.58
    cy = 0.16 + rng.random() * 0.74
    rx = 0.004 + rng.random() * 0.011
    ry = 0.004 + rng.random() * 0.010
    islands = np.maximum(islands, metaball(cx, cy, rx, ry, rng.random() * 3.14))
field += islands * 0.32

land = cv2.GaussianBlur(field, (0, 0), 1.6)
land_mask = np.clip((land - 0.19) / 0.024, 0, 1)

# soften any 0..1 mask into a coast
land_mask = cv2.GaussianBlur(land_mask, (0, 0), 1.1)
land_mask = np.clip(land_mask, 0, 1)

# --- terrain ------------------------------------------------------------
terrain = fbm(W, H, 141)
terrain = cv2.GaussianBlur(terrain, (0, 0), 1.2)
# mountains follow a few ridge lines inside the mass
ridge = np.abs(fbm(W, H, 233) - 0.5) * 2.0
terrain = np.clip(0.55 * terrain + 0.45 * ridge, 0, 1)

# coastal shelf: blur the mask and keep the outer ring
shelf = cv2.GaussianBlur(land_mask, (0, 0), 26.0)
shelf = np.clip((shelf - land_mask) * 2.4, 0, 1)
shelf = cv2.GaussianBlur(shelf, (0, 0), 5.0)

# coastal fringe on land: an inward band, kept in alpha
blurred_land = cv2.GaussianBlur(land_mask, (0, 0), 14.0)
coast_in = land_mask * (1.0 - np.clip((blurred_land - 0.48) / 0.49, 0, 1))
coast_in = np.clip(coast_in * 1.55, 0, 1)
coast_in = cv2.GaussianBlur(coast_in, (0, 0), 2.0)
coast_in = np.clip(coast_in, 0, 1)

# equator / pole subtle lightening in the terrain channel
lat = np.abs(YY - 0.5) * 2.0
terrain = np.clip(terrain * (1.0 - 0.12 * lat), 0, 1)

out = np.zeros((H, W, 4), np.uint8)
out[..., 0] = np.clip(land_mask * 255, 0, 255).astype(np.uint8)
out[..., 1] = np.clip(terrain * 255, 0, 255).astype(np.uint8)
out[..., 2] = np.clip(shelf * 255, 0, 255).astype(np.uint8)
out[..., 3] = np.clip(coast_in * 255, 0, 255).astype(np.uint8)

# cv2 writes BGR, so hand it the channels in the order it expects.
bgr = cv2.cvtColor(out, cv2.COLOR_RGBA2BGRA)
dest = Path(__file__).resolve().parent.parent / "assets" / "pangaea.png"
cv2.imwrite(str(dest), bgr)
print("wrote", dest, out.shape)

# preview (also BGR for cv2)
vis = np.zeros((H, W, 3), np.uint8)
ocean = np.array([32, 78, 148], np.float32)
land_col = np.array([184, 164, 116], np.float32)
green = np.array([93, 128, 73], np.float32)
m = land_mask[..., None]
terr = terrain[..., None]
base = ocean * (1 - m) + land_col * m
base = base * (0.84 + 0.24 * terr)
coastal = (
    np.clip((land_mask[..., None] - 0.05) / 0.28, 0, 1)
    * np.clip((0.9 - land_mask[..., None]) / 0.45, 0, 1)
)
base = base * (1 - coastal * 0.6) + green * coastal * 0.6
vis = np.clip(base, 0, 255).astype(np.uint8)
vis = cv2.cvtColor(vis, cv2.COLOR_RGB2BGR)
preview = dest.parent.parent / "shots" / "pangaea_preview.jpg"
preview.parent.mkdir(exist_ok=True)
cv2.imwrite(str(preview), vis)
