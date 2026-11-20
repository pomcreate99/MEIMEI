// 生成ロジックの自動テスト（npm test）
// 偏り・重複・性別条件の尊重・候補不足の扱いを、大量生成で検証する。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const gen = await import(join(root, '.test-build/generate.js'))
const data = JSON.parse(readFileSync(join(root, 'src/data/names.json'), 'utf-8'))
const surnames = data.surnames
const givenNames = data.givenNames

let failures = 0
function assert(cond, label, detail = '') {
  if (cond) {
    console.log(`  ok  ${label}`)
  } else {
    failures += 1
    console.log(`  NG  ${label} ${detail}`)
  }
}

// 決定的な乱数（再現性のため mulberry32）
function rng(seed) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ROWS = [
  ['あ行', 'あいうえお'], ['か行', 'かきくけこがぎぐげご'], ['さ行', 'さしすせそざじずぜぞ'],
  ['た行', 'たちつてとだぢづでど'], ['な行', 'なにぬねの'], ['は行', 'はひふへほばびぶべぼぱぴぷぺぽ'],
  ['ま行', 'まみむめも'], ['や行', 'やゆよ'], ['ら行', 'らりるれろ'], ['わ行', 'わをん'],
]
const rowOf = (reading) => ROWS.find(([, chars]) => chars.includes(reading[0]))?.[0] ?? '他'

function simulate(conditions, rounds, seed = 42) {
  const rand = rng(seed)
  let batches = []
  const all = []
  const batchList = []
  for (let i = 0; i < rounds; i += 1) {
    const outcome = gen.generateBatch(surnames, givenNames, conditions, batches, rand)
    batchList.push(outcome.results)
    all.push(...outcome.results)
    if (outcome.results.length) batches = [gen.batchKeys(outcome.results), ...batches].slice(0, 10)
  }
  return { all, batchList }
}

console.log('== 1. 読みの頭文字の偏り（おまかせ / 300バッチ） ==')
{
  const poolShare = {}
  givenNames.forEach((g) => { const r = rowOf(g.reading); poolShare[r] = (poolShare[r] ?? 0) + 1 })
  Object.keys(poolShare).forEach((k) => { poolShare[k] /= givenNames.length })
  const { all } = simulate({ surnameTier: 'all', givenMood: 'all', gender: 'any', count: 4 }, 300)
  const genShare = {}
  all.forEach((item) => { const r = rowOf(item.given.reading); genShare[r] = (genShare[r] ?? 0) + 1 })
  Object.keys(genShare).forEach((k) => { genShare[k] /= all.length })
  console.log('  プール実分布:', Object.entries(poolShare).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(' '))
  console.log('  生成分布    :', Object.entries(genShare).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(' '))
  for (const [row] of ROWS) {
    const diff = Math.abs((genShare[row] ?? 0) - (poolShare[row] ?? 0))
    assert(diff < 0.07, `${row} の生成割合がプール実分布と大きくずれていない`, `diff=${diff.toFixed(3)}`)
  }
  assert((genShare['あ行'] ?? 0) < 0.3, 'あ行が3割未満（旧実装は52%）', `share=${(genShare['あ行'] ?? 0).toFixed(3)}`)
}

console.log('== 2. 同一生成内の重複禁止（500バッチ） ==')
{
  const { batchList } = simulate({ surnameTier: 'all', givenMood: 'all', gender: 'any', count: 10 }, 500, 7)
  let dup = 0
  batchList.forEach((batch) => {
    const s = new Set(batch.map((i) => gen.surnameKey(i.surname)))
    const g = new Set(batch.map((i) => gen.givenKey(i.given)))
    const f = new Set(batch.map((i) => gen.fullNameKey(i)))
    if (s.size !== batch.length || g.size !== batch.length || f.size !== batch.length) dup += 1
  })
  assert(dup === 0, '苗字・名前・姓名の重複バッチが0', `dup batches=${dup}`)
}

