"""Независимая реализация Glicko-2 для векторов fixtures/glicko2/ (TESTING §7.5, F6-Q2).

Написана с нуля по статье Mark E. Glickman, "Example of the Glicko-2 system"
(http://www.glicko.net/glicko/glicko2.pdf), шаги 1-8; итерация волатильности —
алгоритм Illinois из статьи, epsilon = 1e-6. Рост RD без игр — ARCHITECTURE §11
(c = 0.21436 периода в сутки, прежняя sigma, потолок RD 350), затем один шаг статьи
с прибавкой sigma'^2 (шаг 6).

Только стандартная библиотека Python 3. Запуск из корня репозитория:
    py fixtures/glicko2/generate.py
Перезаписывает glickman.json, sequence.json, decay.json рядом со скриптом.
В CI не входит; json — результат этого скрипта, вручную не правятся.
"""

import json
import math
from pathlib import Path

TAU = 0.5
EPSILON = 1e-6
SCALE = 173.7178
BASE = 1500.0
RD_MAX = 350.0
RD_GROWTH_PER_DAY = 0.21436  # ARCHITECTURE §11, c

OUT = Path(__file__).resolve().parent


def g(phi):
    return 1.0 / math.sqrt(1.0 + 3.0 * phi * phi / (math.pi * math.pi))


def expected(mu, mu_j, phi_j):
    return 1.0 / (1.0 + math.exp(-g(phi_j) * (mu - mu_j)))


def new_volatility(phi, sigma, delta, v):
    """Шаг 5 статьи: Illinois по x = ln(sigma^2)."""
    a = math.log(sigma * sigma)

    def f(x):
        ex = math.exp(x)
        num = ex * (delta * delta - phi * phi - v - ex)
        den = 2.0 * (phi * phi + v + ex) ** 2
        return num / den - (x - a) / (TAU * TAU)

    big_a = a
    if delta * delta > phi * phi + v:
        big_b = math.log(delta * delta - phi * phi - v)
    else:
        k = 1
        while f(a - k * TAU) < 0:
            k += 1
        big_b = a - k * TAU
    f_a = f(big_a)
    f_b = f(big_b)
    while abs(big_b - big_a) > EPSILON:
        big_c = big_a + (big_a - big_b) * f_a / (f_b - f_a)
        f_c = f(big_c)
        if f_c * f_b <= 0:
            big_a, f_a = big_b, f_b
        else:
            f_a = f_a / 2.0
        big_b, f_b = big_c, f_c
    return math.exp(big_a / 2.0)


def rate(player, games, elapsed_days):
    """player: dict rating/rd/volatility; games: [(opp_rating, opp_rd, score)]."""
    mu = (player["rating"] - BASE) / SCALE
    phi = player["rd"] / SCALE
    sigma = player["volatility"]

    # Рост RD без игр (ARCHITECTURE §11): прежняя sigma, потолок 350.
    if elapsed_days > 0:
        phi = math.sqrt(phi * phi + RD_GROWTH_PER_DAY * elapsed_days * sigma * sigma)
        phi = min(phi, RD_MAX / SCALE)

    # Шаги 3-4.
    inv_v = 0.0
    acc = 0.0
    for opp_rating, opp_rd, score in games:
        mu_j = (opp_rating - BASE) / SCALE
        phi_j = opp_rd / SCALE
        e = expected(mu, mu_j, phi_j)
        gj = g(phi_j)
        inv_v += gj * gj * e * (1.0 - e)
        acc += gj * (score - e)
    v = 1.0 / inv_v
    delta = v * acc

    # Шаги 5-8.
    sigma_new = new_volatility(phi, sigma, delta, v)
    phi_star = math.sqrt(phi * phi + sigma_new * sigma_new)
    phi_new = 1.0 / math.sqrt(1.0 / (phi_star * phi_star) + 1.0 / v)
    mu_new = mu + phi_new * phi_new * acc
    return {
        "rating": mu_new * SCALE + BASE,
        "rd": phi_new * SCALE,
        "volatility": sigma_new,
    }


