// 名前生成ロジック（UIから分離し、自動テストから直接検証できるようにしている）
//
// 方針（旧サイト「なまえ帳」仕様書 v1.0 の核を採用）:
// - 苗字は雰囲気ではなく頻度の傾向 tier で絞る。
// - 同一生成内では苗字・名前・姓名の重複を「禁止」する（抑制止まりにしない）。
// - 直近10バッチの出現回数で重みを下げ、4回以上出た候補は通常選択から外す。
// - 候補が足りない場合は、条件を無言で捨てず、件数を減らして理由を表示する。
// - 抽選はプール全体からの重み付き抽選。先頭N件だけに絞るような偏りを作らない。

export type Mood = 'modern' | 'classic' | 'elegant' | 'bright' | 'strong' | 'mysterious' | 'unique'
export type Gender = 'male' | 'female' | 'unisex'
export type GenderFilter = 'any' | Gender
export type SurnameTier = 'common' | 'familiar' | 'rare'
export type TierFilter = 'all' | SurnameTier

export interface Surname {
  kanji: string
  reading: string
  tier: SurnameTier
  population?: number | null
}

export interface GivenName {
  kanji: string
  reading: string
  gender: Gender
  moods: Mood[]
}

export interface GeneratedName {
  surname: Surname
  given: GivenName
  createdAt: number
}

export interface Conditions {
  surnameTier: TierFilter
  givenMood: Mood | 'all'
  gender: GenderFilter
  count: number
  fixedSurname?: Surname
  fixedGiven?: GivenName
}

export interface GenerationOutcome {
  results: GeneratedName[]
  shortageReason: string | null
  surnamePoolSize: number
  givenPoolSize: number
}

export const surnameKey = (s: Surname) => `${s.kanji}|${s.reading}`
export const givenKey = (g: GivenName) => `${g.kanji}|${g.reading}`
export const fullNameKey = (item: GeneratedName) => `${surnameKey(item.surname)}+${givenKey(item.given)}`

export function filterSurnames(all: Surname[], tier: TierFilter): Surname[] {
  return tier === 'all' ? all : all.filter((s) => s.tier === tier)
}

export function filterGiven(all: GivenName[], mood: Mood | 'all', gender: GenderFilter): GivenName[] {
  return all.filter((g) => {
    const moodOk = mood === 'all' || g.moods.includes(mood)
    // 男性寄り・女性寄りのプールには中性的候補も含める（男女どちらにも使える名前のため）。
    // 「中性的」を選んだ場合は中性的候補だけに絞る。
    const genderOk =
      gender === 'any' ? true : gender === 'unisex' ? g.gender === 'unisex' : g.gender === gender || g.gender === 'unisex'
    return moodOk && genderOk
  })
}

export function combinationCount(
  surnames: Surname[],
  givenNames: GivenName[],
  conditions: Conditions,
): number {
  const s = conditions.fixedSurname ? 1 : filterSurnames(surnames, conditions.surnameTier).length
  const g = conditions.fixedGiven ? 1 : filterGiven(givenNames, conditions.givenMood, conditions.gender).length
  return s * g
}

/** 1バッチ分の偏り防止キーを作る */
export function batchKeys(results: GeneratedName[]): string[] {
  const keys: string[] = []
  results.forEach((item) => {
    keys.push(`s:${surnameKey(item.surname)}`)
    keys.push(`g:${givenKey(item.given)}`)
  })
  return keys
}

function buildWeights<T>(
  pool: T[],
  keyOf: (item: T) => string,
  prefix: 's:' | 'g:',
  counts: Map<string, number>,
  lastBatch: Set<string>,
  usedKeys: Set<string>,
): { items: T[]; weights: number[] } {
  const items: T[] = []
  const weights: number[] = []
  for (const item of pool) {
    const key = keyOf(item)
    if (usedKeys.has(key)) continue
    const count = counts.get(prefix + key) ?? 0
    if (count >= 4) continue // 直近10バッチで4回以上出た候補は通常選択から外す
    let weight = 1 / (1 + count)
    if (lastBatch.has(prefix + key)) weight *= 0.5 // 直近バッチに出た候補は軽く避ける
    items.push(item)
    weights.push(weight)
  }
  return { items, weights }
}

function weightedPick<T>(items: T[], weights: number[], rng: () => number): T | undefined {
  if (items.length === 0) return undefined
  const total = weights.reduce((a, b) => a + b, 0)
  let cursor = rng() * total
  for (let i = 0; i < items.length; i += 1) {
    cursor -= weights[i]
    if (cursor <= 0) return items[i]
  }
  return items[items.length - 1]
}

