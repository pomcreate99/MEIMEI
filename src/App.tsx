import { useEffect, useMemo, useRef, useState } from 'react'
import data from './data/names.json'
import {
  batchKeys,
  combinationCount,
  filterGiven,
  filterSurnames,
  formatBulk,
  formatIndividual,
  fullNameKey,
  generateBatch,
  givenKey,
  surnameKey,
  type GenderFilter,
  type GeneratedName,
  type GivenName,
  type Mood,
  type Surname,
  type TierFilter,
} from './lib/generate'

const BRAND = 'ランダム名鑑' + String.fromCharCode(0x3010) + 'MEIMEI' + String.fromCharCode(0x3011)

type Panel = 'help' | 'updates' | 'sources' | null

const tierOptions: { value: TierFilter; label: string; note: string }[] = [
  { value: 'all', label: 'すべての傾向', note: '幅広くランダム' },
  { value: 'common', label: 'よくある名字', note: '全国ランキング上位300位' },
  { value: 'familiar', label: '標準・やや珍しい名字', note: '全国ランキング301〜3,000位' },
  { value: 'rare', label: '珍しい名字', note: '全国ランキング3,001位以下・圏外' },
]

const moodOptions: { value: Mood | 'all'; label: string; note: string }[] = [
  { value: 'all', label: 'おまかせ', note: '幅広くランダム' },
  { value: 'modern', label: '現代的', note: '今っぽく軽やか' },
  { value: 'classic', label: '和風・古風', note: '時代を感じる' },
  { value: 'elegant', label: '上品・落ち着いた', note: '端正で静か' },
  { value: 'bright', label: '明るく親しみやすい', note: '朗らかで柔らかい' },
  { value: 'strong', label: '凛々しい・強い', note: '芯のある印象' },
  { value: 'mysterious', label: 'ミステリアス', note: '余韻のある響き' },
  { value: 'unique', label: '個性的・珍しい', note: '印象に残る' },
]

const genderOptions: [GenderFilter, string][] = [
  ['any', '指定しない'],
  ['male', '男性寄り'],
  ['female', '女性寄り'],
  ['unisex', '中性的'],
]

const tierLabel = (tier: Surname['tier']) =>
  tier === 'common' ? 'よくある名字' : tier === 'familiar' ? '標準・やや珍しい名字' : '珍しい名字'
const moodLabel = (mood: Mood) => moodOptions.find((o) => o.value === mood)?.label ?? mood
const genderLabel = (gender: GivenName['gender']) =>
  gender === 'male' ? '男性寄り' : gender === 'female' ? '女性寄り' : '中性的'

const surnameCandidates = data.surnames as Surname[]
const givenCandidates = data.givenNames as GivenName[]