console.log('== 3. 性別条件の尊重 ==')
{
  const female = simulate({ surnameTier: 'all', givenMood: 'modern', gender: 'female', count: 4 }, 100, 11)
  assert(female.all.every((i) => i.given.gender === 'female' || i.given.gender === 'unisex'), '女性寄り+現代的: 男性名が混ざらない', `n=${female.all.length}`)
  const male = simulate({ surnameTier: 'all', givenMood: 'unique', gender: 'male', count: 4 }, 100, 13)
  assert(male.all.every((i) => i.given.gender === 'male' || i.given.gender === 'unisex'), '男性寄り+個性的: 女性名が混ざらない', `n=${male.all.length}`)
  const unisex = simulate({ surnameTier: 'all', givenMood: 'all', gender: 'unisex', count: 4 }, 50, 17)
  assert(unisex.all.every((i) => i.given.gender === 'unisex'), '中性的: 中性的候補だけが出る', `n=${unisex.all.length}`)
  const uniqueFemale = simulate({ surnameTier: 'all', givenMood: 'unique', gender: 'female', count: 4 }, 100, 19)
  assert(uniqueFemale.all.length === 400, '個性的+女性寄り: 候補不足で無言フォールバックしない（400件すべて生成）', `n=${uniqueFemale.all.length}`)
  const anyGender = simulate({ surnameTier: 'all', givenMood: 'all', gender: 'any', count: 4 }, 300, 41)
  const femaleShare = anyGender.all.filter((i) => i.given.gender === 'female').length / anyGender.all.length
  const maleShare = anyGender.all.filter((i) => i.given.gender === 'male').length / anyGender.all.length
  assert(femaleShare > 0.32 && maleShare > 0.32, '指定しない: 男女どちらかに大きく偏らない', `female=${femaleShare.toFixed(2)} male=${maleShare.toFixed(2)}`)
  // プール自体が全ての行をカバーしていること（旧データは あ・か行のみだった）
  const poolRows = new Set(givenNames.map((g) => rowOf(g.reading)))
  assert(poolRows.size >= 9, '名前プールが読みの全行をカバーしている', `rows=${poolRows.size}`)
  const poolA = givenNames.filter((g) => rowOf(g.reading) === 'あ行').length / givenNames.length
  assert(poolA < 0.3, '名前プールのあ行割合が3割未満', `share=${poolA.toFixed(2)}`)
}

console.log('== 4. 苗字tier・候補不足・両固定 ==')
{
  const rare = simulate({ surnameTier: 'rare', givenMood: 'all', gender: 'any', count: 4 }, 50, 23)
  assert(rare.all.every((i) => i.surname.tier === 'rare'), '珍しい名字: tierが一致する')
  const outcome = gen.generateBatch(surnames, givenNames, { surnameTier: 'all', givenMood: 'unique', gender: 'unisex', count: 10 }, [], rng(29))
  assert(outcome.results.length <= 2 && outcome.shortageReason !== null, '中性的+個性的（候補2件）: 件数を減らして理由が出る', `results=${outcome.results.length}`)
  const fixedS = surnames[0]
  const fixedG = givenNames[0]
  const both = gen.generateBatch(surnames, givenNames, { surnameTier: 'all', givenMood: 'all', gender: 'any', count: 6, fixedSurname: fixedS, fixedGiven: fixedG }, [], rng(31))
  assert(both.results.length === 1 && both.shortageReason !== null, '両方固定: 同一姓名を並べず1件だけ返す')
  const combos = gen.combinationCount(surnames, givenNames, { surnameTier: 'all', givenMood: 'all', gender: 'any', count: 4 })
  assert(combos === surnames.length * givenNames.length, '組み合わせ数がプール積と一致する', `combos=${combos}`)
}

console.log('== 5. 偏り防止（直近10バッチで同一候補は4回まで） ==')
{
  const { batchList } = simulate({ surnameTier: 'all', givenMood: 'classic', gender: 'male', count: 4 }, 60, 37)
  let violations = 0
  for (let start = 0; start + 10 <= batchList.length; start += 1) {
    const counts = new Map()
    batchList.slice(start, start + 10).flat().forEach((i) => {
      const k = gen.givenKey(i.given)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    })
    counts.forEach((v) => { if (v > 4) violations += 1 })
  }
  assert(violations === 0, 'どの10バッチ窓でも同じ名前が5回以上出ない', `violations=${violations}`)
  const distinct = new Set(batchList.flat().map((i) => gen.givenKey(i.given))).size
  assert(distinct >= 150, '60バッチで多様な名前が出る', `distinct=${distinct}/240`)
}

console.log('== 6. コピー形式 ==')
{
  const item = { surname: surnames[0], given: givenNames[0], createdAt: 0 }
  const individual = gen.formatIndividual(item)
  assert(individual === `${item.surname.kanji} ${item.given.kanji}\n（${item.surname.reading} ${item.given.reading}）`, '個別コピー形式')
  const bulk = gen.formatBulk([item, item])
  assert(bulk.split('\n').length === 2 && bulk.startsWith('1. '), 'まとめてコピー形式（番号付き）')
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
