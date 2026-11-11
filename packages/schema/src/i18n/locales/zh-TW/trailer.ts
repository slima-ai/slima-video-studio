export const trailer = {
  'trailer.invalidSettings': '預告片設定的格式不對（長度要在 10～120 秒之間，封面要是素材）。',
  'trailer.ruleEmpty': '腳本裡還沒有任何一格。',
  'trailer.ruleLength':
    '預告片總長是 {total} 秒，目標是 {target} 秒，差 {diff} 秒。請調整各格的秒數，讓加總剛好等於目標（誤差不超過 0.05 秒）。',
  'trailer.ruleFirstNotPicture': '第一格必須是畫面（影片或靜態畫面），不能是字卡或片名卡。',
  'trailer.ruleFirstTooLong': '第一格有 {sec} 秒，不能超過 {max} 秒；要在最前面就抓住觀眾。',
  'trailer.ruleNarrationDense':
    '第 {n} 格的旁白有 {units} 個字（或單字），這一格只有 {sec} 秒，最多念得完 {limit} 個。請把這句縮短。',
  'trailer.ruleNarrationShare':
    '有旁白的格子加起來 {sec} 秒，超過全片的 60%（{limit} 秒）。請讓一些格子不說話，把時間留給畫面和音樂。',
  'trailer.ruleNarrationOneSentence': '第 {n} 格的旁白不只一句。一格只放一句，句子不要跨格。',
  'trailer.ruleCardEmpty': '第 {n} 格是字卡，但沒有字。',
  'trailer.ruleCardTooLong': '第 {n} 格的字卡有 {units} 個字，上限是 {limit} 個。請把字卡縮短。',
  'trailer.ruleCardTooShort':
    '第 {n} 格的字卡只停 {sec} 秒，至少要 {min} 秒才讀得完（0.8 秒加上每個字 0.2 秒）。',
  'trailer.ruleTooManyCards': '字卡超過 {limit} 張（片名卡不算）。請拿掉幾張。',
  'trailer.ruleNoTitle': '沒有片名卡。最後要有一格片名卡。',
  'trailer.ruleTitleTooShort': '第 {n} 格的片名卡只有 {sec} 秒，至少要 {min} 秒。',
  'trailer.ruleTitleMissingName': '預告片設定裡還沒有書名，片名卡不知道要放什麼。',
  'trailer.ruleTitleNoAction':
    '預告片設定裡沒有片尾那一行（哪天上市、去哪裡買），片名卡上只會有書名。',
  'trailer.ruleUnverifiedClaim':
    '第 {n} 格提到了暢銷、獎項、推薦語之類的說法，但這不是你提供的。推薦語、獎項、銷量只能用你自己提供的原文；沒有就拿掉。',
  'trailer.ruleNoEscalation':
    '後面三分之一的格子沒有比前面三分之一短（平均 {last} 秒對 {first} 秒）。預告片通常越到後面剪得越快；這只是提醒，不會擋下。',
} as const
