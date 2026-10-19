import type { ProjectHandle } from '@svs/db'
import type { Shot, ShotSize } from '@svs/schema'

/** 越近的景別越能看清楚臉。 */
const SIZE_SCORE: Readonly<Record<ShotSize, number>> = {
  close_up: 4,
  medium: 3,
  extreme_close_up: 2,
  full: 1,
  wide: 0,
  extreme_wide: -1,
}

/**
 * 替角色挑一張最清楚的畫面當主圖：景別越近越好、畫面裡同時出現的角色越少越好，
 * 一樣好就取比較前面的鏡頭。只看已經生成好的首幀圖（優先用採用中的）。
 */
export function pickHeroFrame(
  name: string,
  shots: readonly Shot[],
  frameOf: (shot: Shot) => { assetHash: string; modelId: string } | undefined,
): { assetHash: string; modelId: string } | undefined {
  let best: { score: number; frame: { assetHash: string; modelId: string } } | undefined
  for (const shot of shots) {
    if (!shot.characters.some((c) => c.name === name)) continue
    const frame = frameOf(shot)
    if (!frame) continue
    const others = shot.characters.filter((c) => c.name !== name).length
    const score = SIZE_SCORE[shot.size] - 0.5 * others
    if (!best || score > best.score) best = { score, frame }
  }
  return best?.frame
}

/** 鏡頭裡出現、但還沒有角色卡的名字（依出現順序）。 */
export function newCharacterNamesOf(handle: ProjectHandle): string[] {
  const known = new Set(handle.repos.characters.list().map((c) => c.name))
  const names: string[] = []
  for (const shot of handle.repos.shots.list()) {
    for (const { name } of shot.characters) {
      if (name && !known.has(name) && !names.includes(name)) names.push(name)
    }
  }
  return names
}

/**
 * 替鏡頭裡出現、但還沒有角色卡的名字建草稿角色卡，並從已生成的首幀圖挑一張最清楚的當主圖。
 * 只整理資料，不會生成任何東西。
 */
export function createDraftCharacters(
  handle: ProjectHandle,
): { name: string; heroPicked: boolean }[] {
  const { characters, shots } = handle.repos
  const list = shots.list()
  const frameOf = (shot: Shot): { assetHash: string; modelId: string } | undefined => {
    const frames = shots.listTakes(shot.id, 'first_frame')
    const take = frames.find((t) => t.adopted) ?? frames.at(-1)
    return take ? { assetHash: take.assetHash, modelId: take.modelId } : undefined
  }
  return newCharacterNamesOf(handle).map((name) => {
    const character = characters.create(name)
    const frame = pickHeroFrame(name, list, frameOf)
    if (frame) {
      const concept = characters.addConcept({
        characterId: character.id,
        round: 1,
        slot: 0,
        assetHash: frame.assetHash,
        modelId: frame.modelId,
      })
      characters.pickHero(character.id, concept.id)
    }
    return { name, heroPicked: frame !== undefined }
  })
}
