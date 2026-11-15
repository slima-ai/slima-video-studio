export const trailer = {
  'trailer.userRuleUnverifiedClaim':
    'Shot {n} mentions a bestseller, award or blurb claim you did not provide; remove it if you have no source text.',
  'trailer.userRuleNarrationShare':
    'Shots with narration add up to {sec} seconds, over 60% of the film ({limit} seconds).',
  'trailer.userRuleNarrationDense': 'Shot {n}’s narration is too long: {units}, at most {limit}.',
  'trailer.userRuleLength': 'Total {total} seconds, target {target} seconds, {diff} seconds off.',
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
  'trailer.ruleTitleNoAction': 'No release info, so the title card will show only the book title.',
  'trailer.ruleUnverifiedClaim':
    'Shot {n} mentions a bestseller, award or blurb claim that you did not provide. Blurbs, awards and sales figures may only use text you provided; remove it if you have none.',
  'trailer.ruleUnverifiedAuthor':
    "Shot {n} states something about the author (a title, what they have done) that you did not provide and that the text does not say. Use only the author's name you gave and words that are in the text; with nothing, show just the name.",
  'trailer.ruleTooManyVisuals':
    'The script uses {count} main visuals (places); the most is {max}. Each one needs its own place card, so merge them into fewer and use the same name for the same picture.',
  'trailer.ruleFewVisuals':
    'Only {count} main visual(s) (places); {min} or more keeps the pictures from feeling flat.',
  'trailer.ruleBeatTooShort':
    'Shot {n} is only {sec} seconds long; a picture shot must be at least {min} seconds so it can be seen.',
  'trailer.warnMovingTooShort':
    'Shot {n} is a moving shot of only {sec} seconds; a moving shot should be at least {min} seconds. Consider making it a still picture.',
  'trailer.warnCardHoldTooLong':
    'The text card in shot {n} stays {sec} seconds. It has few words; keep it to {max} seconds or less so the pace does not drag.',
  'trailer.warnTitleHoldTooLong':
    'The title card stays {sec} seconds; keep it to {max} seconds or less.',
  'trailer.warnBeatHoldTooLong':
    'Shot {n} stays {sec} seconds; keep it to {max} seconds or less, or it looks frozen.',
  'trailer.ruleNoEscalation':
    'The last third isn’t shorter than the first (average {last} seconds against {first} seconds).',
  'trailer.beatVideo': 'Moving',
  'trailer.beatStill': 'Still',
  'trailer.beatCard': 'Text card',
  'trailer.beatTitle': 'Title card',
  'trailer.beatKindLabel': 'This shot is',
  'trailer.beatKindHint':
    'Moving: an AI-generated video. Still: one picture slowly pushed in or pulled out, made on this computer. Text card: a shot with only words, made on this computer. The last two are free.',
  'trailer.titleCardNote':
    'This shot is the title card. Its content (book title, cover, release info) is edited in the trailer settings.',
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
  'trailer.fixMovingToStill':
    'Shot {n} was a moving shot but too short, so it was changed to a still picture.',
  'trailer.fixFirstShortened': 'The first shot was shortened to 4 seconds.',
  'trailer.fixLengthFitted':
    'The shot lengths were adjusted so they add up to exactly {target} seconds.',
  'trailer.scriptRejected':
    'The script that was written did not pass the checks, and the project was not changed. {problems} Please try again.',
  'trailer.shortenHint': 'The text is long; you can also shorten it and try again.',
  'trailer.sceneTitle': 'Trailer',
  'trailer.noScript': 'There is no trailer script yet. Write the script first.',
  'trailer.cardNotInScript':
    'That shot is not part of the trailer script. Use a shot of the trailer.',
  'trailer.refitImpossible':
    'The target is too short: the minimum time of every shot (0.75 seconds for a picture, more for text cards and the title card) already adds up to more than that. Write the script again for the new length, or make the target longer.',
  'trailer.noTextModel':
    'There is no text model available, so a script cannot be written. Pick a text model in Settings.',
  'trailer.kindStory': 'Story',
  'trailer.kindTeaser': 'Teaser',
  'trailer.kindIdea': 'Key quotes',
  'trailer.visuals': 'Key visuals',
  'trailer.lengthSec': '{n} s',
  'trailer.start.title': 'Make a trailer',
  'trailer.start.textPlaceholder': 'Paste a passage or story from the book',
  'trailer.start.count': '{used} / {max} characters',
  'trailer.start.onlyFirst': 'Only the first {max} characters will be used.',
  'trailer.start.titlePlaceholder': 'Book title',
  'trailer.start.length': 'Length',
  'trailer.start.kind': 'Type',
  'trailer.start.go': 'Write the script first',
  'trailer.start.goReal': 'Write the script first (about US${usd})',
  'trailer.start.going': 'Writing the script…',
  'trailer.start.failed': 'The script could not be written',
  'trailer.badgeName': 'Trailer',
  'trailer.badgeLength': '{script}/{target} s',
  'trailer.panel.title': 'Trailer settings',
  'trailer.panel.close': 'Close',
  'trailer.panel.fit': 'Auto-adjust',
  'trailer.panel.titleLabel': 'Book title',
  'trailer.panel.author': 'Author',
  'trailer.panel.tagline': 'Tagline',
  'trailer.panel.endLine': 'Release info',
  'trailer.panel.endLinePlaceholder': 'Out December 1 in bookstores',
  'trailer.panel.narration': 'Narration',
  'trailer.panel.music': 'Music',
  'trailer.panel.rewrite': 'Rewrite the script',
  'trailer.panel.rewriteReal': 'Rewrite the script (about US${usd})',
  'trailer.panel.rewriting': 'Rewriting…',
  'trailer.filmLength': 'Film {sec} s',
  'trailer.filmLengthOff': 'Film {sec} s (target {target} s)',
  'trailer.panel.length': 'Length',
  'trailer.panel.cancel': 'Not now',
  'trailer.panel.rewriteConfirm': 'Rewrite it',
  'trailer.panel.replaceWarn':
    '{generated} generated pictures will be replaced. You can undo this.',
  'trailer.aspect.label': 'Frame',
  'trailer.aspect.landscape': 'Wide',
  'trailer.aspect.portrait': 'Tall',
  'trailer.aspect.note':
    'Pictures made from now on use the new shape. The ones already made stay as they are.',
  'trailer.page.mock': 'Preview',
  'trailer.page.player': 'Trailer player',
  'trailer.page.noPicture': 'This beat has no picture yet',
  'trailer.segment.hook': 'Hook',
  'trailer.segment.world': 'World',
  'trailer.segment.turn': 'Turn',
  'trailer.segment.escalate': 'Escalate',
  'trailer.segment.suspense': 'Suspense',
  'trailer.segment.montage': 'Montage',
  'trailer.segment.title': 'Title',
  'trailer.page.strip': 'Trailer script strip',
  'trailer.page.cell': 'Beat {n} · {kind} · {sec} s',
  'trailer.page.cellGenerating': 'Generating',
  'trailer.page.cellFailed': 'Failed',
  'trailer.page.cellEmpty': 'Not made yet',
  'trailer.page.narrationRow': 'Narration',
  'trailer.page.musicRow': 'Music',
  'trailer.beatNotInScript': 'That beat is not in the trailer script.',
  'trailer.beatSecondsImpossible':
    'The other beats are already as short as they can be. This one can be at most {max} seconds.',
  'trailer.firstBeatTooLong': 'The first beat can be at most {max} seconds.',
  'trailer.edit.beat': 'Beat {n}',
  'trailer.edit.seconds': 'Length in seconds',
  'trailer.edit.secondsUnit': 's',
  'trailer.edit.shorter': 'Shorten by 0.25 s',
  'trailer.edit.longer': 'Lengthen by 0.25 s',
  'trailer.edit.segment': 'Section',
  'trailer.edit.noSegment': '(No section)',
  'trailer.edit.action': 'Action',
  'trailer.edit.narration': 'Narration',
  'trailer.edit.countChars': '{n}/{max} characters',
  'trailer.edit.countWords': '{n}/{max} words',
  'trailer.edit.titleNote': 'The title card text is changed in Settings on the right.',
  'trailer.menu.addCard': 'Add a text card after this',
  'trailer.menu.remove': 'Delete this beat',
  'trailer.menu.cardNeedsText':
    'This beat has no card text yet: select it, press Text card below and type the words',
  'trailer.menu.titleCannotRemove': 'The title card cannot be deleted',
  'trailer.menu.newCardText': 'New card',
  'trailer.teaserTooLong':
    'A teaser can be at most {max} seconds. For a longer one, choose the story type.',
  'trailer.start.reopen': 'Reopen "{name}"',
} as const
