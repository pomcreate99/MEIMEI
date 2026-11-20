"""MEIMEI データ再分類スクリプト（v2形式の生成）

方針（評価レポート 2026-11-20 のハイブリッド案）:
- 苗字: 雰囲気ラベルを廃止し、頻度の傾向 tier（common/familiar/rare）に変更。
  実人口があるものは人口で、ないもの（DB由来）は旧 commonality で判定する。
  読みが空の2件は除外する。
- 名前: MIT の shuheilocale データセットから作る。利用条件が不明な DB 由来
  （旧データで全件男性扱いになっていた）は使わない。
  【重要】旧ビルドは「男女各7,000件」の上限を読みの五十音順に数えていたため、
  収録名前が あ行・か行の読みだけに切り取られていた（偏りの最大の原因）。
  ここでは全ての読みを対象にし、1読みあたりの漢字バリエーション数だけを
  均等間引きで制限する（男性3件・女性4件まで）。
  男女両方に同じ漢字+読みで現れる候補は unisex（中性的）に統合する。
  元CSVが data/source/personal-names/ に無い場合は、同梱JSONの既存候補で代替する。
- 名前の雰囲気（7分類）は漢字のみで判定する（旧方式は読みの部分一致が混入していた）。
  各分類に代表漢字セットを持ち、一致数でスコア付けする。
  主分類1つ + 副分類最大1つ。どの分類にも一致しない名前は moods=[]（おまかせ専用）。
- 個性的・珍しい（unique）は、3文字以上の名前や珍しい漢字を含む名前を加点する。
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'src/data/names.json'
PERSONAL_DIR = ROOT / 'data/source/personal-names/japanese_personal_name_dataset/dataset'

MOOD_ORDER = ['modern', 'classic', 'elegant', 'bright', 'strong', 'mysterious', 'unique']
# 同点時の主分類の優先順（プールの小さい分類を優先して偏りをならす）
TIE_PRIORITY = ['classic', 'strong', 'mysterious', 'elegant', 'bright', 'modern', 'unique']

KANJI_SETS = {
    # 漢字は複数分類に属してよい（例: 陽=明るい+現代的、月=上品+ミステリアス）。
    # スコアは分類ごとに独立に数え、主分類1つ+副分類最大1つを選ぶ。
    'modern': set('蓮湊凪紬澪葵碧蒼律悠奏栞梓楓椿桜結衣那菜奈羽叶唯莉梨璃怜伶俐漣翠汐弦柚杏李桃樹斗汰凌陽翔央'),
    'classic': set('郎介助之彦夫雄臣茂重信義忠守久恒昭正昌隆博文哲仁敬憲寛豊稔実進蔵衛門源平清松竹梅菊藤鶴亀寿歳千代子江枝乃津留富貴栄一二三八十和章敦史有篤永顕厚成也秋'),
    'elegant': set('雅麗綾香華蘭紗玲瑠瑞皓琴詩織雫朱彩文佳澄薫馨月雪美緒瞳彰淳郁晶英麻安'),
    'bright': set('陽晴光暁笑咲輝暖虹希望花音楽天海空日向心春夏優歩恵愛朝葉緑明朗晃星葵'),
    'strong': set('剛武勇駿陸翔隼剣迅岳豪将真直健力誠毅龍竜虎鷹鋼鉄岩烈昂凛凜颯翼響徹陣甲克勝'),
    'mysterious': set('夜影紫零朔宵玄霧幽黒銀霞星夢冥紺雨闇幻朧深静月雪蒼碧夕緋雲宙霜氷冬'),
}
RARE_KANJI = set('弥耶巫楼兎狼迦姫')

# 独自編集の補完候補。公開名ランキング（明治安田生命・たまひよ等）で定番の
# 現代的な名前を中心に、辞書データに乏しい分類（現代的な男性名、凛々しい女性名、
# ミステリアス、中性的）を補う。moods は [主分類, 副分類] の編集指定。
# (kanji, reading, gender, moods)
SUPPLEMENT: list[tuple[str, str, str, list[str]]] = [
    # 現代的・男性寄り
    ('蓮', 'れん', 'male', ['modern']),
    ('湊', 'みなと', 'male', ['modern']),
    ('湊斗', 'みなと', 'male', ['modern']),
    ('陽翔', 'はると', 'male', ['modern', 'bright']),
    ('蒼太', 'そうた', 'male', ['modern']),
    ('碧斗', 'あおと', 'male', ['modern']),
    ('樹', 'いつき', 'male', ['modern']),
    ('悠真', 'ゆうま', 'male', ['modern']),
    ('悠翔', 'ゆうと', 'male', ['modern', 'bright']),
    ('悠太', 'ゆうた', 'male', ['modern']),
    ('陽向', 'ひなた', 'male', ['bright', 'modern']),
    ('颯真', 'そうま', 'male', ['strong', 'modern']),
    ('颯太', 'そうた', 'male', ['strong', 'modern']),
    ('凌', 'りょう', 'male', ['modern', 'strong']),
    ('陸', 'りく', 'male', ['strong', 'modern']),
    ('奏太', 'そうた', 'male', ['modern']),
    ('悠人', 'ゆうと', 'male', ['modern']),
    ('晴人', 'はると', 'male', ['modern', 'bright']),
    ('凛人', 'りと', 'male', ['modern', 'strong']),
    ('暖', 'だん', 'male', ['bright', 'modern']),
    # 現代的・女性寄り
    ('陽葵', 'ひまり', 'female', ['modern', 'bright']),
    ('紬', 'つむぎ', 'female', ['modern']),
    ('澪', 'みお', 'female', ['modern', 'elegant']),
    ('結愛', 'ゆあ', 'female', ['modern', 'bright']),
    ('芽依', 'めい', 'female', ['modern']),
    ('凪咲', 'なぎさ', 'female', ['modern']),
    ('翠', 'すい', 'female', ['modern', 'elegant']),
    ('莉子', 'りこ', 'female', ['modern', 'classic']),
    ('結菜', 'ゆいな', 'female', ['modern', 'bright']),
    ('咲良', 'さくら', 'female', ['bright', 'modern']),
    ('咲茉', 'えま', 'female', ['modern', 'bright']),
    ('茉莉', 'まり', 'female', ['modern', 'elegant']),
    ('莉茉', 'りま', 'female', ['modern']),
    ('柚葉', 'ゆずは', 'female', ['modern', 'bright']),
    ('花音', 'かのん', 'female', ['modern', 'elegant']),
    ('心春', 'こはる', 'female', ['bright', 'modern']),
    # 凛々しい・強い（男女）
    ('凛', 'りん', 'female', ['strong', 'modern']),
    ('凛久', 'りく', 'male', ['strong', 'modern']),
    ('巴', 'ともえ', 'female', ['strong', 'classic']),
    ('勝子', 'かつこ', 'female', ['strong', 'classic']),
    ('武子', 'たけこ', 'female', ['strong', 'classic']),
    ('勇子', 'ゆうこ', 'female', ['strong', 'classic']),
    ('翔子', 'しょうこ', 'female', ['strong']),
    ('響子', 'きょうこ', 'female', ['strong', 'elegant']),
    ('凛子', 'りんこ', 'female', ['strong', 'classic']),
    # ミステリアス（男女）
    ('玄', 'げん', 'male', ['mysterious']),
    ('玄太', 'げんた', 'male', ['mysterious', 'classic']),
    ('玄一', 'げんいち', 'male', ['mysterious', 'classic']),
    ('零', 'れい', 'male', ['mysterious']),
    ('朔', 'さく', 'male', ['mysterious', 'modern']),
    ('朔也', 'さくや', 'male', ['mysterious', 'modern']),
    ('夕霧', 'ゆうぎり', 'female', ['mysterious']),
    ('紫苑', 'しおん', 'female', ['mysterious', 'elegant']),
    ('雪乃', 'ゆきの', 'female', ['mysterious', 'elegant']),
    ('月乃', 'つきの', 'female', ['mysterious', 'elegant']),
    ('星乃', 'ほしの', 'female', ['mysterious']),
    ('夢乃', 'ゆめの', 'female', ['mysterious']),
    ('紫乃', 'しの', 'female', ['mysterious', 'elegant']),
    ('霞', 'かすみ', 'female', ['mysterious']),
    # 中性的（男女どちらにも使われる定番）
    ('凪', 'なぎ', 'unisex', ['modern']),
    ('律', 'りつ', 'unisex', ['modern']),
    ('奏', 'かなで', 'unisex', ['modern', 'elegant']),
    ('響', 'ひびき', 'unisex', ['strong']),
    ('翼', 'つばさ', 'unisex', ['strong', 'bright']),
    ('悠', 'ゆう', 'unisex', ['modern']),
    ('光', 'ひかる', 'unisex', ['bright']),
    ('泉', 'いずみ', 'unisex', ['bright', 'elegant']),
    ('薫', 'かおる', 'unisex', ['elegant']),
    ('碧', 'あおい', 'unisex', ['modern', 'mysterious']),
    ('蒼', 'あおい', 'unisex', ['modern', 'mysterious']),
    ('千尋', 'ちひろ', 'unisex', ['elegant', 'modern']),
    ('渚', 'なぎさ', 'unisex', ['modern', 'bright']),
    ('楓', 'かえで', 'unisex', ['modern', 'elegant']),
    ('忍', 'しのぶ', 'unisex', ['classic', 'mysterious']),
    ('希空', 'のあ', 'unisex', ['unique', 'modern']),
]


# 実在のランキングに基づく確定分類（2026-11-20 追加）。
# 現代的: 明治安田生命「2025年生まれの子供の名前調査」と、ベネッセ たまひよ
# 「赤ちゃんの名前ランキング2025」の上位（表記・読み）に入った名前。
# 和風・古風: 明治安田生命の生まれ年別調査に基づく昭和期（前期・高度成長期）の
# 人気名前。これらは漢字スコアより優先し、反対側の分類（現代的⇔古風）は付けない。
# (kanji, reading, gender)
RANKED_MODERN: list[tuple[str, str, str]] = [
    # 男性寄り
    ('湊', 'みなと', 'male'), ('伊織', 'いおり', 'male'), ('結翔', 'ゆいと', 'male'),
    ('琉生', 'るい', 'male'), ('蓮', 'れん', 'male'), ('朔', 'さく', 'male'),
    ('碧', 'あお', 'male'), ('陽向', 'ひなた', 'male'), ('陽翔', 'はると', 'male'),
    ('藍', 'らん', 'male'), ('朝陽', 'あさひ', 'male'), ('晴', 'はる', 'male'),
    ('蒼空', 'そら', 'male'), ('碧斗', 'あおと', 'male'), ('陸', 'りく', 'male'),
    ('颯太', 'そうた', 'male'), ('奏太', 'そうた', 'male'), ('善', 'ぜん', 'male'),
    ('晴翔', 'はると', 'male'), ('昊', 'そら', 'male'),
    # 女性寄り
    ('翠', 'すい', 'female'), ('陽葵', 'ひまり', 'female'), ('紬', 'つむぎ', 'female'),
    ('茉白', 'ましろ', 'female'), ('凛', 'りん', 'female'), ('陽菜', 'ひな', 'female'),
    ('心陽', 'こはる', 'female'), ('彩葉', 'いろは', 'female'), ('詩', 'うた', 'female'),
    ('琴葉', 'ことは', 'female'), ('結菜', 'ゆいな', 'female'), ('芽依', 'めい', 'female'),
    ('葵', 'あおい', 'female'), ('結月', 'ゆづき', 'female'), ('澪', 'みお', 'female'),
    ('咲茉', 'えま', 'female'), ('紗那', 'さな', 'female'), ('心春', 'こはる', 'female'),
    ('結愛', 'ゆあ', 'female'),
    # 中性的（男女共通読みで人気）
    ('凪', 'なぎ', 'unisex'), ('律', 'りつ', 'unisex'), ('星那', 'せな', 'unisex'),
]
RANKED_CLASSIC: list[tuple[str, str, str]] = [
    # 男性寄り（昭和前期・高度成長期の人気名）
    ('清', 'きよし', 'male'), ('勝', 'かつ', 'male'), ('茂', 'しげる', 'male'),
    ('正夫', 'まさお', 'male'), ('茂雄', 'しげお', 'male'), ('武', 'たけし', 'male'),
    ('勇', 'いさむ', 'male'), ('武雄', 'たけお', 'male'), ('誠', 'まこと', 'male'),
    ('健一', 'けんいち', 'male'), ('浩', 'ひろし', 'male'), ('隆', 'たかし', 'male'),
    ('博', 'ひろし', 'male'), ('明', 'あきら', 'male'), ('進', 'すすむ', 'male'),
    ('実', 'みのる', 'male'),
    # 女性寄り（昭和前期・高度成長期の人気名）
    ('和子', 'かずこ', 'female'), ('幸子', 'さちこ', 'female'), ('洋子', 'ようこ', 'female'),
    ('節子', 'せつこ', 'female'), ('弘子', 'ひろこ', 'female'), ('美智子', 'みちこ', 'female'),
    ('栄子', 'えいこ', 'female'), ('京子', 'きょうこ', 'female'), ('百合子', 'ゆりこ', 'female'),
    ('清子', 'きよこ', 'female'), ('恵子', 'けいこ', 'female'), ('由美子', 'ゆみこ', 'female'),
    ('裕子', 'ゆうこ', 'female'), ('典子', 'のりこ', 'female'), ('順子', 'じゅんこ', 'female'),
]
RANKED_SECONDARY = {
    'modern': {'bright', 'elegant', 'strong'},
    'classic': {'strong', 'elegant', 'bright'},
}


def merge_ranked(given: list[dict]) -> list[dict]:
    """ランキング確定分類を最後に適用し、漢字スコアより優先する。"""
    index = {(g['kanji'], g['reading']): g for g in given}
    for ranked, primary, opposite in [
        (RANKED_MODERN, 'modern', 'classic'),
        (RANKED_CLASSIC, 'classic', 'modern'),
    ]:
        for kanji, reading, gender in ranked:
            key = (kanji, reading)
            if key in index:
                entry = index[key]
                if gender == 'unisex':
                    entry['gender'] = 'unisex'
                secondary = [m for m in entry['moods'] if m in RANKED_SECONDARY[primary]]
                entry['moods'] = [primary] + secondary[:1]
            else:
                entry = {'kanji': kanji, 'reading': reading, 'gender': gender, 'moods': [primary]}
                given.append(entry)
                index[key] = entry
            if opposite in entry['moods']:
                entry['moods'] = [m for m in entry['moods'] if m != opposite]
    return given


def score_moods(kanji: str, reading: str) -> list[str]:
    scores: dict[str, int] = {}
    for mood, chars in KANJI_SETS.items():
        scores[mood] = sum(1 for c in kanji if c in chars)
    unique_score = 0
    if len(kanji) >= 3:
        unique_score += 1
    if any(c in RARE_KANJI for c in kanji):
        unique_score += 2
    scores['unique'] = unique_score
    # 現代的の誤判定防止（ランキング確定分は merge_ranked で別途付ける）:
    # 古風な漢字を含む名前は現代的にしない。2文字以上で現代的漢字が1つだけの名前も現代的にしない。
    if scores['classic'] > 0 and scores['modern'] <= scores['classic']:
        scores['modern'] = 0
    if len(kanji) > 1 and scores['modern'] < 2:
        scores['modern'] = 0

    ranked = sorted(
        (m for m in MOOD_ORDER if scores[m] > 0),
        key=lambda m: (-scores[m], TIE_PRIORITY.index(m)),
    )
    if not ranked:
        return []
    primary = ranked[0]
    result = [primary]
    for mood in ranked[1:]:
        if scores[mood] >= scores[primary] - 1:
            result.append(mood)
            break
    # 現代的と和風・古風は正反対の印象なので、主分類が現代的なら古風を副分類に残さない
    if primary == 'modern' and 'classic' in result:
        result = [m for m in result if m != 'classic']
    return result


def stride_sample(variants: list[str], cap: int) -> list[str]:
    """バリエーションを先頭・中間・末尾から均等に間引く（決定的サンプリング）。"""
    if len(variants) <= cap:
        return list(variants)
    picked: list[str] = []
    for i in range(cap):
        item = variants[round(i * (len(variants) - 1) / (cap - 1))]
        if item not in picked:
            picked.append(item)
    return picked


def merge_supplement(given: list[dict]) -> list[dict]:
    """補完候補をマージする。同キーがある場合は性別を unisex へ広げ、moods は編集指定を優先する。"""
    index = {(g['kanji'], g['reading']): g for g in given}
    for kanji, reading, gender, moods in SUPPLEMENT:
        key = (kanji, reading)
        if key in index:
            entry = index[key]
            if gender == 'unisex':
                entry['gender'] = 'unisex'
            entry['moods'] = moods
        else:
            entry = {'kanji': kanji, 'reading': reading, 'gender': gender, 'moods': moods}
            given.append(entry)
            index[key] = entry
    return given


def build_given_from_source() -> list[dict]:
    """shuheilocale の元CSVから、全ての読みを対象に名前候補を作る。"""
    by_key: dict[tuple[str, str], set[str]] = {}
    for gender, filename, cap in [
        ('male', 'first_name_man_org.csv', 3),
        ('female', 'first_name_woman_org.csv', 4),
    ]:
        with (PERSONAL_DIR / filename).open(encoding='utf-8', newline='') as f:
            for row in csv.reader(f):
                if len(row) < 3:
                    continue
                reading, _romaji, variants = row[0], row[1], [v for v in row[2:] if v]
                for kanji in stride_sample(variants, cap):
                    by_key.setdefault((kanji, reading), set()).add(gender)
    given = []
    for (kanji, reading), genders in by_key.items():
        gender = 'unisex' if len(genders) > 1 else next(iter(genders))
        given.append({'kanji': kanji, 'reading': reading, 'gender': gender, 'moods': score_moods(kanji, reading)})
    return given


def build_surnames(payload: dict) -> list[dict]:
    """苗字の傾向は、名字由来netランキングの順位で決める（v3）。

    よくある = 全国上位300位 / 標準・やや珍しい = 301〜3,000位 / 珍しい = 3,001位以下。
    人口データのない名字（ランキング圏外）は一律「珍しい」とする。
    旧方式（人口の絶対値や別データベースの commonality で判定）は、
    「よくある」に下位の名字が混ざるため廃止した。
    """
    rows = [r for r in payload['surnames'] if r.get('reading')]
    ranked = sorted((r for r in rows if r.get('population')), key=lambda r: -r['population'])
    rank_of = {id(r): i + 1 for i, r in enumerate(ranked)}
    surnames = []
    for row in rows:
        entry = {'kanji': row['kanji'], 'reading': row['reading'], 'population': row.get('population')}
        if row.get('population'):
            rank = rank_of[id(row)]
            entry['rank'] = rank
            entry['tier'] = 'common' if rank <= 300 else 'familiar' if rank <= 3000 else 'rare'
        else:
            entry['tier'] = 'rare'
        surnames.append(entry)
    return surnames


def main() -> None:
    payload = json.loads(DATA.read_text(encoding='utf-8'))
    surnames = build_surnames(payload)

    if PERSONAL_DIR.exists():
        given = build_given_from_source()
        print('given names built from source CSVs (all readings covered)')
    elif payload.get('version', 0) >= 2:
        given = payload['givenNames']
        print('source CSVs not found; keeping bundled given names')
    else:
        # フォールバック: 同梱JSONの shuheilocale 由来のみを使う。
        # ただし旧同梱データは あ行・か行に切り取られているため、元CSVでの再生成を推奨する。
        kept = [r for r in payload['givenNames'] if not r['id'].startswith('given-db')]
        by_key: dict[tuple[str, str], set[str]] = {}
        for row in kept:
            by_key.setdefault((row['kanji'], row['reading']), set()).add(row['gender'])
        given = []
        for (kanji, reading), genders in by_key.items():
            gender = 'unisex' if len(genders) > 1 else next(iter(genders))
            given.append({'kanji': kanji, 'reading': reading, 'gender': gender, 'moods': score_moods(kanji, reading)})
        print('WARNING: built given names from bundled legacy data (readings truncated to あ・か行). Place source CSVs under data/source/ and rerun for the full dataset.')

    given = merge_supplement(given)
    given = merge_ranked(given)
    # 生成プールの並び順が結果に影響しないよう、読み順で安定ソートしておく
    given.sort(key=lambda r: (r['reading'], r['kanji']))

    out = {
        'version': 3,
        'generatedAt': '2026-11-20',
        'sources': payload.get('sources', {}),
        'surnames': surnames,
        'givenNames': given,
    }
    DATA.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'v3: {len(surnames)} surnames, {len(given)} given names -> {DATA}')


if __name__ == '__main__':
    main()
