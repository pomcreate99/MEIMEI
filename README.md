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
- 直近10回を参照した重複抑制
- 生成履歴とお気に入りの端末内保存
- favicon / Webアプリマニフェスト
- GitHub Pagesなどへ移行しやすい静的Vite構成

## データについて

名字は [siikamiika/japanese-family-names](https://github.com/siikamiika/japanese-family-names) をもとにしています。同データセットのREADMEに記載されているとおり、名字由来netを出典とし、商用利用不可・帰属表示必須です。

名前は [shuheilocale/japanese-personal-name-dataset](https://github.com/shuheilocale/japanese-personal-name-dataset) をもとにしています。リポジトリはMIT Licenseです。詳しい出典・利用条件はアプリ内の「データの出典」を確認してください。

トレンドの参考として、[たまひよ 赤ちゃんの名前ランキング](https://st.benesse.ne.jp/ninshin/name/) と [2026年全国名字ランキング](https://gakumado.mynavi.jp/freshers/articles/92511) を確認しています。
