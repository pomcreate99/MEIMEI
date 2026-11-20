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
- 名前の雰囲気（7分類）の付け方（2026-11-21 の v4 で全面変更）:
  現代的・和風・古風は、実在ランキングに載った漢字+読みのペアだけに付ける
  （RANKED_MODERN / RANKED_CLASSIC）。漢字の印象では絶対に付けない。
  残り5分類（上品・明るい・凛々しい・ミステリアス・個性的）は漢字セットの
  一致数でスコア付けする（主分類1つ + 副分類最大1つ）。どの分類にも
  一致しない名前は moods=[]（おまかせ専用）。
  最後に ChatGPT との共同確認（サンプル125件＋要注意20件）の結果を
  apply_joint_review で反映する（不自然な読みのペア10件を除外、印象の
  付け替え27件）。
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
TIE_PRIORITY = ['strong', 'mysterious', 'elegant', 'bright', 'unique']

# 印象分類（漢字スコア）の対象は5分類のみ。
# 「現代的」「和風・古風」は漢字の印象では付けない（2026-11-21 の方針変更）:
# ランキング（たまひよ／明治安田）に実名として載ったペアだけに、
# merge_ranked が付け、sanitize_ranked がそれ以外から剥がす。
KANJI_SETS = {
    # 漢字は複数分類に属してよい（例: 月=上品+ミステリアス）。
    # スコアは分類ごとに独立に数え、主分類1つ+副分類最大1つを選ぶ。
    'elegant': set('雅麗綾香華蘭紗玲瑠瑞皓琴詩織雫朱彩文佳澄薫馨月雪美緒瞳彰淳郁晶英麻安'),
    'bright': set('陽晴光暁笑咲輝暖虹希望花音楽天海空日向心春夏優歩恵愛朝葉緑明朗晃星葵'),
    'strong': set('剛武勇駿陸翔隼剣迅岳豪将真直健力誠毅龍竜虎鷹鋼鉄岩烈昂凛凜颯翼響徹陣甲克勝'),
    'mysterious': set('夜影紫零朔宵玄霧幽黒銀霞星夢冥紺雨闇幻朧深静月雪蒼碧夕緋雲宙霜氷冬'),
}
RARE_KANJI = set('弥耶巫楼兎狼迦姫')
# 昔ながらの人名に多い漢字（旧「classic」漢字セット）。分類には使わず、
# 「個性的」の文字数ボーナスを抑えるためだけに使う。
OLD_STYLE_KANJI = set('郎介助之彦夫雄臣茂重信義忠守久恒昭正昌隆博文哲仁敬憲寛豊稔実進蔵衛門源平清松竹梅菊藤鶴亀寿歳千代子江枝乃津留富貴栄一二三八十和章敦史有篤永顕厚成也秋')

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


