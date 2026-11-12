export const sound = {
  'sound.low': 'Low',
  'sound.medium': 'Medium',
  'sound.high': 'High',
  'sound.linesNarrationReadsExactlyThis': 'Lines (narration reads exactly this)',
  'sound.forExampleBlackVinesCover': 'For example: Black vines cover the broken bridge.',
  'sound.saveLines': 'Save lines',
  'sound.canTMakeNarrationRight': 'Can’t make narration right now.',
  'sound.soundForThisShot': 'Sound for this shot',
  'sound.sound': 'Sound',
  'sound.useTheVideoSOwn': 'Use the video’s own sound',
  'sound.narrationVersion': 'Narration: version {version}',
  'sound.narrationSVersion': 'Narration: {value} s · version {version}',
  'sound.thisShotHasNoLines':
    'This shot has no lines yet, so there’s no narration. Write a line below and it can be read aloud.',
  'sound.thisShotHasNoNarration': 'This shot has no narration yet.',
  'sound.aboutStart': 'About {value}. Start?',
  'sound.start': 'Start',
  'sound.cancel': 'Cancel',
  'sound.readingAloud': 'Reading aloud…',
  'sound.saveTheLinesFirst': 'Save the lines first',
  'sound.readAgain': 'Read again',
  'sound.readThisLineAloud': 'Read this line aloud',
  'sound.deleteThisShotSNarration':
    'Delete this shot’s narration (the lines stay, so you can read them again). You can undo this.',
  'sound.deletedThisShotSNarration':
    'Deleted this shot’s narration. The lines are still there, so you can read them again.',
  'sound.deleteNarration': 'Delete narration',
  'sound.mixing': 'Mixing…',
  'sound.volume': '{label} volume',
  'sound.off': 'Off',
  'sound.delete': 'Delete',
  'sound.about': 'About {value}: {value2}.',
  'sound.canTAddSoundRight': 'Can’t add sound right now.',
  'sound.narration': 'Narration {value}/{value2}…',
  'sound.music': 'Music…',
  'sound.mixing2': 'Mixing…',
  'sound.firstJoinTheShotsInto':
    'First join the shots into a film (press “Join into film” on the Cut in the canvas), then add sound.',
  'sound.start2': '{value} Start?',
  'sound.noNarrationOrMusicModel':
    'No narration or music model is available yet. Add your OpenRouter API key in Settings (or turn on demo mode).',
  'sound.gettingAnEstimate': 'Getting an estimate…',
  'sound.addNarrationAndMusic': 'Add narration and music',
  'sound.readsEachShotSLines':
    'Reads each shot’s lines, adds a piece of background music, and mixes it all into the film. You’ll see the estimated cost first, and nothing starts until you confirm.',
  'sound.videoSound': 'Video sound',
  'sound.narration2': 'Narration',
  'sound.deleteTheNarrationForEvery':
    'Delete the narration for every shot (the lines stay, so you can read them again). You can undo this.',
  'sound.noShotHasLinesSo':
    'No shot has lines, so there’s no narration. Write lines in a shot and they’ll be read aloud.',
  'sound.music2': 'Music',
  'sound.deleteMusic': 'Delete music',
  'sound.deleteThisMusicNarrationIsn':
    'Delete this music (narration isn’t affected). You can undo this.',
  'sound.deletedTheMusic': 'Deleted the music.',
  'sound.shotsHaveNarrationAndThere':
    '{value} shots have narration, and there’s music. Changing the volume is free and re-mixes automatically.',
  'sound.shotsHaveNarrationAndThere2':
    '{value} shots have narration, and there’s no music. Changing the volume is free and re-mixes automatically.',
  'sound.thereSNoNarrationBut':
    'There’s no narration, but there’s music. Changing the volume is free and re-mixes automatically.',
  'sound.thereSNoNarrationAnd':
    'There’s no narration and no music. Changing the volume is free and re-mixes automatically.',
  'sound.mixAgainFree': 'Mix again (free)',
  'sound.soundTimeline': 'Sound timeline',
  'sound.timeline': 'Timeline',
  'sound.playCell': 'Shot {number}: select it, then press Space to play the kept part',
  'sound.playHint': 'Space plays or pauses only the kept {start}–{end} s (shot {number})',
  'sound.ruler': 'Seconds ruler',
  'sound.cutOff': 'Trimmed',
  'sound.cutOffTip': 'Shot {number}: {cut} s trimmed',
  'sound.shotCellTip': 'Shot {number}: {kept} s used in the film (whole video {total} s)',
  'sound.edgeIn': 'Shot {number} in point (drag to change where it starts being used)',
  'sound.edgeOut': 'Shot {number} out point (drag to change where it stops being used)',
  'sound.edgeReadout': 'Shot {number}: keeping {start}–{end} s, {length} s in all',
  'sound.shots': 'Shots',
  'sound.videoSound2': 'Video sound',
  'sound.undo': 'Undo',
  'sound.narrationLines_one': '{count} line of narration',
  'sound.narrationLines_other': '{count} lines of narration',
  'sound.musicTracks_one': '{count} piece of music',
  'sound.musicTracks_other': '{count} pieces of music',
  'sound.narrationMissing_one':
    '{count} shot has lines but no narration yet. Open it and press “Read this line aloud” (you’ll see an estimate first) to make it.',
  'sound.narrationMissing_other':
    '{count} shots have lines but no narration yet. Open a shot and press “Read this line aloud” (you’ll see an estimate first) to make it.',
  'sound.narrationsDeleted_one':
    'Deleted {count} line of narration. The lines are still there, so you can read them again.',
  'sound.narrationsDeleted_other':
    'Deleted {count} lines of narration. The lines are still there, so you can read them again.',
  'sound.narrationShortened':
    'The narration for shot {value} was too long, so it was shortened to “{text}”. The shot’s line now says the same.',
  'sound.narrationsShortened_one':
    '{count} shot’s narration was too long, so it was shortened and read again. The shot’s line now says the same.',
  'sound.narrationsShortened_other':
    '{count} shots’ narrations were too long, so they were shortened and read again. The shots’ lines now say the same.',
  'sound.import.button': 'Use my own music…',
  'sound.import.busy': 'Importing…',
  'sound.import.hint':
    'Pick an mp3, wav or m4a (up to 50 MB); it is free and is used as the music right away.',
  'sound.import.own': '{name} (your own file)',
  'sound.import.done': '“{name}” is now the music (your own file, free).',
  'sound.import.unsupported': 'This kind of file cannot be used as music: pick an mp3, wav or m4a.',
  'sound.import.unreadable': 'This file cannot be read (it is empty or cannot be opened).',
  'sound.import.notAudio':
    'This file is not audio (or it is damaged), so it cannot be used as music.',
  'sound.import.tooBig': 'This file is too big: music can be at most {mb} MB.',
  'sound.import.pickTitle': 'Pick a music track',
  'sound.import.pickFilter': 'Audio (mp3, wav, m4a)',
} as const
