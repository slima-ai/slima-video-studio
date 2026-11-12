export const trailer = {
  'trailer.cardNoText': 'The text card has no text yet. Write the words to show first.',
  'trailer.titleCardNoName':
    'The trailer settings have no book title yet, so the title card has nothing to show.',
  'trailer.notACardShot': 'This shot is not a text card or the title card.',
  'trailer.coverMissing': 'Could not find the cover picture. Please pick a cover again.',
  'trailer.coverNotAnImage': 'The cover has to be a picture file (png, jpg or webp).',
  'trailer.coverTooBig':
    'The cover picture file is too big. Please use a smaller one (under 20 MB).',
  'trailer.cardRenderFailed': 'Something went wrong while drawing the card. Please try again.',
  'trailer.invalidSettings':
    'The trailer settings are not valid (the length must be between 10 and 120 seconds, and the cover must be an asset).',
  'trailer.ruleEmpty': 'The script has no shots yet.',
  'trailer.ruleLength':
    'The trailer is {total} seconds long but the target is {target} seconds, {diff} seconds off. Adjust the seconds of each shot so they add up to the target (within 0.05 seconds).',
  'trailer.ruleFirstNotPicture':
    'The first shot must be a picture (video or a still), not a text card or the title card.',
  'trailer.ruleFirstTooLong':
    'The first shot is {sec} seconds long; it can be at most {max} seconds. Hook people right at the start.',
  'trailer.ruleNarrationDense':
    'The narration of shot {n} has {units} characters (or words) but the shot is only {sec} seconds, which fits at most {limit}. Shorten the line.',
  'trailer.ruleNarrationShare':
    'The shots with narration add up to {sec} seconds, over 60% of the film ({limit} seconds). Leave some shots silent and give the time to the pictures and the music.',
  'trailer.ruleNarrationOneSentence':
    'The narration of shot {n} is more than one sentence. Put one sentence per shot and do not let a sentence run across shots.',
  'trailer.ruleCardEmpty': 'Shot {n} is a text card but has no text.',
  'trailer.ruleCardTooLong':
    'The text card in shot {n} has {units} characters (or words); the limit is {limit}. Shorten it.',
  'trailer.ruleCardTooShort':
    'The text card in shot {n} stays only {sec} seconds; it needs at least {min} seconds to be read (0.8 seconds plus 0.2 seconds per character).',
  'trailer.ruleTooManyCards':
    'There are more than {limit} text cards (the title card does not count). Remove some.',
  'trailer.ruleNoTitle': 'There is no title card. End with one title card.',
  'trailer.ruleTitleTooShort':
    'The title card in shot {n} is only {sec} seconds long; it needs at least {min} seconds.',
  'trailer.ruleTitleMissingName':
    'The trailer settings have no book title yet, so the title card has nothing to show.',
  'trailer.ruleTitleNoAction':
    'The trailer settings have no closing line (release date, where to buy), so the title card will show only the book title.',
  'trailer.ruleUnverifiedClaim':
    'Shot {n} mentions a bestseller, award or blurb claim that you did not provide. Blurbs, awards and sales figures may only use text you provided; remove it if you have none.',
  'trailer.ruleNoEscalation':
    'The last third of the shots is not shorter than the first third (average {last} seconds against {first} seconds). Trailers usually cut faster toward the end. This is only a reminder and does not block anything.',
  'trailer.beatVideo': 'Moving',
  'trailer.beatStill': 'Still',
  'trailer.beatCard': 'Text card',
  'trailer.beatTitle': 'Title card',
  'trailer.beatKindLabel': 'This shot is',
  'trailer.beatKindHint':
    'Moving: an AI-generated video. Still: one picture slowly pushed in or pulled out, made on this computer. Text card: a shot with only words, made on this computer. The last two are free.',
  'trailer.titleCardNote':
    'This shot is the title card. Its content (book title, cover, closing line) is edited in the trailer settings.',
  'trailer.cardText': 'Card text',
  'trailer.cardSubtext': 'Small text (optional)',
  'trailer.cardTextPlaceholder': 'For example: Some light, and someone to keep it with you',
  'trailer.localFree': 'On this computer · free',
  'trailer.stepStill': '{no}: still picture (on this computer, free)',
  'trailer.stepCard': '{no}: text card (on this computer, free)',
  'trailer.stepTitle': '{no}: title card (on this computer, free)',
  'trailer.lengthOverMax':
    'This shot needs {want} seconds, but the current video model makes at most {max} seconds per video. The video will be {max} seconds, shorter than the shot. Split the shot in two, or pick another model.',
  'trailer.runOverMax':
    '{no}: wants {want} seconds, over the video model limit of {max} seconds. The video will be {max} seconds.',
  'trailer.fixCardCut': 'The text card in shot {n} was too long and has been shortened.',
  'trailer.fixNarrationRemoved':
    'The narration in shot {n} was removed (this trailer has no narration, or the shot is not a picture).',
  'trailer.fixNarrationCut':
    'The narration in shot {n} was too long and has been cut to one sentence.',
  'trailer.fixFirstShortened': 'The first shot was shortened to 4 seconds.',
  'trailer.fixLengthFitted':
    'The shot lengths were adjusted so they add up to exactly {target} seconds.',
  'trailer.scriptRejected':
    'The script that was written did not pass the checks, and the project was not changed. {problems} Please try again, or use a shorter text.',
  'trailer.sceneTitle': 'Trailer',
  'trailer.noScript': 'There is no trailer script yet. Write the script first.',
  'trailer.refitImpossible':
    'The target is too short: the minimum time for the text cards and the title card already adds up to more than that. Make the target longer, or remove some text cards.',
  'trailer.noTextModel':
    'There is no text model available, so a script cannot be written. Pick a text model in Settings.',
} as const
