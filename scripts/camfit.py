"""실사 도면에서 전투 카메라 위치를 **추정**한다 — 카메라 원본(yuanyan3060 levels.json)에 아직 없는 작전용 (2026-09-29).

## 왜 (사용자 지시 2026-09-29 "실사도면에다가 경로표시하기로 전부 통일해놨잖아 왜 갑자기 옛날방식 타일시뮬레이터로 돌아가는데")

벡터 돌파 #3(act3break, 중섭 선행)은 가장 새 이벤트라 카메라 원본에 레벨이 아직 없었다 → cam 이 안 붙어
실사 도면 위 합성 대신 격자 경로 지도로 떨어졌다(stage-detail 한 화면 규칙의 둘째 갈래). 한 화면 규칙은
"실사 도면 위 경로"로 통일돼 있으므로 원본을 기다리지 않고 도면에서 카메라를 찾는다.

## 어떻게

카메라는 자유로운 값이 아니라 **정해진 프리셋 몇 개 중 하나**다 (원본 전수: 서로 다른 값 수십 개 — 벡터 돌파
#1·#2 는 (0,−5.6,−8.9)·(0,−6.1,−9.76)·(0,−5.08,−8.04) …). 그래서 원본에 있는 모든 프리셋을 후보로 두고,
각 후보로 **출현칸(tile_start)의 빨간 철골 상자 · 방어 목표(tile_end)의 파란 철골 상자**를 입체(바닥·윗면·
세로 모서리)로 투영해 도면의 빨강·파랑 선과 가장 잘 겹치는 후보를 고른다. 위치가 하나뿐인 표식으로 맞추는
것이라(SESSION §3 — 반복되는 격자선은 틀려도 맞아 보인다) 판정이 확실하다.
채점 둘을 표준화해 더한다: ① 투영 상자 점이 표식 색 위에 떨어지는 비율 ② 양방향 거리(chamfer).

## 검증 (2026-09-29, 카메라가 알려진 작전 144개 — 벡터 돌파 #1·#2 64개 + 무작위 80개)

격자 투영 어긋남 2px 이내 139/144 (96.5%, 중앙값 0.6px). 채점 하나만 쓰면 134·131. 틀린 5개는 10~60px.
그래서 추정한 작전은 **눈으로 한 번 확인**한다 (벡터 돌파 #3 32개 전수 확인 — 윤곽이 상자와 겹쳤다).

필요: numpy · scipy · Pillow. 없으면 추정을 건너뛴다 (커밋된 표가 값을 지킨다).
"""
import math

PITCH = math.radians(30)
TH = math.tan(math.radians(20))
ASP = 9 / 16
C, S = math.cos(PITCH), math.sin(PITCH)


def available():
    try:
        import numpy  # noqa: F401
        import scipy.ndimage  # noqa: F401
        from PIL import Image  # noqa: F401
        return True
    except Exception:
        return False


def _proj(np, cams, w, h, P):
    """cams (K,3), P (N,3: gx, gy, 높이) → 픽셀 px, py (K,N) — app/stage-cam.ts stageProjector 와 같은 식."""
    X = P[None, :, 0] - w / 2 - cams[:, 0:1]
    Y = h / 2 - P[None, :, 1] - cams[:, 1:2]
    Z = -P[None, :, 2] - cams[:, 2:3]
    u2 = C * Y - S * Z
    d = S * Y + C * Z
    return (1 + (ASP / TH) * (X / d)) / 2 * 512, (1 - u2 / TH / d) / 2 * 512


def _masks(np, nd, path):
    from PIL import Image
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    red = (R > 140) & (R - G > 60) & (R - B > 60)
    blue = (B > 140) & (B - R > 50) & (G > 60)
    return red, blue


def _clean(np, nd, m, min_px=30):
    """잔티(작은 점)는 표식이 아니다"""
    lab, n = nd.label(m, np.ones((3, 3)))
    if not n:
        return m
    sz = nd.sum(m, lab, range(1, n + 1))
    return np.isin(lab, [i + 1 for i, v in enumerate(sz) if v >= min_px])


def _wire(np, tiles, H, inset=0.08, k=7):
    """칸마다 철골 상자 — 바닥·윗면 사각형과 세로 모서리 네 개의 표본점 (gx, gy, 높이)"""
    pts = []
    t = np.linspace(0, 1, k)
    for (x, y) in tiles:
        a, b, c_, d = x + inset, x + 1 - inset, y + inset, y + 1 - inset
        corners = [(a, c_), (b, c_), (b, d), (a, d)]
        for up in (0.0, H):
            for i in range(4):
                (x0, y0), (x1, y1) = corners[i], corners[(i + 1) % 4]
                pts += [(x0 + (x1 - x0) * s, y0 + (y1 - y0) * s, up) for s in t]
        for (x0, y0) in corners:
            pts += [(x0, y0, H * s) for s in t[1:-1]]
    return np.array(pts, float)


def fit(img_path, w, h, g, presets):
    """(카메라, 1·2위 점수 차) — 출현·목표 칸이 하나도 없거나 의존성이 없으면 (None, 0)."""
    if not available():
        return None, 0.0
    import numpy as np
    import scipy.ndimage as nd
    cams = np.array(presets, float)
    red, blue = _masks(np, nd, img_path)
    sp = [(x, y) for y, row in enumerate(g) for x, ch in enumerate(row) if ch == "s"]
    en = [(x, y) for y, row in enumerate(g) for x, ch in enumerate(row) if ch == "e"]
    if not sp and not en:
        return None, 0.0

    # ① 적중 비율 (표식 색을 2px 부풀려 둔다), 상자 높이 1.1
    st = np.ones((5, 5), bool)
    hit = np.zeros(len(cams))
    parts = [(sp, red), (en, blue)]
    n = 0
    for tiles, m in parts:
        if not tiles:
            continue
        md = nd.binary_dilation(m, st)
        px, py = _proj(np, cams, w, h, _wire(np, tiles, 1.1))
        ix, iy = np.round(px).astype(int), np.round(py).astype(int)
        ok = (ix >= 0) & (ix < 512) & (iy >= 0) & (iy < 512)
        v = np.zeros(ok.shape, bool)
        v[ok] = md[iy[ok], ix[ok]]
        hit += v.mean(axis=1)
        n += 1
    hit /= max(1, n)

    # ② 양방향 거리 (잔티 뺀 표식), 상자 높이 0.9
    cap = 25.0
    cham = np.zeros(len(cams))
    n = 0
    for tiles, m in parts:
        m = _clean(np, nd, m)
        if not tiles or not m.any():
            continue
        dt = np.minimum(nd.distance_transform_edt(~m), cap)
        mp = np.argwhere(m)
        P = _wire(np, tiles, 0.9)
        px, py = _proj(np, cams, w, h, P)
        ix = np.clip(np.round(px).astype(int), 0, 511)
        iy = np.clip(np.round(py).astype(int), 0, 511)
        for k in range(len(cams)):
            canvas = np.zeros((512, 512), bool)
            canvas[iy[k], ix[k]] = True
            dtp = np.minimum(nd.distance_transform_edt(~canvas), cap)
            cham[k] -= dt[iy[k], ix[k]].mean() + dtp[mp[:, 0], mp[:, 1]].mean()
        n += 1
    cham /= max(1, n)

    z = lambda a: (a - a.mean()) / (a.std() + 1e-9)
    score = z(hit) + (z(cham) if n else 0)
    order = np.argsort(-score)
    best = [round(float(v), 3) + 0.0 for v in cams[order[0]]]
    return best, float(score[order[0]] - score[order[1]])