# 実在のランキングに基づく確定分類（2026-11-20 追加、2026-11-21 全面拡充）。
# 現代的: ベネッセ たまひよ「赤ちゃんの名前ランキング2025」（男女トップ100＋
# 読みランキングの使用例）と、明治安田生命「2025年生まれの子供の名前調査」の
# 上位に入った名前（漢字＋読みのペア）。
# 和風・古風: 明治安田生命の生まれ年別ベスト10（1926〜1988、安田女子大学紀要の
# 転載で全年確認）など昭和期の人気名前。
# 2026-11-21 の調査ファイル: ~/workspace/meimei-work/rankings-research-2026-11-21.json
# ひらがな名（さくら・ゆかり等）は漢字データの対象外として収録していない。
# 両方に載るペアは現代的を優先する。これらは漢字スコアより優先し、
# 反対側の分類（現代的⇔古風）は付けない。sanitize_ranked が最終検査をする。
# (kanji, reading, gender)
RANKED_MODERN: list[tuple[str, str, str]] = [
    ('碧', 'あお', 'male'), ('蒼', 'あお', 'male'), ('碧', 'あおい', 'female'),
    ('葵', 'あおい', 'unisex'), ('蒼生', 'あおい', 'male'), ('碧人', 'あおと', 'male'),
    ('碧斗', 'あおと', 'male'), ('蒼翔', 'あおと', 'male'), ('蒼葉', 'あおば', 'male'),
    ('明莉', 'あかり', 'female'), ('朱莉', 'あかり', 'female'), ('旭', 'あさひ', 'male'),
    ('旭陽', 'あさひ', 'male'), ('朝陽', 'あさひ', 'male'), ('天音', 'あまね', 'female'),
    ('絢斗', 'あやと', 'male'), ('新', 'あらた', 'male'), ('杏', 'あん', 'female'),
    ('杏奈', 'あんな', 'female'), ('伊織', 'いおり', 'male'), ('一花', 'いちか', 'female'),
    ('一華', 'いちか', 'female'), ('樹', 'いつき', 'male'), ('依采', 'いと', 'female'),
    ('絃葉', 'いとは', 'female'), ('一颯', 'いぶき', 'male'), ('伊吹', 'いぶき', 'male'),
    ('彩羽', 'いろは', 'female'), ('彩葉', 'いろは', 'female'), ('詩', 'うた', 'female'),
    ('詩葉', 'うたは', 'female'), ('咲茉', 'えま', 'female'), ('永茉', 'えま', 'female'),
    ('桜都', 'おと', 'female'), ('音羽', 'おとは', 'female'), ('櫂', 'かい', 'male'),
    ('海斗', 'かいと', 'male'), ('海翔', 'かいと', 'male'), ('楓', 'かえで', 'unisex'),
    ('奏多', 'かなた', 'male'), ('奏太', 'かなた', 'male'), ('奏汰', 'かなた', 'male'),
    ('叶翔', 'かなと', 'male'), ('奏翔', 'かなと', 'male'), ('花音', 'かのん', 'female'),
    ('岳', 'がく', 'male'), ('慧', 'けい', 'male'), ('慶', 'けい', 'male'),
    ('敬斗', 'けいと', 'male'), ('光希', 'こうき', 'male'), ('心都', 'こと', 'female'),
    ('琴音', 'ことね', 'female'), ('琴葉', 'ことは', 'female'), ('心春', 'こはる', 'female'),
    ('心晴', 'こはる', 'female'), ('心陽', 'こはる', 'female'), ('朔', 'さく', 'male'),
    ('咲翔', 'さくと', 'male'), ('咲良', 'さくら', 'female'), ('桜', 'さくら', 'female'),
    ('咲凪', 'さな', 'female'), ('咲奈', 'さな', 'female'), ('咲那', 'さな', 'female'),
    ('紗奈', 'さな', 'female'), ('紗菜', 'さな', 'female'), ('紗那', 'さな', 'female'),
    ('紗良', 'さら', 'female'), ('雫', 'しずく', 'female'), ('柊', 'しゅう', 'male'),
    ('翔', 'しょう', 'male'), ('仁', 'じん', 'male'), ('翠', 'すい', 'unisex'),
    ('涼葉', 'すずは', 'female'), ('菫', 'すみれ', 'female'), ('世梛', 'せな', 'male'),
    ('星那', 'せな', 'unisex'), ('善', 'ぜん', 'male'), ('然', 'ぜん', 'male'),
    ('想', 'そう', 'male'), ('颯', 'そう', 'male'), ('颯介', 'そうすけ', 'male'),
    ('奏太', 'そうた', 'male'), ('蒼大', 'そうた', 'male'), ('颯太', 'そうた', 'male'),
    ('颯汰', 'そうた', 'male'), ('壮真', 'そうま', 'male'), ('蒼真', 'そうま', 'male'),
    ('颯真', 'そうま', 'male'), ('昊', 'そら', 'male'), ('蒼空', 'そら', 'male'),
    ('大晴', 'たいせい', 'male'), ('太陽', 'たいよう', 'male'), ('暖', 'だん', 'male'),
    ('千隼', 'ちはや', 'male'), ('千颯', 'ちはや', 'male'), ('千紘', 'ちひろ', 'male'),
    ('紬', 'つむぎ', 'female'), ('紬希', 'つむぎ', 'female'), ('紬葵', 'つむぎ', 'female'),
    ('斗碧', 'とあ', 'male'), ('燈真', 'とうま', 'male'), ('凪', 'なぎ', 'unisex'),
    ('凪咲', 'なぎさ', 'female'), ('凪紗', 'なぎさ', 'female'), ('凪翔', 'なぎと', 'male'),
    ('夏輝', 'なつき', 'male'), ('虹心', 'にこ', 'female'), ('乃愛', 'のあ', 'female'),
    ('花', 'はな', 'female'), ('颯人', 'はやと', 'male'), ('颯斗', 'はやと', 'male'),
    ('晴', 'はる', 'unisex'), ('晴琉', 'はる', 'male'), ('陽', 'はる', 'male'),
    ('陽琉', 'はる', 'male'), ('悠希', 'はるき', 'male'), ('悠翔', 'はると', 'male'),
    ('晴翔', 'はると', 'male'), ('遥斗', 'はると', 'male'), ('陽斗', 'はると', 'male'),
    ('陽翔', 'はると', 'male'), ('陽彩', 'ひいろ', 'female'), ('光莉', 'ひかり', 'female'),
    ('陽菜', 'ひな', 'female'), ('陽向', 'ひなた', 'male'), ('陽咲', 'ひなた', 'female'),
    ('陽大', 'ひなた', 'male'), ('陽太', 'ひなた', 'male'), ('陽奏', 'ひなた', 'male'),
    ('陽菜乃', 'ひなの', 'female'), ('陽葵', 'ひまり', 'female'), ('大翔', 'ひろと', 'male'),
    ('風花', 'ふうか', 'female'), ('楓真', 'ふうま', 'male'), ('双葉', 'ふたば', 'female'),
    ('茉白', 'ましろ', 'female'), ('心彩', 'みあ', 'female'), ('心愛', 'みあ', 'female'),
    ('実桜', 'みお', 'female'), ('澪', 'みお', 'female'), ('美桜', 'みお', 'female'),
    ('美琴', 'みこと', 'female'), ('美月', 'みつき', 'female'), ('湊', 'みなと', 'male'),
    ('湊大', 'みなと', 'male'), ('湊斗', 'みなと', 'male'), ('湊翔', 'みなと', 'male'),
    ('湊音', 'みなと', 'male'), ('心結', 'みゆ', 'female'), ('芽依', 'めい', 'female'),
    ('芽生', 'めい', 'female'), ('百花', 'ももか', 'female'), ('大和', 'やまと', 'male'),
    ('結愛', 'ゆあ', 'female'), ('結', 'ゆい', 'female'), ('結衣', 'ゆい', 'female'),
    ('結仁', 'ゆいと', 'male'), ('結斗', 'ゆいと', 'male'), ('結翔', 'ゆいと', 'male'),
    ('結菜', 'ゆいな', 'female'), ('悠', 'ゆう', 'male'), ('悠晴', 'ゆうせい', 'male'),
    ('悠生', 'ゆうせい', 'male'), ('悠人', 'ゆうと', 'male'), ('悠斗', 'ゆうと', 'male'),
    ('結翔', 'ゆうと', 'male'), ('悠陽', 'ゆうひ', 'male'), ('悠真', 'ゆうま', 'male'),
    ('柚希', 'ゆずき', 'female'), ('柚葉', 'ゆずは', 'female'), ('結月', 'ゆづき', 'female'),
    ('結菜', 'ゆな', 'female'), ('柚乃', 'ゆの', 'female'), ('耀', 'よう', 'male'),
    ('藍', 'らん', 'unisex'), ('蘭', 'らん', 'female'), ('莉愛', 'りあ', 'female'),
    ('莉央', 'りお', 'female'), ('莉緒', 'りお', 'female'), ('凌久', 'りく', 'male'),
    ('理玖', 'りく', 'male'), ('陸', 'りく', 'male'), ('陸斗', 'りくと', 'male'),
    ('莉子', 'りこ', 'female'), ('六花', 'りっか', 'female'), ('律', 'りつ', 'unisex'),
    ('律希', 'りつき', 'male'), ('理翔', 'りと', 'male'), ('理人', 'りひと', 'male'),
    ('理仁', 'りひと', 'male'), ('凛', 'りん', 'female'), ('凜', 'りん', 'female'),
    ('琉生', 'るい', 'male'), ('琉翔', 'るいと', 'male'), ('琉叶', 'るか', 'male'),
    ('瑠花', 'るか', 'female'), ('怜', 'れい', 'male'), ('玲衣', 'れい', 'female'),
    ('怜央', 'れお', 'male'), ('蓮', 'れん', 'male'),
]
RANKED_CLASSIC: list[tuple[str, str, str]] = [
    ('愛', 'あい', 'female'), ('愛子', 'あいこ', 'female'), ('昭子', 'あきこ', 'female'),
    ('明', 'あきら', 'male'), ('昭', 'あきら', 'male'), ('明美', 'あけみ', 'female'),
    ('麻美', 'あさみ', 'female'), ('明日香', 'あすか', 'female'), ('淳', 'あつし', 'male'),
    ('彩', 'あや', 'female'), ('文子', 'あやこ', 'female'), ('功', 'いさお', 'male'),
    ('勲', 'いさお', 'male'), ('勇', 'いさむ', 'male'), ('栄子', 'えいこ', 'female'),
    ('悦子', 'えつこ', 'female'), ('恵美', 'えみ', 'female'), ('絵美', 'えみ', 'female'),
    ('恵美子', 'えみこ', 'female'), ('修', 'おさむ', 'male'), ('香織', 'かおり', 'female'),
    ('一男', 'かずお', 'male'), ('和夫', 'かずお', 'male'), ('和子', 'かずこ', 'female'),
    ('和彦', 'かずひこ', 'male'), ('和也', 'かずや', 'male'), ('勝', 'かつ', 'male'),
    ('勝子', 'かつこ', 'female'), ('京子', 'きょうこ', 'female'), ('清子', 'きよこ', 'female'),
    ('清', 'きよし', 'male'), ('久美子', 'くみこ', 'female'), ('啓子', 'けいこ', 'female'),
    ('恵子', 'けいこ', 'female'), ('健', 'けん', 'male'), ('健一', 'けんいち', 'male'),
    ('健太', 'けんた', 'male'), ('健太郎', 'けんたろう', 'male'), ('浩一', 'こういち', 'male'),
    ('浩二', 'こうじ', 'male'), ('沙織', 'さおり', 'female'), ('貞子', 'さだこ', 'female'),
    ('幸子', 'さちこ', 'female'), ('聡', 'さとし', 'male'), ('三郎', 'さぶろう', 'male'),
    ('茂雄', 'しげお', 'male'), ('茂', 'しげる', 'male'), ('静子', 'しずこ', 'female'),
    ('昭一', 'しょういち', 'male'), ('昭子', 'しょうこ', 'female'), ('照子', 'しょうこ', 'female'),
    ('昭二', 'しょうじ', 'male'), ('昭三', 'しょうぞう', 'male'), ('翔太', 'しょうた', 'male'),
    ('勝利', 'しょうり', 'male'), ('純子', 'じゅんこ', 'female'), ('順子', 'じゅんこ', 'female'),
    ('進', 'すすむ', 'male'), ('節子', 'せつこ', 'female'), ('孝子', 'たかこ', 'female'),
    ('崇', 'たかし', 'male'), ('隆', 'たかし', 'male'), ('拓也', 'たくや', 'male'),
    ('武雄', 'たけお', 'male'), ('健', 'たけし', 'male'), ('武', 'たけし', 'male'),
    ('辰雄', 'たつお', 'male'), ('竜也', 'たつや', 'male'), ('達也', 'たつや', 'male'),
    ('大樹', 'だいき', 'male'), ('大介', 'だいすけ', 'male'), ('大輔', 'だいすけ', 'male'),
    ('千代子', 'ちよこ', 'female'), ('勉', 'つとむ', 'male'), ('剛', 'つよし', 'male'),
    ('哲也', 'てつや', 'male'), ('照子', 'てるこ', 'female'), ('徹', 'とおる', 'male'),
    ('敏子', 'としこ', 'female'), ('智子', 'ともこ', 'female'), ('友美', 'ともみ', 'female'),
    ('智美', 'ともみ', 'female'), ('直樹', 'なおき', 'male'), ('直子', 'なおこ', 'female'),
    ('直美', 'なおみ', 'female'), ('信子', 'のぶこ', 'female'), ('昇', 'のぼる', 'male'),
    ('典子', 'のりこ', 'female'), ('紀子', 'のりこ', 'female'), ('久子', 'ひさこ', 'female'),
    ('秀樹', 'ひでき', 'male'), ('英樹', 'ひでき', 'male'), ('弘', 'ひろ', 'male'),
    ('弘子', 'ひろこ', 'female'), ('浩子', 'ひろこ', 'female'), ('博', 'ひろし', 'male'),
    ('弘', 'ひろし', 'male'), ('浩', 'ひろし', 'male'), ('裕美', 'ひろみ', 'female'),
    ('博之', 'ひろゆき', 'male'), ('浩之', 'ひろゆき', 'male'), ('文子', 'ふみこ', 'female'),
    ('舞', 'まい', 'female'), ('麻衣', 'まい', 'female'), ('麻衣子', 'まいこ', 'female'),
    ('誠', 'まこと', 'male'), ('正夫', 'まさお', 'male'), ('正', 'まさし', 'male'),
    ('勝', 'まさる', 'male'), ('学', 'まなぶ', 'male'), ('愛美', 'まなみ', 'female'),
    ('真由美', 'まゆみ', 'female'), ('美香', 'みか', 'female'), ('美紀', 'みき', 'female'),
    ('美智子', 'みちこ', 'female'), ('光子', 'みつこ', 'female'), ('実', 'みのる', 'male'),
    ('稔', 'みのる', 'male'), ('美穂', 'みほ', 'female'), ('美代子', 'みよこ', 'female'),
    ('恵', 'めぐみ', 'female'), ('八重子', 'やえこ', 'female'), ('優', 'ゆう', 'male'),
    ('優子', 'ゆうこ', 'female'), ('祐子', 'ゆうこ', 'female'), ('裕子', 'ゆうこ', 'female'),
    ('祐介', 'ゆうすけ', 'male'), ('雄太', 'ゆうた', 'male'), ('由佳', 'ゆか', 'female'),
    ('幸雄', 'ゆきお', 'male'), ('豊', 'ゆたか', 'male'), ('由美', 'ゆみ', 'female'),
    ('由美子', 'ゆみこ', 'female'), ('百合子', 'ゆりこ', 'female'), ('洋子', 'ようこ', 'female'),
    ('陽子', 'ようこ', 'female'), ('洋平', 'ようへい', 'male'), ('良子', 'よしこ', 'female'),
    ('理恵', 'りえ', 'female'), ('亮', 'りょう', 'male'),
]
# 1980年代に初めて年別トップ10入りした名前は「昔ながらの昭和名」から外す
# （ChatGPTとの共同確認 2026-11-21、明治安田の生まれ年別ベスト10と照合）。
# 「微妙」とされた7件（絵美・智美・友美・由佳・健太・祐介・優）は、同読み・
# 近い形が1970年代に上位だった経緯があるため今回は残している。
RANKED_CLASSIC_1980S: list[tuple[str, str]] = [
    ('麻美', 'あさみ'), ('明日香', 'あすか'), ('麻衣', 'まい'), ('麻衣子', 'まいこ'),
    ('彩', 'あや'), ('舞', 'まい'), ('愛美', 'まなみ'), ('沙織', 'さおり'),
    ('和也', 'かずや'), ('拓也', 'たくや'), ('雄太', 'ゆうた'), ('翔太', 'しょうた'),
    ('大樹', 'だいき'),
]
RANKED_CLASSIC = [e for e in RANKED_CLASSIC if (e[0], e[1]) not in set(RANKED_CLASSIC_1980S)]

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
    # 「個性的」の文字数ボーナスは、昔ながらの漢字を2つ以上含む名前には付けない
    # （ChatGPTとの共同確認 2026-11-21: 古風な名前が「珍しい」に吸われすぎる問題への対処。
    #  ランキングに載らない古風な名前は、おまかせ専用（moods=[]）に寄せる）
    old_style_hits = sum(1 for c in kanji if c in OLD_STYLE_KANJI)
    if len(kanji) >= 3 and old_style_hits < 2:
        unique_score += 1
    if any(c in RARE_KANJI for c in kanji):
        unique_score += 2
    scores['unique'] = unique_score

    ranked = sorted(
        (m for m in scores if scores[m] > 0),
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
    return result


def sanitize_ranked(given: list[dict]) -> list[dict]:
    """「現代的」「和風・古風」はランキング掲載ペアだけに残す最終検査。

    補完候補（SUPPLEMENT）や旧データ経由で紛れた modern/classic を剥がし、
    剥がした結果 moods が空になった名前は印象スコアで付け直す。
    """
    modern_keys = {(k, r) for k, r, _g in RANKED_MODERN}
    classic_keys = {(k, r) for k, r, _g in RANKED_CLASSIC}
    for entry in given:
        key = (entry['kanji'], entry['reading'])
        moods = []
        for mood in entry['moods']:
            if mood == 'modern' and key not in modern_keys:
                continue
            if mood == 'classic' and key not in classic_keys:
                continue
            moods.append(mood)
        if not moods:
            moods = score_moods(entry['kanji'], entry['reading'])
        entry['moods'] = moods
    return given


# ChatGPT（GPT-6）との共同確認（2026-11-21）で「漢字と読みの対応が不自然」と
# 判定されたペア。生成候補から除外する（辞書に読みが載っていても人名として不自然なもの）。
# 判定根拠: 似莉奈=莉奈を「れな」と読ませるのが不自然／奈樹=奈を「だい」と読まない／
# 樹（たてる）・斗（はかる）・葵（まもる）・央（ちかし）=名乗り読みはあるが人名として不自然／
# 亜沙美（あすみ）=沙を「す」と読まない（あさみ は別ペアとして残る）／翔香（さやか）=
# 翔を「さや」と読む根拠が弱い／染真（しま）=染を「し」と読まない／聖衣納（せいな）=
# 漢字と読みの対応が不明確。
EXCLUDED_PAIRS: list[tuple[str, str]] = [
    ('似莉奈', 'にれな'), ('奈樹', 'だいじゅ'), ('樹', 'たてる'), ('斗', 'はかる'),
    ('葵', 'まもる'), ('央', 'ちかし'), ('亜沙美', 'あすみ'), ('翔香', 'さやか'),
    ('染真', 'しま'), ('聖衣納', 'せいな'),
]

# 同じ共同確認で「印象カテゴリが合わない」と判定されたサンプルの付け替え。
# 変更先は印象5分類の中だけ（現代的・古風はランキング基準を優先するため対象外）。
# (kanji, reading, new_primary_mood)
CHATGPT_OVERRIDES: list[tuple[str, str, str]] = [
    ('佳愛', 'かあい', 'unique'), ('燦英', 'さんえい', 'unique'), ('小麻記', 'こまき', 'unique'),
    ('多葉紗', 'たばさ', 'unique'), ('華巳', 'はなみ', 'unique'), ('亜佳利', 'あかり', 'bright'),
    ('流知愛', 'るちあ', 'unique'), ('愛土', 'あど', 'unique'), ('春星', 'しゅんせい', 'unique'),
    ('外志恵', 'としえ', 'unique'), ('乗晃', 'のりあき', 'unique'), ('紅花', 'べにか', 'unique'),
    ('拓晃', 'たくあき', 'strong'), ('恵丞', 'けいすけ', 'elegant'), ('緒凛', 'おりん', 'elegant'),
    ('真佳奈', 'まかな', 'bright'), ('真梨夏', 'まりか', 'bright'), ('真希帆', 'まきほ', 'bright'),
    ('碧', 'みどり', 'elegant'), ('五夢', 'いつむ', 'unique'), ('彩雲', 'あやも', 'unique'),
    ('星斗', 'ほしと', 'strong'), ('冬威', 'とうい', 'strong'), ('銀太', 'ぎんた', 'bright'),
    ('夢佳', 'ゆめか', 'bright'), ('夕陽', 'ゆうひ', 'bright'), ('志保里', 'しほり', 'elegant'),
    ('友理菜', 'ゆりな', 'bright'),
]


def apply_joint_review(given: list[dict]) -> list[dict]:
    """ChatGPTとの共同確認の結果（付け替え＋除外）を最後に適用する。"""
    index = {(g['kanji'], g['reading']): g for g in given}
    for kanji, reading, primary in CHATGPT_OVERRIDES:
        entry = index.get((kanji, reading))
        if entry is None or 'modern' in entry['moods'] or 'classic' in entry['moods']:
            continue
        rest = [m for m in entry['moods'] if m != primary]
        entry['moods'] = [primary] + rest[:1]
    excluded = set(EXCLUDED_PAIRS)
    return [g for g in given if (g['kanji'], g['reading']) not in excluded]


# ChatGPT（GPT-6）による2,000件の一括診断（2026-11-21、博士の提案で実施）。
# 印象分類つきの名前から5分類×400件を無作為抽出し、現在の分類を伏せた状態で
# ChatGPTに分類させた。結果は scripts/bulk-review-2026-11-21.json に保存。
# コード: E/B/S/M/U=印象5分類の主分類に付け替え、N=印象タグを外す、
# X=読みが不自然として生成候補から除外する。
BULK_REVIEW_PATH = Path(__file__).with_name('bulk-review-2026-11-21.json')
BULK_CODE_TO_MOOD = {'E': 'elegant', 'B': 'bright', 'S': 'strong', 'M': 'mysterious', 'U': 'unique'}


def apply_bulk_review(given: list[dict]) -> list[dict]:
    if not BULK_REVIEW_PATH.exists():
        return given
    bulk = json.loads(BULK_REVIEW_PATH.read_text(encoding='utf-8'))['results']
    verdicts = {(r['kanji'], r['reading']): r['code'] for r in bulk}
    kept = []
    for g in given:
        code = verdicts.get((g['kanji'], g['reading']))
        if code is None or 'modern' in g['moods'] or 'classic' in g['moods']:
            kept.append(g)
            continue
        if code == 'X':
            continue
        if code == 'N':
            g['moods'] = []
        else:
            primary = BULK_CODE_TO_MOOD[code]
            rest = [m for m in g['moods'] if m != primary]
            g['moods'] = [primary] + rest[:1]
        kept.append(g)
    return kept


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
    given = sanitize_ranked(given)
    given = apply_joint_review(given)
    given = apply_bulk_review(given)
    # 生成プールの並び順が結果に影響しないよう、読み順で安定ソートしておく
    given.sort(key=lambda r: (r['reading'], r['kanji']))

    out = {
        'version': 5,
        'generatedAt': '2026-11-21',
        'sources': payload.get('sources', {}),
        'surnames': surnames,
        'givenNames': given,
    }
    DATA.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'v5: {len(surnames)} surnames, {len(given)} given names -> {DATA}')


if __name__ == '__main__':
    main()