export function generateBatch(
  surnames: Surname[],
  givenNames: GivenName[],
  conditions: Conditions,
  recentBatches: string[][],
  rng: () => number = Math.random,
): GenerationOutcome {
  const surnamePool = conditions.fixedSurname ? [conditions.fixedSurname] : filterSurnames(surnames, conditions.surnameTier)
  const givenPool = conditions.fixedGiven ? [conditions.fixedGiven] : filterGiven(givenNames, conditions.givenMood, conditions.gender)
  const surnamePoolSize = surnamePool.length
  const givenPoolSize = givenPool.length

  const counts = new Map<string, number>()
  recentBatches.slice(0, 10).forEach((batch) => {
    batch.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1))
  })
  const lastBatch = new Set(recentBatches[0] ?? [])

  const bothFixed = Boolean(conditions.fixedSurname && conditions.fixedGiven)
  const target = bothFixed ? 1 : conditions.count

  const usedSurnames = new Set<string>()
  const usedGiven = new Set<string>()
  const usedFull = new Set<string>()
  const results: GeneratedName[] = []

  for (let slot = 0; slot < target; slot += 1) {
    let surname: Surname | undefined
    if (conditions.fixedSurname) {
      surname = slot === 0 ? conditions.fixedSurname : undefined
      if (!surname) break
    } else {
      const { items, weights } = buildWeights(surnamePool, surnameKey, 's:', counts, lastBatch, usedSurnames)
      surname = weightedPick(items, weights, rng)
    }
    if (!surname) break

    let given: GivenName | undefined
    if (conditions.fixedGiven) {
      given = conditions.fixedGiven
    } else {
      // 「指定しない」のときは、データ件数の多い性別に偏らないよう、
      // 男性寄り候補と女性寄り候補のバケツを半々で選んでから抽選する（中性的は両方に入る）。
      const buckets: GivenName[][] =
        conditions.gender === 'any'
          ? [
              givenPool.filter((g) => g.gender === 'male' || g.gender === 'unisex'),
              givenPool.filter((g) => g.gender === 'female' || g.gender === 'unisex'),
            ]
          : [givenPool]
      // 姓名の重複を避けるため、数回まで引き直す
      for (let attempt = 0; attempt < 8 && !given; attempt += 1) {
        const bucket = buckets.length === 2 ? buckets[rng() < 0.5 ? 0 : 1] : buckets[0]
        const { items, weights } = buildWeights(bucket, givenKey, 'g:', counts, lastBatch, usedGiven)
        const candidate = weightedPick(items, weights, rng) ?? (() => {
          const other = buckets.find((b) => b !== bucket) ?? bucket
          const fallback = buildWeights(other, givenKey, 'g:', counts, lastBatch, usedGiven)
          return weightedPick(fallback.items, fallback.weights, rng)
        })()
        if (!candidate) break
        if (usedFull.has(`${surnameKey(surname)}+${givenKey(candidate)}`)) {
          usedGiven.add(givenKey(candidate))
          continue
        }
        given = candidate
      }
    }
    if (!given) break

    const item: GeneratedName = { surname, given, createdAt: Date.now() }
    if (usedFull.has(fullNameKey(item))) break
    usedSurnames.add(surnameKey(surname))
    usedGiven.add(givenKey(given))
    usedFull.add(fullNameKey(item))
    results.push(item)
  }

  let shortageReason: string | null = null
  if (bothFixed && conditions.count > 1) {
    shortageReason = '名字と名前の両方が固定されているため、1件だけ表示しています。片方の固定を外すと複数作れます。'
  } else if (results.length === 0) {
    shortageReason = `条件に合う候補が見つかりませんでした（名字 ${surnamePoolSize.toLocaleString()} 件／名前 ${givenPoolSize.toLocaleString()} 件）。条件をゆるめてみてください。`
  } else if (results.length < conditions.count) {
    shortageReason = `重複を避けながら作れる上限のため、${conditions.count}件ではなく ${results.length}件だけ表示しています（名字 ${surnamePoolSize.toLocaleString()} 件／名前 ${givenPoolSize.toLocaleString()} 件の候補から生成）。条件をゆるめると増やせます。`
  }

  return { results, shortageReason, surnamePoolSize, givenPoolSize }
}

export function formatIndividual(item: GeneratedName): string {
  return `${item.surname.kanji} ${item.given.kanji}\n（${item.surname.reading} ${item.given.reading}）`
}

export function formatBulk(items: GeneratedName[]): string {
  return items
    .map((item, i) => `${i + 1}. ${item.surname.kanji} ${item.given.kanji}（${item.surname.reading} ${item.given.reading}）`)
    .join('\n')
}
