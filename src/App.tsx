import { useEffect, useMemo, useState } from 'react'
import data from './data/names.json'

type Mood = 'all' | 'modern' | 'classic' | 'elegant' | 'bright' | 'strong' | 'mysterious' | 'unique'
type Gender = 'any' | 'male' | 'female'
type GenerateCount = 4 | 6 | 8 | 10
type Candidate = {
  id: string
  kanji: string
  reading: string
  moods: string[]
  gender?: 'male' | 'female'
  rank?: number
  population?: number | null
  commonality?: 1 | 2 | 3
}
type GeneratedName = {
  surname: Candidate
  given: Candidate
  createdAt: number
}
type Panel = 'help' | 'history' | 'favorites' | 'updates' | 'sources' | null

const moodOptions: { value: Mood; label: string; note: string }[] = [
  { value: 'all', label: 'おまかせ', note: '幅広くランダム' },
  { value: 'modern', label: '現代的', note: '今っぽく軽やか' },
  { value: 'classic', label: '和風・古風', note: '時代を感じる' },
  { value: 'elegant', label: '上品・落ち着いた', note: '端正で静か' },
  { value: 'bright', label: '明るく親しみやすい', note: '朗らかで柔らかい' },
  { value: 'strong', label: '凛々しい・強い', note: '芯のある印象' },
  { value: 'mysterious', label: 'ミステリアス', note: '余韻のある響き' },
  { value: 'unique', label: '個性的・珍しい', note: '印象に残る' },
]

const surnameCandidates = data.surnames as Candidate[]
const givenCandidates = data.givenNames as Candidate[]
const storageKeys = { history: 'meimei-history-v1', favorites: 'meimei-favorites-v1' }

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function randomIndex(length: number) {
  return Math.floor(Math.random() * length)
}

function moodFilter(candidate: Candidate, mood: Mood) {
  return mood === 'all' || candidate.moods.includes(mood)
}

function poolFor(candidates: Candidate[], mood: Mood, gender?: Gender) {
  return candidates.filter((candidate) => {
    const genderOk = !gender || gender === 'any' || candidate.gender === gender
    return genderOk && moodFilter(candidate, mood)
  })
}

function weightedPick(pool: Candidate[], recent: Candidate[], avoidPair?: string) {
  if (pool.length === 0) return undefined
  const counts = new Map<string, number>()
  recent.forEach((item) => counts.set(item.kanji, (counts.get(item.kanji) ?? 0) + 1))
  const recentKeys = new Set(recent.slice(0, 4).map((item) => item.kanji))
  const ranked = [...pool]
    .map((candidate) => ({ candidate, count: counts.get(candidate.kanji) ?? 0, fresh: recentKeys.has(candidate.kanji) ? 0 : 1 }))
    .sort((a, b) => b.fresh - a.fresh || a.count - b.count || Math.random() - 0.5)
  const allowed = ranked.filter(({ candidate, count }) => count < 4 && candidate.kanji !== avoidPair)
  const source = allowed.length > 0 ? allowed : ranked.filter(({ count }) => count < 4)
  return source[randomIndex(Math.min(source.length, 20))]?.candidate ?? ranked[0]?.candidate
}

function createName(surnameMood: Mood, givenMood: Mood, gender: Gender, history: GeneratedName[], fixedSurname?: Candidate, fixedGiven?: Candidate): GeneratedName {
  const recentSurnames = history.map((item) => item.surname)
  const recentGiven = history.map((item) => item.given)
  const surnamePool = poolFor(surnameCandidates, surnameMood)
  const givenPool = poolFor(givenCandidates, givenMood, gender)
  const safeSurnamePool = surnamePool.length ? surnamePool : surnameCandidates
  const safeGivenPool = givenPool.length ? givenPool : givenCandidates
  const recentPairs = new Set(history.map((item) => `${item.surname.kanji}|${item.given.kanji}`))

  const matchingSurnamePool = fixedGiven ? safeSurnamePool.filter((candidate) => Math.abs((candidate.commonality ?? 2) - (fixedGiven.commonality ?? 2)) <= 1) : safeSurnamePool
  const safeMatchingSurnamePool = matchingSurnamePool.length ? matchingSurnamePool : safeSurnamePool
  let surname = fixedSurname ?? weightedPick(safeMatchingSurnamePool, recentSurnames)
  const matchingGivenPool = fixedGiven ? safeGivenPool : safeGivenPool.filter((candidate) => Math.abs((candidate.commonality ?? 2) - (surname?.commonality ?? 2)) <= 1)
  const safeMatchingGivenPool = matchingGivenPool.length ? matchingGivenPool : safeGivenPool
  let given = fixedGiven ?? weightedPick(safeMatchingGivenPool, recentGiven)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const nextSurname = fixedSurname ?? weightedPick(safeMatchingSurnamePool, recentSurnames)
    const nextGivenPool = fixedGiven ? safeGivenPool : safeGivenPool.filter((candidate) => Math.abs((candidate.commonality ?? 2) - (nextSurname?.commonality ?? 2)) <= 1)
    const nextGiven = fixedGiven ?? weightedPick(nextGivenPool.length ? nextGivenPool : safeGivenPool, recentGiven, nextSurname?.kanji)
    if (nextSurname && nextGiven && !recentPairs.has(`${nextSurname.kanji}|${nextGiven.kanji}`)) {
      surname = nextSurname
      given = nextGiven
      break
    }
  }
  return { surname: surname!, given: given!, createdAt: Date.now() }
}

