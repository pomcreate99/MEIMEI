from __future__ import annotations

import csv
import json
import sqlite3
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
SURNAME_FILE = ROOT / 'data/source/family-names/myoji-yurai-readings.csv'
PERSONAL_DIR = ROOT / 'data/source/personal-names/japanese_personal_name_dataset/dataset'
SQLITE_FILE = ROOT / 'data/source/japanese-names-db/names.sqlite'
OUT = ROOT / 'src/data/names.json'

MOODS = ['modern', 'classic', 'elegant', 'bright', 'strong', 'mysterious', 'unique']

MODERN = 'あお れん めい りく そら さな みお ゆい はる いつき とうま ゆうと ひなた りお あおい つむぎ こはる えま なぎ せな 叶 陽 凪 碧 蒼 結 花音'
CLASSIC = '太郎 次郎 三郎 子 之 彦 江 枝 鶴 松 竹 梅 菊 千代 清 守 忠 義 信 貞 久 和歌 春 秋 冬 夏'
ELEGANT = '雅 麗 綾 香 華 蘭 紗 美 玲 瑠 和 清 皓 琴 詩 織 紫 月 澪 雫 朱里 彩乃 あや かおり みやび'
BRIGHT = '陽 晴 光 明 笑 咲 ひかり あかり なな まい ほのか かなで 朗 輝 暖 虹 希 望 花 音'
STRONG = '剛 武 勇 駿 陸 翔 隼 巧 蓮 龍 竜 剣 迅 岳 豪 将 真 直 健 力 誠 毅'
MYSTERIOUS = '夜 月 影 紫 零 朔 宵 玄 碧 霧 幽 珠 黒 銀 霞 星 深 静 冥 紺 玲央'


def read_csv(path: Path) -> Iterable[list[str]]:
    with path.open(encoding='utf-8', newline='') as f:
        yield from csv.reader(f)


def score_moods(text: str, *, rare: bool = False, commonality: int = 2, kind: str = 'given') -> list[str]:
    scores = {mood: 0 for mood in MOODS}
    for mood, vocab in {
        'modern': MODERN,
        'classic': CLASSIC,
        'elegant': ELEGANT,
        'bright': BRIGHT,
        'strong': STRONG,
        'mysterious': MYSTERIOUS,
    }.items():
        scores[mood] = sum(1 for token in vocab.split() if token in text)
    if kind == 'surname':
        if commonality >= 3:
            scores['modern'] += 2
            scores['bright'] += 1
        elif commonality == 2:
            scores['elegant'] += 1
        else:
            scores['unique'] += 2
            scores['mysterious'] += 1
    elif commonality >= 3:
        scores['modern'] += 2
        scores['bright'] += 1
    elif commonality == 2:
        scores['elegant'] += 1
    if len(text) >= 4 and commonality <= 1:
        scores['unique'] += 1
    if rare:
        scores['unique'] += 2
        scores['mysterious'] += 1
    ordered = sorted(scores, key=lambda mood: (-scores[mood], MOODS.index(mood)))
    selected = [mood for mood in ordered if scores[mood] > 0][:3]
    if not selected:
        selected = ['modern', 'unique'] if len(text) >= 3 else ['modern']
    return selected


def build_surnames() -> list[dict]:
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for rank, row in enumerate(read_csv(SURNAME_FILE), start=1):
        if len(row) < 2:
            continue
        kanji, readings, population, *rest = row
        for reading in readings.split('|'):
            key = (kanji, reading)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                'id': f'surname-{rank}-{len(rows)}',
                'kanji': kanji,
                'reading': reading,
                'rank': rank,
        'moods': score_moods(kanji + reading, rare=rank > 5000, commonality=3 if rank <= 500 else 2 if rank <= 3000 else 1, kind='surname'),
        'commonality': 3 if rank <= 500 else 2 if rank <= 3000 else 1,
                'population': int(float(population)) if population else None,
            })
    if len(rows) < 10000 and SQLITE_FILE.exists():
        connection = sqlite3.connect(SQLITE_FILE)
        for noid, kanji, alt, reading, country in connection.execute("SELECT noid, name, alt, reading, country FROM last_names WHERE country = 'jp' ORDER BY noid"):
            key = (kanji, reading)
            if not kanji or not reading or key in seen:
                continue
            seen.add(key)
            commonality = 2 if len(rows) < 8500 else 1
            rows.append({'id': f'surname-db-{noid}', 'kanji': kanji, 'reading': reading, 'rank': len(rows) + 1, 'moods': score_moods(kanji + reading, rare=commonality == 1, commonality=commonality, kind='surname'), 'commonality': commonality, 'population': None})
            if len(rows) >= 10000:
                break
        connection.close()
    return rows


