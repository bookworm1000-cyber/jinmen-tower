# 人面アニマル積み合戦

自分の顔をカメラで撮って、どうぶつの胴体に貼りつけて積み上げる物理パズルです。交互に積んで、落としたほうが負け。

- CPUと対戦 / ふたりで対戦(1台を交互に) / ひとりで練習
- 顔は端末のカメラで撮影。写真ファイルからも選べます。画像はブラウザの中だけで使い、どこにも送信しません。
- 操作: ドラッグで左右に動かし、指を離すと落ちる。「回す」で45度回転。PCは ← → で移動、↑ で回転、↓ かスペースで落とす。
- 結果画面の「画像を保存」で、積み上がった塔をPNGで保存できます。
- 効果音つき。タイトル画面右上のボタンで消せます。

## GitHub Pages で公開する

ビルドは不要です。このフォルダをそのままリポジトリにして push し、Pages を有効にします。

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/jinmen-tower.git
git push -u origin main
```

GitHub のリポジトリで Settings → Pages → Source を「Deploy from a branch」、Branch を `main` / `(root)` にすると、数分で `https://<ユーザー名>.github.io/jinmen-tower/` から遊べます。

カメラは HTTPS か localhost でしか動きません。GitHub Pages は HTTPS なのでそのまま使えます。手元で試すときは次のようにします。

```bash
python -m http.server 8000
```

## ファイル

- `index.html` 画面
- `style.css` 見た目
- `img/animals/` 背景を切り抜いたどうぶつの写真
- `js/animals.js` 写真の輪郭から作った当たり判定と、顔を貼る位置
- `sound/` 効果音
- `js/main.js` 顔の取り込み、物理演算、CPU、描画、音

物理演算は [Matter.js](https://brm.io/matter-js/) 0.19.0 を CDN から読み込んでいます。

## 写真のクレジット

どうぶつの写真はすべて Wikimedia Commons の CC0(パブリックドメイン提供)の写真です。背景を切り抜き、縮小して使っています。

| どうぶつ | 元ファイル | 撮影者 |
|---|---|---|
| ゾウ | [Elephant in Africa (37478786891).jpg](https://commons.wikimedia.org/wiki/File:Elephant_in_Africa_(37478786891).jpg) | laurentmarx |
| キリン | [Mannetjes masaigiraffe in de Serengeti, Tanzania, -12 januari 2013 a.jpg](https://commons.wikimedia.org/wiki/File:Mannetjes_masaigiraffe_in_de_Serengeti,_Tanzania,_-12_januari_2013_a.jpg) | David Sluka |
| ウシ | [Cow on a Field.jpg](https://commons.wikimedia.org/wiki/File:Cow_on_a_Field.jpg) | Anja Osenberg |
| シマウマ | [Grant’s Zebra 573197331.jpg](https://commons.wikimedia.org/wiki/File:Grant%E2%80%99s_Zebra_573197331.jpg) | 記載なし |
| トラ | [Tiger-tiger-baby-tigerfamile-young-39629.jpg](https://commons.wikimedia.org/wiki/File:Tiger-tiger-baby-tigerfamile-young-39629.jpg) | Sponchia |
| ラクダ | [Camel-692648.jpg](https://commons.wikimedia.org/wiki/File:Camel-692648.jpg) | hbieser |
| サイ | [IMG-20210224-WA0159 rhino grazing in the east.jpg](https://commons.wikimedia.org/wiki/File:IMG-20210224-WA0159_rhino_grazing_in_the_east.jpg) | Kashmirik |
| ブタ | [Breeding boars pig sow-638346.jpg](https://commons.wikimedia.org/wiki/File:Breeding_boars_pig_sow-638346.jpg) | Jai79 |
| カバ | [Hippopotamus-2780699 1280.png](https://commons.wikimedia.org/wiki/File:Hippopotamus-2780699_1280.png) | Capri23auto |
| ウマ | [Horse-1917708.png](https://commons.wikimedia.org/wiki/File:Horse-1917708.png) | N1111 |

## 効果音

効果音は [効果音ラボ](https://soundeffect-lab.info/) の音を使っています。
