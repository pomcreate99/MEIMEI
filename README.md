# ランダム名鑑【MEIMEI】

創作活動向けの名字・名前ランダム生成ツールです。名字と名前の雰囲気を個別に選び、直近10回の重複を抑えながら日本人名を生成できます。

## 開発

```bash
npm install
npm run dev
```

本番ビルドは `npm run build` です。ビルド時に `scripts/build-data.py` が公開データを `src/data/names.json` に変換します。

## 主な機能

- 名字・名前の雰囲気選択
- 男女傾向の選択
- 4・6・8・10個のまとめ生成
- 名字固定・名前固定による片側だけの再生成
- 画面上部の「？」から開く使い方ダイアログ
- 直近10回を参照した重複抑制
- 生成履歴とお気に入りの端末内保存
- favicon / Webアプリマニフェスト
- GitHub Pagesなどへ移行しやすい静的Vite構成

## データについて

名字は [siikamiika/japanese-family-names](https://github.com/siikamiika/japanese-family-names) と、公開共有されている [JapaneseNamesDatabase](https://github.com/jackdeguest/JapaneseNamesDatabase) をもとに、読み付き10,000件へ整形しています。前者はREADMEに記載されているとおり、名字由来netを出典とし、商用利用不可・帰属表示必須です。後者は公開元READMEに明示された利用条件がないため、公開元の最新条件を確認して利用してください。

名前は [shuheilocale/japanese-personal-name-dataset](https://github.com/shuheilocale/japanese-personal-name-dataset) とJapaneseNamesDatabaseをもとに、読みと漢字表記を別候補として20,000件へ整形しています。前者のリポジトリはMIT Licenseです。詳しい出典・利用条件はアプリ内の「データの出典」を確認してください。

トレンドの参考として、[たまひよ 赤ちゃんの名前ランキング](https://st.benesse.ne.jp/ninshin/name/) と [2026年全国名字ランキング](https://gakumado.mynavi.jp/freshers/articles/92511) を確認しています。