def rounded(state):
    return {
        "rating": round(state["rating"], 6),
        "rd": round(state["rd"], 6),
        "volatility": round(state["volatility"], 9),
    }


def vector(vid, kind, source, player, games, elapsed_days, expect, tolerance):
    return {
        "id": vid,
        "kind": kind,
        "source": source,
        "tau": TAU,
        "player": dict(player),
        "elapsed_days": elapsed_days,
        "games": [
            {"opponent": {"rating": r, "rd": rd}, "score": s} for r, rd, s in games
        ],
        "expect": expect,
        "tolerance": tolerance,
    }


SRC_SELF = "fixtures/glicko2/generate.py (независимая реализация по статье Glickman, Python)"
# Допуски для векторов скрипта: значения хранятся с 6 / 9 знаками; volatility 1e-6 —
# различие двух реализаций Illinois с epsilon = 1e-6 по ln(sigma^2) на порядки меньше.
TOL_SELF = {"rating": 0.01, "rd": 0.01, "volatility": 0.000001}


def glickman():
    player = {"rating": 1500, "rd": 200, "volatility": 0.06}
    games = [(1400, 30, 1), (1550, 100, 0), (1700, 300, 0)]
    got = rate(player, games, 0)
    # Сверка скрипта с опубликованным примером.
    assert abs(got["rating"] - 1464.06) < 0.01, got
    assert abs(got["rd"] - 151.52) < 0.01, got
    assert abs(got["volatility"] - 0.05999) < 0.00001, got
    return [
        vector(
            "glickman-example",
            "multi",
            "Glickman, Example of the Glicko-2 system",
            player,
            games,
            0,
            {"rating": 1464.06, "rd": 151.52, "volatility": 0.05999},
            {"rating": 0.01, "rd": 0.01, "volatility": 0.00001},
        )
    ], got


# Набор (3): 4 игрока, партии подряд, elapsed_days = 0.
PLAYERS = {
    "newcomer": {"rating": 1500, "rd": 350, "volatility": 0.06},
    "provisional": {"rating": 1620, "rd": 180, "volatility": 0.06},
    "strong": {"rating": 1850, "rd": 60, "volatility": 0.06},
    "steady": {"rating": 1400, "rd": 80, "volatility": 0.06},
}

# (белые, чёрные, очки белых). 36 партий: каждая пара — 6 раз, цвета чередуются,
# исходы разные, есть ничьи и неожиданные результаты.
SCHEDULE = [
    ("newcomer", "provisional", 1),
    ("strong", "steady", 1),
    ("steady", "newcomer", 0),
    ("provisional", "strong", 0.5),
    ("newcomer", "strong", 0),
    ("steady", "provisional", 0),
    ("provisional", "newcomer", 0),
    ("steady", "strong", 0.5),
    ("newcomer", "steady", 0.5),
    ("strong", "provisional", 1),
    ("strong", "newcomer", 0),
    ("provisional", "steady", 1),
    ("newcomer", "provisional", 0.5),
    ("strong", "steady", 0),
    ("steady", "newcomer", 1),
    ("provisional", "strong", 0),
    ("newcomer", "strong", 0.5),
    ("steady", "provisional", 0.5),
    ("provisional", "newcomer", 1),
    ("steady", "strong", 0),
    ("newcomer", "steady", 1),
    ("strong", "provisional", 0.5),
    ("strong", "newcomer", 1),
    ("provisional", "steady", 0),
    ("newcomer", "provisional", 0),
    ("strong", "steady", 0.5),
    ("steady", "newcomer", 0.5),
    ("provisional", "strong", 1),
    ("newcomer", "strong", 1),
    ("steady", "provisional", 1),
    ("provisional", "newcomer", 0.5),
    ("steady", "strong", 0),
    ("newcomer", "steady", 0),
    ("strong", "provisional", 0),
    ("strong", "newcomer", 0.5),
    ("provisional", "steady", 0.5),
]