def build_given_names() -> list[dict]:
    rows: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    sources = [
        ('male', PERSONAL_DIR / 'first_name_man_org.csv', 7000),
        ('female', PERSONAL_DIR / 'first_name_woman_org.csv', 7000),
    ]
    for gender, path, cap in sources:
        for source_rank, row in enumerate(read_csv(path), start=1):
            if len(row) < 3:
                continue
            reading, romaji, *kanji_variants = row
            for kanji in kanji_variants:
                if not kanji or not reading:
                    continue
                key = (gender, kanji, reading)
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    'id': f'given-{gender}-{len(rows)}',
                    'kanji': kanji,
                    'reading': reading,
                    'gender': gender,
                    'moods': score_moods(kanji + reading, rare=source_rank > 4000, commonality=3 if source_rank <= 1000 else 2 if source_rank <= 4000 else 1),
                    'commonality': 3 if source_rank <= 1000 else 2 if source_rank <= 4000 else 1,
                })
                if sum(1 for item in rows if item['gender'] == gender) >= cap:
                    break
            if sum(1 for item in rows if item['gender'] == gender) >= cap:
                break
    if len(rows) < 20000 and SQLITE_FILE.exists():
        connection = sqlite3.connect(SQLITE_FILE)
        for foid, kanji, reading, sex, country, popularity in connection.execute("SELECT foid, name, reading, sex, country, popularity FROM first_names WHERE country = 'jp' ORDER BY foid"):
            gender = 'male' if sex == 'M' else 'female' if sex == 'F' else 'female'
            key = (gender, kanji, reading)
            if not kanji or not reading or key in seen:
                continue
            seen.add(key)
            commonality = 2 if len(rows) < 15000 else 1
            rows.append({'id': f'given-db-{foid}', 'kanji': kanji, 'reading': reading, 'gender': gender, 'moods': score_moods(kanji + reading, rare=commonality == 1, commonality=commonality), 'commonality': commonality})
            if len(rows) >= 20000:
                break
        connection.close()
    return rows


def main() -> None:
    # GitHub Pagesなどのクリーンビルドでは元SQLiteを取得しないため、
    # 生成済みの同梱JSONをそのまま使って候補数を維持する。
    if not SQLITE_FILE.exists() and OUT.exists():
        payload = json.loads(OUT.read_text(encoding='utf-8'))
        print(f"using bundled {len(payload['surnames'])} surnames and {len(payload['givenNames'])} given names -> {OUT}")
        return
    surnames = build_surnames()
    given_names = build_given_names()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'generatedAt': '2026-10-22',
        'sources': {
            'surname': 'siikamiika/japanese-family-names（名字由来net由来・商用利用不可・帰属表示必須）＋jackdeguest/JapaneseNamesDatabase（公開共有データ）',
            'given': 'shuheilocale/japanese-personal-name-dataset（MIT License）＋jackdeguest/JapaneseNamesDatabase（公開共有データ）',
            'trend': 'たまひよ 赤ちゃんの名前ランキング2025 / 2026年全国名字ランキング',
        },
        'surnames': surnames,
        'givenNames': given_names,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'generated {len(surnames)} surnames and {len(given_names)} given names -> {OUT}')


if __name__ == '__main__':
    main()
