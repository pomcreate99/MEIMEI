# MEIMEI data

`src/data/names.json` は `scripts/build-data.py` で生成します。

- 名字: [siikamiika/japanese-family-names](https://github.com/siikamiika/japanese-family-names) の `myoji-yurai-readings.csv`。同リポジトリのREADMEに記載されたとおり、名字由来netを出典とし、商用利用不可・帰属表示必須です。
- 名前: [shuheilocale/japanese-personal-name-dataset](https://github.com/shuheilocale/japanese-personal-name-dataset)。MIT License。読みと漢字表記の組を候補として利用しています。
- トレンド確認: [たまひよ 赤ちゃんの名前ランキング](https://st.benesse.ne.jp/ninshin/name/) と [2026年全国名字ランキング](https://gakumado.mynavi.jp/freshers/articles/92511)。
- 候補拡張: [JapaneseNamesDatabase](https://github.com/jackdeguest/JapaneseNamesDatabase) の読み付き名字・名前を抽出し、名字10,000件・名前20,000件に拡張しています。同リポジトリのREADMEには利用条件の明記がないため、公開元の最新条件を確認して利用してください。

生成時は、候補ごとに一般性レベル（一般的・中間・珍しい）を付け、雰囲気の一致に加えて名字と名前の一般性が大きく離れない組み合わせを優先します。

候補データはアプリ内に同梱し、利用時に外部サイトへアクセスしません。名字データの利用条件は、公開先や利用目的に応じて必ず各出典の最新条件を確認してください。
