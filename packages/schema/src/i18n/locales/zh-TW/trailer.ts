export const trailer = {
  'trailer.cardNoText': '字卡還沒有字，請先寫上要顯示的文字。',
  'trailer.titleCardNoName': '預告片設定裡還沒有書名，片名卡不知道要放什麼。',
  'trailer.notACardShot': '這一格不是字卡或片名卡。',
  'trailer.coverMissing': '找不到封面圖，請重新選一張封面。',
  'trailer.coverNotAnImage': '封面要是圖片檔（png、jpg 或 webp）。',
  'trailer.coverTooBig': '封面圖的檔案太大了，請換一張小一點的（20 MB 以內）。',
  'trailer.cardRenderFailed': '畫字卡的時候出錯了，請再試一次。',
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
  'trailer.beatVideo': '會動',
  'trailer.beatStill': '不動',
  'trailer.beatCard': '字卡',
  'trailer.beatTitle': '片名卡',
  'trailer.beatKindLabel': '這一格是',
  'trailer.beatKindHint':
    '會動：AI 生成的影片。不動：一張圖慢慢推近或拉遠，在這台電腦上做。字卡：只有文字的一格，在這台電腦上做。後兩種不花錢。',
  'trailer.titleCardNote': '這一格是片名卡。內容（書名、封面、片尾那一行）在預告片設定裡改。',
  'trailer.cardText': '字卡上的字',
  'trailer.cardSubtext': '小字（可以不填）',
  'trailer.cardTextPlaceholder': '例如：有些光，要有人陪你一起守',
  'trailer.localFree': '本機・不花錢',
  'trailer.stepStill': '{no}：不動的畫面（本機，不花錢）',
  'trailer.stepCard': '{no}：字卡（本機，不花錢）',
  'trailer.stepTitle': '{no}：片名卡（本機，不花錢）',
  'trailer.lengthOverMax':
    '這一格要 {want} 秒，但現在的影片模型一支最多 {max} 秒：影片只會有 {max} 秒，比格長短。請把這一格拆成兩格，或換一個模型。',
  'trailer.runOverMax': '{no}：要 {want} 秒，超過影片模型的上限 {max} 秒，影片只會有 {max} 秒。',
  'trailer.fixCardCut': '第 {n} 格的字卡太長，已截短。',
  'trailer.fixNarrationRemoved': '第 {n} 格的旁白拿掉了（這一支不要旁白，或這一格不是畫面）。',
  'trailer.fixNarrationCut': '第 {n} 格的旁白太長，已截短成一句。',
  'trailer.fixFirstShortened': '第一格縮短到 4 秒。',
  'trailer.fixLengthFitted': '各格秒數已調整，加總剛好是 {target} 秒。',
  'trailer.scriptRejected':
    '寫出來的腳本沒有通過檢查，專案沒有被改。{problems} 請再試一次，或把文本縮短一點。',
  'trailer.sceneTitle': '預告片',
  'trailer.noScript': '還沒有預告片腳本。請先寫腳本。',
  'trailer.refitImpossible':
    '目標太短：字卡與片名卡的最短停留秒數加起來就超過了，放不下。請把目標拉長，或拿掉幾張字卡。',
  'trailer.noTextModel': '現在沒有可用的文字模型，沒辦法寫腳本。請到設定選一個文字模型。',
} as const