function formatPopulation(value?: number | null) {
  if (!value) return ''
  return `${new Intl.NumberFormat('ja-JP').format(value)}人ほど`
}

function Icon({ name, size = 20 }: { name: 'menu' | 'spark' | 'copy' | 'heart' | 'history' | 'close' | 'book' | 'arrow' | 'info'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (name === 'menu') return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  if (name === 'spark') return <svg {...common}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></svg>
  if (name === 'copy') return <svg {...common}><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" /></svg>
  if (name === 'heart') return <svg {...common}><path d="M20.8 8.8c0 5.2-8.8 10-8.8 10s-8.8-4.8-8.8-10A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.7Z" /></svg>
  if (name === 'history') return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5M12 7v5l3 2" /></svg>
  if (name === 'close') return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>
  if (name === 'book') return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M4 5.5v16M8 7h8M8 11h8" /></svg>
  if (name === 'info') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></svg>
  if (name === 'arrow') return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  return null
}

function App() {
  const [surnameMood, setSurnameMood] = useState<Mood>('all')
  const [givenMood, setGivenMood] = useState<Mood>('all')
  const [gender, setGender] = useState<Gender>('any')
  const [generateCount, setGenerateCount] = useState<GenerateCount>(4)
  const [fixedSurname, setFixedSurname] = useState<Candidate | undefined>()
  const [fixedGiven, setFixedGiven] = useState<Candidate | undefined>()
  const [history, setHistory] = useState<GeneratedName[]>(() => readStorage(storageKeys.history, []))
  const [favorites, setFavorites] = useState<GeneratedName[]>(() => readStorage(storageKeys.favorites, []))
  const [results, setResults] = useState<GeneratedName[]>(() => Array.from({ length: 4 }, () => createName('all', 'all', 'any', [])))
  const [menuOpen, setMenuOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [toast, setToast] = useState('')

  const stats = useMemo(() => ({ surnames: surnameCandidates.length, given: givenCandidates.length }), [])
  const result = results[0]
  const resultKey = results.map((item) => `${item.surname.kanji}|${item.given.kanji}|${item.createdAt}`).join(',')

  useEffect(() => { localStorage.setItem(storageKeys.history, JSON.stringify(history.slice(0, 10))) }, [history])
  useEffect(() => { localStorage.setItem(storageKeys.favorites, JSON.stringify(favorites)) }, [favorites])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const generate = () => {
    const nextResults: GeneratedName[] = []
    for (let index = 0; index < generateCount; index += 1) {
      nextResults.push(createName(surnameMood, givenMood, gender, [...results, ...nextResults, ...history].slice(0, 10), fixedSurname, fixedGiven))
    }
    setResults(nextResults)
    setHistory((current) => [...nextResults, ...current].slice(0, 10))
  }

  const copyResult = async (item = result) => {
    try {
      await navigator.clipboard.writeText(`${item.surname.kanji} ${item.given.kanji}（${item.surname.reading}・${item.given.reading}）`)
      setToast('名前をコピーしました')
    } catch {
      setToast('コピーできませんでした')
    }
  }

  const toggleFavorite = (item = result) => {
    if (!item) return
    const exists = favorites.some((favorite) => favorite.surname.kanji === item.surname.kanji && favorite.given.kanji === item.given.kanji)
    setFavorites((current) => exists
      ? current.filter((favorite) => !(favorite.surname.kanji === item.surname.kanji && favorite.given.kanji === item.given.kanji))
      : [{ ...item }, ...current])
    setToast(exists ? 'お気に入りから外しました' : 'お気に入りに保存しました')
  }

  const toggleFixedSurname = (item: GeneratedName) => setFixedSurname((current) => current?.kanji === item.surname.kanji ? undefined : item.surname)
  const toggleFixedGiven = (item: GeneratedName) => setFixedGiven((current) => current?.kanji === item.given.kanji ? undefined : item.given)

  const openPanel = (next: Panel) => {
    setMenuOpen(false)
    setPanel(next)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="メニューを開く"><Icon name="menu" /></button>
        <div className="brand-lockup">
          <div className="brand-seal">名</div>
          <div><p className="eyebrow">創作向け名字・名前メーカー</p><div className="brand-name">ランダム名鑑<span>【MEIMEI】</span></div></div>
        </div>
        <button className="help-button" onClick={() => openPanel('help')} aria-label="使い方を表示">?</button><div className="topbar-count"><span className="live-dot" />ログイン不要・端末内保存</div>
      </header>

      <main className="main-content">
        <section className="hero-intro">
          <div className="vertical-label">名をつむぐ</div>
          <div>
            <p className="section-kicker"><span />創作の登場人物に、ひとつの響きを</p>
            <h1>雰囲気を選んで、<br /><em>名前をひらく。</em></h1>
            <p className="hero-copy">名字と名前の印象をそれぞれ選ぶと、物語に似合う日本人名をランダムに組み合わせます。</p><button className="hero-help" onClick={() => openPanel('help')}><span>?</span> まずは使い方を見る</button>
          </div>
          <div className="hero-mark" aria-hidden="true"><span>MEI</span><strong>名</strong><span>MEI</span></div>
        </section>

        <section className="generator-card" aria-labelledby="generator-title">
          <div className="card-heading"><div><p className="section-kicker"><span />GENERATE</p><h2 id="generator-title">生成条件を選ぶ</h2></div><div className="counter-chip"><span>{stats.surnames.toLocaleString()}件</span>の名字 ／ <span>{stats.given.toLocaleString()}件</span>の名前</div></div>
          <div className="choice-grid">
            <MoodSelect label="名字の雰囲気" value={surnameMood} onChange={setSurnameMood} />
            <MoodSelect label="名前の雰囲気" value={givenMood} onChange={setGivenMood} />
          </div>
          <div className="gender-row"><span className="field-label">名前の性別傾向</span><div className="segmented-control">{([['any', '男女どちらも'], ['male', '男性寄り'], ['female', '女性寄り']] as [Gender, string][]).map(([value, label]) => <button key={value} className={gender === value ? 'active' : ''} onClick={() => setGender(value)}>{label}</button>)}</div></div>
          <div className="gender-row"><span className="field-label">一度に生成する数</span><div className="segmented-control">{([4, 6, 8, 10] as GenerateCount[]).map((value) => <button key={value} className={generateCount === value ? 'active' : ''} onClick={() => setGenerateCount(value)}>{value}個</button>)}</div></div>
          {(fixedSurname || fixedGiven) && <div className="fixed-note">固定中：{fixedSurname && `名字「${fixedSurname.kanji}」`}{fixedSurname && fixedGiven && ' ／ '}{fixedGiven && `名前「${fixedGiven.kanji}」`}　<button onClick={() => { setFixedSurname(undefined); setFixedGiven(undefined) }}>解除</button></div>}
          <button className="generate-button" onClick={generate}><Icon name="spark" size={22} /><span>この条件で名前をつくる</span><Icon name="arrow" size={18} /></button>
          <p className="privacy-note"><Icon name="info" size={15} />生成履歴はこの端末にだけ保存されます。直近10回の重複を自動で抑えています。</p>
        </section>

        <section className="result-section" aria-live="polite">
          <div className="result-header"><div><p className="section-kicker"><span />YOUR NAME</p><h2>今回の名まえ</h2></div><button className="small-action" onClick={generate}><Icon name="spark" size={16} />もう一度つくる</button></div>
          <div className="result-grid">{results.map((item, index) => {
            const itemFavorite = favorites.some((favorite) => favorite.surname.kanji === item.surname.kanji && favorite.given.kanji === item.given.kanji)
            return <div className="name-card" key={`${item.createdAt}-${index}`}>
            <div className="name-ornament ornament-left">「</div>
            <div className="name-main"><div className="full-name"><span>{item.surname.kanji}</span><span>{item.given.kanji}</span></div><div className="reading">{item.surname.reading}　{item.given.reading}</div><div className="name-tags"><span>{moodOptions.find((option) => option.value === surnameMood)?.label ?? 'おまかせ'}の名字</span><span>{moodOptions.find((option) => option.value === givenMood)?.label ?? 'おまかせ'}の名前</span></div></div>
            <div className="name-ornament ornament-right">」</div>
            <div className="name-actions"><button className={itemFavorite ? 'icon-action favorite active' : 'icon-action favorite'} onClick={() => toggleFavorite(item)} aria-label={itemFavorite ? 'お気に入りから外す' : 'お気に入りに保存'}><Icon name="heart" size={20} /><span>{itemFavorite ? '保存済み' : 'お気に入り'}</span></button><button className="icon-action" onClick={() => copyResult(item)}><Icon name="copy" size={19} /><span>コピー</span></button><button className={fixedSurname?.kanji === item.surname.kanji ? 'icon-action active' : 'icon-action'} onClick={() => toggleFixedSurname(item)}><span>名字固定</span></button><button className={fixedGiven?.kanji === item.given.kanji ? 'icon-action active' : 'icon-action'} onClick={() => toggleFixedGiven(item)}><span>名前固定</span></button></div>
          </div>})}</div>
          {result?.surname.population && <p className="population-note">名字「{result.surname.kanji}」は全国に{formatPopulation(result.surname.population)}（参考値）</p>}
        </section>

        <section className="quick-links"><button onClick={() => openPanel('history')}><span className="quick-icon"><Icon name="history" /></span><span><b>生成履歴</b><small>直近{history.length}件を確認</small></span><Icon name="arrow" size={17} /></button><button onClick={() => openPanel('favorites')}><span className="quick-icon"><Icon name="heart" /></span><span><b>お気に入り</b><small>{favorites.length}件を保存中</small></span><Icon name="arrow" size={17} /></button><button onClick={() => openPanel('help')}><span className="quick-icon"><Icon name="book" /></span><span><b>使い方を見る</b><small>創作に使うヒント</small></span><Icon name="arrow" size={17} /></button></section>

        <footer className="site-footer"><div className="footer-brand"><div className="brand-seal small">名</div><div><strong>ランダム名鑑【MEIMEI】</strong><span>創作のための名前生成帳</span></div></div><div className="footer-links"><button onClick={() => openPanel('updates')}>更新履歴</button><button onClick={() => openPanel('sources')}>データの出典</button></div><p>© 2026 MEIMEI. 名字・名前データは各出典の利用条件に従って掲載しています。</p></footer>
      </main>

      {menuOpen && <div className="overlay" onClick={() => setMenuOpen(false)} />}
      <aside className={menuOpen ? 'drawer open' : 'drawer'} aria-hidden={!menuOpen}><div className="drawer-head"><div className="brand-seal small">名</div><div><strong>ランダム名鑑</strong><span>【MEIMEI】</span></div><button onClick={() => setMenuOpen(false)} aria-label="メニューを閉じる"><Icon name="close" /></button></div><p className="drawer-intro">創作の人物に似合う、<br />ひとつの名前を見つけよう。</p><nav><button onClick={() => openPanel('help')}><Icon name="book" />使い方</button><button onClick={() => openPanel('history')}><Icon name="history" />生成履歴 <small>{history.length}</small></button><button onClick={() => openPanel('favorites')}><Icon name="heart" />お気に入り <small>{favorites.length}</small></button><button onClick={() => openPanel('updates')}><Icon name="info" />更新履歴</button><button onClick={() => openPanel('sources')}><Icon name="book" />データの出典</button></nav><div className="drawer-foot">問い合わせフォームは設置していません。<br />ご意見は今後の更新に活用します。</div></aside>

      {panel && <div className="panel-backdrop" onClick={() => setPanel(null)}><section className="info-panel" onClick={(event) => event.stopPropagation()}><button className="panel-close" onClick={() => setPanel(null)} aria-label="閉じる"><Icon name="close" /></button><InfoPanel panel={panel} history={history} favorites={favorites} onCopy={copyResult} onFavorite={toggleFavorite} /></section></div>}
      {toast && <div className="toast">{toast}</div>}
      <span className="sr-only">現在の結果ID: {resultKey}</span>
    </div>
  )
}

function MoodSelect({ label, value, onChange }: { label: string; value: Mood; onChange: (value: Mood) => void }) {
  return <label className="mood-select"><span className="field-label">{label}</span><select value={value} onChange={(event) => onChange(event.target.value as Mood)}>{moodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}　— {option.note}</option>)}</select></label>
}

