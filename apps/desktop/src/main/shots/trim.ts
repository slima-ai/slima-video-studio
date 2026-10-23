import type { Take, Trim } from '@svs/schema'

/** 這支影片版本的裁切；沒裁（兩端都沒設）就是 undefined。 */
export function trimOfTake(take: Take | undefined): Trim | undefined {
  if (!take || (take.trimInSec === undefined && take.trimOutSec === undefined)) return undefined
  return {
    ...(take.trimInSec === undefined ? {} : { inSec: take.trimInSec }),
    ...(take.trimOutSec === undefined ? {} : { outSec: take.trimOutSec }),
  }
}