def sequence():
    state = {k: dict(v) for k, v in PLAYERS.items()}
    out = []
    for i, (w, b, ws) in enumerate(SCHEDULE, start=1):
        before_w, before_b = dict(state[w]), dict(state[b])
        bs = 1 - ws
        after_w = rate(before_w, [(before_b["rating"], before_b["rd"], ws)], 0)
        after_b = rate(before_b, [(before_w["rating"], before_w["rd"], bs)], 0)
        for color, me, opp, s, after in (
            ("white", w, b, ws, after_w),
            ("black", b, w, bs, after_b),
        ):
            mine = before_w if color == "white" else before_b
            theirs = before_b if color == "white" else before_w
            out.append(
                vector(
                    f"seq-{i:02d}-{color}-{me}-vs-{opp}",
                    "single",
                    SRC_SELF,
                    mine,
                    [(theirs["rating"], theirs["rd"], s)],
                    0,
                    rounded(after),
                    TOL_SELF,
                )
            )
        # Следующая партия начинается с точных (не округлённых) значений, но в вектор
        # пишется то же значение, что и в expect предыдущего — округлённое.
        state[w] = rounded(after_w)
        state[b] = rounded(after_b)
    return out


# Вид C: рост RD до партии (ARCHITECTURE §11).
DECAY = [
    ("decay-1d-strong-win", {"rating": 1850, "rd": 60, "volatility": 0.06}, (1700, 90, 1), 1),
    ("decay-30d-steady-draw", {"rating": 1400, "rd": 80, "volatility": 0.06}, (1450, 70, 0.5), 30),
    ("decay-365d-strong-loss", {"rating": 1850, "rd": 60, "volatility": 0.06}, (1800, 60, 0), 365),
    ("decay-0.5d-provisional-loss", {"rating": 1620, "rd": 180, "volatility": 0.06}, (1500, 350, 0), 0.5),
    ("decay-cap350-3650d-win", {"rating": 1700, "rd": 200, "volatility": 0.06}, (1600, 100, 1), 3650),
]


def decay():
    out = []
    for vid, player, game, days in DECAY:
        got = rate(player, [game], days)
        out.append(vector(vid, "decay", SRC_SELF, player, [game], days, rounded(got), TOL_SELF))
    # Контроль К-2 «при elapsedDays = 0 роста нет»: та же партия, что decay-365d, без перерыва
    # (вид A, single); RD после неё заметно меньше, чем у decay-365d-strong-loss.
    vid, player, game, _ = DECAY[2]
    got0 = rate(player, [game], 0)
    got365 = rate(player, [game], 365)
    assert got0["rd"] < got365["rd"] - 30, (got0, got365)
    out.append(vector("no-decay-0d-strong-loss", "single", SRC_SELF, player, [game], 0, rounded(got0), TOL_SELF))
    # Самопроверка константы: RD 60 -> ~110 за 365 суток (lila Glicko.periodsPerDay).
    phi = 60 / SCALE
    rd_year = math.sqrt(phi * phi + RD_GROWTH_PER_DAY * 365 * 0.06 * 0.06) * SCALE
    assert 109.5 < rd_year < 110.5, rd_year
    # Самопроверка потолка: без него RD превысил бы 350.
    phi = 200 / SCALE
    assert math.sqrt(phi * phi + RD_GROWTH_PER_DAY * 3650 * 0.06 * 0.06) * SCALE > RD_MAX
    return out


def write(name, data):
    path = OUT / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"{path.name}: {len(data)} векторов")


def main():
    gl, got = glickman()
    print(
        f"Glickman: {got['rating']:.4f} / {got['rd']:.4f} / {got['volatility']:.8f}"
    )
    write("glickman.json", gl)
    write("sequence.json", sequence())
    write("decay.json", decay())


if __name__ == "__main__":
    main()