function InfoPanel({ panel, history, favorites, onCopy, onFavorite }: { panel: Exclude<Panel, null>; history: GeneratedName[]; favorites: GeneratedName[]; onCopy: (item: GeneratedName) => void; onFavorite: (item: GeneratedName) => void }) {
  if (panel === 'help') return <><p className="section-kicker"><span />GUIDE</p><h2>使い方</h2><div className="guide-list"><div><b>01</b><p><strong>雰囲気を選ぶ</strong><br />名字と名前は別々に雰囲気を選べます。「おまかせ」ならデータ全体から組み合わせます。</p></div><div><b>02</b><p><strong>4・6・8・10個から選ぶ</strong><br />一度に生成する数を選び、まとめて候補を見比べられます。</p></div><div><b>03</b><p><strong>名字・名前を固定する</strong><br />候補カードの「名字固定」「名前固定」を押すと、次回から片方だけを変えて生成できます。</p></div><div><b>04</b><p><strong>気に入ったら保存</strong><br />お気に入りとコピーは、ログインなしでこの端末に保存されます。</p></div></div><div className="panel-note">？ボタンからいつでもこの説明を開けます。創作上の人物名を考えるための補助ツールです。</div></>
  if (panel === 'history') return <ListPanel title="生成履歴" subtitle="直近10回まで保存" items={history} empty="まだ生成履歴がありません。" onCopy={onCopy} onFavorite={onFavorite} />
  if (panel === 'favorites') return <ListPanel title="お気に入り" subtitle={`${favorites.length}件をこの端末に保存中`} items={favorites} empty="お気に入りに保存した名前がここに並びます。" onCopy={onCopy} onFavorite={onFavorite} />
  if (panel === 'updates') return <><p className="section-kicker"><span />CHANGELOG</p><h2>更新履歴</h2><div className="changelog"><div><time>2026.10.23</time><strong>雰囲気に合う候補選定を改善</strong><p>候補に一般性レベルを付け、雰囲気と名字・名前のバランスを見ながら組み合わせるようにしました。</p></div><div><time>2026.10.22</time><strong>初回公開版を制作</strong><p>ランダム名鑑【MEIMEI】を新規構成。雰囲気選択、重複抑制、履歴、お気に入り、PWAアイコンを追加。</p></div></div></>
  return <><p className="section-kicker"><span />SOURCES</p><h2>データの出典</h2><div className="source-copy"><p>名字は、名字由来netを出典とする公開データセットの上位候補と、公開共有されているJapaneseNamesDatabaseから抽出した読み付き候補を組み合わせ、10,000件以上に拡張しています。名字由来net由来データはREADMEの「商用利用不可・帰属表示必須」に従います。</p><p>名前は、MIT LicenseのJapanese Personal Name Datasetと、公開共有されているJapaneseNamesDatabaseから読みと漢字表記を抽出し、10,000件以上に拡張しています。後者は公開元READMEに明示された利用条件がないため、公開元の最新条件を確認したうえで利用してください。</p><p>トレンドの参考情報として、2025年たまひよ赤ちゃんの名前ランキングと、2026年全国名字ランキングの記事を確認しています。ランキング値をそのまま再配布するものではありません。</p><div className="source-links"><a href="https://github.com/siikamiika/japanese-family-names" target="_blank" rel="noreferrer">名字データセット（GitHub） <Icon name="arrow" size={15} /></a><a href="https://github.com/jackdeguest/JapaneseNamesDatabase" target="_blank" rel="noreferrer">JapaneseNamesDatabase（GitHub） <Icon name="arrow" size={15} /></a><a href="https://github.com/shuheilocale/japanese-personal-name-dataset" target="_blank" rel="noreferrer">日本人姓名データセット（GitHub） <Icon name="arrow" size={15} /></a><a href="https://gakumado.mynavi.jp/freshers/articles/92511" target="_blank" rel="noreferrer">2026年全国名字ランキング <Icon name="arrow" size={15} /></a></div></div></>
}

function ListPanel({ title, subtitle, items, empty, onCopy, onFavorite }: { title: string; subtitle: string; items: GeneratedName[]; empty: string; onCopy: (item: GeneratedName) => void; onFavorite: (item: GeneratedName) => void }) {
  return <><p className="section-kicker"><span />LIBRARY</p><h2>{title}</h2><p className="panel-subtitle">{subtitle}</p>{items.length === 0 ? <div className="empty-state">{empty}</div> : <div className="name-list">{items.map((item) => <div className="name-list-item" key={`${item.surname.kanji}-${item.given.kanji}-${item.createdAt}`}><div><strong>{item.surname.kanji} {item.given.kanji}</strong><span>{item.surname.reading}　{item.given.reading}</span></div><div><button onClick={() => onCopy(item)} aria-label="名前をコピー"><Icon name="copy" size={17} /></button><button onClick={() => onFavorite(item)} aria-label="お気に入りを切り替え"><Icon name="heart" size={17} /></button></div></div>)}</div>}</>
}

export default App