const FAVORITES_LIMIT = 24
const HISTORY_LIMIT = 40
const storageKeys = {
  history: 'meimei-history-v2',
  favorites: 'meimei-favorites-v2',
  batches: 'meimei-balance-batches-v1',
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function Icon({ name, size = 20 }: { name: 'menu' | 'spark' | 'copy' | 'heart' | 'history' | 'close' | 'book' | 'arrow' | 'info' | 'trash'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (name === 'menu') return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  if (name === 'spark') return <svg {...common}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></svg>
  if (name === 'copy') return <svg {...common}><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" /></svg>
  if (name === 'heart') return <svg {...common}><path d="M20.8 8.8c0 5.2-8.8 10-8.8 10s-8.8-4.8-8.8-10A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.7Z" /></svg>
  if (name === 'history') return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5M12 7v5l3 2" /></svg>
  if (name === 'close') return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>
  if (name === 'book') return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M4 5.5v16M8 7h8M8 11h8" /></svg>
  if (name === 'info') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></svg>
  if (name === 'trash') return <svg {...common}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></svg>
  if (name === 'arrow') return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  return null
}

const MOTIFS = ['○', '△', '◇', '▽', '□', '◎']

function App() {
  const [surnameTier, setSurnameTier] = useState<TierFilter>('all')
  const [givenMood, setGivenMood] = useState<Mood | 'all'>('all')
  const [gender, setGender] = useState<GenderFilter>('any')
  const [count, setCount] = useState(4)
  const [fixedSurname, setFixedSurname] = useState<Surname | undefined>()
  const [fixedGiven, setFixedGiven] = useState<GivenName | undefined>()
  const [history, setHistory] = useState<GeneratedName[]>(() => readStorage(storageKeys.history, []))
  const [favorites, setFavorites] = useState<GeneratedName[]>(() => readStorage(storageKeys.favorites, []))
  const [batches, setBatches] = useState<string[][]>(() => readStorage(storageKeys.batches, []))
  const [results, setResults] = useState<GeneratedName[]>(() => {
    const outcome = generateBatch(surnameCandidates, givenCandidates, { surnameTier: 'all', givenMood: 'all', gender: 'any', count: 4 }, [])
    return outcome.results
  })
  const [notice, setNotice] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [toast, setToast] = useState('')
  const [clock, setClock] = useState('')
  const [lastGenAt, setLastGenAt] = useState(() => Date.now())
  const [sessionLog, setSessionLog] = useState<string[]>([])
  const generatorRef = useRef<HTMLElement>(null)
  const resultRef = useRef<HTMLElement>(null)
  const favoritesRef = useRef<HTMLElement>(null)
  const historyRef = useRef<HTMLElement>(null)

  const stats = useMemo(() => ({ surnames: surnameCandidates.length, given: givenCandidates.length }), [])
  const combos = useMemo(
    () => combinationCount(surnameCandidates, givenCandidates, { surnameTier, givenMood, gender, count, fixedSurname, fixedGiven }),
    [surnameTier, givenMood, gender, count, fixedSurname, fixedGiven],
  )
  const moodCounts = useMemo(() => {
    const map = new Map<string, number>()
    moodOptions.forEach((option) => {
      map.set(option.value, option.value === 'all' ? filterGiven(givenCandidates, 'all', gender).length : filterGiven(givenCandidates, option.value as Mood, gender).length)
    })
    return map
  }, [gender])
  const tierCounts = useMemo(() => {
    const map = new Map<string, number>()
    tierOptions.forEach((option) => map.set(option.value, filterSurnames(surnameCandidates, option.value).length))
    return map
  }, [])

  useEffect(() => { localStorage.setItem(storageKeys.history, JSON.stringify(history.slice(0, HISTORY_LIMIT))) }, [history])
  useEffect(() => { localStorage.setItem(storageKeys.favorites, JSON.stringify(favorites.slice(0, FAVORITES_LIMIT))) }, [favorites])
  useEffect(() => { localStorage.setItem(storageKeys.batches, JSON.stringify(batches.slice(0, 10))) }, [batches])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('ja-JP', { hour12: false })
    setClock(fmt())
    const timer = window.setInterval(() => setClock(fmt()), 1000)
    setSessionLog([`[${fmt()}] SYS :: terminal boot -- dataset v3 loaded`, `[${fmt()}] DATA :: surnames ${surnameCandidates.length.toLocaleString()} / given ${givenCandidates.length.toLocaleString()}`])
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPanel(null); setMenuOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const generate = () => {
    const outcome = generateBatch(
      surnameCandidates,
      givenCandidates,
      { surnameTier, givenMood, gender, count, fixedSurname, fixedGiven },
      batches,
    )
    setNotice(outcome.shortageReason)
    if (outcome.results.length === 0) {
      setToast('条件に合う候補がありませんでした')
      return
    }
    setResults(outcome.results)
    setLastGenAt(Date.now())
    {
      const t = new Date().toLocaleTimeString('ja-JP', { hour12: false })
      const cond = `${tierOptions.find((o) => o.value === surnameTier)?.label ?? ''} / ${moodOptions.find((o) => o.value === givenMood)?.label ?? ''} / ${genderOptions.find(([v]) => v === gender)?.[1] ?? ''}`
      setSessionLog((current) => [
        `[${t}] GEN :: ${cond} -> ${outcome.results.length} records`,
        ...(outcome.shortageReason ? [`[${t}] NOTE :: ${outcome.shortageReason}`] : []),
        ...current,
      ].slice(0, 8))
    }
    setBatches((current) => [batchKeys(outcome.results), ...current].slice(0, 10))
    setHistory((current) => {
      const seen = new Set<string>()
      const merged: GeneratedName[] = []
      ;[...outcome.results, ...current].forEach((item) => {
        const key = fullNameKey(item)
        if (seen.has(key)) return
        seen.add(key)
        merged.push(item)
      })
      return merged.slice(0, HISTORY_LIMIT)
    })
  }

  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setToast(message)
    } catch {
      setToast('コピーできませんでした')
    }
  }
  const copyResult = (item: GeneratedName) => copyText(formatIndividual(item), '名前をコピーしました')
  const copyAll = () => copyText(formatBulk(results), `${results.length}件をまとめてコピーしました`)

  const isFavorite = (item: GeneratedName) => favorites.some((f) => fullNameKey(f) === fullNameKey(item))
  const toggleFavorite = (item: GeneratedName) => {
    if (isFavorite(item)) {
      setFavorites((current) => current.filter((f) => fullNameKey(f) !== fullNameKey(item)))
      setToast('お気に入りから外しました')
      return
    }
    if (favorites.length >= FAVORITES_LIMIT) {
      setToast(`お気に入りは${FAVORITES_LIMIT}件までです。古いものを削除してください`)
      return
    }
    setFavorites((current) => [{ ...item }, ...current])
    setToast('お気に入りに保存しました')
  }

  const showInResult = (item: GeneratedName) => {
    setResults([item])
    setCount(1)
    setNotice(null)
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const clearHistory = () => {
    setHistory([])
    setBatches([])
    setToast('履歴をすべて消去しました（偏り防止の記録もリセット）')
  }

  const scrollTo = (ref: React.RefObject<HTMLElement | null>) => {
    setMenuOpen(false)
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="メニューを開く"><Icon name="menu" /></button>
        <div className="brand-lockup">
          <div className="brand-seal">名</div>
          <div><p className="eyebrow">NAME GENERATION TERMINAL // 創作向け</p><div className="brand-name">{BRAND}</div></div>
        </div>
        <button className="help-button" onClick={() => setPanel('help')} aria-label="使い方を表示">?</button>
        <div className="sys-readout"><span className="live-dot" /><span>LOCAL ONLY</span><span className="sys-sep">|</span><span>DATA v3</span><span className="sys-sep">|</span><span className="sys-clock" aria-label="現在時刻">{clock}</span></div>
      </header>

      <div className="terminal-layout">
      <nav className="terminal-nav" aria-label="コマンド一覧">
        <p className="nav-head">// COMMANDS</p>
        <button onClick={() => scrollTo(generatorRef)}><span className="cmd">&gt; generate</span><span className="cmd-jp">条件と生成</span></button>
        <button onClick={() => scrollTo(resultRef)}><span className="cmd">&gt; output</span><span className="cmd-jp">生成結果</span></button>
        <button onClick={() => scrollTo(favoritesRef)}><span className="cmd">&gt; favorites</span><span className="cmd-jp">お気に入り</span><span className="cmd-count">{favorites.length}</span></button>
        <button onClick={() => scrollTo(historyRef)}><span className="cmd">&gt; history</span><span className="cmd-jp">生成履歴</span><span className="cmd-count">{history.length}</span></button>
        <button onClick={() => setPanel('help')}><span className="cmd">&gt; help</span><span className="cmd-jp">使い方</span></button>
        <button onClick={() => setPanel('updates')}><span className="cmd">&gt; updates</span><span className="cmd-jp">更新履歴</span></button>
        <button onClick={() => setPanel('sources')}><span className="cmd">&gt; sources</span><span className="cmd-jp">データの出典</span></button>
        <p className="nav-foot">入力コマンドは不要です。<br />すべてクリック／タップで操作できます。</p>
      </nav>
      <main className="main-content">
        <section className="hero-intro">
          <div className="vertical-label">名をつむぐ</div>
          <div>
            <p className="section-kicker"><span />SYS.BOOT // 創作の登場人物に、ひとつの響きを</p>
            <h1>雰囲気を選んで、<br /><em>名前をひらく。</em></h1>
            <p className="hero-copy">名字の傾向と名前の雰囲気をそれぞれ選ぶと、物語に似合う日本人名をランダムに組み合わせます。開いた直後から、下の条件ですぐ作れます。</p>
            <div className="boot-log" aria-hidden="true"><p>&gt; dataset.load("names_v3") ... OK</p><p>&gt; surnames {stats.surnames.toLocaleString()} / given {stats.given.toLocaleString()} records ready</p><p>&gt; awaiting input_</p></div>
          </div>
          <div className="hero-mark" aria-hidden="true"><span>MEI</span><strong>名</strong><span>MEI</span></div>
        </section>

        <section className="generator-card" ref={generatorRef} aria-labelledby="generator-title">
          <div className="card-heading"><div><p className="section-kicker"><span />01 // GENERATE</p><h2 id="generator-title">条件をえらぶ</h2></div><div className="counter-chip"><span>{stats.surnames.toLocaleString()}件</span>の名字 ／ <span>{stats.given.toLocaleString()}件</span>の名前</div></div>

          <div className="gender-row first"><span className="field-label" id="gender-label">名前の性別イメージ</span><div className="segmented-control" role="group" aria-labelledby="gender-label">{genderOptions.map(([value, label]) => <button key={value} className={gender === value ? 'active' : ''} onClick={() => setGender(value)} aria-pressed={gender === value}>{label}</button>)}</div></div>

          <div className="choice-grid">
            <label className="mood-select"><span className="field-label">苗字の傾向</span><select value={surnameTier} onChange={(event) => setSurnameTier(event.target.value as TierFilter)}>{tierOptions.map((option) => <option key={option.value} value={option.value}>{option.label}（{(tierCounts.get(option.value) ?? 0).toLocaleString()}件）— {option.note}</option>)}</select></label>
            <label className="mood-select"><span className="field-label">名前の雰囲気</span><select value={givenMood} onChange={(event) => setGivenMood(event.target.value as Mood | 'all')}>{moodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}（{(moodCounts.get(option.value) ?? 0).toLocaleString()}件）— {option.note}</option>)}</select></label>
            <label className="mood-select"><span className="field-label">一度に生成する人数</span><select value={count} onChange={(event) => setCount(Number(event.target.value))}>{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}人</option>)}</select></label>
          </div>
          <p className="combo-note" aria-live="polite">この条件で <strong>約{combos.toLocaleString()}通り</strong> の組み合わせがあります</p>

          {(fixedSurname || fixedGiven) && (
            <div className="fixed-chips">
              <span className="fixed-chips-label">固定中：</span>
              {fixedSurname && <span className="fixed-chip">名字「{fixedSurname.kanji}」<button onClick={() => setFixedSurname(undefined)} aria-label="名字の固定を外す"><Icon name="close" size={13} /></button></span>}
              {fixedGiven && <span className="fixed-chip">名前「{fixedGiven.kanji}」<button onClick={() => setFixedGiven(undefined)} aria-label="名前の固定を外す"><Icon name="close" size={13} /></button></span>}
            </div>
          )}
          <button className="generate-button" onClick={generate}><Icon name="spark" size={22} /><span>{count}人の候補をつくる</span><Icon name="arrow" size={18} /></button>
          <p className="privacy-note"><Icon name="info" size={15} />同じ生成内では名字・名前が重複しません。直近10回の生成でよく出た候補は出にくくなります。保存はこの端末の中だけです。</p>
        </section>

        <section className="result-section" ref={resultRef} aria-live="polite">
          <div className="result-header"><div><p className="section-kicker"><span />02 // OUTPUT</p><h2>できあがった {results.length}人 の候補</h2><p className="log-line">[{new Date(lastGenAt).toLocaleTimeString('ja-JP', { hour12: false })}] GEN COMPLETE -- {results.length} RECORDS</p></div><div className="result-actions"><button className="small-action" onClick={copyAll}><Icon name="copy" size={16} />まとめてコピー</button><button className="small-action" onClick={generate}><Icon name="spark" size={16} />もう一度</button></div></div>
          {notice && <p className="shortage-note" role="status"><Icon name="info" size={15} />{notice}</p>}
          <div className="result-grid">{results.map((item, index) => {
            const itemFavorite = isFavorite(item)
            const surnameFixed = fixedSurname && surnameKey(fixedSurname) === surnameKey(item.surname)
            const givenFixed = fixedGiven && givenKey(fixedGiven) === givenKey(item.given)
            return (
              <div className="name-card" key={`${item.createdAt}-${index}`} style={{ animationDelay: `${Math.min(index, 9) * 55}ms` }}>
                <div className="name-ornament ornament-left">「</div>
                <div className="name-main">
                  <div className="card-meta"><span className="card-number">[{String(index + 1).padStart(3, '0')}]</span><span className="card-motif" aria-hidden="true">{MOTIFS[index % MOTIFS.length]}</span>{(surnameFixed || givenFixed) && <span className="fixed-badge">{surnameFixed && givenFixed ? '名字・名前固定中' : surnameFixed ? '名字固定中' : '名前固定中'}</span>}</div>
                  <div className="full-name"><span>{item.surname.kanji}</span><span>{item.given.kanji}</span></div>
                  <div className="reading">{item.surname.reading}　{item.given.reading}</div>
                  <div className="name-tags"><span className={`tag-tier tag-tier-${item.surname.tier}`}>{tierLabel(item.surname.tier)}</span>{item.given.moods.length > 0 ? item.given.moods.map((mood) => <span key={mood} className={`tag-mood tag-mood-${mood}`}>{moodLabel(mood)}</span>) : <span>おまかせ</span>}<span>{genderLabel(item.given.gender)}</span></div>
                  {item.surname.population ? <p className="population-line">名字「{item.surname.kanji}」は全国に約{new Intl.NumberFormat('ja-JP').format(item.surname.population)}人{item.surname.rank ? `（名字ランキング約${item.surname.rank.toLocaleString()}位）` : ''}</p> : null}
                </div>
                <div className="name-ornament ornament-right">」</div>
                <div className="name-actions">
                  <button className={itemFavorite ? 'icon-action favorite active' : 'icon-action favorite'} onClick={() => toggleFavorite(item)} aria-label={itemFavorite ? 'お気に入りから外す' : 'お気に入りに保存'} aria-pressed={itemFavorite}><Icon name="heart" size={19} /><span>{itemFavorite ? '保存済み' : 'お気に入り'}</span></button>
                  <button className="icon-action" onClick={() => copyResult(item)}><Icon name="copy" size={18} /><span>コピー</span></button>
                  <button className={surnameFixed ? 'icon-action active' : 'icon-action'} onClick={() => setFixedSurname(surnameFixed ? undefined : item.surname)} aria-pressed={Boolean(surnameFixed)}><span>名字固定</span></button>
                  <button className={givenFixed ? 'icon-action active' : 'icon-action'} onClick={() => setFixedGiven(givenFixed ? undefined : item.given)} aria-pressed={Boolean(givenFixed)}><span>名前固定</span></button>
                </div>
              </div>
            )
          })}</div>
        </section>

        <div className="library-grid">
          <section className="library-section" ref={favoritesRef} aria-labelledby="favorites-title">
            <div className="library-head"><div><p className="section-kicker"><span />FAVORITES</p><h2 id="favorites-title">お気に入りストック</h2></div>{favorites.length > 0 && <button className="small-action danger" onClick={() => { setFavorites([]); setToast('お気に入りをすべて消去しました') }}><Icon name="trash" size={15} />すべて消去</button>}</div>
            <p className="panel-subtitle">ハートを押した候補だけを保存します（最大{FAVORITES_LIMIT}件・新しい順）。クリックすると結果欄に表示します。</p>
            {favorites.length === 0 ? <div className="empty-state">まだお気に入りがありません。候補カードの「お気に入り」から保存できます（最大{FAVORITES_LIMIT}件）。</div> : (
              <div className="name-list">{favorites.map((item) => (
                <div className="name-list-item" key={fullNameKey(item)}>
                  <button className="name-list-main" onClick={() => showInResult(item)}><strong>{item.surname.kanji} {item.given.kanji}</strong><span>{item.surname.reading}　{item.given.reading}</span></button>
                  <div className="name-list-actions"><button onClick={() => copyResult(item)}>コピー</button><button onClick={() => toggleFavorite(item)}>削除</button></div>
                </div>
              ))}</div>
            )}
          </section>

          <section className="library-section" ref={historyRef} aria-labelledby="history-title">
            <div className="library-head"><div><p className="section-kicker"><span />HISTORY</p><h2 id="history-title">生成履歴</h2></div>{history.length > 0 && <button className="small-action danger" onClick={clearHistory}><Icon name="trash" size={15} />すべて消去</button>}</div>
            <p className="panel-subtitle">生成した候補を新しい順に最大{HISTORY_LIMIT}件（同じ姓名は1件にまとめます）。クリックすると結果欄に表示します。</p>
            {history.length === 0 ? <div className="empty-state">まだ履歴がありません。「候補をつくる」を押すと、ここに残ります。</div> : (
              <div className="name-list">{history.map((item) => (
                <div className="name-list-item" key={fullNameKey(item)}>
                  <button className="name-list-main" onClick={() => showInResult(item)}><strong>{item.surname.kanji} {item.given.kanji}</strong><span>{item.surname.reading}　{item.given.reading}</span></button>
                  <div className="name-list-actions"><button onClick={() => copyResult(item)}>コピー</button><button onClick={() => toggleFavorite(item)}>{isFavorite(item) ? 'お気に入り済み' : 'お気に入り'}</button><button onClick={() => setHistory((current) => current.filter((h) => fullNameKey(h) !== fullNameKey(item)))}>削除</button></div>
                </div>
              ))}</div>
            )}
          </section>
        </div>

        <footer className="site-footer"><div className="footer-brand"><div className="brand-seal small">名</div><div><strong>{BRAND}</strong><span>創作のための名前生成帳</span></div></div><div className="footer-links"><button onClick={() => setPanel('updates')}>更新履歴</button><button onClick={() => setPanel('sources')}>データの出典</button></div><p>© 2026 MEIMEI. 名字・名前データは各出典の利用条件に従って掲載しています。</p></footer>
      </main>
      <aside className="status-rail" aria-label="状態表示">
        <div className="rail-block">
          <h3>// STATUS</h3>
          <dl className="status-list">
            <div><dt>MODE</dt><dd>LOCAL / NO LOGIN</dd></div>
            <div><dt>SURNAMES</dt><dd>{stats.surnames.toLocaleString()} RECORDS</dd></div>
            <div><dt>GIVEN</dt><dd>{stats.given.toLocaleString()} RECORDS</dd></div>
            <div><dt>COND</dt><dd>{tierOptions.find((o) => o.value === surnameTier)?.label} / {moodOptions.find((o) => o.value === givenMood)?.label} / {genderOptions.find(([v]) => v === gender)?.[1]}</dd></div>
            <div><dt>COMBOS</dt><dd>約{combos.toLocaleString()}通り</dd></div>
            <div><dt>FIXED</dt><dd>{fixedSurname || fixedGiven ? `${fixedSurname ? `名字「${fixedSurname.kanji}」` : ''}${fixedSurname && fixedGiven ? ' + ' : ''}${fixedGiven ? `名前「${fixedGiven.kanji}」` : ''}` : 'NONE'}</dd></div>
            <div><dt>STOCK</dt><dd>FAV {favorites.length} / HIST {history.length}</dd></div>
          </dl>
        </div>
        <div className="rail-block">
          <h3>// SESSION LOG</h3>
          <div className="session-log">{sessionLog.length === 0 ? <p>-- no events --</p> : sessionLog.map((line, i) => <p key={i}>{line}</p>)}</div>
        </div>
        <div className="rail-block rail-note">保存はこの端末の中だけです。入力や生成結果がサーバーへ送信されることはありません。</div>
      </aside>
      </div>

      {menuOpen && (
        <>
          <div className="overlay" onClick={() => setMenuOpen(false)} />
          <aside className="drawer open" aria-label="メニュー"><div className="drawer-head"><div className="brand-seal small">名</div><div><strong>ランダム名鑑</strong><span>MEIMEI</span></div><button onClick={() => setMenuOpen(false)} aria-label="メニューを閉じる"><Icon name="close" /></button></div><p className="drawer-intro">創作の人物に似合う、<br />ひとつの名前を見つけよう。</p><nav><button onClick={() => { setMenuOpen(false); setPanel('help') }}><Icon name="book" />使い方</button><button onClick={() => scrollTo(favoritesRef)}><Icon name="heart" />お気に入り <small>{favorites.length}</small></button><button onClick={() => scrollTo(historyRef)}><Icon name="history" />生成履歴 <small>{history.length}</small></button><button onClick={() => { setMenuOpen(false); setPanel('updates') }}><Icon name="info" />更新履歴</button><button onClick={() => { setMenuOpen(false); setPanel('sources') }}><Icon name="book" />データの出典</button></nav><div className="drawer-foot">問い合わせフォームは設置していません。<br />ご意見は今後の更新に活用します。</div></aside>
        </>
      )}

      {panel && <div className="panel-backdrop" onClick={() => setPanel(null)}><section className="info-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><button className="panel-close" onClick={() => setPanel(null)} aria-label="閉じる"><Icon name="close" /></button><InfoPanel panel={panel} /></section></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function InfoPanel({ panel }: { panel: Exclude<Panel, null> }) {
  if (panel === 'help') return <><p className="section-kicker"><span />GUIDE</p><h2>使い方</h2><div className="guide-list"><div><b>01</b><p><strong>条件を選ぶ</strong><br />苗字は「傾向（よくある／やや珍しい／珍しい）」、名前は「雰囲気」と「性別イメージ」で絞り込めます。各選択肢には候補件数が出ます。</p></div><div><b>02</b><p><strong>1〜10人の候補をつくる</strong><br />同じ生成の中では名字・名前が重複しません。直近10回でよく出た候補は出にくくなっています。候補が足りない条件では、理由を表示して件数を減らします。</p></div><div><b>03</b><p><strong>名字・名前を固定する</strong><br />候補カードの「名字固定」「名前固定」で片方だけを変えて作り直せます。固定は条件欄のチップから個別に外せます。両方固定すると1件だけ表示します。</p></div><div><b>04</b><p><strong>気に入ったら保存</strong><br />お気に入りは最大{FAVORITES_LIMIT}件、履歴は最大{HISTORY_LIMIT}件まで、この端末に保存されます。一覧をクリックすると結果欄に再表示できます。</p></div></div><div className="panel-note">雰囲気の分類は、漢字の印象に基づく創作向けの目安です。実在人物の性別・年代・人格を断定するものではありません。</div></>
  if (panel === 'updates') return <><p className="section-kicker"><span />CHANGELOG</p><h2>更新履歴</h2><div className="changelog"><div><time>2026.11.21</time><strong>UIを「電子名簿帳」のデザインへ変更</strong><p>台帳・名簿帳の紙の質感に、サイバーの情報設計を重ねた意匠に変更しました。明るい紙色の地に方眼と罫線、見出しタブの目次、朱印のようなお気に入りスタンプ、押し心地のある大きなボタンを備え、視認性と操作性を優先しています。生成の仕組み・データ・分類に変更はありません。</p></div><div><time>2026.11.20</time><strong>UIを情報端末デザインへ全面変更</strong><p>画面全体を「暗い都市で使う情報端末」のデザインに変更しました。上部のシステム帯、左のコマンド一覧、右の状態欄（現在の条件とセッションログ）を追加し、生成結果はタイムスタンプ付きのログ形式で表示します。生成の仕組みやデータに変更はありません。</p></div><div><time>2026.11.20</time><strong>分類をランキング実データに基づいて付け直し</strong><p>名字の傾向を、名字由来netの全国ランキングの順位（上位300位＝よくある／301〜3,000位＝標準・やや珍しい／3,001位以下・圏外＝珍しい）で判定するよう変更。名前の「現代的」は2025年の赤ちゃん名前ランキング（明治安田生命・たまひよ）上位の名前、「和風・古風」は昭和期の人気名前を基準に付け直し、漢字の印象だけでは現代的に分類しないようにしました。結果カードのタグをカテゴリごとに色分けしました。</p></div><div><time>2026.11.20</time><strong>生成の偏りと条件の反映を全面修正</strong><p>ランダム抽選をプール全体からの重み付き抽選に書き換え、読みの頭文字などへの偏りを解消。苗字の絞り込みを「雰囲気」から「傾向（よくある／やや珍しい／珍しい）」に変更し、中性的を追加。候補が足りない条件では無言で条件を変えず、理由を表示するようになりました。お気に入り（最大24件）と履歴（最大40件）をページ内に移し、削除・再表示・まとめてコピーに対応。保存形式の更新に伴い、以前のお気に入り・履歴は引き継がれません。</p></div><div><time>2026.10.23</time><strong>雰囲気に合う候補選定を改善</strong><p>候補に一般性レベルを付け、雰囲気と名字・名前のバランスを見ながら組み合わせるようにしました。</p></div><div><time>2026.10.22</time><strong>初回公開版を制作</strong><p>{BRAND}を新規構成。雰囲気選択、重複抑制、履歴、お気に入り、PWAアイコンを追加。</p></div></div></>
  return <><p className="section-kicker"><span />SOURCES</p><h2>データの出典</h2><div className="source-copy"><p>名字は、名字由来netを出典とする公開データセット（siikamiika/japanese-family-names、商用利用不可・帰属表示必須）と、公開共有されている JapaneseNamesDatabase から抽出した読み付き候補を組み合わせた {surnameCandidates.length.toLocaleString()} 件です。傾向（よくある／標準・やや珍しい／珍しい）は、名字由来netの全国名字ランキングの順位で付けています（よくある＝上位300位、標準・やや珍しい＝301〜3,000位、珍しい＝3,001位以下とランキング圏外）。順位は2026年版ランキングで照合しました。</p><p>名前は、MIT License の Japanese Personal Name Dataset（shuheilocale）をもとに、男女両方に現れる候補を「中性的」として統合した {givenCandidates.length.toLocaleString()} 件です。分類のうち「現代的」は明治安田生命「2025年生まれの子供の名前調査」とベネッセ たまひよ「赤ちゃんの名前ランキング2025」の上位の名前、「和風・古風」は明治安田生命の生まれ年別調査に基づく昭和期の人気名前を基準に付けています。その他の雰囲気は漢字の印象に基づく創作向けの目安です。分類は候補ごとに保持し、結果カードに色分けして表示しています。</p><p>利用条件が明示されていないデータベース由来の名前候補は、今回の改修で除外しました。名字データの利用条件は、公開先や利用目的に応じて各出典の最新条件を確認してください。</p><div className="source-links"><a href="https://github.com/siikamiika/japanese-family-names" target="_blank" rel="noreferrer">名字データセット（GitHub） <Icon name="arrow" size={15} /></a><a href="https://github.com/jackdeguest/JapaneseNamesDatabase" target="_blank" rel="noreferrer">JapaneseNamesDatabase（GitHub） <Icon name="arrow" size={15} /></a><a href="https://github.com/shuheilocale/japanese-personal-name-dataset" target="_blank" rel="noreferrer">日本人姓名データセット（GitHub） <Icon name="arrow" size={15} /></a></div></div></>
}

export default App
